/**
 * WhatsApp messaging via Baileys (unofficial WhatsApp Web API).
 *
 * Connects as a linked device — the coordinator scans a QR code from the
 * dashboard to pair, just like linking WhatsApp Web on a computer. Auth
 * state persists to disk so re-pairing isn't needed on every restart.
 *
 * IMPORTANT: This uses an unofficial API and may violate WhatsApp ToS.
 * Accounts used with this service can be banned. Use a dedicated prepaid
 * number, keep message volume low, and always configure a fallback channel.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from '@whiskeysockets/baileys';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

// Baileys requires a pino-compatible logger. Use a silent stub to suppress
// its very chatty default output without adding pino as a dependency.
const logger = {
  level: 'silent',
  child: () => logger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
} as unknown as Parameters<typeof makeWASocket>[0]['logger'];

export type WhatsAppStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'connected';

export interface WhatsAppState {
  status: WhatsAppStatus;
  qrCode: string | null;      // data URI or raw QR string for pairing
  phoneNumber: string | null;  // connected account number
  error: string | null;
}

const DEFAULT_AUTH_DIR = '/app/whatsapp-auth';

class WhatsAppService extends EventEmitter {
  private sock: WASocket | null = null;
  private state: WhatsAppState = {
    status: 'disconnected',
    qrCode: null,
    phoneNumber: null,
    error: null,
  };
  private authDir: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.authDir = process.env.WHATSAPP_AUTH_DIR ?? DEFAULT_AUTH_DIR;
  }

  getState(): WhatsAppState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.status === 'connected';
  }

  /**
   * Start the WhatsApp connection. If auth state exists on disk,
   * reconnects automatically. Otherwise, emits a QR code for pairing.
   */
  async connect(): Promise<void> {
    if (this.sock) {
      return; // already connected or connecting
    }

    this.state.status = 'connecting';
    this.state.error = null;

    // Ensure auth directory exists
    fs.mkdirSync(this.authDir, { recursive: true });

    const { state: authState, saveCreds } = await useMultiFileAuthState(
      this.authDir,
    );

    this.sock = makeWASocket({
      auth: authState,
      logger,
      printQRInTerminal: false,
      browser: ['SafeCare', 'Desktop', '1.0.0'],
      // Reduce connection noise — we only send messages, we don't need
      // chat history, presence updates, or read receipts.
      syncFullHistory: false,
    });

    // --- Connection events ---

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.state.status = 'qr_ready';
        this.state.qrCode = qr;
        this.emit('qr', qr);
      }

      if (connection === 'open') {
        this.state.status = 'connected';
        this.state.qrCode = null;
        this.state.error = null;

        // Extract phone number from socket
        const me = this.sock?.user;
        if (me) {
          this.state.phoneNumber = me.id.split(':')[0] ?? me.id;
        }

        this.emit('connected', this.state.phoneNumber);
      }

      if (connection === 'close') {
        // Extract status code from the Boom-shaped error Baileys provides
        const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
        const statusCode = err?.output?.statusCode ?? DisconnectReason.connectionClosed;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        this.sock = null;

        if (loggedOut) {
          // Session invalidated — clear auth state and wait for new QR scan
          this.clearAuthState();
          this.state.status = 'disconnected';
          this.state.phoneNumber = null;
          this.state.error = 'Logged out from WhatsApp. Re-pair to reconnect.';
          this.emit('disconnected', 'logged_out');
        } else {
          // Temporary disconnect — reconnect after a delay
          this.state.status = 'disconnected';
          this.state.error = `Connection closed (${statusCode}). Reconnecting...`;
          this.emit('disconnected', 'temporary');
          this.scheduleReconnect();
        }
      }
    });

    // Save credentials whenever they update (key rotation, etc.)
    this.sock.ev.on('creds.update', saveCreds);
  }

  /**
   * Send a WhatsApp message to a phone number.
   * Phone should be in E.164 format (e.g., +16125551234).
   */
  async sendMessage(
    phone: string,
    message: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.sock || this.state.status !== 'connected') {
      return { success: false, error: 'WhatsApp not connected' };
    }

    try {
      // Convert E.164 to WhatsApp JID format: 16125551234@s.whatsapp.net
      const jid = this.phoneToJid(phone);

      const result = await this.sock.sendMessage(jid, { text: message });

      return {
        success: true,
        messageId: result?.key?.id ?? undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown WhatsApp error',
      };
    }
  }

  /**
   * Disconnect and optionally clear auth state (forces re-pairing).
   */
  async disconnect(clearAuth = false): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // May already be disconnected
      }
      this.sock = null;
    }

    if (clearAuth) {
      this.clearAuthState();
    }

    this.state.status = 'disconnected';
    this.state.qrCode = null;
    this.state.phoneNumber = null;
    this.state.error = null;
  }

  /**
   * Check if auth state exists on disk (i.e., previously paired).
   */
  hasAuthState(): boolean {
    const credsPath = path.join(this.authDir, 'creds.json');
    return fs.existsSync(credsPath);
  }

  // --- Private helpers ---

  private phoneToJid(phone: string): string {
    // Strip + and any non-digit characters
    const digits = phone.replace(/\D/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  private clearAuthState(): void {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
        fs.mkdirSync(this.authDir, { recursive: true });
      }
    } catch {
      // Best effort
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Will retry via connection.close handler
      });
    }, 5000);
  }
}

export const whatsappService = new WhatsAppService();
