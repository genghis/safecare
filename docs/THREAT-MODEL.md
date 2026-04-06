# SafeCare Threat Model

This document analyzes specific threat scenarios and what SafeCare does to protect recipients in each case.

## Core Principle

SafeCare assumes the worst: that any device, account, or service provider WILL be compromised eventually. The design minimizes what an adversary can learn when that happens.

---

## Threat 1: Server is Physically Confiscated

**Scenario:** Illegal actors or another adversary seizes the Raspberry Pi, PC, or VPS running SafeCare.

**What they get:**
- A Docker host with encrypted data at rest
- PostgreSQL database files on disk

**What they CAN'T read without the encryption key (DEK):**
- Recipient names
- Recipient addresses
- Recipient phone numbers
- Driver phone numbers and emails

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| Field-level encryption (pgp_sym_encrypt) | Implemented | All PII columns encrypted. Raw database files show ciphertext. |
| DEK never on disk | Implemented | DEK is NOT stored in `.env` or anywhere on the filesystem. It exists only in backend process memory after admin scans the QR code on each boot. Seized server (powered off) = no DEK = unreadable database. |
| HMAC hashes for lookups | Implemented | Phone dedup uses HMAC-SHA256, not reversible to plaintext. |
| PostgreSQL query logging disabled | Implemented | `log_statement=none`, `log_min_error_statement=PANIC`, `log_min_duration_statement=-1`. **Critical:** every `pgp_sym_decrypt(column, DEK)` call passes the DEK as a query parameter. Without these settings, a query error or slow query log would write the DEK in plaintext to the Postgres log file on the Docker volume — defeating the off-disk DEK model entirely. |
| Delivery records auto-deleted | Implemented | Records hard-deleted + VACUUMed within 24 hours. A seized server likely has no delivery history. |
| Emergency destroy script | Implemented | If you know seizure is coming: `scripts/destroy.sh` shreds keys, wipes volumes, removes images. |

**What IS exposed if they have the DEK:**
- Recipient PII is fully readable
- Lat/lng coordinates are stored in plaintext (needed for routing)

**Mitigation for DEK exposure:**
- Use SOPS + age encryption. The age private key can be printed physically and kept separate from the server.
- Shamir's Secret Sharing: split the age key among multiple trusted members. No single person can decrypt.
- On seizure, if you can get to the server first: run `destroy.sh` or physically destroy the storage device.

**Gap:** If the server is seized while running (not shut down), the DEK is in process memory and could theoretically be extracted with forensic tools. Mitigation: full-disk encryption (LUKS on Linux) adds another layer.

---

## Threat 2: Driver's Phone is Seized or Stolen

**Scenario:** A driver's phone is taken by a bad actor, or simply lost, while it may contain delivery route data.

**What's on the phone:**
- The PWA with cached route data (addresses, names, lat/lng)
- Cached map tiles for the delivery area
- The driver's JWT authentication token

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| Encrypted IndexedDB | Implemented | Route data encrypted with AES-GCM-256 via server-issued session key, derived through HKDF. Key held only in sessionStorage (volatile, tab-scoped, not on disk). |
| TTL auto-purge (8 hours) | Implemented | Session expiry stored encrypted in IndexedDB. On app foreground, checks expiry and purges all data + key if expired. |
| End-of-shift manual purge | Implemented | Flushes sync queue, clears all IndexedDB stores, destroys CryptoKey, clears sessionStorage key, clears tile cache, confirms to server. |
| Panic erase (driver) | Implemented | Long-press "Erase" button on Dashboard. Instant destroy of all local data — no network calls, no waiting. |
| Remote wipe (admin) | Implemented | Admin revokes session key in Redis. Driver status poll detects revocation and triggers emergency purge. |
| QR backup key | Implemented | After route download, driver can photograph a QR code of the session key for offline recovery after tab close. |
| Session key re-issue | Implemented | `GET /api/driver/session-key` re-issues from Redis if driver is online after tab close/crash. |
| Purge confirmation tracking | Implemented | Admin warned if driver hasn't confirmed purge within 12 hours. |
| Single-use download tokens | Implemented | Route download tokens expire after 5 minutes, can't be replayed. |
| Admin-controlled route release | Implemented | Phone can't pull routes unless admin explicitly releases them. |
| Airplane mode prompts | Implemented | Driver prompted to go offline near delivery area, reducing location exposure. |
| Remote wipe via push notification | Planned | Admin revokes session → push notification triggers purge on phone. |
| Hardware-backed key storage (iOS Keychain / Android Keystore) | Planned | Encryption key stored in secure hardware, inaccessible when device is locked. |
| Root/jailbreak detection | Planned | Refuse route download on compromised devices. |

