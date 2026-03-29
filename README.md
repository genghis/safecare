# SafeCare — Mutual Aid Delivery System

A secure logistics platform for managing volunteer food deliveries to at-risk families. Prioritizes recipient privacy through field-level encryption, self-hosted geocoding and routing, and data compartmentalization.

## How It Works

1. **Admin** creates delivery zones, adds recipients (with map-based address entry), and manages volunteer drivers
2. **Admin** creates a dispatch session, assigns deliveries to drivers, and releases routes
3. **Drivers** check in via the PWA, download their route (with offline maps), and deliver
4. **Recipients** are notified when their delivery is on the way and when it arrives (via Signal, SMS, or WhatsApp in their preferred language)
5. **After delivery**, route data is automatically purged from driver devices and the server

All geocoding, routing, and map data is self-hosted. No addresses are sent to Google, Mapbox, or any external service.

## Quick Start

### 1. Install and start

```bash
git clone https://github.com/jasontitus/safecare.git && cd safecare
bash scripts/setup.sh    # generates secrets, writes .env
cd docker
docker compose up -d     # starts all services
```

### 2. Register the first admin

```bash
curl -X POST http://localhost:3001/api/auth/admin/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'
```

### 3. First-run setup

Open **http://localhost:3000** and log in. You'll see a welcome banner directing you to Settings.

1. Go to **Settings**
2. Enter your organization name
3. **Define your operating region**: pan and zoom the map so the visible area covers everywhere your deliveries go and your drivers live. The map edges define the bounding box.
4. Click **Save Settings**
5. Click **Provision Maps** — the system downloads OpenStreetMap data for your region and imports it into the geocoding and routing engines. This takes 10-30 minutes on first run.

Once provisioning completes, address search, map views, and offline routing are all scoped to your operating region.

### 4. Start using it

- **Recipients** → Add recipients with the map-based address picker (search or click to place)
- **Drivers** → Add drivers, set vehicle type, availability, vet/approve them
- **Zones** → Draw delivery zones on the map
- **Dispatch** → Create a session, assign deliveries, release routes to drivers
- **Drivers open the PWA** → check in, download route, deliver, maps work offline

## Services

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3000 | Next.js admin dashboard |
| Backend API | 3001 | Fastify REST API |
| PostgreSQL | 5432 | Database with pgcrypto field-level encryption |
| Redis | 6379 | Job queues, settings, session state |
| Nominatim | 8088 | Self-hosted address geocoding (OpenStreetMap) |
| OSRM | 5000 | Self-hosted driving directions (OpenStreetMap) |
| Signal | 8089 | Self-hosted Signal messaging (E2E encrypted) |

Nominatim and OSRM start in standby mode and begin importing after you provision maps in Settings.

## Current Status

See [STATUS.md](STATUS.md) for detailed implementation progress against the phased plan.

## Architecture

```
                        ┌──────────────┐
┌─────────────┐         │  PostgreSQL   │
│  Dashboard   │────┐   │  (pgcrypto)   │
│  (Next.js)   │    │   │  :5432        │
│  :3000       │    │   └──────────────┘
└─────────────┘    │           │
                   ▼           │
┌─────────────┐  ┌─────────┐  │  ┌────────────┐
│  Driver PWA  │─▶│ Backend │──┘  │ Nominatim  │
│  (offline)   │  │ (Fastify)│────▶│ geocoding  │
└─────────────┘  │ :3001   │     │ :8088      │
                 └────┬────┘     └────────────┘
                      │
              ┌───────┼────────┐
              │       │        │
         ┌────┴──┐ ┌──┴───┐ ┌─┴──────┐
         │ OSRM  │ │Redis │ │Signal  │
         │routing│ │:6379 │ │:8089   │
         │:5000  │ └──────┘ └────────┘
         └───────┘
```

## Operating Region & Map Provisioning

When you first set up SafeCare, you define your **operating region** — the area where your deliveries happen and your drivers live. This is done visually: pan and zoom the map in Settings so the visible area covers your full operating region.

The system then downloads OpenStreetMap data covering that region:
- **Single state**: downloads that state's extract (~100-500 MB)
- **Multi-state** (e.g., a metro area on a state border): downloads the regional extract (Midwest, South, etc.) that covers all overlapping states

This data powers:
- **Address autocomplete** with house-number-level accuracy (TIGER data)
- **Driving directions** for delivery routes
- **Offline map tiles** pre-cached on driver phones
- **Zone assignment** (which deliveries fall in which zones)

All of this runs on your hardware. No addresses, routes, or location data leaves your network.

### Re-provisioning

If your operating region changes, go to Settings, adjust the map viewport, save, and click **Re-provision**. The old data is replaced with the new region's data.

