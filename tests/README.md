# SafeCare Test Suites

Four test suites verify the complete system, from fresh install through delivery and security.

## Quick Reference

```bash
# Run all tests against existing instance (~30 sec)
./tests/e2e-smoke.sh
./tests/security-verify.sh

# Run Playwright browser + API tests (~15 sec)
cd tests/integration && npx playwright test

# Full fresh install simulation (~5 min, resets Docker)
./tests/integration/run.sh

# Full test without resetting Docker
./tests/integration/run.sh --skip-reset
```

## Test Suites

### 1. E2E Smoke Tests (`e2e-smoke.sh`)
**35 tests** — Verifies all API endpoints work end-to-end.

| Category | Tests | What's Tested |
|----------|-------|---------------|
| Service Health | 4 | Backend, dashboard, PWA responding; setup status |
| Admin Auth | 2 | Registration, login |
| Settings | 4 | Save/load settings, provision status, manifest |
| Zones CRUD | 3 | Create, list, delete |
| Drivers CRUD | 3 | Create, vet, list |
| Recipients CRUD | 2 | Create with lat/lng, list |
| Dispatch | 4 | Session, delivery, active session, list |
| Driver App | 4 | OTP, verify, check-in, status |
| Route Release | 7 | Assign, release, download token, route geometry, tiles, stop fields |
| Pre-built Manifest | 5 | Structure, regions, downloadability, viewport matching |
| Geocoding | 1 | Search endpoint |
| Dashboard Stats | 1 | KPI counts |

### 2. Security Verification (`security-verify.sh`)
**32 tests** — Verifies encryption, access controls, and data protection.

| Category | Tests | What's Tested |
|----------|-------|---------------|
| PII Encryption at Rest | 6 | Recipient names/addresses/phones, driver names/phones, delivery addresses are ciphertext in DB |
| HMAC Hashes | 3 | Phone hashes are SHA-256, unique per record |
| Password Security | 2 | bcrypt hashing, no plaintext passwords |
| API Decryption | 1 | Authorized API returns readable decrypted data |
| Access Controls | 7 | All PII endpoints require auth (401), public endpoints correct, role separation |
| Data Purge | 4 | Purge infrastructure, no old deliveries, audit log |
| Geocoding Privacy | 2 | Search/reverse require admin auth |
| Download Token Security | 3 | Tokens hashed in DB, invalid tokens rejected |
| Notification Privacy | 1 | Messages contain no PII placeholders |
| Database Security | 3 | pgcrypto installed, DEK not in DB, lat/lng documented |

### 3. Fresh Install Tests (`integration/fresh-install.spec.ts`)
**10 Playwright browser tests** — Simulates the out-of-box experience.

- Dashboard redirects to setup wizard
- Account creation flow
- Operating region selection
- Setup/health API validation
- Pre-built manifest structure
- PII endpoint auth (5 endpoints)
- PWA loads login page
- PWA dashboard requires auth
- Database encryption via API

### 4. Full Flow Tests (`integration/full-flow.spec.ts`)
**17 Playwright tests** — Complete Detroit metro delivery flow.

- Admin login
- Pre-built manifest has 50+ states and metros
- Geocoding endpoint (local only; no public fallback)
- Reverse geocoding
- Detroit metro in manifest (or Michigan state)
- Create Detroit delivery zone (Midtown)
- Create driver with availability + zone assignment
- Create recipient with Detroit address + lat/lng
- Create dispatch session + delivery + assignment
- Driver PWA browser login with OTP
- Driver check-in via API
- Admin route release
- Route download: stops, OSRM geometry, tile URLs, tile bounds
- OSM tile downloadability (image/png)
- Driver PWA shows content
- Deliveries API returns data
- Cleanup

## Running the Full Fresh Install Simulation

```bash
./tests/integration/run.sh
```

This:
1. Stops all Docker containers
2. Deletes all volumes (clean slate)
3. Starts fresh Docker Compose
4. Waits for services to be healthy
5. Runs all Playwright browser tests
6. Runs all API smoke tests
7. Runs all security verification tests
8. Tears down (or use `--keep` to leave running)

## Writing New Tests

- **API tests**: Add to `e2e-smoke.sh` (bash + curl)
- **Security tests**: Add to `security-verify.sh` (bash + docker exec + psql)
- **Browser tests**: Add to `integration/*.spec.ts` (Playwright)
- **Always use test-specific data** (unique phone numbers, etc.) to avoid collisions

## Contact

For questions about the test suites: info@safecare.app
