import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DASHBOARD = process.env.DASHBOARD_URL || "http://localhost:3000";
const PWA = process.env.PWA_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:3001";
const TEST_DEK = process.env.SAFECARE_TEST_DEK || "1".repeat(64);
const ARTIFACT_PATH =
  process.env.SAFECARE_SMOKE_ARTIFACT ||
  path.join(process.cwd(), ".artifacts", "core-smoke.json");

const REGION = {
  lat: 37.44,
  lng: -122.16,
  zoom: 13,
  label: "Palo Alto",
  bounds: {
    south: 37.41,
    west: -122.19,
    north: 37.47,
    east: -122.13,
  },
};

type ApiOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
};

type SmokeArtifacts = {
  apiBase: string;
  dashboardBase: string;
  pwaBase: string;
  dek: string;
  adminEmail: string;
  adminPassword: string;
  orgName: string;
  driverPhone: string;
  driverId: string;
  recipientId: string;
  zoneId: string;
  sessionId: string;
  deliveryId: string;
  routeReleased: boolean;
  routeVisibleInPwa: boolean;
};

async function api(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  route: string,
  options: ApiOptions = {},
) {
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response =
    method === "GET"
      ? await request.get(`${API}${route}`, { headers })
      : method === "POST"
      ? await request.post(`${API}${route}`, { headers, data: options.body })
      : method === "PUT"
      ? await request.put(`${API}${route}`, { headers, data: options.body })
      : method === "PATCH"
      ? await request.patch(`${API}${route}`, { headers, data: options.body })
      : await request.delete(`${API}${route}`, { headers });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    status: response.status(),
    ok: response.ok(),
    raw: data,
    data:
      data && typeof data === "object" && "data" in (data as Record<string, unknown>)
        ? (data as { data: unknown }).data
        : data,
  };
}

