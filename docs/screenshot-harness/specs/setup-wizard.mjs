/**
 * Full setup wizard clickthrough spec.
 *
 * Walks the REAL setup wizard end-to-end:
 *   1. Account creation (real)
 *   2. Region selection (mocked geocoder + real OSM tiles via proxy)
 *   3. Map provisioning (mocked progress → ready)
 *   4. WhatsApp pairing (mocked QR code + mocked connection state)
 *   5. Security briefing (real, all client-side)
 *   6. Finish → lands on dashboard home (with mocked setup status + stats)
 *
 * Captures individual PNGs of each notable state AND records a clickthrough
 * GIF and WebP animation (frames captured manually at 10fps, stitched via
 * ffmpeg with a two-pass palette for good color quality).
 *
 * All mocks are scoped to the harness browser context. They cannot leak
 * into production — they only exist in the puppeteer request interceptor
 * for this one browser session.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// Frame capture at 10 fps keeps the output small while still looking smooth
const FRAME_FPS = 10;
const FRAME_INTERVAL_MS = Math.round(1000 / FRAME_FPS);

export async function run(ctx) {
  const { page, outputDir, goto, wait, enableTileProxy, mockApi } = ctx;

  // Reset module-level state in case the spec is re-run
  wizardState.adminCreated = false;
  wizardState.regionSaved = false;
  wizardState.provisionStarted = false;
  wizardState.provisionPollCount = 0;
  wizardState.whatsappConnected = false;

  // Viewport: 1440x900 @ 1x pixel ratio. deviceScaleFactor=2 would
  // double the frame file size without helping a GIF encoded at 900px.
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // --- Mocks ---
  setupMocks({ mockApi });
  enableTileProxy('https://tile.openstreetmap.org/{z}/{x}/{y}.png');

  // Prepare frame capture but don't start the loop yet — we want the
  // GIF to open directly on the rendered empty form, not on the
  // dashboard's "Loading..." placeholder before the /setup route
  // finishes hydrating.
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safecare-gif-'));
  console.log(`🎞  Frames will be captured to ${framesDir}`);

  let frameIdx = 0;
  let capturing = false;
  let frameErrorCount = 0;
  let captureLoop = null;

  function startCaptureLoop() {
    capturing = true;
    captureLoop = (async () => {
      while (capturing) {
        const framePath = path.join(framesDir, `frame-${String(frameIdx).padStart(5, '0')}.png`);
        try {
          await page.screenshot({ path: framePath, fullPage: false, timeout: 5000 });
          frameIdx += 1;
        } catch (err) {
          // Don't let one hiccup kill the whole loop — screenshots can
          // occasionally race with DOM updates or pending navigations.
          // Tolerate up to 20 consecutive failures before giving up.
          frameErrorCount += 1;
          if (frameErrorCount > 20) {
            console.warn(`  ⚠ Frame capture gave up after 20 errors: ${err.message}`);
            break;
          }
        }
        await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      }
    })();
  }

  try {
    // ================================================================
    // Step 1: Account creation
    // ================================================================
    console.log('\n→ Step 1: Account creation');
    await goto('/setup');
    // Wait for the wizard form to actually be visible — past this
    // point we know the dashboard has finished its initial loading
    // screen and the empty form is on screen.
    await page.waitForSelector('[data-testid="setup-org-name"]', { visible: true, timeout: 15_000 });
    await wait(800);
    await shotFull(ctx, 'setup-01-account-empty');

    // Now that the empty form is rendered, start the frame capture.
    // The GIF opens cleanly on the empty form instead of the Loading… state.
    console.log('🎬 Starting frame capture');
    startCaptureLoop();

    await typeInto(page, '[data-testid="setup-org-name"]', 'Cedar Riverside Mutual Aid', 40);
    await wait(200);
    await typeInto(page, '[data-testid="setup-admin-email"]', 'coordinator@cedarmutual.org', 40);
    await wait(200);
    await typeInto(page, '[data-testid="setup-admin-password"]', 'my-strong-passphrase-42', 40);
    await wait(150);
    await typeInto(page, '[data-testid="setup-admin-confirm-password"]', 'my-strong-passphrase-42', 40);
    await wait(500);
    await shotFull(ctx, 'setup-01-account-filled');

    await page.click('[data-testid="setup-create-account"]');
    wizardState.adminCreated = true;

    // ================================================================
    // Step 2: Region selection
    // ================================================================
    console.log('\n→ Step 2: Region selection');
    await page.waitForSelector('[data-testid="setup-region-search"]', { visible: true, timeout: 15_000 });
    await wait(1200);
    await shotFull(ctx, 'setup-02-region-empty');

    await typeInto(page, '[data-testid="setup-region-search"]', 'Minneapolis, MN', 60);

    // Wait for the debounced search + dropdown to appear
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((b) =>
        (b.textContent || '').includes('Minneapolis, Hennepin'),
      ),
      { timeout: 5000 },
    ).catch(() => console.warn('  ⚠ Search dropdown never appeared'));
    await shotFull(ctx, 'setup-02-region-searching');

    // Click the Minneapolis result
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('Minneapolis, Hennepin'),
      );
      btn?.click();
    });

    // Let the map pan and OSM tiles load (cached in-memory after first fetch)
    await wait(4500);
    await shotFull(ctx, 'setup-02-region-minneapolis');

    // Click "Save Region & Continue"
    await page.click('[data-testid="setup-save-region"]');
    wizardState.regionSaved = true;

    // ================================================================
    // Step 3: Map provisioning
    // ================================================================
    console.log('\n→ Step 3: Map provisioning');
    await page.waitForSelector('[data-testid="setup-provision-maps"]', { visible: true, timeout: 10_000 });
    await wait(800);
    await shotFull(ctx, 'setup-03-maps-start');

    // Click "Download Map Data" — the mock will walk the status from
    // not_started → downloading → importing → ready on successive polls.
    await page.click('[data-testid="setup-provision-maps"]');

    // Let the spec progress through downloading + importing + ready states.
    // The dashboard polls every 2s, and our mock increments a counter each
    // time it's called. 6 polls = 12s ≈ all states + hold frame.
    await page.waitForSelector('[data-testid="setup-continue-from-maps"]', { visible: true, timeout: 20_000 });
    await wait(800);
    await shotFull(ctx, 'setup-03-maps-ready');

    await page.click('[data-testid="setup-continue-from-maps"]');

    // ================================================================
    // Step 4: WhatsApp / Notifications
    // ================================================================
    console.log('\n→ Step 4: WhatsApp pairing');

    // Sub-step 1: "I have a SIM card ready"
    await clickButtonByText(page, 'I have a SIM card ready');
    await wait(500);
    await shotFull(ctx, 'setup-04a-whatsapp-sim');

    // Sub-step 2: "WhatsApp is installed and verified"
    await clickButtonByText(page, 'WhatsApp is installed and verified');
    await wait(500);
    await shotFull(ctx, 'setup-04b-whatsapp-install');

    // Sub-step 3: "Show QR Code to Pair"
    await clickButtonByText(page, 'Show QR Code to Pair');

    // Wait for the QR code image to render (dashboard fetches an image
    // from api.qrserver.com using the fake qrCode string returned by
    // our mock). ~1.5s is enough for the request to complete.
    await page.waitForFunction(
      () => document.querySelectorAll('img[alt*="WhatsApp QR"]').length > 0,
      { timeout: 10_000 },
    ).catch(() => console.warn('  ⚠ WhatsApp QR never rendered'));
    await wait(2500);
    await shotFull(ctx, 'setup-04c-whatsapp-qr');

    // Now flip the QR mock to return "connected" so the next poll transitions
    setMockToConnected(mockApi);

    // The dashboard polls /api/whatsapp/lines/:id/qr every 2s and then
    // refetches /api/whatsapp/lines when it sees status 'connected'.
    await wait(4500);
    await shotFull(ctx, 'setup-04d-whatsapp-connected');

    // Continue to security step
    await page.click('[data-testid="setup-continue-notifications"]');

    // ================================================================
    // Step 5: Security briefing
    // ================================================================
    console.log('\n→ Step 5: Security briefing');
    await page.waitForSelector('[data-testid="setup-finish"]', { visible: true, timeout: 10_000 });
    await wait(1000);
    await shotFull(ctx, 'setup-05-security');

    // Finish → routes to dashboard home
    await page.click('[data-testid="setup-finish"]');

    // ================================================================
    // Final: Dashboard home
    // ================================================================
    console.log('\n→ Dashboard home');
    await page.waitForFunction(
      () => window.location.pathname === '/',
      { timeout: 10_000 },
    );
    await wait(2000);
    await shotFull(ctx, 'setup-06-dashboard');

    // Hold the final frame
    await wait(2000);

    console.log('\n✓ Full setup wizard capture complete');
  } finally {
    capturing = false;
    if (captureLoop) {
      await captureLoop;
    }
    console.log(`🎞  Captured ${frameIdx} frames${frameErrorCount ? ` (${frameErrorCount} frame errors tolerated)` : ''}`);
  }

  // --- Convert frames → GIF + WebP ---
  if (frameIdx === 0) {
    console.warn('\n⚠ No frames captured — skipping GIF/WebP encoding.');
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
    return;
  }

  console.log('\n🎞  Encoding GIF...');
  const gifPath = path.resolve(outputDir, 'setup-wizard.gif');
  await convertFramesToGif(framesDir, FRAME_FPS, gifPath);
  const gifSize = (fs.statSync(gifPath).size / 1024 / 1024).toFixed(1);
  console.log(`  📽 setup-wizard.gif (${gifSize} MB)`);

  console.log('\n🎞  Encoding WebP...');
  const webpPath = path.resolve(outputDir, 'setup-wizard.webp');
  await convertFramesToWebp(framesDir, FRAME_FPS, webpPath);
  const webpSize = (fs.statSync(webpPath).size / 1024 / 1024).toFixed(1);
  console.log(`  📽 setup-wizard.webp (${webpSize} MB)`);

  // Clean up scratch frames
  try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
}

// ====================================================================
// Mocks
// ====================================================================

// Shared state mutated by the spec as the flow progresses
const wizardState = {
  adminCreated: false,
  regionSaved: false,
  provisionStarted: false,
  provisionPollCount: 0,
  whatsappConnected: false,
};

function setupMocks({ mockApi }) {
  // Geocoder for the region step
  mockApi('/api/geocode/search', [
    {
      displayName: 'Minneapolis, Hennepin County, Minnesota, United States',
      lat: 44.9778,
      lng: -93.265,
      type: 'city',
    },
  ]);

  // Save the region — Next.js PUT /api/settings just returns success
  mockApi('/api/settings', { ok: true });

  // Provision maps kick-off — also flips the provisionStarted flag so
  // the poll mock starts walking through states.
  mockApi('/api/settings/provision-maps', () => {
    wizardState.provisionStarted = true;
    return { status: 'downloading', message: 'Connecting to download server...' };
  });

  // Provision status poll — returns 'not_started' until the user clicks
  // the "Download Map Data" button. After that, walks: downloading →
  // importing → ready over 3 polls (~5s each since the dashboard polls
  // every 5 seconds).
  mockApi('/api/settings/provision-status', () => {
    if (!wizardState.provisionStarted) return { status: 'not_started' };
    wizardState.provisionPollCount += 1;
    const n = wizardState.provisionPollCount;
    if (n === 1) return { status: 'downloading', message: 'Downloading map data...', progress: 45 };
    if (n === 2) return { status: 'importing', message: 'Importing into the database...', importProgress: 65 };
    return { status: 'ready' };
  });

  // Also mock /api/setup/status — the setup page calls it on mount to
  // figure out which step to resume on, and re-fetches it as a fallback
  // when provision-status fails.
  mockApi('/api/setup/status', () => {
    const n = wizardState.provisionPollCount;
    const mapsStatus = n === 0 ? 'not_started' : n === 1 ? 'downloading' : n === 2 ? 'importing' : 'ready';
    return {
      setupComplete:
        wizardState.adminCreated &&
        wizardState.regionSaved &&
        mapsStatus === 'ready' &&
        wizardState.whatsappConnected,
      locked: false,
      steps: {
        adminCreated: wizardState.adminCreated,
        operatingRegionSet: wizardState.regionSaved,
        mapsProvisioned: mapsStatus === 'ready',
        mapsStatus,
        cloudAvailable: false,
      },
    };
  });

  // GET (list) and POST (create) both hit /api/whatsapp/lines with no
  // id in the path. Branch on method inside the handler.
  mockApi('/api/whatsapp/lines', ({ method }) => {
    if (method === 'POST') {
      return {
        id: 'mock-primary-line',
        label: 'Main Line',
        isPrimary: true,
        isRelayPool: false,
        status: 'disconnected',
      };
    }
    // GET
    if (wizardState.whatsappConnected) {
      return [{
        id: 'mock-primary-line',
        label: 'Main Line',
        status: 'connected',
        phoneNumber: '16125550101',
        qrCode: null,
        isPrimary: true,
        isRelayPool: false,
        error: null,
        lastConnectedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }];
    }
    return [];
  });

  // POST /api/whatsapp/lines/:id/connect — start pairing
  const fakeQrString = `2@${crypto.randomBytes(20).toString('base64')},${crypto.randomBytes(16).toString('base64')}==,${crypto.randomBytes(16).toString('base64')}==`;
  mockApi(/^\/api\/whatsapp\/lines\/[^/]+\/connect$/, {
    status: 'qr_ready',
    qrCode: fakeQrString,
  });

  // GET /api/whatsapp/lines/:id/qr — poll for QR updates
  mockApi(/^\/api\/whatsapp\/lines\/[^/]+\/qr$/, () => {
    if (wizardState.whatsappConnected) {
      return { status: 'connected', qrCode: null };
    }
    return { status: 'qr_ready', qrCode: fakeQrString };
  });

  // Dashboard stats — populate with believable numbers for the final
  // "all set up" dashboard shot
  mockApi('/api/dashboard/stats', {
    totalRecipients: 0,
    activeDrivers: 0,
    todayDeliveries: 0,
    pendingOrders: 0,
  });

  // 2FA status check for the nudge banner on dashboard home
  mockApi('/api/auth/admin/totp/status', { enabled: false });
}

/**
 * Flip the WhatsApp mock state so the next poll returns 'connected'.
 * The dashboard will then re-fetch /api/whatsapp/lines and show the
 * "WhatsApp connected successfully!" success box.
 */
