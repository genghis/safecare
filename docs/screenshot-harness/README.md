# Screenshot Harness

Generates **real dashboard screenshots** with dummy data for use in documentation. Runs the actual backend + Next.js dashboard, seeds a throwaway local database, and captures the real UI with Puppeteer.

## What this is for

- Documentation screenshots (setup guides, WhatsApp setup, daily operations)
- Hero images for the README
- Anywhere you want to show "here's what the real product looks like"

## What this is NOT

- Not a test framework
- Not a production tool
- Not something that runs in CI against a real database

## Safety

This harness has hard safeguards to prevent accidental damage to real data:

1. **Refuses to run** if `DATABASE_URL` points anywhere except `localhost` / `127.0.0.1`
2. **Destroys the `safecare-postgres` Docker volume** before each run — guarantees a clean slate, but means it can **only** target a local dev DB
3. **Writes a throwaway admin account** (`screenshots@local` / `ScreenshotDummyPass42!`)
4. **Does not touch `packages/backend` or `packages/dashboard`** — all seeding is via direct Postgres connection, all mocking is via Puppeteer request interception
5. **All dummy data patterns** live in `lib/seed.mjs` — grep that file to see everything the harness ever writes to a database

## Prerequisites

- Docker Desktop running
- `pnpm install` completed in the repo root
- Port 3000 (dashboard), 3001 (backend), 5432 (postgres), 6379 (redis) free

## Usage

```bash
# Capture WhatsApp setup screenshots
node docs/screenshot-harness/run.mjs whatsapp

# Output lands in docs/screenshots/
ls docs/screenshots/
```

## Architecture

```
docs/screenshot-harness/
├── run.mjs                  # Main entry — dispatches to specs
├── lib/
│   ├── stack.mjs            # Start/stop Docker + backend + dashboard
│   ├── bootstrap.mjs        # Generate DEK, register admin, unlock, login
│   ├── seed.mjs             # Direct-to-Postgres dummy data insertion
│   └── capture.mjs          # Puppeteer helpers (login, navigate, screenshot)
└── specs/
    └── whatsapp.mjs         # WhatsApp-specific capture spec
```

### Spec format

A spec exports an async `run(ctx)` function where `ctx` contains:

- `ctx.page` — Puppeteer page with dashboard already loaded + logged in
- `ctx.db` — pg Client for direct database inserts
- `ctx.outputDir` — `docs/screenshots/` path
- `ctx.shot(name)` — takes a screenshot and saves to outputDir

## Extending

To add screenshots for a new flow (e.g., dispatch page):

1. Add seeders to `lib/seed.mjs` if you need new data types
2. Create `specs/<flow>.mjs` with a `run(ctx)` function
3. Register it in `run.mjs`
4. Run: `node docs/screenshot-harness/run.mjs <flow>`
