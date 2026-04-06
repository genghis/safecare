# SafeCare — Implementation Status

Last updated: 2026-03-30

## Project URLs

- **Website**: https://safecare.app
- **Pre-built Map Data**: https://safecare.app/manifest.json
- **GitHub**: https://github.com/safecare-project/safecare
- **Contact**: info@safecare.app

## Phase 1: Foundation + Manual MVP -- COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Monorepo scaffolding (Turborepo, pnpm, shared) | Done | |
| PostgreSQL + pgcrypto + Drizzle encrypted columns | Done | Field-level encryption with DEK |
| SOPS + age key management | Done | setup.sh supports it |
| Backend API (Fastify) | Done | Recipients, drivers, deliveries, dispatch, zones, distribution, geocoding, notifications |
| JotForm webhook intake | Done | POST /api/webhooks/jotform |
| Admin dashboard (Next.js) | Done | Login, recipients, drivers, deliveries, dispatch, distribution, zones, settings |
| Add Recipient with map-based address picker | Done | Leaflet + self-hosted geocoding only |
| Add Driver with availability scheduling | Done | Vehicle, team, day/time availability, vetting workflow |
| Dispatch session + route release gate | Done | Admin creates session, drivers check in, admin releases |
| Distribution planner (auto-assign) | Done | Zone-aware, capacity-aware, nearest-neighbour routing |
| Driver PWA (React + Vite) | Done | Login, dashboard, delivery detail, offline sync, route map |
| Docker Compose (all services) | Done | postgres, redis, backend, dashboard, nominatim, osrm, signal, pwa |
| Guided setup wizard | Done | 5-step first-run: account, region, provision, notifications, security |
| Settings-driven map provisioning | Done | Operating region → auto-downloads correct state/metro extract |
| scripts/setup.sh interactive installer | Done | Generates secrets, .env, starts containers |

## Phase 2: Mapping, Routing & Air-Gap -- MOSTLY DONE

| Feature | Status | Notes |
|---------|--------|-------|
| Pre-built OSRM on GCS (safecare.app) | Done | 50 states + 50 metros, quarterly builds, ~$0.50/build |
| OSRM routing container | Done | Docker service, MLD algorithm, pre-built or viewport-trimmed |
| Self-hosted Nominatim geocoding | Done | Local import only; fails closed until ready |
| Viewport-based operating region | Done | Map viewport IS the region, auto-selects best pre-built match |
| Region size estimation + RAM warnings | Done | Live estimate, color-coded (green/amber/red) |
| GPS-aware route ordering | Done | Nearest stop to driver first, then nearest-neighbour chain |
| Driver position in route geometry | Done | OSRM route starts from driver's GPS, not just first stop |
| Admin map view for zones (Leaflet/OSM) | Done | Interactive polygon drawing, click/drag |
| Address picker with geocoding in recipient form | Done | Search + pin-drop + reverse geocode + zone overlay |
| Offline map tiles in driver PWA | Done | Service worker CacheFirst, tile pre-caching on route download |
| Route geometry display (polyline) | Done | OSRM driving directions rendered on Leaflet map |
| GPS tracking in driver PWA | Done | Live position on map via watchPosition |
| Airplane mode reminder | Done | Geofenced proximity detection, dismissible banner, loud audio alert at 500 m per stop |
| Route packet with tile URLs + bounds | Done | Backend computes tile coverage for pre-caching |
| **Exclusion zones (draw + OSRM edge-weighting)** | **Not done** | Zones page handles delivery zones, not exclusion zones |
| **Route variation between delivery cycles** | **Not done** | Same route every time currently |
| PWA client-side encryption | Done | Server generates session key on route download, client derives AES-GCM-256 via HKDF. Key in sessionStorage (volatile). Route data encrypted in IndexedDB. QR backup for offline recovery. |
| Remote wipe (admin spike) | Done | Backend API + driver-side detection + emergency purge + dashboard "Revoke" button per driver in dispatch view. |
| Panic erase (driver) | Done | Long-press "Erase" button on Dashboard. Instant local destroy — no network, no confirmation. |
| Session key re-issue | Done | `GET /api/driver/session-key` re-issues from Redis after tab close (online recovery). |
| Off-disk DEK (server encryption key) | Done | DEK never written to .env or disk. Loaded into memory via QR code unlock on each boot. Seized server = unreadable database. |
| RPi appliance provisioner | Done | Flask captive portal: WiFi setup, device password, key gen + QR, Docker startup. Hands off to dashboard wizard. |
| Dashboard unlock screen | Done | QR scanner + manual hex entry to unlock system on each boot. 423 Locked on PII endpoints until unlocked. |
| WiFi recovery AP | Done | Auto-detects lost WiFi on boot. After 60s, starts SafeCare-Recovery AP for reconfiguration. No SSH needed. |
| pi-gen SD card image | Done | Custom pi-gen stage: pre-pulled Docker images, systemd services, hostapd/dnsmasq, Avahi mDNS |
| **Full client-side data purge (SQLCipher/keychain)** | **Not done** | No hardware-backed key expiry; purge uses IndexedDB clear + sessionStorage + tile cache |

