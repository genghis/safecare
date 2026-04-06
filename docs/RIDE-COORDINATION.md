# Ride Coordination — Design Proposal

> **Status: Proposed** — Data model is in place, UI is not yet built. The screenshots below are mockups showing the intended design direction.

SafeCare is expanding from food delivery to include **scheduled ride coordination** for passengers. This was driven by detailed feedback from coordinators in active mutual aid driving groups who are currently managing rides through spreadsheets, Signal polls, and WhatsApp messages.

## Why

Coordinators across multiple driving groups are hitting the same bottlenecks:

- **Intake is manual** — ride requests arrive as plain-text WhatsApp or Signal messages, and a coordinator has to manually transcribe each one into a calendar or spreadsheet
- **Scheduling is duplicated** — coordinators maintain parallel spreadsheets for their own tracking and for driver-facing views, with Signal polls filling gaps
- **Privacy is ad-hoc** — drivers share personal cell numbers with passengers and use whatever translation app they can find
- **Relationships matter** — driving groups strongly prioritize ongoing driver-passenger relationships, but current tools don't track or support this

SafeCare already solves many of these problems for food delivery (encrypted PII, multi-language notifications, offline maps, blind communication proxy). The same infrastructure applies directly to rides.

## What's Different from Deliveries

| | Food Delivery | Ride Coordination |
|---|---|---|
| **Assignment** | Coordinator pushes routes to drivers | Drivers browse and claim shifts |
| **Timing** | Same-day batch dispatch | Scheduled days/weeks ahead |
| **Recurrence** | One-off per session | Recurring weekly schedules |
| **Relationships** | Transactional | Ongoing, preferred pairings |
| **Locations** | Single address per recipient | Multiple named locations (home, work 1, work 2) |
| **Data retention** | Purged within 24 hours | Schedules persist, shift history retained |

Both service types share the same driver pool, notification channels, encryption, and mapping infrastructure.

## Proposed Workflows

### Shift Board (Coordinator + Driver View)

Drivers see a week-ahead board of available rides showing only **neighborhoods and passenger IDs** — no addresses or phone numbers until a coordinator confirms their claim.

![Shift Board](mockups/screenshots/shift-board.png)

Key elements:
- **Progressive disclosure** — neighborhoods and route labels ("work 1 to home") are visible; full addresses and contact info are revealed only after coordinator approval
- **Preferred pairings** — gold stars indicate driver-passenger relationships the coordinator has flagged as preferred, with prior ride counts
- **Language codes** — visible on each shift so drivers know translation needs upfront
- **Send Poll** — for unfilled shifts, coordinators can push a last-minute Signal poll (matching the workflow groups already use)
- **Volunteer escorts** — Saturday distro volunteers who need rides appear with a purple VOLUNTEER tag

### Ride Schedules (Coordinator View)

Recurring ride templates grouped by passenger. Each schedule specifies pickup/dropoff locations, days of week, and time. Shifts are auto-generated each week from active schedules.

![Ride Schedules](mockups/screenshots/ride-schedule.png)

Key elements:
- **Multiple locations per passenger** — P2 has "home", "work 1", and "work 2" as saved locations, each in a different neighborhood
- **Route labels** — "home to work 1" appears on the shift board instead of addresses, matching the pattern coordinators already use ("work one to home" instead of "regina to bloomington")
- **Day-of-week selectors** — visual representation of which days each route runs

### Intake Queue (Coordinator View)

Incoming ride requests from any channel — WhatsApp, Signal, JotForm, web form, or manual entry — land in a unified queue. Auto-parsed fields (days, times, neighborhoods, language) are extracted from raw text to reduce coordinator data entry.

![Intake Queue](mockups/screenshots/intake-queue.png)

Key elements:
- **Multi-channel** — WhatsApp messages, Signal forwards (including via third-party sponsors), JotForm submissions, and volunteer escort requests all appear in one place
- **Auto-parsing** — the system extracts structured fields from unstructured text (days, times, locations, language) so coordinators can review and confirm rather than re-type
- **Volunteer escorts** — requests for rides to distribution events are visually distinguished and tagged separately

### Passenger Detail (Coordinator View)

Per-passenger view showing saved locations, active schedules, ride history, and driver relationship tracking.

![Passenger Detail](mockups/screenshots/passenger-detail.png)

Key elements:
- **Saved locations** — home, work 1, work 2 with neighborhood-level labels and encrypted full addresses
- **Driver relationships** — ride counts and preferred-pairing flags for each driver who has driven this passenger, supporting the relationship-building priority
- **Fill rate** — what percentage of scheduled shifts are actually getting claimed, so coordinators can see where coverage is thin
- **Stats** — total rides, no-shows, cancellations for operational awareness

## Data Model

The ride coordination schema is implemented and ready for backend service development. See:

- [`docker/init-db.sql`](../docker/init-db.sql) — full schema (new installs)
- [`docker/migrations/002-ride-coordination.sql`](../docker/migrations/002-ride-coordination.sql) — migration for existing deployments
- [`packages/shared/src/types.ts`](../packages/shared/src/types.ts) — TypeScript interfaces
- [`packages/backend/src/db/schema.ts`](../packages/backend/src/db/schema.ts) — Drizzle ORM definitions

### New Tables

| Table | Purpose |
|---|---|
| `saved_locations` | Multiple named addresses per passenger, encrypted |
| `ride_schedules` | Recurring ride templates (days, times, pickup/dropoff) |
| `shifts` | Individual ride instances with driver-claim lifecycle |
| `driver_passenger_affinity` | Ride counts and preferred-pairing flags |
| `intake_requests` | Multi-channel request queue with parsed fields |

### Shift Lifecycle

```
open → claimed → confirmed → in_progress → completed
  │       │                                     │
  │       └──→ (coordinator rejects) ──→ open   │
  │                                             │
  └──→ cancelled                        no_show ←┘
```

## What's Not Built Yet

To be clear about current status:

- **Data model** — Done (migration, Drizzle schema, TypeScript types)
- **Backend services** — Not started (CRUD, shift generation, claim/confirm flow, affinity tracking, intake processing)
- **API routes** — Not started
- **Dashboard UI** — Not started (the screenshots above are static HTML mockups)
- **Driver PWA integration** — Not started (shift board in the driver app)
- **Notifications** — Not started (shift claim alerts, day-before passenger messages)
- **Blind communication proxy** — Schema exists, proxy logic not implemented (needed for both deliveries and rides)

## Regenerating Mockup Screenshots

```bash
node docs/mockups/capture-screenshots.mjs
```

Requires `puppeteer-core` (already in devDependencies) and Chrome installed. The interactive mockup is at [`docs/mockups/ride-coordination.html`](mockups/ride-coordination.html).
