/**
 * Operations screenshot spec.
 *
 * Seeds recipients, drivers, zones, and an active dispatch session,
 * then captures the main dashboard pages users interact with day-to-day:
 *
 *   - /          — home dashboard (stats + nudges)
 *   - /recipients — list with populated table
 *   - /drivers    — list with mixed vetting states
 *   - /zones      — split panel with colored polygons
 *   - /dispatch   — active session with check-ins + delivery progress
 *
 * These are candidate hero shots for the README — dispatch and drivers
 * are usually the most visually striking.
 */

import {
  clearWhatsAppLines,
  clearRecipients,
  clearDrivers,
  clearZones,
  clearDispatch,
  seedRecipients,
  seedDrivers,
  seedZones,
  seedDispatchSession,
} from '../lib/seed.mjs';

export async function run(ctx) {
  const { page, dbClient, goto, wait, shot, mockApi } = ctx;

  // Override /api/setup/status so the dashboard treats the system as
  // fully provisioned. In a real install this requires Nominatim to be
  // up and an operating region to be set — neither is true in the
  // harness, but mocking this one endpoint lets the real home page
  // render with real API data for stats.
  mockApi('/api/setup/status', {
    setupComplete: true,
    locked: false,
    steps: {
      adminCreated: true,
      operatingRegionSet: true,
      mapsProvisioned: true,
      mapsStatus: 'ready',
      cloudAvailable: false,
    },
  });

  // --- Seed everything ---
  console.log('\n🌱 Seeding operations data...');
  await clearDispatch(dbClient);
  await clearDrivers(dbClient);
  await clearRecipients(dbClient);
  await clearZones(dbClient);
  await clearWhatsAppLines(dbClient);

  const recipientIds = await seedRecipients(dbClient);
  console.log(`  ✓ ${recipientIds.length} recipients`);
  const driverIds = await seedDrivers(dbClient);
  console.log(`  ✓ ${driverIds.length} drivers`);
  const zoneIds = await seedZones(dbClient);
  console.log(`  ✓ ${zoneIds.length} zones`);
  const sessionId = await seedDispatchSession(dbClient, {
    recipientIds,
    driverIds,
    checkedInCount: 5,
    status: 'active',
  });
  console.log(`  ✓ dispatch session ${sessionId.slice(0, 8)}…`);

  // --- 1. Home dashboard ---
  console.log('\n→ Capturing home dashboard');
  await goto('/');
  await wait(800);
  await fullPageShot(ctx, 'dashboard-home');

  // --- 2. Recipients list ---
  console.log('\n→ Capturing recipients list');
  await goto('/recipients');
  await wait(600);
  await fullPageShot(ctx, 'recipients-list');

  // --- 3. Drivers list ---
  console.log('\n→ Capturing drivers list');
  await goto('/drivers');
  await wait(600);
  await fullPageShot(ctx, 'drivers-list');

  // --- 4. Zones page ---
  console.log('\n→ Capturing zones page');
  await goto('/zones');
  await wait(1000); // map tiles take a moment
  await fullPageShot(ctx, 'zones-list');

  // --- 5. Dispatch page with active session ---
  console.log('\n→ Capturing dispatch page');
  await goto('/dispatch');
  await wait(800);
  await fullPageShot(ctx, 'dispatch-active');

  console.log('\n✓ Operations capture complete');
}

/**
 * Full-viewport screenshot of the current page (no full-page scroll capture —
 * that can produce huge images that don't fit well in docs).
 */
async function fullPageShot(ctx, name) {
  const { page, outputDir } = ctx;
  const nodePath = await import('path');
  const outPath = nodePath.resolve(outputDir, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return outPath;
}
