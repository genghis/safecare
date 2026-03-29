import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import authPlugin from './middleware/auth.js';
import authRoutes from './routes/auth.routes.js';
import recipientRoutes from './routes/recipient.routes.js';
import driverRoutes from './routes/driver.routes.js';
import dispatchRoutes from './routes/dispatch.routes.js';
import driverAppRoutes from './routes/driver-app.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import zoneRoutes from './routes/zone.routes.js';
import distributionRoutes from './routes/distribution.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import geocodeRoutes from './routes/geocode.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import { initQueues, closeQueues } from './jobs/index.js';

async function main() {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // --- Plugins ---
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: config.JWT_SECRET,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // --- Auth decorators ---
  await fastify.register(authPlugin);

  // --- Routes ---
  await fastify.register(authRoutes);
  await fastify.register(recipientRoutes);
  await fastify.register(driverRoutes);
  await fastify.register(dispatchRoutes);
  await fastify.register(driverAppRoutes);
  await fastify.register(deliveryRoutes);
  await fastify.register(zoneRoutes);
  await fastify.register(distributionRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(geocodeRoutes);
  await fastify.register(notificationRoutes);

  // --- Health check ---
  fastify.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // --- Background jobs ---
  initQueues();

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}, shutting down gracefully...`);
    await closeQueues();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // --- Start ---
  try {
    await fastify.listen({ port: config.PORT, host: config.HOST });
    fastify.log.info(
      `SafeCare backend running on ${config.HOST}:${config.PORT}`,
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
