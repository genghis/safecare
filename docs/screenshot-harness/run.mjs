#!/usr/bin/env node
/**
 * SafeCare screenshot harness — main entry point.
 *
 * Usage:
 *   node docs/screenshot-harness/run.mjs <spec>
 *
 * Specs:
 *   whatsapp  — Settings > WhatsApp Lines (4 states)
 *
 * Environment:
 *   SKIP_STACK=1      skip docker + backend + dashboard startup (assume already up)
 *   SKIP_TEARDOWN=1   don't tear everything down at the end (useful for iterating)
 *   CHROME_PATH=...   override Chrome executable path
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertLocalOnly,
  startDocker,
  startBackend,
  startDashboard,
  teardown,
} from './lib/stack.mjs';
import { bootstrap } from './lib/bootstrap.mjs';
import { openDashboard } from './lib/capture.mjs';
import { connect as connectDb } from './lib/seed.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'docs', 'screenshots');

const SPECS = {
  whatsapp: () => import('./specs/whatsapp.mjs'),
  operations: () => import('./specs/operations.mjs'),
  'setup-wizard': () => import('./specs/setup-wizard.mjs'),
  noop: () => import('./specs/noop.mjs'),
};

// Specs that need a FRESH system (no admin, not unlocked) so the setup
// wizard actually renders instead of redirecting to /login or /.
const SPECS_SKIP_BOOTSTRAP = new Set(['setup-wizard']);

async function main() {
  const specName = process.argv[2];
  if (!specName || !SPECS[specName]) {
    console.error('Usage: node docs/screenshot-harness/run.mjs <spec>');
    console.error(`Available specs: ${Object.keys(SPECS).join(', ')}`);
    process.exit(1);
  }

  assertLocalOnly();

  let dbClient;
  let browserCtx;

  try {
    if (!process.env.SKIP_STACK) {
      await startDocker();
      await startBackend();
      await startDashboard();
    } else {
      console.log('⊘  SKIP_STACK=1 — assuming stack already running');
    }

    // Specs in SPECS_SKIP_BOOTSTRAP skip bootstrap by default.
    // SKIP_BOOTSTRAP=1 can also be set to skip bootstrap for any spec
    // (useful for running the e2e test suite against a fresh stack).
    const skipBootstrap =
      SPECS_SKIP_BOOTSTRAP.has(specName) || process.env.SKIP_BOOTSTRAP === '1';
    let token = null;
    if (!skipBootstrap) {
      ({ token } = await bootstrap());
    } else {
      console.log('⊘  Skipping bootstrap — fresh install state');
    }

    console.log('🗄  Connecting to postgres for seeding...');
    dbClient = await connectDb();

    console.log('🌐 Opening dashboard in headless Chrome...');
    browserCtx = await openDashboard({ token, outputDir: OUTPUT_DIR });

    const ctx = {
      ...browserCtx,
      dbClient,
    };

    console.log(`\n▶ Running spec: ${specName}`);
    const spec = await SPECS[specName]();
    await spec.run(ctx);

    console.log(`\n✅ Spec "${specName}" finished — screenshots saved to docs/screenshots/`);
  } catch (err) {
    console.error('\n❌ Screenshot harness failed:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (browserCtx) {
      try { await browserCtx.close(); } catch {}
    }
    if (dbClient) {
      try { await dbClient.end(); } catch {}
    }
    if (!process.env.SKIP_TEARDOWN) {
      await teardown();
    } else {
      console.log('⊘  SKIP_TEARDOWN=1 — leaving stack running');
    }
  }
}

main();
