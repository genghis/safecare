# SafeCare — Implementation Status

Last updated: 2026-03-29

## Phase 1: Foundation + Manual MVP -- COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Monorepo scaffolding (Turborepo, pnpm, shared) | Done | |
| PostgreSQL + pgcrypto + Drizzle encrypted columns | Done | Field-level encryption with DEK |
| SOPS + age key management | Done | setup.sh supports it |
| Backend API (Fastify) | Done | Recipients, drivers, deliveries, dispatch, zones, distribution, geocoding, notifications |
| JotForm webhook intake | Done | POST /api/webhooks/jotform |
| Admin dashboard (Next.js) | Done | Login, recipients, drivers, deliveries, dispatch, distribution, zones |
| Add Recipient with map-based address picker | Done | Leaflet + self-hosted Nominatim geocoding proxy |
| Add Driver with availability scheduling | Done | Vehicle, team, day/time availability |
| Dispatch session + route release gate | Done | Admin creates session, drivers check in, admin releases |
| Distribution planner (auto-assign) | Done | Zone-aware, capacity-aware, nearest-neighbour routing |
| Driver PWA (React + Vite) | Done | Login, dashboard, delivery detail, profile, offline sync |
| Docker Compose (all services) | Done | postgres, redis, backend, dashboard, nominatim, osrm, signal |
| scripts/setup.sh interactive installer | Done | Generates secrets, .env, starts containers |

## Phase 2: Mapping, Routing & Air-Gap -- MOSTLY DONE

| Feature | Status | Notes |
|---------|--------|-------|
| OSRM routing container (Midwest extract) | Done | Docker service, MLD algorithm, osrm-init.sh |
| Self-hosted Nominatim geocoding | Done | US Midwest extract, backend proxy, no PII leakage |
| Admin map view for zones (Leaflet/OSM) | Done | Interactive polygon drawing, click/drag |
| Address picker with geocoding in recipient form | Done | Search + pin-drop + reverse geocode + zone overlay |
| Offline map tiles in driver PWA | Done | Service worker CacheFirst, tile pre-caching on route download |
| Route geometry display (polyline) | Done | OSRM driving directions rendered on Leaflet map |
| GPS tracking in driver PWA | Done | Live position on map via watchPosition |
| Airplane mode reminder | Done | Geofenced proximity detection, dismissible banner |
| Route packet with tile URLs + bounds | Done | Backend computes tile coverage for pre-caching |
| **Exclusion zones (draw + OSRM edge-weighting)** | **Not done** | Zones page handles delivery zones, not exclusion zones |
| **Route variation between delivery cycles** | **Not done** | Same route every time currently |
| **Full client-side data purge (SQLCipher/keychain)** | **Partial** | PWA clears IndexedDB + tile cache; no hardware-backed key expiry |

## Phase 3: Blind Communication + Acknowledgment -- IN PROGRESS

| Feature | Status | Notes |
|---------|--------|-------|
| Unified notification service | Done | Channel-agnostic: SMS, WhatsApp, Signal with fallback |
| Recipient notifications ("on the way" / "delivered") | Done | Fired async on driver sync status updates |
| i18n / localized messages | Done | 6 languages: en, es, ar, so, fr, zh |
| Twilio SMS send/receive | Done | REST API integration with SID tracking |
| WhatsApp via Twilio | Done | Sends when recipient opts in, falls back to SMS otherwise |
| Signal via signal-cli | Done | Self-hosted container, E2E encrypted, free |
| Notification test endpoint | Done | POST /api/notifications/test for admin verification |
| Twilio log auto-deletion | Done | Per-session scrub + daily 2AM sweep (Phase 5 hardening) |
| Communication proxy (blind number pool) | Not done | Schema exists, no proxy logic |
| Number rotation cron | Not done | Constant defined (14 days), no job |
| Recipient "GOT IT" ack flow | Not done | |
| Orphaned food alert (15-min timeout) | Not done | Constant defined, no implementation |

