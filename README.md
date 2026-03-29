# SafeCare — Mutual Aid Delivery System

A secure logistics platform for managing volunteer food deliveries to at-risk families. Prioritizes recipient privacy through field-level encryption, self-hosted geocoding and routing, and data compartmentalization.

## How It Works

1. **Admin** sets up the operating region, adds recipients and drivers
2. **Admin** creates dispatch sessions, assigns deliveries, releases routes
3. **Drivers** check in via phone (PWA), download routes with offline maps, deliver
4. **Recipients** are notified in their language via Signal, SMS, or WhatsApp
5. **After delivery**, all route data is automatically purged from devices and server

All geocoding, routing, and maps are self-hosted. No addresses leave your network.

## Quick Start

```bash
git clone https://github.com/jasontitus/safecare.git && cd safecare
bash scripts/setup.sh
cd docker && docker compose up -d
```

Open **http://localhost:3000** — a setup wizard walks you through creating your account, defining your operating region, and downloading map data. No command line needed after this point.

**See [GETTING-STARTED.md](GETTING-STARTED.md) for the full guide** including screenshots, driver setup, notification configuration, and troubleshooting.

## Architecture

```
┌─────────────┐  ┌─────────┐  ┌────────────┐  ┌──────────┐
│  Dashboard   │─▶│ Backend │─▶│ PostgreSQL │  │ Nominatim│
│  :3000       │  │ :3001   │  │ (pgcrypto) │  │ geocoding│
└─────────────┘  └────┬────┘  └────────────┘  └──────────┘
┌─────────────┐       │
│  Driver PWA  │──────▶│  ┌──────┐  ┌──────┐  ┌────────┐
│  (offline)   │       ├─▶│Redis │  │ OSRM │  │Signal  │
└─────────────┘       │  └──────┘  │routing│  │:8089   │
                      │            └──────┘  └────────┘
```

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3000 | Admin dashboard (Next.js) |
| Backend | 3001 | REST API (Fastify) |
| PostgreSQL | 5432 | Encrypted database |
| Redis | 6379 | Jobs, settings, sessions |
| Nominatim | 8088 | Address geocoding |
| OSRM | 5000 | Driving directions |
| Signal | 8089 | E2E encrypted messaging |

## Key Features

- **Guided setup wizard** — 3-step first-run experience, no technical knowledge needed
- **Self-hosted maps** — OpenStreetMap data provisioned to your operating region
- **Address autocomplete** — house-number-level accuracy with TIGER data
- **Offline driver navigation** — map tiles and routes pre-cached on phones
- **Airplane mode prompts** — privacy reminder near delivery areas
- **6 languages** — English, Spanish, Arabic, Somali, French, Chinese
- **3 notification channels** — Signal (free, E2E), SMS (Twilio), WhatsApp (Twilio)
- **Field-level encryption** — recipient PII encrypted with pgcrypto
- **Automatic data purge** — delivery records deleted + VACUUMed within 24 hours
- **Emergency destroy** — `scripts/destroy.sh` shreds everything

## Hardware Requirements

| Target | RAM | Storage | Cost | Notes |
|--------|-----|---------|------|-------|
| Raspberry Pi 4/5 (4GB) | 4 GB | 32 GB SSD | ~$60 | Metro-area viewport only |
| Raspberry Pi 4/5 (8GB) | 8 GB | 64 GB SSD | ~$100 | Any viewport size |
| Home PC | 8-16 GB | SSD | Already have it | |
| VPS | 4-8 GB | SSD | ~$20-40/mo | |

Map data is trimmed to your operating region viewport. A metro area (~20 MB) uses ~500 MB RAM total. The setup wizard shows a live RAM estimate as you define your region.

Monthly operating cost: $0 (Signal only) to ~$6/mo (Twilio SMS).

## Documentation

- **[GETTING-STARTED.md](GETTING-STARTED.md)** — Full setup guide, daily use, troubleshooting
- **[STATUS.md](STATUS.md)** — Implementation progress against the phased plan
- **[PLAN.md](PLAN.md)** — Product plan, security architecture, phased roadmap
- **[SPEC.md](SPEC.md)** — Product specification

## Development

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
cd docker && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
pnpm dev    # hot reload on http://localhost:3000 + :3001
pnpm test   # run test suites
```

## Emergency Destroy

```bash
scripts/destroy.sh    # type DESTROY to confirm
```

Shreds secrets, wipes database, deletes map data, removes Docker images. Cannot be undone.
