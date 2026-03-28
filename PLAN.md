# MADS (Mutual Aid Delivery System) — Product Plan

## Context

A mutual aid org needs a secure logistics platform for volunteer food deliveries to at-risk families. The system must protect recipient physical safety and data privacy through offline-first routing, field-level encryption, blind communications, and low data persistence — while being simple enough for a small org (2-10 people) to deploy on commodity hardware (Raspberry Pi, home PC, or a VPS) with Docker Compose.

---

## Recommended Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Language** | TypeScript (everywhere) | Single language across backend, dashboard, mobile. Critical for a small team. |
| **Backend** | Fastify + TypeScript | Built-in schema validation (security), plugin system, better perf than Express. |
| **Database** | PostgreSQL 16 + pgcrypto | Spec requirement. Field-level encryption via `pgp_sym_encrypt`/`pgp_sym_decrypt`. |
| **ORM** | Drizzle ORM | Type-safe, custom column types for transparent encrypt/decrypt. |
| **Key Management** | SOPS + age | Zero-infrastructure (single binary). Vault is too heavy for a small org. Supports AWS KMS upgrade path. |
| **Admin Dashboard** | Next.js (App Router) + shadcn/ui | Server-side rendering keeps decrypted PII off the wire. shadcn = zero supply-chain risk (copy-pasted components). |
| **Mobile App** | React Native (Expo) + SQLCipher | Native capabilities required for airplane mode detection. SQLCipher encrypts local DB. Expo simplifies builds. |
| **Mapping** | OSRM (self-hosted) + Protomaps | No addresses sent to third parties. OSRM supports custom edge-weighting for exclusion zones. Protomaps = offline tiles. City-level extract keeps RAM under 512MB. |
| **Geocoding** | Admin map pin-drop + Nominatim fallback | Pelias is too heavy for RPi. Admins place pins on a map during order intake. Optional lightweight Nominatim API for batch lookups (external, but addresses are already known to the org). |
| **Communication** | Twilio Programmable SMS/Voice | Custom proxy (Twilio Proxy product is closed to new customers). Full control over log deletion + number rotation. |
| **Job Queue** | BullMQ + Redis | Background jobs for Twilio log purge, data expiry, number rotation. |
| **Networking** | Tailscale (admin) + Tailscale Funnel (driver API) | Split architecture: admin dashboard private on tailnet (zero-trust). Driver-facing API exposed via Tailscale Funnel or Cloudflare Tunnel — minimal public surface, JWT-protected. Volunteers install only the delivery app, no VPN/Tailscale required. |
| **Monorepo** | Turborepo + pnpm workspaces | Shared types/crypto across packages. |

---

## Monorepo Structure

```
safecare/
  packages/
    shared/              # Types, encryption utils, constants
    backend/             # Fastify API server + Dockerfile
    dashboard/           # Next.js admin dashboard + Dockerfile
    mobile/              # React Native (Expo) driver app
  docker/
    docker-compose.yml   # postgres, backend, dashboard, osrm, redis, tailscale
    docker-compose.dev.yml
    osrm/                # OSM data prep scripts
  secrets/
    secrets.enc.yaml     # SOPS-encrypted secrets
  scripts/
    setup.sh             # Interactive first-time setup
    destroy.sh           # Emergency teardown
    rotate-keys.sh       # DEK rotation helper
    rotate-twilio-numbers.sh
  turbo.json
  package.json
```

**Docker Compose services:** postgres, backend (port 3001), dashboard (port 3000), osrm (port 5000), redis. Tailscale runs on the host (or as a sidecar container).

### Hardware Profiles

**Minimum requirement: 8GB RAM.** The system supports three deployment targets. All use the same Docker Compose file with profile overrides.

| Target | RAM | Storage | Notes |
|--------|-----|---------|-------|
| **Raspberry Pi 5 (8GB)** | 8GB | USB SSD required (SD cards wear out under DB writes) | Minimum. OSRM handles metro-level extract (~512MB). Tailscale for networking. |
| **Home PC / Mini PC** | 8-16GB | SSD | Recommended. Full headroom for all services. |
| **VPS** | 8GB | SSD | Alternative for orgs that prefer not to self-host. $20-40/mo. |

