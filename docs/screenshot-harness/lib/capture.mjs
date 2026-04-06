/**
 * Puppeteer helpers for the screenshot harness.
 *
 * Launches a headless Chrome pointed at the real dashboard, installs the
 * admin JWT into sessionStorage (so the dashboard treats us as logged in),
 * and exposes a `shot(name)` helper for consistent full-page captures.
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import nodePath from 'path';
import { URLS } from './stack.mjs';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome() {
  for (const p of CHROME_PATHS) if (fs.existsSync(p)) return p;
  throw new Error('Chrome not found. Set CHROME_PATH env var.');
}

/**
 * Launch a browser, open the dashboard, inject the auth token, and
 * return a helper object for downstream specs.
 */
export async function openDashboard({ token, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || findChrome(),
    headless: true,
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();

  // Map of API path → canned response body for interception. Each entry is
  // `{ path: string, body: object }`. Used by ctx.mockApi(path, body).
  const mocks = new Map();

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    try {
      const url = new URL(req.url());
      const mock = mocks.get(url.pathname);
      if (mock) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: mock }),
        });
        return;
      }
    } catch {
      /* fall through */
    }
    req.continue();
  });

  // First, visit any URL on the origin so we can touch sessionStorage
  await page.goto(URLS.dashboard, { waitUntil: 'domcontentloaded' });

  // Inject the admin token into sessionStorage (same key the dashboard uses).
  // Skipped for fresh-install specs that need to run the setup wizard.
  if (token) {
    await page.evaluate((t) => {
      sessionStorage.setItem('safecare_token', t);
    }, token);
  }

  return {
    page,
    browser,
    outputDir,

    async goto(urlPath) {
      await page.goto(`${URLS.dashboard}${urlPath}`, { waitUntil: 'networkidle0' });
      // Wait for i18n to load — the LocaleProvider dynamically imports
      // @safecare/shared on mount, which races with our first render.
      // Check the sidebar nav (spans inside <a> elements) since that's
      // where raw keys are most visible.
      await page.waitForFunction(
        () => {
          const bodyText = document.body.innerText || '';
          return !bodyText.includes('dashboard.nav.') && !bodyText.includes('dashboard.settings.');
        },
        { timeout: 15_000 },
      ).catch(() => {
        console.warn('  ⚠ i18n did not finish loading — screenshots may show raw keys');
      });
      await new Promise((r) => setTimeout(r, 600));
    },

    async shot(name) {
      const outPath = nodePath.resolve(outputDir, `${name}.png`);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`  📸 ${name}.png`);
      return outPath;
    },

    async click(selector) {
      await page.waitForSelector(selector, { visible: true });
      await page.click(selector);
      await new Promise((r) => setTimeout(r, 400));
    },

    async type(selector, text) {
      await page.waitForSelector(selector, { visible: true });
      await page.click(selector, { clickCount: 3 });
      await page.type(selector, text);
    },

    async wait(ms) {
      await new Promise((r) => setTimeout(r, ms));
    },

    async waitForSelector(selector, opts) {
      await page.waitForSelector(selector, opts);
    },

    /**
     * Intercept API responses for a given path and return canned data.
     * Used to skip blocking checks (e.g. setup/status needs Nominatim).
     * Pass `null` to remove a mock.
     */
    mockApi(path, body) {
      if (body === null) {
        mocks.delete(path);
      } else {
        mocks.set(path, body);
      }
    },

    async close() {
      await browser.close();
    },
  };
}
