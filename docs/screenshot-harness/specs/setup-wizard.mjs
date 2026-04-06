/**
 * Setup wizard screenshot + GIF spec.
 *
 * Skips bootstrap so the real setup wizard renders on /setup. Walks
 * through step 1 (account creation) and step 2 (region selection),
 * capturing individual screenshots AND a screencast that's converted
 * to a GIF via ffmpeg.
 *
 * The remaining steps (3: map provisioning, 4: notifications, 5:
 * security) are intentionally skipped — provisioning requires a real
 * Nominatim container, and notifications/security need actual Baileys
 * connections. We capture only the steps that are self-contained and
 * visually tell the "set it up" story.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function run(ctx) {
  const { page, outputDir, goto, wait } = ctx;

  // --- Start a screencast (records the whole flow) ---
  // Puppeteer 22+ page.screencast() returns a recording that stops on disposal.
  const videoPath = path.resolve(outputDir, 'setup-wizard.webm');
  if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

  console.log('🎬 Starting screencast...');
  const recorder = await page.screencast({ path: videoPath });

  try {
    // --- Step 1: Account creation ---
    console.log('\n→ Step 1: Account creation');
    await goto('/setup');
    await wait(1200);
    await shotFull(ctx, 'setup-01-account-empty');

    // Type realistic values slowly so the video shows natural input
    await typeInto(page, '[data-testid="setup-org-name"]', 'Cedar Riverside Mutual Aid', 40);
    await wait(300);
    await typeInto(page, '[data-testid="setup-admin-email"]', 'coordinator@cedarmutual.org', 40);
    await wait(300);
    await typeInto(page, '[data-testid="setup-admin-password"]', 'my-strong-passphrase-42', 40);
    await wait(200);
    await typeInto(page, '[data-testid="setup-admin-confirm-password"]', 'my-strong-passphrase-42', 40);
    await wait(600);
    await shotFull(ctx, 'setup-01-account-filled');

    // Click Create Account
    await page.click('[data-testid="setup-create-account"]');

    // Wait for step 2 to render — the region step shows a search input.
    console.log('\n→ Step 2: Region selection');
    await page.waitForSelector('[data-testid="setup-region-search"]', { visible: true, timeout: 15_000 });
    await wait(1500); // let the map tiles start loading
    await shotFull(ctx, 'setup-02-region-empty');

    // Type a search query — even if the geocoder isn't up, typing shows the UX
    await typeInto(page, '[data-testid="setup-region-search"]', 'Minneapolis, MN', 60);
    await wait(1500); // wait for debounced search results
    await shotFull(ctx, 'setup-02-region-searching');

    // Give the search + map interaction a moment for the GIF
    await wait(1500);

    console.log('\n✓ Setup wizard capture complete');
  } finally {
    console.log('🎬 Stopping screencast...');
    await recorder.stop();
  }

  // --- Convert webm → GIF via ffmpeg ---
  const gifPath = path.resolve(outputDir, 'setup-wizard.gif');
  console.log('\n🎞  Converting to GIF...');
  await convertWebmToGif(videoPath, gifPath);
  console.log(`  📽 ${path.basename(gifPath)}`);

  // Keep the webm too (higher quality; we can re-convert later with different settings)
  console.log(`  📽 ${path.basename(videoPath)} (source)`);
}

/**
 * Type text into a selector one character at a time with a delay,
 * so the resulting screencast shows natural typing rather than
 * instantaneous text appearance.
 */
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
 * Convert the WebM screencast to an optimized GIF using a two-pass
 * palette approach — one pass to compute the palette, one to apply it.
 * Produces much better color quality than a naive single-pass convert.
 */
function convertWebmToGif(webmPath, gifPath) {
  return new Promise((resolve, reject) => {
    const palettePath = `${gifPath}.palette.png`;

    // Two-pass ffmpeg: palettegen, then paletteuse.
    // fps=12 keeps the file small; scale=900 keeps it readable in docs.
    const filter = 'fps=12,scale=900:-1:flags=lanczos';

    const pass1 = spawn('ffmpeg', [
      '-y',
      '-i', webmPath,
      '-vf', `${filter},palettegen=stats_mode=diff`,
      palettePath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let err1 = '';
    pass1.stderr.on('data', (d) => (err1 += d.toString()));
    pass1.on('exit', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg palettegen failed: ${err1}`));
      }

      const pass2 = spawn('ffmpeg', [
        '-y',
        '-i', webmPath,
        '-i', palettePath,
        '-lavfi', `${filter} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`,
        gifPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });

      let err2 = '';
      pass2.stderr.on('data', (d) => (err2 += d.toString()));
      pass2.on('exit', (code2) => {
        try { fs.unlinkSync(palettePath); } catch {}
        if (code2 !== 0) {
          return reject(new Error(`ffmpeg paletteuse failed: ${err2}`));
        }
        resolve();
      });
    });
  });
}