## Phase 3: Blind Communication + Acknowledgment -- IN PROGRESS

| Feature | Status | Notes |
|---------|--------|-------|
| Unified notification service | Done | Channel-agnostic: SMS, WhatsApp, Signal with fallback |
| Recipient notifications ("on the way" / "delivered") | Done | Fired async on driver sync status updates |
| i18n / localized messages | Done | 443 string keys across 6 languages (en, es, ar, so, fr, zh). Full coverage: notifications, driver PWA, admin dashboard. Language picker in settings. RTL support for Arabic. |
| Twilio SMS send/receive | Done | REST API integration with SID tracking |
| WhatsApp via Baileys | Done | Direct WhatsApp Web connection — QR pairing from dashboard, no Twilio/Meta business API needed |
| Signal via signal-cli | Done | Self-hosted container, E2E encrypted, free |
| Twilio inbound SMS webhook | Done | POST /api/webhooks/twilio/sms for ack processing |
| Recipient "GOT IT" ack flow | Done | Multi-language keyword matching, auto-purge on ack |
| Orphaned food alert (15-min timeout) | Done | BullMQ job, dashboard endpoint, Redis tracking |
| Number rotation monitoring | Done | Daily job, warns when rotation due |
| Notification test endpoint | Done | POST /api/notifications/test for admin verification |
| Twilio SMS log auto-deletion | Done | Per-session scrub + daily 2AM sweep (WhatsApp via Baileys has no server-side logs to scrub) |
| Communication proxy (blind number pool) | Not done | Schema exists, no proxy logic |

## Phase 4: Volunteer Management -- PARTIAL

| Feature | Status | Notes |
|---------|--------|-------|
| Driver profiles (vehicle, availability, zones) | Done | Full CRUD in dashboard |
| Vetting workflow (pending/vetted/suspended) | Done | Approve/suspend/reinstate buttons in driver detail panel |
| Team gamification | Not done | |
| Route optimization with driver constraints | Partial | Zone-aware distribution, no constraint optimization |

## Phase 5: Hardening & Advanced Security -- IN PROGRESS

| Feature | Status | Notes |
|---------|--------|-------|
| Server-side data purge (hard DELETE + VACUUM) | Done | Hourly sweep + VACUUM, communication session cleanup |
| Audit log cleanup (90-day sweep) | Done | Daily cron job |
| Twilio SMS log scrubbing | Done | Per-session + daily 2AM sweep, Redis SID tracking |
| Purge confirmation loop | Done | 12h window, Redis tracking, dashboard warnings |
| Dashboard purge warnings endpoint | Done | GET /api/dashboard/purge-warnings |
| Emergency destroy script | Done | Cross-platform (Linux + macOS), shreds secrets, wipes volumes |
| TOTP 2FA for admin accounts | Done | Backend + dashboard UI + login step + nudge + 8 single-use backup recovery codes |
| Dashboard auth guard | Done | LayoutShell checks for token before rendering protected pages. Redirects to /login if missing. |
| Logout button | Done | Sidebar "Logout" button revokes server session + clears token. API auto-redirects on 401. |
| Admin session management | Done | JWTs include jti, tracked in Redis. Logout revokes session. revokeAllSessions available for password change. |
| Admin audit log | Done | audit_log expanded with admin_id, ip, details (JSONB). Logs: login, login_failed, logout, TOTP enable/disable, system unlock, driver revoke. |
| Threat model documentation | Done | docs/THREAT-MODEL.md, 8 scenarios analyzed |
| CI/CD (GitHub Actions) | Done | Lint, typecheck, test, build on push/PR |
| E2E smoke tests | Done | 35 API tests, full flow verification |
| Security verification tests | Done | 32 tests, encryption/purge/access controls |
| Playwright integration tests | Done | 27 browser tests, fresh install + Detroit flow |
| Encrypted backup export + restore | Done | AES-256-GCM + scrypt KDF, passphrase-protected, restore during fresh setup |
| Webhook signature validation | Done | Twilio SMS HMAC signatures, JotForm shared-secret auth, fail-closed |
| Local tile serving | Done | Self-hosted tile proxy + cache, no external CDN for map tiles |
| OTP delivery gating | Done | Fails closed if SMS/Signal delivery fails, clears pending OTP |
| Driver enumeration protection | Done | Same response for existing/non-existing driver phone numbers |
| Geocoding fail-closed | Done | No public Nominatim fallback — addresses never leave local network |
| Input sanitization utilities | Done | constantTimeEquals (HMAC-based), sanitizePlainText, normalizePhone |
| Key rotation tooling | Done | Interactive rotate-keys.sh script for DEK re-encryption |
| Remote access documentation | Done | docs/REMOTE-ACCESS.md — Tailscale/Cloudflare deployment patterns |
| Remote wipe via push notification | Not done | |

## Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Project website | https://safecare.app | Firebase Hosting, custom domain |
| Pre-built OSRM data | GCS bucket (safecare-maps-osrm) | 50 states + 50 metros, ~40 GB |
| Build VM | GCE spot (c2-standard-8) | Quarterly builds, ~$0.50/run |
| Terraform | infra/prebuilt/ | GCS, service account, VM |

## Test Suites

| Suite | Tests | File |
|-------|-------|------|
| PWA Unit Tests | 62 | packages/pwa/src/\_\_tests\_\_/ (crypto, db, api, sync, hooks) |
| Backend Unit Tests | 136 | packages/backend/src/\_\_tests\_\_/ (auth, dispatch, session-key, middleware, routing, tiles, etc.) |
| E2E Smoke | 35 | tests/e2e-smoke.sh |
| Security Verification | 32 | tests/security-verify.sh |
| Fresh Install (Playwright) | 10 | tests/integration/fresh-install.spec.ts |
| Full Flow - Detroit (Playwright) | 17 | tests/integration/full-flow.spec.ts |

See [tests/README.md](tests/README.md) for details.

## Services (Docker)

| Service | Container | Port | Image |
|---------|-----------|------|-------|
| Dashboard | safecare-dashboard | 3000 | Next.js standalone |
| Backend API | safecare-backend | 3001 | Fastify + Node 20 |
| Driver PWA | safecare-pwa | 5173 | React + Vite |
| PostgreSQL | safecare-postgres | 5432 | postgres:16-alpine |
| Redis | safecare-redis | 6379 | redis:7-alpine |
| Nominatim | safecare-nominatim | 8088 | mediagis/nominatim:4.4 |
| OSRM | safecare-osrm | 5000 | ghcr.io/project-osrm/osrm-backend:v6.0.0 |
| Signal | safecare-signal | 8089 | bbernhard/signal-cli-rest-api |

## i18n Coverage (443 string keys)

All user-facing strings translated to 6 languages. Language selectable in Settings.

| Locale | Language | Notifications | Dashboard UI | Driver PWA UI |
|--------|----------|--------------|-------------|--------------|
| en | English | Complete | Complete | Complete |
| es | Español | Complete | Complete | Complete |
| ar | العربية (Arabic) | Complete | Complete (RTL) | Complete (RTL) |
| so | Soomaali (Somali) | Complete | Complete | Complete |
| fr | Français (French) | Complete | Complete | Complete |
| zh | 中文 (Chinese) | Complete | Complete | Complete |
| uk | Українська (Ukrainian) | Complete | Complete | Complete |

## Cross-Cutting Gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| Exclusion zones | High | Draw "avoid" areas on map, OSRM edge-weighting. Currently zones are delivery-only. |
| Communication proxy (blind number pool) | High | Proxy so drivers/recipients never see each other's real numbers. Schema exists, no proxy logic. |
| Tailscale / tunnel networking | High | Recommended deployment documented in docs/REMOTE-ACCESS.md. Admin should stay private; public host should expose only driver + webhook paths. |
| Route variation | Medium | Same driver gets same route pattern every time. |
| Push notification remote wipe | Medium | Current wipe uses polling. Push would be instant even with app backgrounded. |
| Unit tests for security.ts | Medium | 5 security utility functions have no unit tests (constantTimeEquals, sanitizePlainText, normalizePhone, etc.) |
| Team gamification | Low | Fun team names for morale. |
