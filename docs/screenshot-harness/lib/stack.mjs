/**
 * Manage the lifecycle of the SafeCare dev stack for screenshot capture.
 *
 * Brings up Docker (postgres + redis), starts backend and dashboard in
 * dev mode, waits for them to be healthy, and tears everything down at
 * the end.
 *
 * Only talks to localhost. Refuses to run against anything else.
 */

import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const LOG_DIR = path.join(__dirname, '..', '.logs');

const BACKEND_URL = 'http://localhost:3001';
const DASHBOARD_URL = 'http://localhost:3000';
const POSTGRES_URL = 'postgres://safecare:safecare@localhost:5432/safecare';
const REDIS_URL = 'redis://localhost:6379';

const procs = [];

export const URLS = {
  backend: BACKEND_URL,
  dashboard: DASHBOARD_URL,
  postgres: POSTGRES_URL,
  redis: REDIS_URL,
};

/**
 * Hard safety check — refuse to run if DATABASE_URL or REDIS_URL point
 * anywhere except localhost. The harness is purely a local dev tool.
 */
export function assertLocalOnly() {
  const danger = [process.env.DATABASE_URL, process.env.REDIS_URL].filter(
    Boolean,
  );
  for (const url of danger) {
    if (url && !/localhost|127\.0\.0\.1/.test(url)) {
      throw new Error(
        `screenshot-harness refuses to run: DATABASE_URL/REDIS_URL points to non-local host (${url}).\n` +
          `This tool wipes the local postgres volume before each run. It must never target a shared or production database.`,
      );
    }
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)),
    );
    p.on('error', reject);
  });
}

function runCollecting(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('exit', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || out || `${cmd} exited with ${code}`)),
    );
    p.on('error', reject);
  });
}

async function waitForHttp(url, { timeoutMs = 90_000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.status < 500) return;
    } catch {
      // Not ready yet
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url} to respond`);
}

/**
 * Bring up docker services (postgres, redis only — no backend/dashboard/nominatim/osrm).
 * Destroys any existing postgres volume first for a clean slate.
 */
export async function startDocker() {
  assertLocalOnly();

  console.log('⎇  Tearing down any existing postgres volume...');
  await run('docker', ['compose', 'down', '-v'], {
    cwd: path.join(REPO_ROOT, 'docker'),
    stdio: ['ignore', 'ignore', 'inherit'],
  }).catch(() => {});

  console.log('🐳 Starting Docker services (postgres, redis)...');
  await run('docker', ['compose', 'up', '-d', 'postgres', 'redis'], {
    cwd: path.join(REPO_ROOT, 'docker'),
  });

  // Wait for postgres to accept connections
  console.log('⏳ Waiting for postgres...');
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    try {
      await runCollecting('docker', [
        'exec',
        'safecare-postgres',
        'pg_isready',
        '-U',
        'safecare',
        '-d',
        'safecare',
      ]);
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error('Postgres failed to become ready');
}

function spawnLogged(name, cmd, args, env = {}) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${name}.log`);
  const log = fs.openSync(logPath, 'w');
  const p = spawn(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', log, log],
    detached: false,
  });
  procs.push({ name, proc: p, logPath });
  return p;
}

/**
 * Start the backend in dev mode.
 */
export async function startBackend() {
  // Generate throwaway secrets
  const JWT_SECRET = randHex(32);
  const HMAC_KEY = randHex(32);

  console.log('🚀 Starting backend (pnpm dev)...');
  spawnLogged('backend', 'pnpm', ['--filter', '@safecare/backend', 'dev'], {
    DATABASE_URL: POSTGRES_URL,
    REDIS_URL,
    JWT_SECRET,
    HMAC_KEY,
    NODE_ENV: 'development',
    PORT: '3001',
    HOST: '0.0.0.0',
    // Point Baileys auth at a throwaway dir so a leftover pairing can't
    // accidentally be reused across runs.
    WHATSAPP_AUTH_DIR: path.join(LOG_DIR, 'whatsapp-auth'),
  });

  await waitForHttp(`${BACKEND_URL}/api/health`, { timeoutMs: 120_000 });
  console.log('✓  Backend ready');
}

/**
 * Build + start the dashboard in production mode.
 *
 * We use production mode instead of `pnpm dev` because dev mode enables
 * React StrictMode double-mounting, which breaks Leaflet's MapContainer
 * (known issue: "Map container is already initialized"). Prod mode is
 * also closer to what users actually see.
 *
 * The build is cached in .next/ — subsequent runs are much faster.
 */
export async function startDashboard() {
  const skipBuild = process.env.SKIP_DASHBOARD_BUILD === '1';

  if (!skipBuild) {
    console.log('🏗  Building dashboard (pnpm build)...');
    await run('pnpm', ['--filter', '@safecare/dashboard', 'build'], {
      cwd: REPO_ROOT,
      env: { ...process.env, NEXT_PUBLIC_API_URL: BACKEND_URL },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } else {
    console.log('⊘  SKIP_DASHBOARD_BUILD=1 — reusing existing build');
  }

  console.log('🎨 Starting dashboard (pnpm start)...');
  spawnLogged('dashboard', 'pnpm', ['--filter', '@safecare/dashboard', 'start'], {
    NEXT_PUBLIC_API_URL: BACKEND_URL,
    PORT: '3000',
    HOSTNAME: '0.0.0.0',
  });

  await waitForHttp(DASHBOARD_URL, { timeoutMs: 60_000 });
  await delay(1500);
  console.log('✓  Dashboard ready');
}

/**
 * Tear down all processes and Docker services.
 */
export async function teardown() {
  console.log('\n🧹 Tearing down...');

  for (const { name, proc } of procs) {
    try {
      // pnpm launches a chain of child processes — kill the whole group
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      try { proc.kill('SIGTERM'); } catch {}
    }
    console.log(`  - stopped ${name}`);
  }
  procs.length = 0;

  try {
    await run('docker', ['compose', 'down', '-v'], {
      cwd: path.join(REPO_ROOT, 'docker'),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    console.log('  - docker compose down');
  } catch {
    // Already down
  }
}

function randHex(bytes) {
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
