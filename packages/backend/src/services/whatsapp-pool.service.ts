/**
 * Multi-line WhatsApp pool manager.
 *
 * Manages multiple WhatsApp connections via Baileys — one primary line for
 * outbound notifications, plus a pool of relay lines for blind
 * driver <-> recipient communication.
 *
 * Each line has its own Baileys socket, auth directory, and connection state.
 * Lines are persisted in the `whatsapp_lines` database table.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from '@whiskeysockets/baileys';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';

// Silent Baileys logger
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

export type LineStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface LineState {
  id: string;
  label: string;
  status: LineStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  isPrimary: boolean;
  isRelayPool: boolean;
  error: string | null;
}

interface ManagedLine {
  id: string;
  label: string;
  isPrimary: boolean;
  isRelayPool: boolean;
  authDir: string;
  sock: WASocket | null;
  status: LineStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  error: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const BASE_AUTH_DIR = config.WHATSAPP_AUTH_DIR || '/app/whatsapp-auth';

export class WhatsAppPoolService extends EventEmitter {
  private lines: Map<string, ManagedLine> = new Map();

  /**
   * Register a line from the database. Call this on startup for each
   * persisted line, and when creating a new line.
   */
  registerLine(opts: {
    id: string;
    label: string;
    isPrimary: boolean;
    isRelayPool: boolean;
    authDir: string;
    phoneNumber?: string | null;
  }): void {
    if (this.lines.has(opts.id)) return;

    this.lines.set(opts.id, {
      id: opts.id,
      label: opts.label,
      isPrimary: opts.isPrimary,
      isRelayPool: opts.isRelayPool,
      authDir: opts.authDir,
      sock: null,
      status: 'disconnected',
      qrCode: null,
      phoneNumber: opts.phoneNumber ?? null,
      error: null,
      reconnectTimer: null,
    });
  }

  /**
   * Remove a line from the pool. Disconnects first.
   */
  async removeLine(lineId: string): Promise<void> {
    const line = this.lines.get(lineId);
    if (!line) return;

    await this.disconnectLine(lineId, true);
    this.lines.delete(lineId);
  }

  /**
   * Update a line's metadata (label, primary, relay flags).
   */
  updateLine(lineId: string, updates: { label?: string; isPrimary?: boolean; isRelayPool?: boolean }): void {
    const line = this.lines.get(lineId);
    if (!line) return;

    if (updates.label !== undefined) line.label = updates.label;
    if (updates.isPrimary !== undefined) line.isPrimary = updates.isPrimary;
    if (updates.isRelayPool !== undefined) line.isRelayPool = updates.isRelayPool;
  }

  getLineState(lineId: string): LineState | null {
    const line = this.lines.get(lineId);
    if (!line) return null;

    return {
      id: line.id,
      label: line.label,
      status: line.status,
      qrCode: line.qrCode,
      phoneNumber: line.phoneNumber,
      isPrimary: line.isPrimary,
      isRelayPool: line.isRelayPool,
      error: line.error,
    };
  }

  getAllLineStates(): LineState[] {
    return Array.from(this.lines.values()).map((line) => ({
      id: line.id,
      label: line.label,
      status: line.status,
      qrCode: line.qrCode,
      phoneNumber: line.phoneNumber,
      isPrimary: line.isPrimary,
      isRelayPool: line.isRelayPool,
      error: line.error,
    }));
  }

  /**
   * Get the primary line (for outbound notifications).
   */
  getPrimaryLine(): ManagedLine | null {
    for (const line of this.lines.values()) {
      if (line.isPrimary) return line;
    }
    return null;
  }

  /**
   * Is the primary line connected and ready to send?
   */
  isPrimaryConnected(): boolean {
    const primary = this.getPrimaryLine();
    return primary?.status === 'connected';
  }

  /**
   * Send a message via the primary line (for notifications).
   */
  async sendMessage(
    phone: string,
    message: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const primary = this.getPrimaryLine();
    if (!primary || !primary.sock || primary.status !== 'connected') {
      return { success: false, error: 'WhatsApp primary line not connected' };
    }

    return this.sendOnLine(primary, phone, message);
  }

  /**
   * Send a message via a specific relay line (for blind comms).
   */
  async sendOnRelay(
    lineId: string,
    phone: string,
    message: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const line = this.lines.get(lineId);
    if (!line || !line.sock || line.status !== 'connected') {
      return { success: false, error: `Relay line ${lineId} not connected` };
    }

    return this.sendOnLine(line, phone, message);
  }

  /**
   * Get an available relay line from the pool.
   * Prefers lines not currently assigned to active sessions.
   */
  getAvailableRelayLine(excludeLineIds: string[] = []): ManagedLine | null {
    const exclude = new Set(excludeLineIds);
    for (const line of this.lines.values()) {
      if (line.isRelayPool && line.status === 'connected' && !exclude.has(line.id)) {
        return line;
      }
    }
    return null;
  }

  /**
   * Count connected relay lines.
   */
  getRelayPoolStats(): { total: number; connected: number; available: number } {
    let total = 0;
    let connected = 0;
    for (const line of this.lines.values()) {
      if (line.isRelayPool) {
        total++;
        if (line.status === 'connected') connected++;
      }
    }
    return { total, connected, available: connected };
  }

  /**
   * Connect a line. If auth state exists, reconnects. Otherwise, emits QR.
   */
  async connectLine(lineId: string): Promise<void> {
    const line = this.lines.get(lineId);
    if (!line) throw new Error(`Line ${lineId} not found`);
    if (line.sock) return; // already connected/connecting

    line.status = 'connecting';
    line.error = null;

    fs.mkdirSync(line.authDir, { recursive: true });

    const { state: authState, saveCreds } = await useMultiFileAuthState(line.authDir);

    const sock = makeWASocket({
      auth: authState,
      logger,
      printQRInTerminal: false,
      browser: ['SafeCare', 'Desktop', '1.0.0'],
      syncFullHistory: false,
    });

    line.sock = sock;

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        line.status = 'qr_ready';
        line.qrCode = qr;
        this.emit('qr', { lineId: line.id, qr });
      }

      if (connection === 'open') {
        line.status = 'connected';
        line.qrCode = null;
        line.error = null;

        const me = sock.user;
        if (me) {
          line.phoneNumber = me.id.split(':')[0] ?? me.id;
        }

        this.emit('connected', { lineId: line.id, phoneNumber: line.phoneNumber });
      }

      if (connection === 'close') {
        const err = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
        const statusCode = err?.output?.statusCode ?? DisconnectReason.connectionClosed;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        line.sock = null;

        if (loggedOut) {
          this.clearLineAuth(line);
          line.status = 'disconnected';
          line.phoneNumber = null;
          line.error = 'Logged out. Re-scan QR code to reconnect.';
          this.emit('disconnected', { lineId: line.id, reason: 'logged_out' });
        } else {
          line.status = 'disconnected';
          line.error = `Connection closed (${statusCode}). Reconnecting...`;
          this.emit('disconnected', { lineId: line.id, reason: 'temporary' });
          this.scheduleReconnect(line);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Listen for incoming messages (for relay forwarding)
    sock.ev.on('messages.upsert', (msg) => {
      if (msg.type === 'notify') {
        for (const m of msg.messages) {
          if (!m.key.fromMe && m.message) {
            this.emit('message', {
              lineId: line.id,
              from: m.key.remoteJid,
              text: m.message.conversation
                || m.message.extendedTextMessage?.text
                || '',
              messageId: m.key.id,
            });
          }
        }
      }
    });
  }

  /**
   * Disconnect a line. Optionally clear auth state.
   */
  async disconnectLine(lineId: string, clearAuth = false): Promise<void> {
    const line = this.lines.get(lineId);
    if (!line) return;

    if (line.reconnectTimer) {
      clearTimeout(line.reconnectTimer);
      line.reconnectTimer = null;
    }

    if (line.sock) {
      try {
        await line.sock.logout();
      } catch {
        // May already be disconnected
      }
      line.sock = null;
    }

    if (clearAuth) {
      this.clearLineAuth(line);
    }

    line.status = 'disconnected';
    line.qrCode = null;
    line.phoneNumber = null;
    line.error = null;
  }

  /**
   * Check if a line has saved auth state (previously paired).
   */
  lineHasAuth(lineId: string): boolean {
    const line = this.lines.get(lineId);
    if (!line) return false;
    const credsPath = path.join(line.authDir, 'creds.json');
    return fs.existsSync(credsPath);
  }

  /**
   * Auto-connect all lines that have saved auth state.
   * Called on startup.
   */
  async autoConnectAll(): Promise<void> {
    for (const line of this.lines.values()) {
      if (this.lineHasAuth(line.id)) {
        this.connectLine(line.id).catch(() => {
          // Logged via connection events
        });
      }
    }
  }

  /**
   * Generate the auth directory path for a new line.
   */
  static authDirForLine(lineId: string): string {
    return path.join(BASE_AUTH_DIR, `line-${lineId}`);
  }

  // --- Private ---

  private async sendOnLine(
    line: ManagedLine,
    phone: string,
    message: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!line.sock) {
      return { success: false, error: 'Socket not available' };
    }

    try {
      const jid = this.phoneToJid(phone);
      const result = await line.sock.sendMessage(jid, { text: message });
      return { success: true, messageId: result?.key?.id ?? undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown WhatsApp error',
      };
    }
  }

  private phoneToJid(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  private clearLineAuth(line: ManagedLine): void {
    try {
      if (fs.existsSync(line.authDir)) {
        fs.rmSync(line.authDir, { recursive: true, force: true });
        fs.mkdirSync(line.authDir, { recursive: true });
      }
    } catch {
      // Best effort
    }
  }

  private scheduleReconnect(line: ManagedLine): void {
    if (line.reconnectTimer) return;
    line.reconnectTimer = setTimeout(() => {
      line.reconnectTimer = null;
      this.connectLine(line.id).catch(() => {});
    }, 5000);
  }
}

export const whatsappPool = new WhatsAppPoolService();
