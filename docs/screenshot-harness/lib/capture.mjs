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
    args: [
      '--no-sandbox',
      '--disable-gpu',
      // Auto-deny all permission prompts (mic, speech-recognition, etc).
      // Otherwise the harness can hang on an "Allow speech recognition?"
      // dialog the browser throws up when some page interaction accidentally
      // triggers the SpeechRecognition API.
      '--deny-permission-prompts',
      // Disable features that surface permission prompts in headless mode.
      '--disable-features=MediaSession,SpeechRecognition,AudioServiceOutOfProcess',
      // Disable the password manager / credential save prompt — typing into
      // the password fields in the setup wizard can trigger it.
      '--password-store=basic',
      '--disable-save-password-bubble',
    ],
  });

  // Belt-and-braces: pre-deny all permissions at the browser context level
  // in case any launch flag is stripped by Chromium's headless build.
  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(URLS.dashboard, []);
  } catch {
    /* ignore — older Chromium may not support overridePermissions in headless */
  }

  const page = await browser.newPage();

  // API mocks. Each entry is { matcher, handler } where:
  //   - matcher: string (exact pathname match) OR RegExp
  //   - handler: function({ pathname, method, url, match }) => body | { body, status, ...}
  //              OR a plain object/array used as the body directly
  // Registered via ctx.mockApi(matcher, handlerOrBody).
  const mocks = [];

  // Tile proxy: when enabled, requests to /api/tiles/{z}/{x}/{y}.png
  // are fetched from a public OSM-style tile server instead. Used by the
  // setup-wizard spec so the map in the region step shows real tiles
  // instead of greyed-out squares.
  //
  // OSM's usage policy explicitly permits low-volume development work
  // like generating documentation screenshots.
  const tileState = { enabled: false, upstream: null, cache: new Map() };

  const tileRegex = /\/api\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/;

  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const url = new URL(req.url());

      // JSON API mocks — match by exact pathname or regex
      for (const { matcher, handler } of mocks) {
        let matched = false;
        let match = null;
        if (typeof matcher === 'string') {
          matched = matcher === url.pathname;
        } else if (matcher instanceof RegExp) {
          match = matcher.exec(url.pathname);
          matched = match !== null;
        }

        if (!matched) continue;

        if (process.env.DEBUG_MOCKS) {
          console.log(`  🎭 mock ${req.method()} ${url.pathname}`);
        }

        // Resolve the response body
        let body;
        if (typeof handler === 'function') {
          body = handler({ pathname: url.pathname, method: req.method(), url, match });
        } else {
          body = handler;
        }

        // Include permissive CORS headers — the dashboard at :3000 makes
        // cross-origin requests to the backend at :3001, and the browser
        // drops responses without Access-Control-Allow-Origin.
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          },
          body: JSON.stringify({ success: true, data: body }),
        });
        return;
      }

      if (process.env.DEBUG_MOCKS && url.pathname.startsWith('/api/')) {
        console.log(`  🔍 api ${req.method()} ${url.pathname}`);
      }

      // Tile proxy
      const tileMatch = tileRegex.exec(url.pathname);
      if (tileState.enabled && tileMatch) {
        const [, z, x, y] = tileMatch;
        const upstreamUrl = tileState.upstream
          .replace('{z}', z)
          .replace('{x}', x)
          .replace('{y}', y);

        const cacheKey = `${z}/${x}/${y}`;
        let buf = tileState.cache.get(cacheKey);
        if (!buf) {
          const res = await fetch(upstreamUrl, {
            headers: {
              // OSM policy requires a valid User-Agent identifying the app
              'User-Agent': 'SafeCare-ScreenshotHarness/0.1 (dev@safecare.local)',
            },
          });
          if (res.ok) {
            buf = Buffer.from(await res.arrayBuffer());
            tileState.cache.set(cacheKey, buf);
          }
        }

        if (buf) {
          req.respond({
            status: 200,
            contentType: 'image/png',
            headers: { 'Cache-Control': 'public, max-age=86400' },
            body: buf,
          });
          return;
        }
        // Fall through to the backend if upstream failed
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
     * Intercept API responses.
     *
     * @param matcher Either an exact pathname string (e.g.
     *   '/api/setup/status') or a RegExp (e.g.
     *   /^\/api\/whatsapp\/lines\/[^/]+\/qr$/).
     * @param handlerOrBody Either a response body (object, array, string)
     *   that will be wrapped as `{success: true, data: body}`, or a
     *   function that returns the body. The function receives
     *   `{ pathname, method, url, match }` where `match` is the regex
     *   match result (if matcher was a RegExp).
     *
     * Later calls with the same matcher REPLACE earlier ones.
     * Pass `null` as the body to remove a mock.
     */
    mockApi(matcher, handlerOrBody) {
      // Remove any existing mock with the same matcher
      const matcherKey = matcher instanceof RegExp ? matcher.source : matcher;
      const idx = mocks.findIndex((m) => {
        const key = m.matcher instanceof RegExp ? m.matcher.source : m.matcher;
        return key === matcherKey;
      });
      if (idx >= 0) mocks.splice(idx, 1);

      if (handlerOrBody !== null) {
        mocks.push({ matcher, handler: handlerOrBody });
      }
    },

    /** Clear all mocks. */
    clearMocks() {
      mocks.length = 0;
    },

    /**
     * Enable the tile proxy. When enabled, requests to /api/tiles/*
     * are fetched from the given upstream template instead (e.g.
     * "https://tile.openstreetmap.org/{z}/{x}/{y}.png"). This makes
     * the map in screenshots show real tiles rather than grey squares.
     *
     * Fetched tiles are cached in memory for the session so the same
     * tile isn't requested twice.
     */
    enableTileProxy(upstreamTemplate = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png') {
      tileState.enabled = true;
      tileState.upstream = upstreamTemplate;
    },

    async close() {
      await browser.close();
    },
  };
}
