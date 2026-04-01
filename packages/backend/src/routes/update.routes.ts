import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { exec } from 'child_process';
import { promisify } from 'util';
import Redis from 'ioredis';
import { config } from '../config.js';
import { logAdminAction } from '../services/audit.service.js';
import { SAFECARE_VERSION, SAFECARE_REPO } from '@safecare/shared';

const redis = new Redis(config.REDIS_URL);
const execAsync = promisify(exec);

const UPDATE_CHECK_CACHE_KEY = 'update:check';
const UPDATE_CHECK_TTL = 3600; // 1 hour
const UPDATE_HISTORY_KEY = 'update:history';

interface ReleaseInfo {
  version: string;
  tagName: string;
  changelog: string;
  publishedAt: string;
  htmlUrl: string;
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${SAFECARE_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'SafeCare-Update-Checker',
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      tag_name: string;
      body: string;
      published_at: string;
      html_url: string;
    };

    return {
      version: data.tag_name.replace(/^v/, ''),
      tagName: data.tag_name,
      changelog: data.body || '',
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
    };
  } catch {
    return null;
  }
}

function compareVersions(current: string, latest: string): number {
  const a = current.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((b[i] || 0) > (a[i] || 0)) return 1;
    if ((b[i] || 0) < (a[i] || 0)) return -1;
  }
  return 0;
}

export default async function updateRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/updates/check
   * Check GitHub for the latest SafeCare release. Cached for 1 hour.
   */
  fastify.get(
    '/api/updates/check',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Check cache first
      const cached = await redis.get(UPDATE_CHECK_CACHE_KEY);
      if (cached) {
        return reply.send({ success: true, data: JSON.parse(cached) });
      }

      const release = await fetchLatestRelease();
      const result = {
        currentVersion: SAFECARE_VERSION,
        latestVersion: release?.version ?? SAFECARE_VERSION,
        updateAvailable: release ? compareVersions(SAFECARE_VERSION, release.version) > 0 : false,
        changelog: release?.changelog ?? '',
        publishedAt: release?.publishedAt ?? null,
        releaseUrl: release?.htmlUrl ?? null,
        checkedAt: new Date().toISOString(),
      };

      await redis.setex(UPDATE_CHECK_CACHE_KEY, UPDATE_CHECK_TTL, JSON.stringify(result));
      return reply.send({ success: true, data: result });
    },
  );

  /**
   * POST /api/updates/apply
   * Pull new Docker images and restart services.
   */
  fastify.post(
    '/api/updates/apply',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { version?: string } | undefined;
      const targetVersion = body?.version;

      if (!targetVersion) {
        return reply.code(400).send({
          success: false,
          error: 'Target version required',
        });
      }

      logAdminAction('app_update_started', request, {
        from: SAFECARE_VERSION,
        to: targetVersion,
      });

      try {
        // Update the version in .env
        const envPath = '/opt/safecare/.env';
        try {
          const { readFile, writeFile } = await import('fs/promises');
          let envContent = await readFile(envPath, 'utf-8');
          if (envContent.includes('SAFECARE_VERSION=')) {
            envContent = envContent.replace(/SAFECARE_VERSION=.*/,
              `SAFECARE_VERSION=${targetVersion}`);
          } else {
            envContent += `\nSAFECARE_VERSION=${targetVersion}\n`;
          }
          await writeFile(envPath, envContent);
        } catch {
          // .env may not exist in dev — non-fatal
        }

        // Pull new images
        const composeDir = '/opt/safecare/docker';
        const { stdout: pullOutput } = await execAsync(
          'docker compose -f docker-compose.yml -f docker-compose.prod.yml pull',
          { cwd: composeDir, timeout: 300000 },
        );

        // Log the update
        const historyEntry = {
          from: SAFECARE_VERSION,
          to: targetVersion,
          timestamp: new Date().toISOString(),
          pullOutput: pullOutput.slice(0, 500),
        };
        await redis.lpush(UPDATE_HISTORY_KEY, JSON.stringify(historyEntry));
        await redis.ltrim(UPDATE_HISTORY_KEY, 0, 49); // Keep last 50

        // Clear the update check cache
        await redis.del(UPDATE_CHECK_CACHE_KEY);

        logAdminAction('app_update_applied', request, {
          from: SAFECARE_VERSION,
          to: targetVersion,
        });

        // Restart services (this will kill the current process)
        // Use exec without await — the response is sent before restart
        exec(
          'sleep 2 && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d',
          { cwd: composeDir },
        );

        return reply.send({
          success: true,
          data: {
            message: 'Update applied. Services are restarting.',
            from: SAFECARE_VERSION,
            to: targetVersion,
          },
        });
      } catch (err) {
        logAdminAction('app_update_failed', request, {
          from: SAFECARE_VERSION,
          to: targetVersion,
          error: String(err),
        });
        return reply.code(500).send({
          success: false,
          error: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  );

  /**
   * GET /api/updates/os-status
   * Check for available OS security updates.
   */
  fastify.get(
    '/api/updates/os-status',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Update package lists
        await execAsync('apt-get update -qq', { timeout: 60000 });

        // Get upgradable packages
        const { stdout } = await execAsync(
          'apt list --upgradable 2>/dev/null | grep -v "^Listing"',
          { timeout: 30000 },
        );

        const packages = stdout
          .trim()
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => {
            const match = line.match(/^([^/]+)\/\S+\s+(\S+)/);
            return match ? { name: match[1], version: match[2] } : null;
          })
          .filter(Boolean);

        return reply.send({
          success: true,
          data: {
            count: packages.length,
            packages,
            checkedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        return reply.send({
          success: true,
          data: {
            count: 0,
            packages: [],
            error: 'Could not check for OS updates',
            checkedAt: new Date().toISOString(),
          },
        });
      }
    },
  );

  /**
   * POST /api/updates/os-apply
   * Apply OS security updates via apt-get upgrade.
   */
  fastify.post(
    '/api/updates/os-apply',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logAdminAction('os_update_started', request);

      try {
        const { stdout, stderr } = await execAsync(
          'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --with-new-pkgs 2>&1',
          { timeout: 600000 }, // 10 min
        );

        const upgraded = (stdout.match(/(\d+) upgraded/)?.[1]) ?? '0';

        logAdminAction('os_update_applied', request, {
          upgraded,
          output: stdout.slice(0, 500),
        });

        return reply.send({
          success: true,
          data: {
            upgraded: parseInt(upgraded, 10),
            output: stdout.slice(0, 2000),
          },
        });
      } catch (err) {
        logAdminAction('os_update_failed', request, {
          error: String(err),
        });
        return reply.code(500).send({
          success: false,
          error: `OS update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  );

  /**
   * GET /api/updates/history
   * Get recent update history.
   */
  fastify.get(
    '/api/updates/history',
    { preHandler: [fastify.requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const entries = await redis.lrange(UPDATE_HISTORY_KEY, 0, 19);
      const history = entries.map((e) => {
        try {
          return JSON.parse(e);
        } catch {
          return null;
        }
      }).filter(Boolean);

      return reply.send({ success: true, data: { history } });
    },
  );
}
