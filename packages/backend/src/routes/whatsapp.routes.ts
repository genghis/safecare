import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { whatsappPool, WhatsAppPoolService } from '../services/whatsapp-pool.service.js';
import { db } from '../db/index.js';
import { whatsappLines, whatsappRelaySessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function whatsappRoutes(fastify: FastifyInstance) {
  // ------------------------------------------------------------------
  // Line CRUD
  // ------------------------------------------------------------------

  /**
   * GET /api/whatsapp/lines
   * List all WhatsApp lines with their live connection status.
   */
  fastify.get(
    '/api/whatsapp/lines',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {

      const dbLines = await db.select().from(whatsappLines);

      // Merge DB rows with live in-memory state
      const liveStates = whatsappPool.getAllLineStates();
      const stateMap = new Map(liveStates.map((s) => [s.id, s]));

      const merged = dbLines.map((row) => {
        const live = stateMap.get(row.id);
        return {
          id: row.id,
          label: row.label,
          phoneNumber: live?.phoneNumber ?? row.phoneNumber,
          status: live?.status ?? row.status ?? 'disconnected',
          isPrimary: row.isPrimary,
          isRelayPool: row.isRelayPool,
          qrCode: live?.qrCode ?? null,
          error: live?.error ?? null,
          lastConnectedAt: row.lastConnectedAt,
          createdAt: row.createdAt,
        };
      });

      return reply.send({ success: true, data: merged });
    },
  );

  /**
   * POST /api/whatsapp/lines
   * Create a new WhatsApp line. Generates auth dir, saves to DB.
   */
  fastify.post(
    '/api/whatsapp/lines',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        label?: string;
        isPrimary?: boolean;
        isRelayPool?: boolean;
      } | undefined;


      const label = body?.label || 'WhatsApp Line';
      const isPrimary = body?.isPrimary ?? false;
      const isRelayPool = body?.isRelayPool ?? false;

      // If setting as primary, clear other primaries
      if (isPrimary) {
        await db
          .update(whatsappLines)
          .set({ isPrimary: false })
          .where(eq(whatsappLines.isPrimary, true));
      }

      // Generate a temporary ID to compute auth dir, then insert
      const tempId = crypto.randomUUID();
      const authDir = WhatsAppPoolService.authDirForLine(tempId);

      const [row] = await db
        .insert(whatsappLines)
        .values({
          id: tempId,
          label,
          isPrimary,
          isRelayPool,
          authDir,
          status: 'disconnected',
        })
        .returning();

      // Register in the pool service
      whatsappPool.registerLine({
        id: row.id,
        label: row.label,
        isPrimary: row.isPrimary ?? false,
        isRelayPool: row.isRelayPool ?? false,
        authDir: row.authDir,
      });

      return reply.code(201).send({
        success: true,
        data: {
          id: row.id,
          label: row.label,
          isPrimary: row.isPrimary,
          isRelayPool: row.isRelayPool,
          status: 'disconnected',
        },
      });
    },
  );

  /**
   * PATCH /api/whatsapp/lines/:id
   * Update a line's label, primary, or relay flags.
   */
  fastify.patch(
    '/api/whatsapp/lines/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        label?: string;
        isPrimary?: boolean;
        isRelayPool?: boolean;
      };



      // If setting as primary, clear other primaries
      if (body.isPrimary) {
        await db
          .update(whatsappLines)
          .set({ isPrimary: false })
          .where(eq(whatsappLines.isPrimary, true));
      }

      const updates: Record<string, unknown> = {};
      if (body.label !== undefined) updates.label = body.label;
      if (body.isPrimary !== undefined) updates.isPrimary = body.isPrimary;
      if (body.isRelayPool !== undefined) updates.isRelayPool = body.isRelayPool;

      const [updated] = await db
        .update(whatsappLines)
        .set(updates)
        .where(eq(whatsappLines.id, id))
        .returning();

      if (!updated) {
        return reply.code(404).send({ success: false, error: 'Line not found' });
      }

      whatsappPool.updateLine(id, body);

      return reply.send({ success: true, data: updated });
    },
  );

  /**
   * DELETE /api/whatsapp/lines/:id
   * Remove a line. Disconnects and clears auth state.
   */
  fastify.delete(
    '/api/whatsapp/lines/:id',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      await whatsappPool.removeLine(id);


      await db.delete(whatsappRelaySessions).where(eq(whatsappRelaySessions.whatsappLineId, id));
      await db.delete(whatsappLines).where(eq(whatsappLines.id, id));

      return reply.send({ success: true, data: { deleted: true } });
    },
  );

  // ------------------------------------------------------------------
  // Connection management
  // ------------------------------------------------------------------

  /**
   * POST /api/whatsapp/lines/:id/connect
   * Start connecting a line. Returns QR code if pairing is needed.
   */
  fastify.post(
    '/api/whatsapp/lines/:id/connect',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await whatsappPool.connectLine(id);

        // Wait briefly for QR or connection
        const state = await waitForLineState(id, 3000);

        // Persist status to DB
        if (state) {
    
          const dbUpdates: Record<string, unknown> = { status: state.status };
          if (state.phoneNumber) dbUpdates.phoneNumber = state.phoneNumber;
          if (state.status === 'connected') dbUpdates.lastConnectedAt = new Date();
          await db.update(whatsappLines).set(dbUpdates).where(eq(whatsappLines.id, id));
        }

        return reply.send({ success: true, data: state });
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: err instanceof Error ? err.message : 'Failed to connect',
        });
      }
    },
  );

  /**
   * POST /api/whatsapp/lines/:id/disconnect
   * Disconnect a line. Optionally clear auth.
   */
  fastify.post(
    '/api/whatsapp/lines/:id/disconnect',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { clearAuth?: boolean } | undefined;

      await whatsappPool.disconnectLine(id, body?.clearAuth ?? false);


      await db
        .update(whatsappLines)
        .set({ status: 'disconnected' })
        .where(eq(whatsappLines.id, id));

      return reply.send({
        success: true,
        data: { disconnected: true, authCleared: body?.clearAuth ?? false },
      });
    },
  );

  /**
   * GET /api/whatsapp/lines/:id/qr
   * Poll for the QR code of a specific line.
   */
  fastify.get(
    '/api/whatsapp/lines/:id/qr',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const state = whatsappPool.getLineState(id);

      if (!state) {
        return reply.code(404).send({ success: false, error: 'Line not found' });
      }

      return reply.send({
        success: true,
        data: { status: state.status, qrCode: state.qrCode },
      });
    },
  );

  // ------------------------------------------------------------------
  // Backward-compatible endpoints (delegate to primary line)
  // ------------------------------------------------------------------

  /**
   * GET /api/whatsapp/status
   */
  fastify.get(
    '/api/whatsapp/status',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const primary = whatsappPool.getAllLineStates().find((l) => l.isPrimary);
      const data = primary
        ? { status: primary.status, qrCode: primary.qrCode, phoneNumber: primary.phoneNumber, error: primary.error }
        : { status: 'disconnected', qrCode: null, phoneNumber: null, error: 'No primary line configured' };

      return reply.send({ success: true, data });
    },
  );

  /**
   * POST /api/whatsapp/connect (legacy — connects primary)
   */
  fastify.post(
    '/api/whatsapp/connect',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const primary = whatsappPool.getAllLineStates().find((l) => l.isPrimary);
      if (!primary) {
        return reply.code(400).send({ success: false, error: 'No primary line. Add a WhatsApp line first.' });
      }

      try {
        await whatsappPool.connectLine(primary.id);
        const state = await waitForLineState(primary.id, 3000);
        return reply.send({ success: true, data: state });
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: err instanceof Error ? err.message : 'Failed to connect',
        });
      }
    },
  );

  /**
   * POST /api/whatsapp/disconnect (legacy — disconnects primary)
   */
  fastify.post(
    '/api/whatsapp/disconnect',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { clearAuth?: boolean } | undefined;
      const primary = whatsappPool.getAllLineStates().find((l) => l.isPrimary);
      if (primary) {
        await whatsappPool.disconnectLine(primary.id, body?.clearAuth ?? false);
      }
      return reply.send({ success: true, data: { disconnected: true } });
    },
  );

  /**
   * GET /api/whatsapp/qr (legacy — primary QR)
   */
  fastify.get(
    '/api/whatsapp/qr',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const primary = whatsappPool.getAllLineStates().find((l) => l.isPrimary);
      return reply.send({
        success: true,
        data: {
          status: primary?.status ?? 'disconnected',
          qrCode: primary?.qrCode ?? null,
        },
      });
    },
  );

  // ------------------------------------------------------------------
  // Relay pool stats
  // ------------------------------------------------------------------

  /**
   * GET /api/whatsapp/pool/stats
   * Get relay pool health summary.
   */
  fastify.get(
    '/api/whatsapp/pool/stats',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const stats = whatsappPool.getRelayPoolStats();
      const allStates = whatsappPool.getAllLineStates();

      return reply.send({
        success: true,
        data: {
          ...stats,
          primaryConnected: whatsappPool.isPrimaryConnected(),
          totalLines: allStates.length,
        },
      });
    },
  );

  // ------------------------------------------------------------------
  // Startup: load lines from DB and auto-connect
  // ------------------------------------------------------------------

  try {
    const dbLines = await db.select().from(whatsappLines);

    for (const row of dbLines) {
      whatsappPool.registerLine({
        id: row.id,
        label: row.label,
        isPrimary: row.isPrimary ?? false,
        isRelayPool: row.isRelayPool ?? false,
        authDir: row.authDir,
        phoneNumber: row.phoneNumber,
      });
    }

    // Auto-connect lines that were previously paired
    await whatsappPool.autoConnectAll();

    // Persist status changes to DB
    whatsappPool.on('connected', async ({ lineId, phoneNumber }: { lineId: string; phoneNumber: string }) => {
      try {
  
        await db
          .update(whatsappLines)
          .set({ status: 'connected', phoneNumber, lastConnectedAt: new Date() })
          .where(eq(whatsappLines.id, lineId));
      } catch {
        // Best effort
      }
    });

    whatsappPool.on('disconnected', async ({ lineId }: { lineId: string }) => {
      try {
  
        await db
          .update(whatsappLines)
          .set({ status: 'disconnected' })
          .where(eq(whatsappLines.id, lineId));
      } catch {
        // Best effort
      }
    });
  } catch {
    // DB may not be ready at registration time — lines will be loaded on first request
    fastify.log.warn('WhatsApp: could not load lines from DB at startup');
  }
}

/**
 * Wait for a line's state to change from 'connecting'.
 */
function waitForLineState(
  lineId: string,
  timeoutMs: number,
): Promise<ReturnType<typeof whatsappPool.getLineState>> {
  return new Promise((resolve) => {
    const state = whatsappPool.getLineState(lineId);
    if (!state || state.status !== 'connecting') {
      resolve(state);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve(whatsappPool.getLineState(lineId));
    }, timeoutMs);

    const handler = (evt: { lineId: string }) => {
      if (evt.lineId === lineId) {
        cleanup();
        resolve(whatsappPool.getLineState(lineId));
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      whatsappPool.removeListener('qr', handler);
      whatsappPool.removeListener('connected', handler);
      whatsappPool.removeListener('disconnected', handler);
    };

    whatsappPool.on('qr', handler);
    whatsappPool.on('connected', handler);
    whatsappPool.on('disconnected', handler);
  });
}