**ARM64 compatibility:** All Docker images must be multi-arch (linux/amd64 + linux/arm64). PostgreSQL, Redis, Node.js, and OSRM all publish official ARM64 images. The backend and dashboard Dockerfiles use multi-stage builds with `--platform=$BUILDPLATFORM` for cross-compilation.

**RPi/home-server hardening:**
- `restart: unless-stopped` on all containers (survives power loss / reboot)
- `systemd` service to start Docker Compose on boot
- PostgreSQL `shared_buffers` and `work_mem` tuned for 8GB profile
- OSRM uses MLD (Multi-Level Dijkstra) preprocessing — lower memory than CH (Contraction Hierarchies)
- Swap file (2GB) on SSD as safety net, not relied upon

**Split networking model (admin-private / driver-public):**

Volunteers are non-technical. They cannot be expected to install Tailscale or manage a VPN. Additionally, the air-gap workflow requires Airplane Mode near destinations — this kills all VPN tunnels. The driver app is already offline-first, so it only needs brief connectivity windows for sync.

- **Admin side (Tailscale, private):**
  - Server runs `tailscaled` and joins the org's tailnet
  - Admin dashboard accessible only via Tailscale MagicDNS (e.g., `https://safecare.tail1234.ts.net`)
  - Only org members (2-5 people) need Tailscale installed — these are technical or semi-technical staff
  - Tailscale ACLs restrict dashboard access to admin-tagged devices

- **Driver side (public HTTPS, minimal surface):**
  - A hardened driver API is exposed via Tailscale Funnel (or Cloudflare Tunnel) — the only public-facing surface
  - Volunteers install only the delivery app. No VPN, no Tailscale, no extra setup.
  - The public endpoint exposes only: `/api/driver/auth`, `/api/driver/status` (polling for route release), `/api/driver/download` (one-time token-gated route download), `/api/driver/sync`, `/api/webhooks/*` (for Twilio)
  - Routes are never available on-demand — admin must explicitly release them via a dispatch session (see Route Release Gate)
  - Protected by: JWT auth, rate limiting (100 req/min per driver), single-use download tokens, request signing
  - Responses contain only encrypted route packets — even if intercepted, data is useless without the session key
  - Airplane Mode is clean: app goes offline, caches status updates locally, reconnects over normal cellular/WiFi when airplane mode is toggled off. No VPN reconnection delay.

- **Twilio webhooks** (inbound SMS/WhatsApp) hit the same public Funnel endpoint at `/api/webhooks/*`, validated by Twilio request signature

---

## Security Architecture

### Field-Level Encryption
- PII columns (name, address, phone) use `pgp_sym_encrypt(value, DEK)` via Drizzle custom column types.
- Companion `_hash` columns store `HMAC-SHA256(value, HMAC_KEY)` for equality lookups (phone dedup, order verification) without decryption.
- DEK loaded from SOPS-encrypted file at container startup, held in process memory. Never in logs or env files on disk.
- PostgreSQL `log_statement = 'none'` in production.

### Blind Communication Proxy (Model A)
- Backend maintains `communication_sessions` table: `(session_id, driver_phone_enc, recipient_phone_enc, twilio_proxy_number, expires_at)`.
- Driver taps "Message" in app -> backend sends via Twilio proxy number -> recipient replies to proxy number -> webhook forwards to driver via push notification.
- On delivery ack: session deleted, all Twilio message SIDs purged via Delete API, proxy number returned to pool.
- Number rotation cron every 14-30 days (configurable).

### Twilio Log Scrubbing
- Every outbound message SID tracked in Redis.
- On session end: BullMQ job deletes each SID via Twilio API with retry.
- Daily 2 AM sweep catches stragglers.

### Route Release Gate (Admin-Controlled Sync)

Routes are never available on-demand. An admin must explicitly release them to specific drivers. This is the most important control protecting recipient addresses.

**How it works:**

