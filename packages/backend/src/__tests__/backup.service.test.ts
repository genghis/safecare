import { describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(async () => null),
  })),
}));

vi.mock('../config.js', () => ({
  config: {
    REDIS_URL: 'redis://localhost:6379',
    DEK: 'test-dek',
  },
}));

vi.mock('../db/index.js', () => ({
  db: {},
}));

vi.mock('../db/schema.js', () => ({
  adminUsers: {},
  deliveryZones: {},
  dispatchSessions: {},
  driverCheckIns: {},
}));

vi.mock('../services/recipient.service.js', () => ({
  recipientService: {
    list: vi.fn(async () => []),
  },
}));

vi.mock('../services/driver.service.js', () => ({
  driverService: {
    list: vi.fn(async () => []),
  },
}));

const { BackupService } = await import('../services/backup.service.js');

describe('BackupService', () => {
  it('creates an encrypted backup that round-trips with the correct passphrase', async () => {
    const service = new BackupService({
      loadSettings: async () => ({
        orgName: 'Mutual Aid Network',
        serviceArea: { lat: 41.88, lng: -87.63, zoom: 12, label: 'Chicago' },
      }),
      loadAdmins: async () => [
        {
          id: 'admin-1',
          email: 'admin@example.org',
          passwordHash: 'bcrypt-hash',
          role: 'admin',
          totpSecret: 'totp-secret',
          totpBackupCodes: ['hash-1'],
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
      loadRecipients: async () => [
        {
          id: 'recipient-1',
          name: 'Jordan',
          address: '123 Main St',
          phone: '+15555550100',
          verified: true,
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
        },
      ],
      loadDrivers: async () => [
        {
          id: 'driver-1',
          name: 'Casey',
          phone: '+15555550101',
          vehicleSize: 'sedan',
          deliveryZoneIds: ['zone-1'],
          createdAt: new Date('2026-03-03T00:00:00.000Z'),
        },
      ],
      loadZones: async () => [
        {
          id: 'zone-1',
          name: 'North Side',
          color: '#3B82F6',
          polygon: [],
          active: true,
          createdAt: new Date('2026-03-04T00:00:00.000Z'),
        },
      ],
      loadDispatchSessions: async () => [
        {
          id: 'session-1',
          date: '2026-04-01',
          status: 'draft',
          createdAt: new Date('2026-03-05T00:00:00.000Z'),
        },
      ],
      loadDeliveries: async () => [
        {
          id: 'delivery-1',
          recipientId: 'recipient-1',
          driverId: 'driver-1',
          dispatchSessionId: 'session-1',
          status: 'pending',
          address: '123 Main St',
          notes: 'Leave at door',
          createdAt: new Date('2026-03-06T00:00:00.000Z'),
        },
      ],
      loadDriverCheckIns: async () => [
        {
          id: 'check-in-1',
          driverId: 'driver-1',
          dispatchSessionId: 'session-1',
          checkedInAt: new Date('2026-03-07T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.createEncryptedBackup('correct horse battery staple');

    expect(result.filename).toMatch(/^safecare-backup-\d{8}-\d{6}\.scbackup$/);
    expect(result.summary).toMatchObject({
      orgName: 'Mutual Aid Network',
      adminCount: 1,
      recipientCount: 1,
      driverCount: 1,
      zoneCount: 1,
      dispatchSessionCount: 1,
      deliveryCount: 1,
      checkInCount: 1,
      includesMapData: false,
    });

    const payload = service.decryptBackupFile(
      result.buffer,
      'correct horse battery staple',
    );

    expect(payload.format).toBe('safecare-backup-data');
    expect(payload.summary.recipientCount).toBe(1);
    expect(payload.data.settings).toMatchObject({
      orgName: 'Mutual Aid Network',
    });
    expect(payload.data.recipients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recipient-1',
          address: '123 Main St',
        }),
      ]),
    );
    expect(payload.data).not.toHaveProperty('downloadTokens');
    expect(payload.data).not.toHaveProperty('communicationSessions');
  });

  it('rejects decryption with the wrong passphrase', async () => {
    const service = new BackupService({
      loadSettings: async () => ({ orgName: 'Mutual Aid Network' }),
      loadAdmins: async () => [],
      loadRecipients: async () => [],
      loadDrivers: async () => [],
      loadZones: async () => [],
      loadDispatchSessions: async () => [],
      loadDeliveries: async () => [],
      loadDriverCheckIns: async () => [],
    });

    const result = await service.createEncryptedBackup('the right passphrase');

    expect(() => service.decryptBackupFile(result.buffer, 'the wrong passphrase')).toThrow();
  });

  it('imports an encrypted backup via the injected persistence hook', async () => {
    const persistImportedBackup = vi.fn(async () => {});
    const service = new BackupService({
      loadSettings: async () => ({ orgName: 'Mutual Aid Network' }),
      loadAdmins: async () => [
        {
          id: 'admin-1',
          email: 'admin@example.org',
          passwordHash: 'bcrypt-hash',
          role: 'admin',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
      loadRecipients: async () => [],
      loadDrivers: async () => [],
      loadZones: async () => [],
      loadDispatchSessions: async () => [],
      loadDeliveries: async () => [],
      loadDriverCheckIns: async () => [],
      persistImportedBackup,
    });

    const exported = await service.createEncryptedBackup('restore-me-safely');
    const imported = await service.importEncryptedBackup(
      exported.buffer,
      'restore-me-safely',
    );

    expect(imported).toMatchObject({
      requiresMapProvisioning: true,
      summary: expect.objectContaining({
        orgName: 'Mutual Aid Network',
        adminCount: 1,
      }),
    });
    expect(persistImportedBackup).toHaveBeenCalledOnce();
    expect(persistImportedBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'safecare-backup-data',
        data: expect.objectContaining({
          admins: expect.arrayContaining([
            expect.objectContaining({
              email: 'admin@example.org',
            }),
          ]),
        }),
      }),
    );
  });
});
