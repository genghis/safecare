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
| DEK held in process memory only | Implemented | Key loaded from SOPS-encrypted file at startup, never written to disk in plaintext. |
| HMAC hashes for lookups | Implemented | Phone dedup uses HMAC-SHA256, not reversible to plaintext. |
| PostgreSQL log_statement=none | Planned | Prevents SQL queries (which contain plaintext) from appearing in Postgres logs. |
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

**Scenario:** A driver's phone is taken by law enforcement, a bad actor, or simply lost, while it may contain delivery route data.

**What's on the phone:**
- The PWA with cached route data (addresses, names, lat/lng)
- Cached map tiles for the delivery area
- The driver's JWT authentication token

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| Encrypted IndexedDB | Implemented | Route data encrypted with AES-GCM-256 in IndexedDB. |
| TTL auto-purge (8 hours) | Implemented | On next app open after TTL, all data is deleted. No server contact needed. |
| End-of-shift manual purge | Implemented | Driver taps "End Shift" → data + tile cache wiped, confirmation sent to server. |
| Purge confirmation tracking | Implemented | Admin warned if driver hasn't confirmed purge within 12 hours. |
| Single-use download tokens | Implemented | Route download tokens expire after 5 minutes, can't be replayed. |
| Admin-controlled route release | Implemented | Phone can't pull routes unless admin explicitly releases them. |
| Airplane mode prompts | Implemented | Driver prompted to go offline near delivery area, reducing location exposure. |
| Remote wipe via push notification | Planned | Admin revokes session → push notification triggers purge on phone. |
| Hardware-backed key storage (iOS Keychain / Android Keystore) | Planned | Encryption key stored in secure hardware, inaccessible when device is locked. |
| Root/jailbreak detection | Planned | Refuse route download on compromised devices. |

**What an adversary gets with an unlocked phone during an active shift:**
- Current delivery addresses (the ones assigned to this driver, not all recipients)
- The route map with stop locations
- Driver's own phone number

**What they DON'T get:**
- Other drivers' routes
- Recipients not assigned to this driver
- Historical delivery data (purged)
- The admin dashboard or server access

**Worst case timeline:**
- Phone seized during active delivery → addresses visible until TTL purge (max 8 hours)
- Phone seized after shift ended → data already purged (0 addresses)
- Phone seized while locked → encrypted IndexedDB, needs device unlock + app access

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
| TOTP 2FA | Planned | Second factor would prevent password-only attacks. |
| Session management with explicit logout | Planned | Revoke all sessions on password change. |
| Admin audit log | Planned | Track who accessed what, when. |
| Tailscale-only access | Planned | Dashboard only accessible on private tailnet, not the internet. |

**This is the highest-impact threat.** An attacker with admin access sees everything. Mitigations:

1. **Enable 2FA** (when implemented) — prevents password-only attacks
2. **Use Tailscale** — dashboard never on the public internet, can't be reached without tailnet membership
3. **Strong unique password** — minimum 12 characters, not reused
4. **Limit admin accounts** — only people who need it. Review access regularly.
5. **Don't use the admin account on public WiFi** — use a VPN or tailnet

---

## Threat 4: Twilio is Subpoenaed or Compromised

**Scenario:** Law enforcement or Twilio itself provides access to message logs, revealing which phone numbers received delivery notifications.

**What Twilio has:**
- Message SIDs (unique IDs for each message)
- Sender phone number (your Twilio number)
- Recipient phone number
- Message content ("Your delivery is on its way")
- Timestamps

**Defense layers:**

| Layer | Status | Protection |
|-------|--------|------------|
| Twilio SID tracking + deletion | Implemented | Every message SID tracked in Redis, deleted via Twilio API after delivery completes. |
| Daily 2 AM sweep | Implemented | Catches any SIDs missed by per-session cleanup. |
| Vague message content | Implemented | Messages say "Your delivery has arrived" — no names, no addresses. |
| Number rotation (14-day) | Implemented (job) | Twilio number rotated periodically so historical correlation is harder. |
| Signal alternative | Implemented | E2E encrypted, Twilio never sees the message. Self-hosted. |

**Best mitigation: Use Signal instead of Twilio.** With Signal:
- Messages are end-to-end encrypted
- The Signal server sees only that a message was sent, not its content
- The signal-cli instance runs on your hardware
- No third party has any message content or metadata

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
| HTTPS for all API traffic | Implemented (via Tailscale/tunnel) | All data encrypted in transit. |
| Airplane mode during deliveries | Implemented (prompts) | No network traffic near recipient homes. |
| Tailscale for admin access | Planned | Admin traffic goes through encrypted WireGuard tunnel. |
| Tailscale Funnel for driver API | Planned | Only specific API paths exposed, not the full server. |
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
| Twilio log scrubbing | **Implemented** |
| Driver phone TTL auto-purge | **Implemented** |
| Purge confirmation tracking | **Implemented** |
| Encrypted IndexedDB (PWA) | **Implemented** |
| Admin-controlled route release | **Implemented** |
| Single-use download tokens | **Implemented** |
| Airplane mode prompts | **Implemented** |
| Self-hosted geocoding | **Implemented** |
| Self-hosted routing | **Implemented** |
| Signal E2E notifications | **Implemented** |
| Emergency destroy script | **Implemented** |
| Vetting workflow | **Implemented** |
| TOTP 2FA for admin | Planned |
| Hardware-backed key storage (mobile) | Planned |
| Remote wipe via push | Planned |
| Tailscale networking | Planned |
| Full-disk encryption docs | Planned |
| PostgreSQL log_statement=none | Planned |
| Route variation between cycles | Planned |
| Root/jailbreak detection | Planned |
| Backup encryption | Planned |

---

## Recommendations for Deploying Orgs

1. **Use Signal, not SMS** — eliminates the Twilio exposure entirely
2. **Enable full-disk encryption** on the server (LUKS on Linux, FileVault on Mac, BitLocker on Windows)
3. **Keep the age private key physically separate** from the server (print it, store in a safe)
4. **Use Tailscale** so the dashboard is never on the public internet
5. **Vet every driver** before approving them
6. **Review purge warnings** regularly
7. **Don't screenshot** recipient lists or export data
8. **Rotate your admin password** quarterly
9. **Limit admin accounts** to people who absolutely need them
10. **Know where the destroy script is** — `scripts/destroy.sh`