1. **Admin creates a dispatch session** on the dashboard: selects the day's deliveries, assigns them to drivers, reviews the routes.
2. **Drivers open the app and tap "Ready for routes"** — an explicit check-in. They see "Checked in — waiting for dispatch..." with their name and delivery count, but no addresses.
3. **Admin sees the check-in list** on the dashboard — e.g., "Today's dispatch: 3 of 5 drivers checked in" with names, assigned stop counts, and check-in timestamps.
4. **Admin taps "Approve & Release"** — can release to all checked-in drivers at once, or select individual drivers. The server generates time-limited, single-use download tokens and pushes encrypted route packets to approved drivers.
5. **Drivers receive their routes** — the app downloads and decrypts the route packet. The download token expires after 5 minutes (configurable). A driver who missed the window must re-check-in and wait for admin re-approval.
6. **No-show handling** — drivers who never check in never receive routes. The admin can reassign their stops to a checked-in driver and re-release.
7. **Late arrivals** — a driver who checks in after the initial release shows up on the dashboard as "checked in, not yet released." Admin can approve them individually.

**Security properties:**
- A compromised driver phone cannot pull routes outside of an active dispatch session
- Routes exist on devices for the shortest possible window (release -> end of shift purge)
- Admin has visual confirmation of who received what
- Download tokens are single-use and time-limited — replay attacks don't work
- The server logs route releases (who, when, how many stops) for audit, but not the addresses themselves

**Configurable strictness levels:**
- **Standard**: Admin releases routes; drivers can request re-download within the dispatch session window if app crashes
- **High**: Admin releases routes; single download only, no re-requests without admin re-release
- **Maximum**: Admin releases routes only when physically present with drivers (depot scenario); session auto-expires after 30 minutes

### Data Purge Architecture

Purging is the most critical security operation in the system. It happens on two fronts — the server (which we control) and the driver's phone (which we don't). Defense in depth on both.

#### Server-Side Purge

- **On delivery acknowledgment**: When all stops in a route are confirmed (recipient "GOT IT" or admin manual confirm), the server performs a hard `DELETE` (not soft-delete) of delivery records containing addresses.
- **24-hour maximum retention sweep**: A BullMQ cron job runs hourly. Any delivery record older than 24 hours is hard-deleted regardless of acknowledgment status. Unacknowledged deliveries are flagged for admin review before deletion.
- **PostgreSQL VACUUM**: After bulk deletes, an explicit `VACUUM` reclaims disk space and overwrites deleted tuples — prevents forensic recovery from the database files.
- **De-identified audit trail**: After purge, only a minimal record remains: `(delivery_id, driver_id, stop_count, completed_count, released_at, purged_at)`. No addresses, no names, no phone numbers.

#### Client-Side Purge (Defense in Depth)

Route data on the driver's phone is stored in a **separate, ephemeral SQLCipher database** — isolated from the main app database. This allows wholesale destruction without affecting app state.

**Layer 1 — Ephemeral DB with hardware-backed expiring encryption key:**
- When the admin releases routes, the server issues a session-specific encryption key for the route packet.
- This key is stored in the device's secure hardware (iOS Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` / Android Keystore with `setUserAuthenticationRequired`) — not in app storage, not in the SQLCipher DB itself.
- **iOS**: The keychain item is created with a `kSecAttrAccessControl` that requires biometric/passcode auth to read. If the device is locked by an adversary and they can't unlock it, the key is inaccessible even if they extract the filesystem.
- **Android**: The Keystore key is set with `setUserAuthenticationValidityDurationSeconds` matching the TTL — after expiry, the key becomes permanently inaccessible at the hardware level, no app code execution needed.
- On purge: the key is deleted from the keychain/keystore first, then the DB file is overwritten with random bytes and deleted. Even if the file deletion is incomplete, the data is unreadable without the key.

**Layer 2 — Baked-in TTL (self-destruct timer):**
- Every route packet includes an `expires_at` timestamp set by the server (default: 8 hours after release, configurable).
- On every app foreground event (user opens/switches to app), the app checks `expires_at`. If expired: purge immediately, no server contact needed.
- This handles the case where a driver forgets to end their shift, loses their phone, or goes permanently offline.

**Layer 3 — Manual "End Shift" purge:**
- Driver taps "End Shift" after completing deliveries. App purges the ephemeral DB, deletes the keychain entry, and sends a "purge confirmed" signal to the server.
- The app shows a confirmation: "Route data deleted. 0 addresses on this device."

