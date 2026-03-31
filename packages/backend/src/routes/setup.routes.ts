import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { provisionService } from '../services/provision.service.js';
import Redis from 'ioredis';
import { config, setDEK, isUnlocked } from '../config.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const redis = new Redis(config.REDIS_URL);

const unlockSchema = z.object({
  dek: z.string().regex(/^[0-9a-f]{64}$/i, 'DEK must be 64 hex characters'),
});

export default async function setupRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/setup/status
   * Returns whether initial setup is needed and whether the system is locked.
   * No auth required — this is used by the dashboard to decide which screen to show.
   */
  fastify.get(
    '/api/setup/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const adminExists = await authService.adminExists();
      const settingsRaw = await redis.get('org:settings');
      const settings = settingsRaw ? JSON.parse(settingsRaw) : null;
      const hasOperatingRegion = !!settings?.serviceArea?.bounds;

      let provisionStatus = 'not_started';
      try {
        const provRaw = await redis.get('map:provision:status');
        if (provRaw) {
          const prov = JSON.parse(provRaw);
          provisionStatus = prov.status || 'not_started';
        }
      } catch { /* ignore */ }

      // Check if Nominatim is actually serving
      if (provisionStatus === 'ready' || provisionStatus === 'importing') {
        try {
          const res = await fetch(`${config.GEOCODING_URL}/status`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) provisionStatus = 'ready';
          else provisionStatus = 'importing';
        } catch {
          if (provisionStatus === 'ready') provisionStatus = 'importing';
        }
      }

      // Check cloud provisioning availability (non-blocking, cached briefly)
      let cloudAvailable = false;
      try {
        cloudAvailable = await provisionService.isCloudAvailable();
      } catch { /* ignore */ }

      const setupComplete = adminExists && hasOperatingRegion && provisionStatus === 'ready';

      // Read import progress if importing
      let importMessage = '';
      if (provisionStatus === 'importing') {
        try {
          const { readFile } = await import('fs/promises');
          const line = (await readFile('/app/map-data/import-progress.txt', 'utf-8')).trim();
          if (line && line !== 'waiting' && line !== 'starting') {
            importMessage = line.length > 120 ? line.substring(0, 120) + '...' : line;
          }
        } catch { /* no progress file yet */ }
      }

      return reply.send({
        success: true,
        data: {
          setupComplete,
          locked: !isUnlocked(),
          steps: {
            adminCreated: adminExists,
            operatingRegionSet: hasOperatingRegion,
            mapsProvisioned: provisionStatus === 'ready',
            mapsStatus: provisionStatus,
            importMessage: importMessage || undefined,
            cloudAvailable,
          },
        },
      });
    },
  );

  /**
   * POST /api/setup/unlock
   * Load the DEK into memory. Validates against the canary row if it exists.
   * On first unlock (no canary), stores one for future validation.
   */
  fastify.post(
    '/api/setup/unlock',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = unlockSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request: DEK must be 64 hex characters',
        });
      }

      const { dek } = parsed.data;

      // Check if a canary row exists and validate the DEK against it
      try {
        const canaryRows = await db.execute<{ encrypted_value: string }>(
          sql`SELECT encrypted_value FROM dek_canary WHERE id = 1`,
        );

        if (canaryRows.length > 0) {
          // Canary exists — validate the DEK against it
          const encryptedValue = canaryRows[0].encrypted_value;
          try {
            const decryptResult = await db.execute<{ plaintext: string }>(
              sql`SELECT pgp_sym_decrypt(${encryptedValue}::bytea, ${dek}) AS plaintext`,
            );
            const plaintext = decryptResult[0]?.plaintext;
            if (plaintext !== 'safecare') {
              return reply.code(403).send({
                success: false,
                error: 'Invalid encryption key',
              });
            }
          } catch {
            // pgp_sym_decrypt throws on wrong key
            return reply.code(403).send({
              success: false,
              error: 'Invalid encryption key',
            });
          }
        } else {
          // No canary — first unlock. Store one for future validation.
          await db.execute(
            sql`INSERT INTO dek_canary (id, encrypted_value) VALUES (1, pgp_sym_encrypt('safecare', ${dek}))`,
          );
        }
      } catch {
        // Table might not exist yet (pre-migration). Create canary on best effort.
        try {
          await db.execute(
            sql`CREATE TABLE IF NOT EXISTS dek_canary (
              id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
              encrypted_value TEXT NOT NULL,
              created_at TIMESTAMP DEFAULT now()
            )`,
          );
          await db.execute(
            sql`INSERT INTO dek_canary (id, encrypted_value) VALUES (1, pgp_sym_encrypt('safecare', ${dek})) ON CONFLICT (id) DO NOTHING`,
          );
        } catch {
          // Non-fatal — canary is a nice-to-have for validation
        }
      }

      setDEK(dek);

      return reply.send({
        success: true,
        data: { unlocked: true },
      });
    },
  );
}
