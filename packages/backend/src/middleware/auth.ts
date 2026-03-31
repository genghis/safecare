import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { config, isUnlocked } from '../config.js';

const redis = new Redis(config.REDIS_URL);

const SESSION_PREFIX = 'admin_session:';

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireDriver: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireUnlocked: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string; jti?: string };
    user: { sub: string; role: string; jti?: string };
  }
}

/**
 * Register an admin session in Redis (called after JWT is signed).
 */
export async function registerSession(jti: string, adminId: string, ttlSeconds: number): Promise<void> {
  await redis.setex(`${SESSION_PREFIX}${jti}`, ttlSeconds, adminId);
}

/**
 * Revoke a single admin session.
 */
export async function revokeSession(jti: string): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${jti}`);
}

/**
 * Revoke ALL sessions for an admin (e.g., on password change).
 */
export async function revokeAllSessions(adminId: string): Promise<number> {
  // Scan for all session keys and delete those belonging to this admin
  let cursor = '0';
  let revoked = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${SESSION_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      const storedAdminId = await redis.get(key);
      if (storedAdminId === adminId) {
        await redis.del(key);
        revoked++;
      }
    }
  } while (cursor !== '0');
  return revoked;
}

async function authPlugin(fastify: FastifyInstance) {
  fastify.decorate(
    'requireAdmin',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
        if (request.user.role !== 'admin') {
          return reply.code(403).send({ success: false, error: 'Forbidden: admin role required' });
        }
        // Check that the session hasn't been revoked
        const jti = request.user.jti;
        if (jti) {
          const active = await redis.get(`${SESSION_PREFIX}${jti}`);
          if (!active) {
            return reply.code(401).send({ success: false, error: 'Session has been revoked' });
          }
        }
      } catch (err) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' });
      }
    },
  );

  fastify.decorate(
    'requireDriver',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
        if (request.user.role !== 'driver') {
          return reply.code(403).send({ success: false, error: 'Forbidden: driver role required' });
        }
      } catch (err) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' });
      }
    },
  );

  fastify.decorate(
    'requireUnlocked',
    async function (_request: FastifyRequest, reply: FastifyReply) {
      if (!isUnlocked()) {
        return reply.code(423).send({
          success: false,
          error: 'System is locked. Scan the encryption key QR code to unlock.',
        });
      }
    },
  );
}

export default fp(authPlugin, { name: 'auth' });