**What an adversary gets with an unlocked phone during an active shift:**
- Current delivery addresses IF the browser tab is still open (decrypted data is in JS memory)
- The route map with stop locations (same condition)

**What they DON'T get:**
- Other drivers' routes
- Recipients not assigned to this driver
- Historical delivery data (purged)
- The admin dashboard or server access
- Encrypted IndexedDB data (unreadable without the session key, which is only in volatile sessionStorage)
- The session key from persistent storage (sessionStorage is not written to disk by modern browsers)

**Worst case timeline:**
- Phone seized during active delivery, browser open → driver can long-press "Erase" to instantly destroy all data
- Phone seized during active delivery, browser open, no time to erase → addresses in JS memory until tab is closed; IndexedDB has encrypted data that requires the session key
- Phone seized, browser tab closed → sessionStorage cleared (key gone), IndexedDB has only ciphertext, JWT not in localStorage
- Phone seized after shift ended → data already purged (0 addresses)
- Admin detects seizure → remote wipe: revokes session key, driver's next poll triggers emergency purge

---

## Threat 3: Admin Account is Compromised

**Scenario:** Someone gains access to the admin email/password through phishing, credential stuffing, or social engineering.

**What they can access:**
- All recipient names, addresses, phone numbers (decrypted in the dashboard)
- All driver information
- Ability to create dispatch sessions and release routes
- Delivery zone definitions
- Org settings

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| bcrypt password hashing | Implemented | Passwords not stored in plaintext. |
| JWT with 24-hour expiry | Implemented | Stolen token expires in 24 hours. |
| Rate limiting (100 req/min) | Implemented | Slows brute-force attempts. |
| TOTP 2FA (backend) | Implemented | All 6 endpoints + backup recovery codes (8 single-use codes generated on enable, bcrypt-hashed in DB). |
| TOTP 2FA (dashboard) | Implemented | Settings page enable/disable flow, login page TOTP step, 2FA setup nudge banner. |
| Dashboard route protection | Implemented | LayoutShell auth guard checks for token before rendering any sidebar page. Redirects to /login if no token. API client auto-redirects on 401. |
| Logout | Implemented | Sidebar "Logout" button clears the admin session token and redirects to /login. |
| Session management with explicit logout | Implemented | JWTs include jti tracked in Redis. Logout revokes session. `revokeAllSessions()` ready for password change. |
| Admin audit log | Implemented | Logs login/logout/failed login/TOTP/unlock/revoke with admin_id, IP, details. 90-day retention. |
| Tailscale-only access | Deployment setup required | Recommended topology is documented in docs/REMOTE-ACCESS.md. Dashboard should stay private to the tailnet. |

**This is the highest-impact threat.** An attacker with admin access sees everything. Mitigations:

1. **Enable 2FA** in Settings — prevents password-only attacks (backend + UI both work)
2. **Use Tailscale** — dashboard never on the public internet, can't be reached without tailnet membership
3. **Strong unique password** — minimum 12 characters, not reused
4. **Limit admin accounts** — only people who need it. Review access regularly.
5. **Don't use the admin account on public WiFi** — use a VPN or tailnet

