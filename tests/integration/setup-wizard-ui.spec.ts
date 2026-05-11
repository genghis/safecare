/**
 * Setup wizard UI smoke test.
 *
 * Unlike fresh-install.spec.ts (which bypasses the wizard by PUTting
 * /api/settings directly), this spec drives the wizard's UI: clicks the
 * Save Region button on Step 2 and asserts it becomes enabled without the
 * user having to pan/zoom the map.
 *
 * This guards the "stuck at the wifi map part" regression — where bounds
 * stayed null until the first Leaflet moveend event, leaving Save Region
 * disabled forever if the user didn't interact with the map.
 */

import { expect, test, type Page } from "@playwright/test";

const DASHBOARD = process.env.DASHBOARD_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:3001";
const TEST_DEK = process.env.SAFECARE_TEST_DEK || "1".repeat(64);

async function dismissUnlockIfPresent(page: Page) {
  if (!page.url().includes("/unlock")) return;
  if (await page.getByTestId("unlock-manual-toggle").isVisible().catch(() => false)) {
    await page.getByTestId("unlock-manual-toggle").click();
  }
  await expect(page.getByTestId("unlock-manual-key")).toBeVisible();
  await page.getByTestId("unlock-manual-key").fill(TEST_DEK);
  await page.getByTestId("unlock-submit").click();
  await page.waitForURL("**/setup", { timeout: 20_000 });
}

test.describe("Setup wizard UI", () => {
  test.setTimeout(120_000);

  test("Save Region enables on mount without map interaction", async ({ page, request }) => {
    const uniqueSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const adminEmail = `wizard-${uniqueSuffix}@example.test`;
    const adminPassword = "wizardsmoke123";
    const orgName = "Wizard UI Smoke Test";

    await page.goto(DASHBOARD);
    await page.waitForLoadState("networkidle");
    await dismissUnlockIfPresent(page);
    await page.waitForURL(/\/setup$/, { timeout: 20_000 });

    // Step 1: account
    await expect(page.getByTestId("setup-create-account")).toBeVisible();
    await page.getByTestId("setup-org-name").fill(orgName);
    await page.getByTestId("setup-admin-email").fill(adminEmail);
    await page.getByTestId("setup-admin-password").fill(adminPassword);
    await page.getByTestId("setup-admin-confirm-password").fill(adminPassword);
    await page.getByTestId("setup-create-account").click();

    // Step 2: region. The bug-fix being tested — Save Region must become
    // enabled within a few seconds, with NO map interaction. Previously it
    // stayed disabled until the user panned/zoomed (which they often don't
    // do when the map is a blank gray rectangle on a fresh install).
    const saveRegion = page.getByTestId("setup-save-region");
    await expect(saveRegion).toBeVisible({ timeout: 20_000 });
    await expect(saveRegion).toBeEnabled({ timeout: 10_000 });

    // Click Save Region without any map interaction
    await saveRegion.click();

    // Step 3 (Maps) should appear. The visible control depends on provision
    // state — not_started shows setup-provision-maps; importing shows
    // setup-continue-while-importing; ready shows setup-continue-from-maps.
    // Any of these proves the wizard advanced past Step 2.
    const step3Locator = page.locator(
      '[data-testid="setup-provision-maps"], [data-testid="setup-continue-while-importing"], [data-testid="setup-continue-from-maps"], [data-testid="setup-retry-provision"]',
    );
    await expect(step3Locator.first()).toBeVisible({ timeout: 15_000 });

    const setupStatus = await request.get(`${API}/api/setup/status`);
    expect(setupStatus.status()).toBe(200);
    const body = await setupStatus.json();
    const steps = (body?.data?.steps ?? body?.steps) as
      | { adminCreated: boolean; operatingRegionSet: boolean }
      | undefined;
    expect(steps?.adminCreated).toBe(true);
    expect(steps?.operatingRegionSet).toBe(true);
  });
});