## Recipient Notifications

Recipients are notified via their preferred channel when deliveries are on the way and when they arrive. Three channels are supported:

| Channel | Provider | PII Exposure | Cost | Setup |
|---------|----------|-------------|------|-------|
| **Signal** | Self-hosted (signal-cli) | None (E2E encrypted) | Free | Register a phone number |
| **SMS** | Twilio | Twilio sees phone + message | ~$0.01/msg | Twilio account |
| **WhatsApp** | Twilio + Meta | Twilio + Meta see phone + message | ~$0.005/msg | Meta verification |

Messages are localized in 6 languages (English, Spanish, Arabic, Somali, French, Chinese). The system tries the recipient's preferred channel first, falls back to SMS.

All notification text is intentionally vague — no names, no addresses, no tracking links.

### Signal Setup (recommended)

Signal is the recommended channel — end-to-end encrypted, free, fully self-hosted.

```bash
# Register a phone number with Signal
curl -X POST http://localhost:8089/v1/register/+1234567890

# Verify with the code you receive via SMS
curl -X POST http://localhost:8089/v1/register/+1234567890/verify/123456
```

Then add `SIGNAL_PHONE_NUMBER=+1234567890` to your `.env` file and restart the backend.

## Data Privacy & Security

- **Recipient PII** (names, addresses, phones) encrypted at rest with `pgp_sym_encrypt`
- **Phone lookups** use HMAC-SHA256 hashes — no plaintext stored for search
- **Geocoding and routing** fully self-hosted — no addresses sent externally
- **Signal notifications** are end-to-end encrypted
- **Delivery records** hard-deleted + VACUUMed after 24 hours (prevents forensic recovery)
- **Twilio message logs** auto-deleted per-session + daily sweep
- **Driver route data** purged from devices at end of shift (IndexedDB + tile cache cleared)
- **Purge confirmation** tracked — admin warned if driver hasn't confirmed deletion within 12 hours
- **Emergency destroy**: `scripts/destroy.sh` shreds all secrets, wipes all data

## Driver PWA

Drivers use a Progressive Web App (works on iOS + Android, no app store needed):

1. Open the PWA URL in a browser, install to home screen
2. Log in with phone number + OTP
3. Check in when ready for routes
4. Admin releases routes → driver downloads (with offline maps)
5. Map tiles are automatically pre-cached for the delivery area
6. Navigate offline with GPS tracking and numbered stop markers
7. Near the delivery area, prompted to enable airplane mode for privacy
8. Mark deliveries as complete
9. End shift → all route data and cached maps are purged

## Hardware Requirements

**Minimum (Raspberry Pi 4/5, 8GB RAM):**
- 8 GB RAM
- 32 GB storage (64 GB recommended)
- ARM64 or x86_64

**Recommended (home PC / small server):**
- 16 GB RAM
- 100 GB storage
- Any modern x86_64 or ARM64

Monthly cost: ~$0-6/mo (free with Signal only, or ~$6/mo with Twilio for SMS).

## Development

```bash
# Install dependencies
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install

# Start infrastructure only (DB, Redis, Nominatim, OSRM, Signal)
cd docker
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Run dev servers with hot reload (from project root)
pnpm dev

# Run tests
pnpm test

# Typecheck
pnpm typecheck
```

## Environment Variables

Generated by `scripts/setup.sh` and stored in `.env` (mode 600, not committed):

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | JWT signing secret (64 hex chars) |
| `DEK` | Yes | Data Encryption Key for pgp_sym_encrypt |
| `HMAC_KEY` | Yes | HMAC key for phone/name hash lookups |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `GEOCODING_URL` | No | Nominatim URL (default: self-hosted) |
| `OSRM_URL` | No | OSRM routing URL (default: self-hosted) |
| `TWILIO_ACCOUNT_SID` | No | Twilio SMS/WhatsApp |
| `TWILIO_AUTH_TOKEN` | No | Twilio SMS/WhatsApp |
| `TWILIO_PHONE_NUMBER` | No | Twilio sender number |
| `SIGNAL_CLI_URL` | No | Signal REST API URL (default: self-hosted) |
| `SIGNAL_PHONE_NUMBER` | No | Signal sender number |
| `JOTFORM_API_KEY` | No | JotForm webhook intake |

## Emergency Destroy

```bash
scripts/destroy.sh
```

Stops all containers, shreds secrets (.env, age keys), wipes all Docker volumes (database, map data, Redis), removes images. Requires typing `DESTROY` to confirm. Works on both Linux and macOS.

On Raspberry Pi: physically destroy the SD card / SSD for maximum assurance.
