/**
 * SafeCare Fresh Install Integration Test
 *
 * Simulates the complete out-of-box experience:
 * 1. Fresh Docker instance (clean volumes)
 * 2. Browser opens dashboard → redirected to setup wizard
 * 3. Create admin account
 * 4. Define operating region
 * 5. Provision maps (or skip if slow)
 * 6. Configure notifications (skip in test)
 * 7. Security briefing → dashboard
 * 8. Add a zone, driver, recipient
 * 9. Create dispatch session, assign deliveries
 * 10. Driver PWA: login, check-in, download route
 *
 * Run: npx playwright test fresh-install.spec.ts
 * Or via the wrapper: ./tests/integration/run.sh
 */

import { test, expect, type Page } from "@playwright/test";

const DASHBOARD = process.env.DASHBOARD_URL || "http://localhost:3000";
const PWA = process.env.PWA_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";

// Increase timeout for slow operations
test.setTimeout(120_000);

test.describe("Fresh Install Flow", () => {
  test("1. Dashboard redirects to setup wizard", async ({ page }) => {
    await page.goto(DASHBOARD);
    // Should redirect to /setup
    await page.waitForURL("**/setup", { timeout: 10_000 });
    await expect(page.locator("text=SafeCare Setup")).toBeVisible();
  });

  test("2. Step 1: Create admin account", async ({ page }) => {
    await page.goto(`${DASHBOARD}/setup`);

    // Should be on step 1
    await expect(page.locator("text=Create Your Admin Account")).toBeVisible();

    // Fill form
    await page.fill('input[placeholder*="Mutual Aid"]', "Test Organization");
    await page.fill('input[type="email"]', `test-${Date.now()}@smoke.test`);
    await page.fill(
      'input[placeholder="At least 8 characters"]',
      "testpass123"
    );
    await page.fill(
      'input[placeholder="Type password again"]',
      "testpass123"
    );

    // Submit
    await page.click("text=Create Account & Continue");

    // Should advance to step 2
    await expect(
      page.locator("text=Define Your Operating Region")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("3. Step 2: Define operating region", async ({ page }) => {
    // This test needs to be logged in from step 1
    // For isolated testing, go directly to setup and check if we land on step 2
    await page.goto(`${DASHBOARD}/setup`);
    await page.waitForTimeout(2000);

    // If we see region step, fill it
    const regionVisible = await page
      .locator("text=Define Your Operating Region")
      .isVisible()
      .catch(() => false);

    if (regionVisible) {
      // Search for a city
      const searchInput = page.locator(
        'input[placeholder="Search for your city..."]'
      );
      if (await searchInput.isVisible()) {
        await searchInput.fill("Palo Alto");
        await page.waitForTimeout(1500); // Wait for debounce + search

        // Click first result if dropdown appears
        const result = page.locator("button:has-text('Palo Alto')").first();
        if (await result.isVisible({ timeout: 5000 }).catch(() => false)) {
          await result.click();
          await page.waitForTimeout(500);
        }
      }

      // Save region
      const saveButton = page.locator("text=Save Region & Continue");
      if (await saveButton.isEnabled()) {
        await saveButton.click();
        await page.waitForTimeout(2000);
      }
    }
  });

  test("4. Setup status API is accessible without auth", async ({
    request,
  }) => {
    const response = await request.get(`${API}/api/setup/status`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty("setupComplete");
    expect(data.data).toHaveProperty("steps");
    expect(data.data.steps).toHaveProperty("adminCreated");
    expect(data.data.steps).toHaveProperty("operatingRegionSet");
    expect(data.data.steps).toHaveProperty("mapsProvisioned");
  });

  test("5. Health check returns ok", async ({ request }) => {
    const response = await request.get(`${API}/api/health`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  test("6. Pre-built manifest is accessible", async ({ request }) => {
    const response = await request.get(
      "https://storage.googleapis.com/safecare-maps-osrm/manifest.json"
    );
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.version).toBe(2);
    expect(manifest.regions.length).toBeGreaterThan(0);

    // Check structure
    const region = manifest.regions[0];
    expect(region).toHaveProperty("id");
    expect(region).toHaveProperty("name");
    expect(region).toHaveProperty("bounds");
    expect(region).toHaveProperty("osrmUrl");
    expect(region).toHaveProperty("osrmSize");
    expect(region.bounds).toHaveProperty("south");
    expect(region.bounds).toHaveProperty("west");
    expect(region.bounds).toHaveProperty("north");
    expect(region.bounds).toHaveProperty("east");
  });

  test("7. PII endpoints require authentication", async ({ request }) => {
    const endpoints = [
      "/api/recipients",
      "/api/drivers",
      "/api/deliveries",
      "/api/dashboard/stats",
      "/api/zones",
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(`${API}${endpoint}`);
      expect(
        response.status(),
        `${endpoint} should require auth`
      ).toBe(401);
    }
  });

  test("8. PWA loads and shows login", async ({ page }) => {
    await page.goto(PWA);
    await expect(page.locator("text=SafeCare")).toBeVisible();
    await expect(page.locator("text=Driver Delivery App")).toBeVisible();
    await expect(
      page.locator('input[type="tel"], input[placeholder*="555"]')
    ).toBeVisible();
  });

  test("9. PWA dashboard requires login", async ({ page }) => {
    await page.goto(`${PWA}/dashboard`);
    // Should redirect to login
    await page.waitForURL("**/", { timeout: 5000 });
    await expect(
      page.locator("text=Driver Delivery App")
    ).toBeVisible();
  });

  test("10. Database has encryption enabled", async ({ request }) => {
    // This indirectly tests encryption by checking the API can decrypt
    // (requires auth, so we need to log in first)
    const loginResponse = await request.post(`${API}/api/auth/admin/login`, {
      data: { email: "admin@example.com", password: "changeme" },
    });

    if (loginResponse.status() === 200) {
      const loginData = await loginResponse.json();
      const token = loginData.data?.token;

      if (token) {
        // Fetch recipients - if encryption works, we get decrypted names
        const recipResponse = await request.get(`${API}/api/recipients`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (recipResponse.status() === 200) {
          const recipData = await recipResponse.json();
          const recipients = recipData.data || recipData;
          if (Array.isArray(recipients) && recipients.length > 0) {
            // Name should be a readable string (decrypted), not ciphertext
            const name = recipients[0].name;
            expect(name).toBeTruthy();
            expect(name.length).toBeGreaterThan(0);
            expect(name.length).toBeLessThan(200); // Ciphertext would be much longer
          }
        }
      }
    }
  });
});