function setMockToConnected(_mockApi) {
  wizardState.whatsappConnected = true;
}

// ====================================================================
// Helpers
// ====================================================================

async function typeInto(page, selector, text, delayMs = 50) {
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text, { delay: delayMs });
}

async function shotFull(ctx, name) {
  const nodePath = await import('path');
  const outPath = nodePath.resolve(ctx.outputDir, `${name}.png`);
  await ctx.page.screenshot({ path: outPath, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return outPath;
}

/**
 * Click the first button whose visible text contains the given string.
 * Used for buttons without a data-testid.
 */
async function clickButtonByText(page, text) {
  const clicked = await page.evaluate((t) => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes(t),
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
  if (!clicked) {
    throw new Error(`Button not found: "${text}"`);
  }
  // Give React a tick to react to the click
  await new Promise((r) => setTimeout(r, 200));
}

// ====================================================================
// ffmpeg encoders
// ====================================================================

function convertFramesToGif(framesDir, fps, gifPath) {
  return new Promise((resolve, reject) => {
    const framePattern = path.join(framesDir, 'frame-%05d.png');
    const palettePath = `${gifPath}.palette.png`;
    const filter = 'scale=900:-1:flags=lanczos';

    const pass1 = spawn('ffmpeg', [
      '-y',
      '-framerate', String(fps),
      '-i', framePattern,
      '-vf', `${filter},palettegen=stats_mode=diff`,
      palettePath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let err1 = '';
    pass1.stderr.on('data', (d) => (err1 += d.toString()));
    pass1.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg palettegen failed: ${err1}`));

      const pass2 = spawn('ffmpeg', [
        '-y',
        '-framerate', String(fps),
        '-i', framePattern,
        '-i', palettePath,
        '-lavfi', `${filter} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`,
        gifPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });

      let err2 = '';
      pass2.stderr.on('data', (d) => (err2 += d.toString()));
      pass2.on('exit', (code2) => {
        try { fs.unlinkSync(palettePath); } catch {}
        if (code2 !== 0) return reject(new Error(`ffmpeg paletteuse failed: ${err2}`));
        resolve();
      });
    });
  });
}

async function convertFramesToWebp(framesDir, fps, webpPath) {
  // Homebrew's ffmpeg doesn't ship with libwebp, so we can't use the
  // ffmpeg webp encoder directly. Instead:
  //   1. Use ffmpeg to scale + re-encode the frames into a second tmp dir
  //   2. Feed the scaled PNGs to `img2webp` (from the `webp` package)
  //
  // img2webp requires each frame be individually listed on the command
  // line — no glob/pattern support.
  const scaledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safecare-webp-'));
  try {
    // Step 1: scale frames to 900px width with ffmpeg
    await new Promise((resolve, reject) => {
      const framePattern = path.join(framesDir, 'frame-%05d.png');
      const scaledPattern = path.join(scaledDir, 'frame-%05d.png');
      const p = spawn('ffmpeg', [
        '-y',
        '-framerate', String(fps),
        '-i', framePattern,
        '-vf', 'scale=900:-1:flags=lanczos',
        scaledPattern,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg scale failed: ${err}`))));
    });

    // Step 2: feed scaled frames to img2webp
    const files = fs.readdirSync(scaledDir)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => path.join(scaledDir, f));
    if (files.length === 0) throw new Error('No scaled frames for img2webp');

    const frameDurationMs = Math.round(1000 / fps);
    const args = [
      '-loop', '0',           // infinite loop
      '-d', String(frameDurationMs), // per-frame duration
      '-q', '75',             // quality 0-100 (higher = better)
      '-m', '6',              // compression method 0-6 (higher = slower + smaller)
      ...files,
      '-o', webpPath,
    ];

    await new Promise((resolve, reject) => {
      const p = spawn('img2webp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`img2webp failed: ${err}`))));
    });
  } finally {
    try { fs.rmSync(scaledDir, { recursive: true, force: true }); } catch {}
  }
}
