import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { isUnlocked } from '../config.js';

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
    payload: { sub: string; role: string };
    user: { sub: string; role: string };
  }
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
