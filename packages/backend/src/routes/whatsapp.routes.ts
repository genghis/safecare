import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { whatsappService } from '../services/whatsapp.service.js';

export default async function whatsappRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/whatsapp/status
   * Check WhatsApp connection status (admin only).
   */
  fastify.get(
    '/api/whatsapp/status',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        success: true,
        data: whatsappService.getState(),
      });
    },
  );

  /**
   * POST /api/whatsapp/connect
   * Start the WhatsApp connection. If not yet paired, returns a QR code
   * that the coordinator scans with their WhatsApp app (Link a Device).
   * If already paired, reconnects automatically.
   */
  fastify.post(
    '/api/whatsapp/connect',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Start connection (async — QR code arrives via event)
        await whatsappService.connect();

        // Wait briefly for QR code or connection
        const state = await waitForState(3000);

        return reply.send({
          success: true,
          data: state,
        });
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: err instanceof Error ? err.message : 'Failed to connect',
        });
      }
    },
  );

  /**
   * POST /api/whatsapp/disconnect
   * Disconnect from WhatsApp and optionally clear auth state.
   * If clearAuth is true, the coordinator will need to re-scan QR next time.
   */
  fastify.post(
    '/api/whatsapp/disconnect',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { clearAuth?: boolean } | undefined;
      const clearAuth = body?.clearAuth ?? false;

      await whatsappService.disconnect(clearAuth);

      return reply.send({
        success: true,
        data: { disconnected: true, authCleared: clearAuth },
      });
    },
  );

  /**
   * GET /api/whatsapp/qr
   * Poll for the current QR code. Returns null if already connected
   * or if no QR has been generated yet.
   *
   * The dashboard polls this endpoint while showing the QR pairing screen.
   */
  fastify.get(
    '/api/whatsapp/qr',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const state = whatsappService.getState();

      return reply.send({
        success: true,
        data: {
          status: state.status,
          qrCode: state.qrCode,
        },
      });
    },
  );

  // Auto-connect on startup if previously paired
  if (whatsappService.hasAuthState()) {
    whatsappService.connect().catch((err) => {
      fastify.log.warn(
        `WhatsApp auto-connect failed: ${err instanceof Error ? err.message : err}`,
      );
    });
  }
}

/**
 * Wait for the WhatsApp state to change from 'connecting'.
 * Returns once a QR code is ready, connection opens, or timeout.
 */
function waitForState(timeoutMs: number): Promise<ReturnType<typeof whatsappService.getState>> {
  return new Promise((resolve) => {
    const state = whatsappService.getState();
    if (state.status !== 'connecting') {
      resolve(state);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve(whatsappService.getState());
    }, timeoutMs);

    const onQr = () => { cleanup(); resolve(whatsappService.getState()); };
    const onConnected = () => { cleanup(); resolve(whatsappService.getState()); };
    const onDisconnected = () => { cleanup(); resolve(whatsappService.getState()); };

    const cleanup = () => {
      clearTimeout(timer);
      whatsappService.removeListener('qr', onQr);
      whatsappService.removeListener('connected', onConnected);
      whatsappService.removeListener('disconnected', onDisconnected);
    };

    whatsappService.on('qr', onQr);
    whatsappService.on('connected', onConnected);
    whatsappService.on('disconnected', onDisconnected);
  });
}