## Phase 4: Volunteer Management -- PARTIAL

| Feature | Status | Notes |
|---------|--------|-------|
| Driver profiles (vehicle, availability, zones) | Done | Full CRUD in dashboard |
| Vetting workflow (pending/vetted/suspended) | Partial | Status field exists, no UI workflow |
| Team gamification | Not done | |
| Route optimization with driver constraints | Partial | Zone-aware distribution, no constraint optimization |

## Phase 5: Hardening & Advanced Security -- IN PROGRESS

| Feature | Status | Notes |
|---------|--------|-------|
| Server-side data purge (hard DELETE + VACUUM) | Done | Hourly sweep + VACUUM, communication session cleanup |
| Audit log cleanup (90-day sweep) | Done | Daily cron job |
| Twilio log scrubbing | Done | Per-session + daily 2AM sweep, Redis SID tracking |
| Purge confirmation loop | Done | 12h window, Redis tracking, dashboard warnings |
| Dashboard purge warnings endpoint | Done | GET /api/dashboard/purge-warnings |
| Emergency destroy script | Done | Cross-platform (Linux + macOS), shreds secrets, wipes volumes |
| Remote wipe via push notification | Not done | |
| Key rotation tooling | Not done | |
| Security docs/runbook | Partial | README.md + STATUS.md |
| CI/CD (GitHub Actions) | Not done | |
| Playwright dashboard tests | Not done | |
| PostgreSQL integration tests (testcontainers) | Not done | |

## Cross-Cutting Gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| **Communication proxy** (blind number pool) | Medium | Twilio proxy numbers for driver-recipient messaging |
| **Tailscale networking** | Medium | Documented in plan but not configured |
| **CI/CD pipeline** | Medium | No automated lint/test/build |
| **Exclusion zones** | Medium | Draw on map, OSRM edge-weighting to avoid |
| **Recipient ack flow** | Medium | "Reply GOT IT" + orphaned food alert |
| **Key rotation tooling** | Low | Scripted DEK re-encryption |
| **Remote wipe** | Low | Push notification to destroy route data on driver phone |

## Services (Docker)

| Service | Container | Port | Image |
|---------|-----------|------|-------|
| Dashboard | safecare-dashboard | 3000 | Next.js standalone |
| Backend API | safecare-backend | 3001 | Fastify + Node 20 |
| Driver PWA | (served via backend or Vite) | 5173 | React + Vite |
| PostgreSQL | safecare-postgres | 5432 | postgres:16-alpine |
| Redis | safecare-redis | 6379 | redis:7-alpine |
| Nominatim | safecare-nominatim | 8088 | mediagis/nominatim:4.4 |
| OSRM | safecare-osrm | 5000 | osrm/osrm-backend:latest |
| Signal | safecare-signal | 8089 | bbernhard/signal-cli-rest-api:latest |

## i18n Coverage

All user-facing strings are keyed in `packages/shared/src/i18n.ts`.

| Locale | Language | Status |
|--------|----------|--------|
| en | English | Complete |
| es | Español | Complete |
| ar | العربية (Arabic) | Complete |
| so | Soomaali (Somali) | Complete |
| fr | Français (French) | Complete |
| zh | 中文 (Chinese) | Complete |

String categories: notification messages, driver app UI, dashboard navigation, communication preferences. Adding a new language requires only adding translations to the string table.

## Test Coverage

| Package | Tests | Status |
|---------|-------|--------|
| Backend: auth | Unit tests | Existing (from Phase 1) |
| Backend: dispatch | Unit tests | Existing (from Phase 1) |
| Backend: geocode | Unit tests | New |
| Backend: routing | Unit tests | New |
| Backend: purge | Unit tests | Existing (from Phase 1) |
| PWA: crypto, db, sync, hooks, api | Unit tests | Existing (from Phase 1) |
| Dashboard | No tests | |
| Integration (testcontainers) | Not done | |
| E2E (Playwright) | Not done | |
