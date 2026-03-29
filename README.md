# SafeCare — Mutual Aid Delivery System

A secure logistics platform for managing volunteer food deliveries to at-risk families. Prioritizes recipient privacy through field-level encryption, self-hosted geocoding, and data compartmentalization.

## Quick Start

```bash
# 1. Clone and enter the project
git clone https://github.com/jasontitus/safecare.git
cd safecare

# 2. Generate secrets and .env file
bash scripts/setup.sh

# 3. Start everything in Docker
cd docker
docker compose up -d

# 4. Wait for services to be ready (~1-2 min, longer on first start)
docker compose ps

# 5. Register the first admin
curl -X POST http://localhost:3001/api/auth/admin/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password-here"}'

# 6. Open the dashboard
open http://localhost:3000
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3000 | Next.js admin dashboard |
| Backend API | 3001 | Fastify REST API |
| Driver PWA | 5173 | Vite dev server (or served via backend in production) |
| PostgreSQL | 5432 | Database with pgcrypto encryption |
| Redis | 6379 | Job queues (BullMQ) |
| OSRM | 5000 | Self-hosted driving directions (OpenStreetMap) |
| Nominatim | 8088 | Self-hosted geocoding (OpenStreetMap) |

## Current Status

See [STATUS.md](STATUS.md) for detailed implementation progress against the phased plan.

## Geocoding

Address geocoding is self-hosted using [Nominatim](https://nominatim.org/) with OpenStreetMap data. This means **no addresses are sent to external services** — all geocoding happens on your own hardware.

### Default Region: US Midwest

The default configuration imports the US Midwest OSM extract, which covers: Illinois, Indiana, Iowa, Kansas, Michigan, Minnesota, Missouri, Nebraska, North Dakota, Ohio, South Dakota, and Wisconsin.

**Resource requirements (after import):**
- Disk: ~2-3 GB
- RAM: ~1.5-2 GB
- First import: 15-60 min (1-2 hours on Raspberry Pi)

### Changing the Region

Regional extracts are available at [download.geofabrik.de](https://download.geofabrik.de/).

1. Edit `docker/docker-compose.yml` and change the `PBF_URL` and `REPLICATION_URL` in the `nominatim` service:

```yaml
environment:
  PBF_URL: https://download.geofabrik.de/north-america/us-south-latest.osm.pbf
  REPLICATION_URL: https://download.geofabrik.de/north-america/us-south-updates/
```

2. Delete the existing Nominatim data and reimport:

```bash
cd docker
docker compose down
docker volume rm docker_nominatimdata
docker compose up -d
```

### Common Region Options

| Region | PBF URL | RAM Needed |
|--------|---------|------------|
| US Midwest | `north-america/us-midwest-latest.osm.pbf` | ~1.5 GB |
| US South | `north-america/us-south-latest.osm.pbf` | ~2 GB |
| US Northeast | `north-america/us-northeast-latest.osm.pbf` | ~1.5 GB |
| US West | `north-america/us-west-latest.osm.pbf` | ~2 GB |
| Single state (e.g. Illinois) | `north-america/us/illinois-latest.osm.pbf` | ~0.5 GB |
| Full US | `north-america/us-latest.osm.pbf` | ~10 GB |

### Disabling Self-Hosted Geocoding

To use the public Nominatim API instead (addresses will be sent to nominatim.openstreetmap.org):

1. Remove or comment out the `nominatim` service in `docker-compose.yml`
2. Change the backend's `GEOCODING_URL` environment variable:

```yaml
backend:
  environment:
    GEOCODING_URL: https://nominatim.openstreetmap.org
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Dashboard   │────▶│   Backend   │────▶│  PostgreSQL   │
│  (Next.js)   │     │  (Fastify)  │────▶│  (pgcrypto)   │
│  :3000       │     │  :3001      │     │  :5432        │
└─────────────┘     └──────┬──────┘     └──────────────┘
                           │
┌─────────────┐     ┌──────┼──────────┐
│  Driver PWA  │────▶│     │          │
│  (Vite/React)│     │  ┌──┴───┐  ┌───┴────────┐
│  offline-first│    │  │Redis │  │ Nominatim  │
└─────────────┘     │  │:6379 │  │ :8088      │
                    │  └──────┘  └────────────┘
                    │
                    │  ┌──────────┐
                    └──│  OSRM    │
                       │  :5000   │
                       └──────────┘
```

### Data Privacy

- **Recipient names, addresses, and phone numbers** are encrypted at rest using PostgreSQL's `pgp_sym_encrypt` with a per-deployment Data Encryption Key (DEK)
- **Phone lookups** use HMAC-SHA256 hashes (never store plaintext for search)
- **Geocoding** is self-hosted — address searches never leave your network
- **Lat/lng coordinates** are stored in plaintext (required for routing)

## Hardware Requirements

**Minimum (Raspberry Pi 4/5, 8GB RAM):**
- 8 GB RAM
- 32 GB storage (64 GB recommended)
- ARM64 or x86_64

**Recommended (home PC / small server):**
- 16 GB RAM
- 100 GB storage
- Any modern x86_64 or ARM64

## Development

```bash
# Install dependencies
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install

# Start infrastructure only
cd docker
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Run dev servers (from project root)
pnpm dev
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
| `GEOCODING_URL` | No | Nominatim URL (default: self-hosted at http://nominatim:8080) |
| `TWILIO_ACCOUNT_SID` | No | Twilio SMS integration |
| `TWILIO_AUTH_TOKEN` | No | Twilio SMS integration |
| `JOTFORM_API_KEY` | No | JotForm webhook intake |