async function readSessionToken(page: Page): Promise<string> {
  let token = "";
  await expect
    .poll(
      async () => {
        token =
          (await page.evaluate(() => window.sessionStorage.getItem("safecare_token"))) || "";
        return token.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(20);

  return token;
}

async function writeArtifacts(artifacts: SmokeArtifacts): Promise<void> {
  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(artifacts, null, 2)}\n`, "utf8");
}

test.describe("Fresh Install Core Smoke", () => {
  test.setTimeout(180_000);

  test("fresh install to first route", async ({ page, request, context }) => {
    const uniqueSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const adminEmail = `smoke-${uniqueSuffix}@example.test`;
    const adminPassword = "smoketest123";
    const orgName = "Smoke Test Mutual Aid";
    const driverPhone = `555${uniqueSuffix.slice(-7)}`;
    const recipientPhone = `556${uniqueSuffix.slice(-7)}`;

    await page.goto(DASHBOARD);
    await page.waitForLoadState("networkidle");

    if (page.url().includes("/unlock")) {
      if (await page.getByTestId("unlock-manual-toggle").isVisible().catch(() => false)) {
        await page.getByTestId("unlock-manual-toggle").click();
      }
      await expect(page.getByTestId("unlock-manual-key")).toBeVisible();
      await page.getByTestId("unlock-manual-key").fill(TEST_DEK);
      await page.getByTestId("unlock-submit").click();
      await page.waitForURL("**/setup", { timeout: 20_000 });
    } else {
      await page.waitForURL(/\/setup$/, { timeout: 20_000 });
    }

    await expect(page.getByTestId("setup-create-account")).toBeVisible();
    await page.getByTestId("setup-org-name").fill(orgName);
    await page.getByTestId("setup-admin-email").fill(adminEmail);
    await page.getByTestId("setup-admin-password").fill(adminPassword);
    await page.getByTestId("setup-admin-confirm-password").fill(adminPassword);
    await page.getByTestId("setup-create-account").click();
    await expect(page.getByTestId("setup-region-search")).toBeVisible({ timeout: 15_000 });

    const adminToken = await readSessionToken(page);

    const saveSettings = await api(request, "PUT", "/api/settings", {
      token: adminToken,
      body: {
        orgName,
        serviceArea: REGION,
      },
    });
    expect(saveSettings.status).toBe(200);

    const startProvisioning = await api(request, "POST", "/api/settings/provision-maps", {
      token: adminToken,
      body: {},
    });
    expect(startProvisioning.status).toBe(200);

    const provisionStatus = await api(request, "GET", "/api/settings/provision-status", {
      token: adminToken,
    });
    expect(provisionStatus.status).toBe(200);
    const setupStatus = await api(request, "GET", "/api/setup/status");
    expect(setupStatus.status).toBe(200);
    expect((setupStatus.data as { steps: { adminCreated: boolean; operatingRegionSet: boolean } }).steps.adminCreated).toBe(true);
    expect((setupStatus.data as { steps: { adminCreated: boolean; operatingRegionSet: boolean } }).steps.operatingRegionSet).toBe(true);

    const unauthRecipients = await api(request, "GET", "/api/recipients");
    expect(unauthRecipients.status).toBe(401);

    const zoneRes = await api(request, "POST", "/api/zones", {
      token: adminToken,
      body: {
        name: "Smoke Test Zone",
        color: "#3b82f6",
        polygon: [
          { lat: 37.44, lng: -122.16 },
          { lat: 37.44, lng: -122.14 },
          { lat: 37.42, lng: -122.14 },
          { lat: 37.42, lng: -122.16 },
        ],
      },
    });
    expect(zoneRes.status).toBe(201);
    const zoneId = (zoneRes.data as { id: string }).id;

    const driverRes = await api(request, "POST", "/api/drivers", {
      token: adminToken,
      body: {
        name: "Smoke Test Driver",
        phone: driverPhone,
        teamName: "Test Team",
      },
    });
    expect(driverRes.status).toBe(201);
    const driverId = (driverRes.data as { id: string }).id;

    const vetDriver = await api(request, "PATCH", `/api/drivers/${driverId}/status`, {
      token: adminToken,
      body: { status: "vetted" },
    });
    expect(vetDriver.status).toBe(200);

    const recipientRes = await api(request, "POST", "/api/recipients", {
      token: adminToken,
      body: {
        name: "Smoke Test Recipient",
        phone: recipientPhone,
        address: "123 Test St, Palo Alto, CA",
        lat: REGION.lat,
        lng: REGION.lng,
        communicationPreference: "sms",
        language: "en",
      },
    });
    expect(recipientRes.status).toBe(201);
    const recipientId = (recipientRes.data as { id: string }).id;

    const today = new Date().toISOString().slice(0, 10);
    const sessionRes = await api(request, "POST", "/api/dispatch/sessions", {
      token: adminToken,
      body: { date: today },
    });
    expect(sessionRes.status).toBe(201);
    const sessionId = (sessionRes.data as { id: string }).id;

    const deliveryRes = await api(request, "POST", "/api/deliveries", {
      token: adminToken,
      body: {
        recipientId,
        dispatchSessionId: sessionId,
      },
    });
    expect(deliveryRes.status).toBe(201);
    const deliveryId = (deliveryRes.data as { id: string }).id;

    const assignRes = await api(request, "POST", `/api/deliveries/${deliveryId}/assign`, {
      token: adminToken,
      body: { driverId },
    });
    expect(assignRes.status).toBe(200);

    const driverPage = await context.newPage();
    await driverPage.route(`${API}/api/auth/driver/request-otp`, async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          "x-safecare-test-otp": "1",
        },
      });
    });
    await driverPage.goto(PWA);
    await expect(driverPage.getByTestId("driver-phone-input")).toBeVisible();
    await driverPage.getByTestId("driver-phone-input").fill(driverPhone);
    await driverPage.getByTestId("driver-request-otp").click();
    await expect(driverPage.getByTestId("driver-otp-input")).toBeVisible({ timeout: 15_000 });

    const otpRes = await api(request, "POST", "/api/auth/driver/request-otp", {
      headers: {
        "x-safecare-test-otp": "1",
      },
      body: { phone: driverPhone },
    });
    expect(otpRes.status).toBe(200);
    const otp = (otpRes.data as { otp?: string }).otp;
    expect(otp).toBeTruthy();

    await driverPage.getByTestId("driver-otp-input").fill(otp!);
    await driverPage.getByTestId("driver-verify-otp").click();
    await expect(driverPage.getByTestId("driver-check-in")).toBeVisible({ timeout: 15_000 });
    await driverPage.getByTestId("driver-check-in").click();
    await expect(driverPage.getByTestId("driver-check-routes")).toBeVisible({ timeout: 15_000 });

    const releaseRes = await api(
      request,
      "POST",
      `/api/dispatch/sessions/${sessionId}/release`,
      {
        token: adminToken,
        body: { driverIds: [driverId] },
      },
    );
    expect(releaseRes.status).toBe(200);

    await driverPage.getByTestId("driver-check-routes").click();

    const backupDismiss = driverPage.getByTestId("driver-backup-dismiss");
    if (await backupDismiss.isVisible().catch(() => false)) {
      await backupDismiss.click();
    }

    await expect(driverPage.getByTestId("delivery-card").first()).toBeVisible({
      timeout: 45_000,
    });

    const artifacts: SmokeArtifacts = {
      apiBase: API,
      dashboardBase: DASHBOARD,
      pwaBase: PWA,
      dek: TEST_DEK,
      adminEmail,
      adminPassword,
      orgName,
      driverPhone,
      driverId,
      recipientId,
      zoneId,
      sessionId,
      deliveryId,
      routeReleased: true,
      routeVisibleInPwa: true,
    };

    await writeArtifacts(artifacts);
  });
});
