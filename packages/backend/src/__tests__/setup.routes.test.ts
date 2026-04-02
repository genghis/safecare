import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const adminExists = vi.fn();
const importEncryptedBackup = vi.fn();
const redisGet = vi.fn();
const isCloudAvailable = vi.fn();

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: redisGet,
  })),
}));

vi.mock('../services/auth.service.js', () => ({
  authService: {
    adminExists,
  },
}));

vi.mock('../services/backup.service.js', () => ({
  backupService: {
    importEncryptedBackup,
  },
}));

vi.mock('../services/provision.service.js', () => ({
  provisionService: {
    isCloudAvailable,
  },
}));

vi.mock('../services/audit.service.js', () => ({
  logAdminAction: vi.fn(),
  logSystemAction: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    GEOCODING_URL: 'http://localhost:8088',
  },
  setDEK: vi.fn(),
  isUnlocked: vi.fn(() => true),
}));

vi.mock('../db/index.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

const { default: setupRoutes } = await import('../routes/setup.routes.js');

describe('setupRoutes backup import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisGet.mockResolvedValue(null);
    adminExists.mockResolvedValue(false);
    isCloudAvailable.mockResolvedValue(false);
    importEncryptedBackup.mockResolvedValue({
      summary: {
        orgName: 'Mutual Aid Network',
        adminCount: 1,
        recipientCount: 2,
        driverCount: 1,
        zoneCount: 1,
        dispatchSessionCount: 1,
        deliveryCount: 2,
        checkInCount: 1,
        includesMapData: false,
      },
      requiresMapProvisioning: true,
    });
  });

  it('restores a backup during setup when the system is unlocked and empty', async () => {
    const app = Fastify();
    app.decorate('requireUnlocked', async () => {});
    await app.register(setupRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/import-backup',
      payload: {
        passphrase: 'correct horse battery staple',
        backup: '{"format":"safecare-backup"}',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(importEncryptedBackup).toHaveBeenCalledWith(
      '{"format":"safecare-backup"}',
      'correct horse battery staple',
    );
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        restored: true,
        requiresMapProvisioning: true,
        summary: {
          orgName: 'Mutual Aid Network',
        },
      },
    });

    await app.close();
  });

  it('rejects backup import once an admin already exists', async () => {
    adminExists.mockResolvedValue(true);

    const app = Fastify();
    app.decorate('requireUnlocked', async () => {});
    await app.register(setupRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/import-backup',
      payload: {
        passphrase: 'correct horse battery staple',
        backup: '{"format":"safecare-backup"}',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(importEncryptedBackup).not.toHaveBeenCalled();

    await app.close();
  });
});
