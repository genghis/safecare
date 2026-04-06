#!/usr/bin/env node
/**
 * Captures screenshots of ride coordination mockup views.
 * Usage: node docs/mockups/capture-screenshots.mjs
 *
 * Outputs PNGs to docs/mockups/screenshots/
 * Requires: pnpm add -D puppeteer-core
 */

import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCKUP_PATH = path.join(__dirname, 'ride-coordination.html');
const OUTPUT_DIR = path.join(__dirname, 'screenshots');

const VIEWS = [
  { id: 'shift-board', name: 'shift-board', title: 'Shift Board' },
  { id: 'ride-schedule', name: 'ride-schedule', title: 'Ride Schedules' },
  { id: 'intake', name: 'intake-queue', title: 'Intake Queue' },
  { id: 'passenger', name: 'passenger-detail', title: 'Passenger Detail' },
];

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome not found. Set CHROME_PATH env var.');
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(`file://${MOCKUP_PATH}`, { waitUntil: 'networkidle0' });

  for (const view of VIEWS) {
    // Click the sidebar link to switch views
    await page.evaluate((viewId) => {
      // Activate the view
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(viewId).classList.add('active');
    }, view.id);

    // Wait for render
    await new Promise(r => setTimeout(r, 300));

    const outPath = path.join(OUTPUT_DIR, `${view.name}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`  ✓ ${view.title} → ${path.relative(process.cwd(), outPath)}`);
  }

  await browser.close();
  console.log(`\nDone — ${VIEWS.length} screenshots saved to ${path.relative(process.cwd(), OUTPUT_DIR)}/`);
}

main().catch(err => {
  console.error('Screenshot capture failed:', err.message);
  process.exit(1);
});
