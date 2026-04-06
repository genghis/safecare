/**
 * WhatsApp messaging — backward-compatible wrapper around the pool service.
 *
 * The pool service manages multiple WhatsApp lines. This module re-exports
 * a compatibility shim so existing code (notification service, old routes)
 * keeps working without changes — it delegates to the primary line.
 */

import { whatsappPool } from './whatsapp-pool.service.js';

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface WhatsAppState {
  status: WhatsAppStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  error: string | null;
}

/**
 * Backward-compatible shim that delegates to the pool's primary line.
 */
export const whatsappService = {
  getState(): WhatsAppState {
    const primary = whatsappPool.getAllLineStates().find((l) => l.isPrimary);
    if (!primary) {
      return { status: 'disconnected', qrCode: null, phoneNumber: null, error: null };
    }
    return {
      status: primary.status,
      qrCode: primary.qrCode,
      phoneNumber: primary.phoneNumber,
      error: primary.error,
    };
  },

  isConnected(): boolean {
    return whatsappPool.isPrimaryConnected();
  },

  async sendMessage(phone: string, message: string) {
    return whatsappPool.sendMessage(phone, message);
  },

  async connect(): Promise<void> {
    const primary = whatsappPool.getAllLineStates().find((l) => l.isPrimary);
    if (primary) {
      await whatsappPool.connectLine(primary.id);
    }
  },

  async disconnect(clearAuth = false): Promise<void> {
    const primary = whatsappPool.getAllLineStates().find((l) => l.isPrimary);
    if (primary) {
      await whatsappPool.disconnectLine(primary.id, clearAuth);
    }
  },

  hasAuthState(): boolean {
    const states = whatsappPool.getAllLineStates();
    const primary = states.find((l) => l.isPrimary);
    if (primary) {
      return whatsappPool.lineHasAuth(primary.id);
    }
    return false;
  },

  // Expose pool events
  on: whatsappPool.on.bind(whatsappPool),
  removeListener: whatsappPool.removeListener.bind(whatsappPool),
  emit: whatsappPool.emit.bind(whatsappPool),
};