**Remaining gap:**
- Networking hardening is still deployment-dependent. The codebase supports a split public/private topology, but the nonprofit still needs to deploy Tailscale or a tunnel correctly.

---

## Threat 4: Third-Party Communication Provider is Subpoenaed

**Scenario:** Law enforcement requests message logs from a third-party communication provider.

**WhatsApp (via Baileys) — low risk:**
- WhatsApp messages are sent via a direct connection from the SafeCare server, not through a business API. There is no intermediate service provider (like Twilio) that stores message logs.
- WhatsApp itself has end-to-end encryption — Meta cannot read message content.
- Meta can see metadata (who messaged whom, when) on their servers, but SafeCare's WhatsApp account is a generic prepaid number, not tied to the organization.
- **Risk:** The prepaid WhatsApp number could be correlated with recipient numbers in Meta's metadata if subpoenaed. Use Signal for highest-risk recipients.

**SMS (via Twilio) — moderate risk:**

| Layer | Status | Protection |
|-------|--------|------------|
| Twilio SID tracking + deletion | Implemented | Every message SID tracked in Redis, deleted via Twilio API after delivery completes. |
| Daily 2 AM sweep | Implemented | Catches any SIDs missed by per-session cleanup. |
| Vague message content | Implemented | Messages say "Your delivery has arrived" — no names, no addresses. |
| Number rotation (14-day) | Implemented (job) | Twilio number rotated periodically so historical correlation is harder. |

**Signal — lowest risk:**
- Messages are end-to-end encrypted
- The Signal server sees only that a message was sent, not its content
- The signal-cli instance runs on your hardware
- No third party has any message content or metadata

**Best mitigation: Use Signal or WhatsApp instead of SMS.** SMS via Twilio has the most third-party exposure. WhatsApp via Baileys avoids the Twilio middleman entirely.

---

## Threat 5: Network Traffic is Monitored

**Scenario:** An adversary monitors network traffic between the server, drivers, and recipients (ISP-level surveillance, WiFi sniffing).

**What's visible in traffic:**
- HTTPS connections between driver phones and the server
- Connection timing (when drivers check in, download routes)
- IP addresses of driver phones

**What's NOT visible:**
- Request/response content (HTTPS encrypted)
- Recipient addresses (encrypted in transit via HTTPS, encrypted at rest)
- Route data (encrypted in the HTTPS payload)

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| HTTPS for all API traffic | Deployment setup required | Use Tailscale and/or a public tunnel as documented in docs/REMOTE-ACCESS.md. |
| Airplane mode during deliveries | Implemented (prompts) | No network traffic near recipient homes. |
| Tailscale for admin access | Recommended | Admin traffic should go through encrypted tailnet access. |
| Tailscale Funnel or Cloudflare Tunnel for driver API | Recommended | Public internet should reach only the driver and webhook paths, not the full server. |
| Offline-first driver app | Implemented | After route download, drivers don't need connectivity to navigate. |

---

## Threat 6: A Rogue Driver

**Scenario:** A vetted driver is actually a bad actor trying to learn recipient addresses.

**What they can learn:**
- The addresses on THEIR assigned route (5-10 addresses per shift)
- The general delivery area from the map

**What they CAN'T learn:**
- Other drivers' routes
- Addresses not assigned to them
- Historical delivery data
- The full recipient list

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| Route compartmentalization | Implemented | Each driver sees only their assigned stops. |
| Admin-controlled route release | Implemented | Admin decides who gets which routes. |
| Vetting workflow | Implemented | Drivers must be vetted/approved before receiving routes. |
| Data purge after shift | Implemented | Route data deleted from phone after use. |
| Route variation | Planned | Vary which driver gets which route across delivery cycles. |
| Audit trail | Implemented | Server logs who received routes (but not the addresses). |

**Inherent limitation:** A driver physically goes to each address. They can memorize or write down addresses. No technology prevents this. The mitigation is vetting, trust, compartmentalization (they only see their route), and rotation.

---