**Layer 4 — Remote wipe via push notification:**
- Admin can revoke a driver's session from the dashboard at any time.
- Server sends a **visible** push notification to the driver's phone. Visible notifications are delivered reliably on both platforms regardless of app state (including force-quit).
- **iOS**: Uses a **Notification Service Extension** — a small piece of code that executes when the notification is *received*, before it's even displayed (~30 seconds of execution time). The purge logic (delete keychain key, overwrite ephemeral DB) runs here. By the time the driver sees the notification ("Your delivery session has ended"), the data is already destroyed. The driver does not need to tap it.
- **Android**: Uses a FCM high-priority data+notification message. The app's background service executes the purge on receipt. Same result — data destroyed before the driver interacts.
- The notification text is neutral: "Your delivery session has ended. Thank you!" — no indication of a security action.
- If the push lands: data is purged and confirmation is sent to the server automatically.
- If the push does not land (phone powered off, airplane mode, no connectivity): Layer 1 (hardware key expiry) and Layer 2 (TTL) are the backstops.
- MDM (Mobile Device Management) is documented as an option for orgs that issue dedicated delivery devices, but is too invasive for volunteers using personal phones.

**Layer 5 — Purge confirmation loop:**
- After route release, the server starts a timer for each driver (default: 12 hours).
- The server expects a "purge confirmed" signal from the driver's app within that window.
- If not received: the admin dashboard shows a warning — "Driver X has not confirmed route data deletion. Last seen: 3 hours ago." The admin can follow up directly.
- This doesn't guarantee deletion, but it creates accountability and surfaces problems.

**What this does NOT protect against:**
- A determined adversary with physical access to an unlocked phone who screenshots or photographs the screen before purge. This is an inherent limitation of any mobile app. Mitigation: keep the delivery window short (route release -> end of shift), and the air-gap workflow means the phone is in airplane mode during the most sensitive moments.
- A rooted/jailbroken phone where the secure keychain can be bypassed. Mitigation: the app can detect root/jailbreak status and refuse to download routes (configurable — some orgs may find this too restrictive for volunteers).

**Summary of passive vs active defenses:**

| Defense | Requires app running? | Requires connectivity? | Platform | Reliability |
|---------|----------------------|----------------------|----------|-------------|
| Hardware keychain key expiry (Android) | No — expires at hardware level | No | Android only | Guaranteed |
| Keychain auth-gating (iOS) | No — locked device = inaccessible key | No | iOS only | Guaranteed |
| TTL self-destruct | Yes — on next foreground | No | Both | Guaranteed on next app open |
| Remote wipe push (visible notification) | No — iOS Notification Service Extension / Android FCM runs on receipt | Yes | Both | Reliable on both platforms (visible notifications always delivered when online) |
| Manual "End Shift" | Yes — user action | No (purges locally) | Both | Depends on driver |

### Mobile Security Summary
- Route data in separate ephemeral SQLCipher DB (AES-256), isolated from app state
- Encryption key for ephemeral DB in secure hardware (iOS Keychain / Android Keystore), deleted on purge
- TTL auto-purge (8h default) even without server contact
- Manual "End Shift" purge
- Remote wipe via session revocation
- Purge confirmation loop with admin alerting

### Data Lifecycle

| Data | Retention | Purge Trigger | Purge Method |
|------|-----------|---------------|--------------|
| Delivery records (server) | Hours | All stops acknowledged, or 24h max | Hard DELETE + VACUUM |
| Communication sessions | Hours | Delivery complete | Hard DELETE |
| Twilio message logs | Minutes | Immediate post-communication | Twilio Delete API |
| Route packets (driver device) | Hours | End Shift, TTL expiry, or remote wipe | Keychain key deletion + file overwrite + delete |
| Recipient PII (server) | Persistent | Only on recipient request | Hard DELETE + VACUUM |
| De-identified audit trail | 90 days | Automated sweep | Hard DELETE |

### Auth
- Admin: email + password (bcrypt) + optional TOTP 2FA. Redis sessions, 8hr expiry.
- Driver: phone OTP + 6-digit PIN. JWT (24hr) with refresh rotation. JWT contains only driver ID.
- Roles: `admin` (full), `driver` (own routes only).

---

## Phased Implementation

