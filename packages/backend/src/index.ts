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
import tilesRoutes from './routes/tiles.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import setupRoutes from './routes/setup.routes.js';
import updateRoutes from './routes/update.routes.js';
import rideRoutes from './routes/ride.routes.js';
import referralRoutes from './routes/referral.routes.js';
import { initQueues, closeQueues } from './jobs/index.js';
import { initRelayForwarding } from './services/whatsapp-relay.service.js';

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

  // --- Routes that work without DEK (no encryption needed) ---
  await fastify.register(authRoutes);
  await fastify.register(setupRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(geocodeRoutes);
  await fastify.register(tilesRoutes);
  await fastify.register(zoneRoutes);
  await fastify.register(updateRoutes);
  await fastify.register(whatsappRoutes);

  // --- Routes that require DEK (PII encryption/decryption) ---
  // These return 423 Locked if the system hasn't been unlocked yet.
  await fastify.register(async function dekProtectedRoutes(scoped) {
    scoped.addHook('preHandler', fastify.requireUnlocked);
    await scoped.register(recipientRoutes);
    await scoped.register(driverRoutes);
    await scoped.register(dispatchRoutes);
    await scoped.register(driverAppRoutes);
    await scoped.register(deliveryRoutes);
    await scoped.register(distributionRoutes);
    await scoped.register(dashboardRoutes);
    await scoped.register(webhookRoutes);
    await scoped.register(notificationRoutes);
    await scoped.register(rideRoutes);
    await scoped.register(referralRoutes);
  });

  // --- Health check ---
  fastify.get('/api/health', async () => {
    const { SAFECARE_VERSION } = await import('@safecare/shared');
    return { status: 'ok', version: SAFECARE_VERSION, timestamp: new Date().toISOString() };
  });

  // --- Background jobs ---
  initQueues();

  // --- WhatsApp relay forwarding ---
  initRelayForwarding();

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
