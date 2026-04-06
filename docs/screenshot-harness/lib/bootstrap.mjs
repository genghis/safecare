/**
 * Bootstrap the backend into a logged-in, unlocked state.
 *
 * On a freshly-initialized database:
 *   1. Register a throwaway admin account via /api/auth/admin/register
 *   2. Log in to get a JWT
 *   3. Generate a DEK and unlock the system via /api/setup/unlock
 *
 * Returns { token, dek } for downstream use.
 */

import { URLS, setDek } from './stack.mjs';

export const DUMMY_ADMIN = {
  email: 'screenshots@safecare.local',
  password: 'ScreenshotDummyPass42!',
};

async function apiPost(path, body) {
  const res = await fetch(`${URLS.backend}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${path} (status ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(`${path} failed: ${data.error || res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function randHex(bytes) {
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function bootstrap() {
  console.log('👤 Registering throwaway admin...');
  await apiPost('/api/auth/admin/register', DUMMY_ADMIN);

  console.log('🔑 Logging in...');
  const loginRes = await apiPost('/api/auth/admin/login', DUMMY_ADMIN);
  const token = loginRes.data?.token || loginRes.token;
  if (!token) {
    throw new Error(`Login response missing token: ${JSON.stringify(loginRes)}`);
  }

  console.log('🔓 Unlocking system with fresh DEK...');
  const dek = randHex(32); // 64 hex chars
  await apiPost('/api/setup/unlock', { dek });
  setDek(dek);

  console.log('✓  Bootstrap complete');
  return { token, dek };
}