### Phase 1: Foundation + Manual MVP (Weeks 1-4)
**Goal:** Working encrypted data pipeline. Admin assigns orders to drivers manually. Drivers view and complete deliveries on phones.

- Monorepo scaffolding (Turborepo, pnpm, shared package)
- PostgreSQL + pgcrypto + Drizzle with encrypted column types
- SOPS + age key management
- Backend API: JotForm webhook intake, recipient/driver/delivery CRUD, route release gate
- Admin dashboard: login, view orders, manually assign to drivers, dispatch session with "Release Routes" button, view delivery status
- Mobile app: driver login, "Ready for routes" check-in button, receive admin-released route (delivery list, no map yet), tap "Delivered", offline sync queue
- Docker Compose (postgres, backend, dashboard, redis)
- `scripts/setup.sh` interactive installer

**This alone replaces a shared Google Sheet with encrypted, access-controlled delivery management.**

### Phase 2: Mapping, Routing & Air-Gap Workflow (Weeks 5-8)
**Goal:** Map-based routing with exclusion zones and the airplane mode workflow.

- OSRM container with local OSM data (city-level extract, sized to hardware profile)
- Geocoding via admin map pin-drop during order intake (no heavy geocoder service)
- Route optimization service (exclusion zones via edge-weighting)
- Admin dashboard: map view, draw exclusion zones (GeoJSON), route preview
- Mobile app: offline map tiles (Protomaps), turn-by-turn route, airplane mode detection/prompts, full 5-step air-gap workflow
- Encrypted route packet download with session-scoped key
- Local data purge on shift end
- Dynamic route variation between delivery cycles

### Phase 3: Blind Communication + Acknowledgment (Weeks 9-12)
**Goal:** Twilio proxy, recipient confirmation, orphaned food alerts.

- Twilio SMS integration (send, receive via webhooks)
- Communication session management (proxy number pool)
- Twilio log auto-deletion (per-session + daily sweep)
- Number rotation cron job
- Recipient ack flow: "Reply GOT IT to confirm" -> 15-min orphaned food alert
- Driver app: "Message" / "Call" buttons through proxy
- WhatsApp Business API (Meta message templates, opt-in with privacy disclaimer)

### Phase 4: Volunteer Management & Gamification (Weeks 13-15)
**Goal:** Formalize volunteer lifecycle.

- Vetting workflow: pending -> background check -> interview -> vetted
- Driver profiles: vehicle/capacity, languages, geo prefs, time constraints
- Team gamification (Team Squirrels, etc.)
- Route optimization factors in driver constraints
- Admin: driver roster, team leaderboard

### Phase 5: Hardening & Advanced Security (Weeks 16-20)
**Goal:** High-threat-environment features.

- Model B (Burner Protocol): burner phone tracking, 30-day destruction reminders
- Signal integration via signal-cli container (disappearing message exports)
- Security audit / pen test
- Key rotation tooling (scripted DEK re-encryption migration)
- `scripts/destroy.sh` emergency teardown
- Comprehensive runbook (`docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/RUNBOOK.md`)

---

## Deployment Strategy

### What the Org Needs

**Hardware (pick one, 8GB RAM minimum):**
- **Raspberry Pi 5 (8GB)** + USB SSD + power supply + ethernet. ~$100-120 one-time.
- **Home PC / Mini PC** with 8GB+ RAM and SSD. Many orgs already have one.
- **VPS** (DigitalOcean/Hetzner/Linode), 8GB RAM, ~$40/mo. For orgs that prefer not to self-host hardware.

**Services:**
1. **Tailscale** (free for up to 100 devices) — private mesh network, auto-TLS, zero config networking
2. **Twilio** — pay-as-go (~$6/mo for 5 rotating numbers + per-message costs)
3. (Optional) **Cloudflare Tunnel** or **Tailscale Funnel** — only needed for Twilio webhook ingress
4. (Optional) Apple Dev ($99/yr) + Google Play ($25 one-time) for app distribution
5. (Optional) WhatsApp Business API via Twilio (requires Meta verification)

**No AWS, no GCP, no Kubernetes, no domain name required. Monthly cost as low as ~$6/mo (Twilio) if using own hardware + Tailscale free tier.**