## Threat 7: Database Backup is Stolen

**Scenario:** An adversary obtains a database backup file (pg_dump).

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| Field-level encryption | Implemented | Backup contains ciphertext, not plaintext PII. |
| Backup encryption with age | Planned | pg_dump encrypted with age before storage. |
| Off-site backup encryption | Planned | Backblaze B2 backup encrypted with age key held separately. |

**If the backup AND the DEK are both stolen:** All PII is exposed. This is why the DEK should be stored separately from the backup (e.g., age key printed physically, not on the same device).

---

## Threat 8: Supply Chain / Dependency Attack

**Scenario:** A malicious npm package or Docker image is introduced.

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| shadcn/ui (copy-pasted, not npm) | Implemented | Dashboard UI components are vendored, not pulled from npm at runtime. |
| Lockfile pinning | Implemented | pnpm-lock.yaml pins exact versions. |
| Docker image pinning | Partial | Some images use `:latest` tag. Should pin to digest. |
| GitHub Actions CI | Implemented | Automated build catches issues. |
| Dependency audit | Planned | Regular `pnpm audit` in CI. |

---

## What's Implemented vs Planned

| Defense | Status |
|---------|--------|
| Field-level encryption (PII) | **Implemented** |
| HMAC phone hashes | **Implemented** |
| Delivery record auto-purge + VACUUM | **Implemented** |
| Twilio SMS log scrubbing | **Implemented** |
| WhatsApp via Baileys (no third-party logs) | **Implemented** |
| Driver phone TTL auto-purge | **Implemented** |
| Purge confirmation tracking | **Implemented** |
| Encrypted IndexedDB (PWA) | **Implemented** — AES-GCM-256, server-issued session key via HKDF, key in volatile sessionStorage |
| Remote wipe (admin spike) | **Implemented** — admin revokes key in Redis, driver poll triggers purge |
| Panic erase (driver) | **Implemented** — long-press button, instant local destroy |
| QR backup key for offline recovery | **Implemented** — driver photographs QR after route download |
| Admin-controlled route release | **Implemented** |
| Single-use download tokens | **Implemented** |
| Airplane mode prompts | **Implemented** |
| Self-hosted geocoding | **Implemented** |
| Self-hosted routing | **Implemented** |
| Signal E2E notifications | **Implemented** |
| Emergency destroy script | **Implemented** |
| Vetting workflow | **Implemented** |
| TOTP 2FA for admin | **Implemented** (backend + dashboard + backup codes + auth guard + logout) |
| Hardware-backed key storage (mobile) | Planned |
| Remote wipe via push | Planned |
| Tailscale networking | Planned |
| Full-disk encryption docs | Planned |
| PostgreSQL log_statement=none | **Implemented** |
| Route variation between cycles | Planned |
| Root/jailbreak detection | Planned |
| Backup encryption | Planned |

---

## Recommendations for Deploying Orgs

1. **Use Signal or WhatsApp, not SMS** — eliminates the Twilio exposure entirely. WhatsApp via Baileys has no third-party log storage.
2. **Store the encryption key QR code in a safe** — this is the only copy of the DEK; print it and lock it up
3. **Scan the QR to unlock after every reboot** — the system is locked by design; this protects data if seized
4. **Enable full-disk encryption** on the server (LUKS on Linux, FileVault on Mac, BitLocker on Windows)
5. **Use Tailscale** so the dashboard is never on the public internet
   See [docs/REMOTE-ACCESS.md](REMOTE-ACCESS.md) for the recommended split-host deployment patterns.
6. **Vet every driver** before approving them
7. **Review purge warnings** regularly
8. **Don't screenshot** recipient lists or export data
9. **Rotate your admin password** quarterly
10. **Limit admin accounts** to people who absolutely need them
11. **Know where the destroy script is** — `scripts/destroy.sh`
12. **If WiFi changes** — the Pi auto-starts a SafeCare-Recovery network after 60 seconds; connect to reconfigure