### Install Flow
```bash
# 1. Clone the repo
git clone https://github.com/org/safecare.git && cd safecare

# 2. Run interactive setup — detects hardware (RPi/x86), adjusts defaults
./scripts/setup.sh
# Prompts for: Twilio creds, Tailscale auth key, admin user, city/region for OSM data
# -> detects architecture (ARM64 vs x86_64) and RAM
# -> selects appropriate Docker Compose profile (rpi, desktop, vps)
# -> encrypts secrets with SOPS+age
# -> downloads city/metro-level OSM extract for OSRM
# -> joins Tailscale tailnet
# -> installs systemd service for auto-start on boot (Linux)
# -> docker compose up -d
# -> runs migrations
# -> prints dashboard URL (via Tailscale MagicDNS, e.g. https://safecare.tail1234.ts.net)
```

### Networking (Home Deployments)
- **Admin access**: Tailscale only. Dashboard is never on the public internet. Org members (2-5 people) install Tailscale on their laptops.
- **Driver access**: Public HTTPS via Tailscale Funnel — exposes only the driver API paths. Volunteers just install the delivery app and log in. No VPN, no extra apps, no technical setup.
- **Twilio webhooks**: Share the same Funnel endpoint (`/api/webhooks/*`), validated by Twilio request signature.
- **Airplane Mode compatibility**: Drivers connect over normal cellular/WiFi (not a VPN tunnel), so toggling Airplane Mode off gives instant reconnection — no tunnel re-establishment delay. The offline sync queue flushes immediately.
- Tailscale ACLs restrict admin-side access by device tags.

### Backup
- Daily `pg_dump` encrypted with age, stored locally on a second drive/USB stick.
- Optional upload to Backblaze B2 ($0.005/GB/mo) for off-site backup.
- Recovery requires: git repo + age private key + latest backup.
- Age private key: printed physically or split via Shamir's Secret Sharing among trusted members.

### Emergency Destroy
```bash
./scripts/destroy.sh  # stops containers, drops DB, shreds secrets, removes images, wipes volumes
```

On RPi: the SD card / SSD can be physically destroyed for maximum assurance.

---

## Key Risks

| Risk | Mitigation |
|------|------------|
| WhatsApp template rejection by Meta | Submit early. SMS as default fallback. Generic templates. |
| Twilio subpoena | Aggressive log deletion (minutes). Number rotation. Model B fallback. |
| Driver phone seized | SQLCipher encryption. Session key in secure keychain. Ephemeral route data. |
| OSRM memory for large regions | Use MLD preprocessing. Setup script auto-selects extract size based on detected RAM. City-level on 4GB RPi, metro on 8GB+. |
| Single point of failure (home hardware) | Automated local + off-site backups. Full rebuild from repo + age key + backup in under 1 hour. RPi can be swapped to a new unit. Documented in runbook. |
| Power loss / SD card failure (RPi) | USB SSD required (setup script warns if running on SD). `restart: unless-stopped` + systemd auto-start. 2GB swap on SSD as safety net. |
| Home IP exposure | Admin dashboard on Tailscale (private). Driver API via Tailscale Funnel (only `/api/driver/*` and `/api/webhooks/*` exposed). Home IP never visible. |

---

## Verification Plan
- **Phase 1**: Insert test order via JotForm -> verify encrypted in DB (`SELECT` shows ciphertext) -> assign via dashboard -> verify driver app shows "Waiting for route..." (no addresses yet) -> admin taps "Approve & Release" -> verify driver receives route -> mark delivered -> recipient acks -> confirm status syncs -> verify server hard-deletes delivery records (SELECT returns 0 rows) -> verify driver "End Shift" purges local DB -> verify server receives purge confirmation. Also test: driver cannot download route before release, expired token is rejected, no-show driver never receives route, TTL auto-purge fires if driver never taps End Shift.
- **Phase 2**: Create exclusion zone on dashboard -> generate route -> verify route avoids zone -> test airplane mode workflow end-to-end on physical device
- **Phase 3**: Trigger delivery notification -> verify SMS received -> reply "GOT IT" -> verify Twilio logs deleted within 5 minutes -> verify orphaned food alert after 15-min timeout
- **CI**: GitHub Actions — lint, typecheck, Vitest unit tests, PostgreSQL integration tests via testcontainers, Playwright for dashboard
