# Rideshare — Admin Guide

A practical guide for mutual aid coordinators using the rideshare dashboard to manage rides, transit escorts, and the vetted referral directory.

## What This Is

The rideshare dashboard is a standalone app for **ride coordination** — separate from (but powered by) the SafeCare delivery system. It gives coordinators a focused workspace for:

- **Scheduling rides** — recurring weekly templates and one-off requests
- **Managing a shift board** — drivers browse and claim shifts, coordinators approve
- **Processing intake** — ride requests from WhatsApp, Signal, JotForm, or manual entry land in a single queue
- **Tracking driver-passenger relationships** — preferred pairings, ride history
- **Searching a referral directory** — vetted service providers (vets, attorneys, mechanics, clinics) that replace the "does anyone know a ___?" messages in large group chats

Everything runs on the same encrypted backend as SafeCare. Recipient names, addresses, and phone numbers are encrypted at rest. The same admin accounts, 2FA, and QR unlock flow apply.

## Getting Started

### Option A: Standalone Raspberry Pi

If you're setting up a dedicated rideshare Pi (no food delivery):

1. Download the **rideshare image** and flash it to your SD card
2. Boot the Pi, connect to the **SafeCare-Setup** WiFi, walk through the provisioner
3. Open **http://safecare.local:3002** — that's the rideshare dashboard

### Option B: Alongside SafeCare Delivery

If you already have SafeCare running for food delivery and want to add ride coordination:

```bash
cd docker
docker compose --profile full up -d
```

This starts both dashboards:
- **http://localhost:3000** — SafeCare delivery dashboard (the one you already use)
- **http://localhost:3002** — Rideshare dashboard (new)

Both share the same backend, database, drivers, and recipients. A driver added in one dashboard is visible in both.

### Option C: Developer Setup

```bash
pnpm dev    # starts all packages including rideshare on :3002
```

## Logging In

The rideshare dashboard uses the same admin accounts as SafeCare. If you already have an account on the delivery dashboard, use those same credentials. If this is a fresh install, you'll create your first account through the setup wizard.

Two-factor authentication (TOTP) works the same way — if you've enabled it on your account, you'll be prompted for your 6-digit code after entering your password.

## Daily Workflow

Here's what a typical day looks like for a ride coordinator.

### 1. Check Today's Asks

The home page shows everything that needs attention today:

- **Stat cards** at the top: today's rides, open shifts, pending intake, active schedules, referral directory size
- **Today's shift board** below: each ride and transit escort for today, color-coded by type, with status badges

Blue = ride. Purple = transit escort. Green tags on shifts mean they require a clean vehicle.

### 2. Process the Intake Queue

Go to **Intake Queue** in the sidebar. This is where ride requests land from any channel:

| Source | How it gets here |
|--------|-----------------|
| WhatsApp | Incoming messages auto-forwarded to the intake queue |
| Signal | Coordinator copies the request and pastes it as manual entry |
| JotForm | Form submissions automatically appear |
| Manual | Coordinator types it in directly |

For each request, you can:
- **Process** — link it to an existing passenger or create a new one, then set up a schedule or ad-hoc shift
- **Reject** — with a reason (duplicate, out of area, etc.)

The system tries to extract structured fields from raw text (days, times, neighborhoods, language) to save you retyping.

### 3. Manage Ride Schedules

Go to **Ride Schedules**. These are recurring templates — "Rosa: home to work 1, Mon/Wed/Fri at 9:00 AM."

Each schedule shows:
- **Day-of-week indicators** — filled circles for active days
- **Pickup time and estimated duration**
- **Pause/Resume** toggle — pausing a schedule keeps it saved but stops generating new shifts

To create shifts from a schedule, click **Generate Next Week**. This creates individual shift entries on the shift board for each day in the schedule.

### 4. Review the Shift Board

Go to **Shift Board**. This is the week-ahead view of all rides and escorts:

- Filter by **date range** and **status** (open, claimed, confirmed, etc.)
- Shifts are grouped by date with time-sorted entries
- Each shift shows: time, service type, route label, and any requirements (clean vehicle, passenger count, car seat)

When a driver claims a shift, it moves to **Claimed** status. You'll see **Confirm** and **Reject** buttons:

- **Confirm** — the driver gets the full address and contact details
- **Reject** — the shift goes back to Open for someone else to claim

You can also **Cancel** open shifts or mark completed rides as **No Show**.

### 5. Create Ad-Hoc Shifts

Not everything is scheduled. For same-day or one-off requests, go to the shift board and create a shift directly. You'll specify:

- **Passenger** — pick from existing recipients
- **Pickup and dropoff locations** — from the passenger's saved locations
- **Service type** — Ride or Transit Escort
- **Date and time**
- **Requirements** — clean vehicle needed? How many passengers? Car seat?

## Drivers & Vehicles

Go to **Drivers & Vehicles** for the ride-focused view of your driver pool. This page shows:

### Vehicle Status

Every driver's vehicle is one of three statuses:

| Status | What it means | What they can do |
|--------|--------------|-----------------|
| **Clean** | Not associated with your org's activity | Any ride, including sensitive trips (medical, legal, immigration appointments) |
| **Flagged** | May be recognized | Grocery deliveries and low-profile rides only |
| **Unknown** | New driver, not yet assessed | Treated as Flagged until a coordinator updates it |

You can filter the driver list by vehicle status. When you're looking for someone to cover a sensitive ride, filter to **Clean** only.

The system enforces this automatically: if a shift is marked "requires clean vehicle," drivers with Flagged or Unknown status won't see it on their shift board.

### Capacity

Each driver has two capacity numbers:
- **Passengers** — how many people can ride (seats, excluding the driver)
- **Cargo** — how many delivery boxes/bags they can carry

These are independent. A sedan might be "4 passengers OR 3 boxes" — not both at once.

### Other Fields

- **Insurance** — whether you have a current copy on file
- **Service radius** — Neighborhood (local only), Metro (cross-town), or Regional
- **Languages** — what languages the driver speaks
- **Service opt-ins** — which services they're signed up for (delivery, rides, transit escort)

## Passengers

The **Passengers** page shows recipients who are enrolled in ride services. Each passenger can have:

- **Multiple saved locations** — home, work 1, work 2, school, clinic, etc. Each location has a neighborhood label (shown on the shift board) and an encrypted full address (revealed only after a driver's claim is confirmed).
- **Active schedules** — recurring ride templates
- **Driver relationships** — which drivers have taken them before, ride counts, and preferred-pairing flags

## Referral Directory

Go to **Referral Directory**. This replaces the "does anyone know a ___?" pattern in large Signal/WhatsApp groups.

### How it works

1. **Any admin can add a provider** — fill in category, name, contact info, neighborhoods served, languages, specialties, and whether they offer low-bono/sliding-scale/uninsured services
2. **Adding a provider counts as your vouch** — you're saying "I'm putting my name on this"
3. **Providers need 2 vouches to become Active** — until then they're "Under Review" and don't appear in search results
4. **Other admins can vouch** with a trust level:
   - **Personally Used** — "I've been there myself"
   - **Trusted Referral** — "Someone I trust recommended them"
   - **Community Known** — "They're known in the community but I haven't used them directly"

### Searching

The search bar at the top of the Referral Directory page lets you find providers by:

- **Free text** — searches names, business names, specialties, and notes
- **Category dropdown** — Medical, Legal, Automotive, Immigration, Veterinary, and 12 more
- **Neighborhood** — "Phillips", "Seward", "Bloomington", etc.
- **Low-bono filter** — show only providers offering reduced/free services

Results are sorted by vouch count (most vouched first).

### Categories

| Category | Examples |
|----------|---------|
| Medical | Doctors, clinics, urgent care |
| Dental | Dentists, oral surgery |
| Veterinary | Vets, animal care |
| Legal | Attorneys, paralegals, legal aid |
| Immigration | Immigration attorneys, DACA, asylum |
| Automotive | Mechanics, body shops, towing |
| Housing | Landlords, shelters, housing assistance |
| Mental Health | Therapists, counselors, crisis support |
| Childcare | Daycare, babysitting, after-school |
| Translation | Interpreters, document translation |
| Financial | Tax prep, banking, financial counseling |
| Employment | Job placement, resume help, training |
| Education | Tutoring, GED, ESL classes |
| Food | Food banks, pantries, meal programs |
| Clothing | Clothing closets, donation centers |
| Utilities | Utility assistance, phone plans |
| Other | Anything else |

### Privacy

All provider contact information (name, phone, email, address) is **encrypted at rest** with the same field-level encryption used for recipient data. The search itself is logged for audit purposes (who searched for what, when), but search results are only visible to authenticated admins.

## Deployment Options

The rideshare dashboard can run three ways:

| Mode | Command | What starts |
|------|---------|-------------|
| **Rideshare only** | `docker compose --profile rideshare up -d` | Backend + rideshare dashboard (:3002) + PWA + infrastructure |
| **SafeCare only** | `docker compose --profile safecare up -d` | Backend + delivery dashboard (:3000) + PWA + infrastructure |
| **Both** | `docker compose --profile full up -d` | Everything — both dashboards share one backend |

For Raspberry Pi images, the variant is baked in at build time:

```bash
./scripts/rpi/build/build-image.sh              # delivery-only image
./scripts/rpi/build/build-image.sh rideshare     # rideshare-only image
./scripts/rpi/build/build-image.sh full           # both dashboards
```

## Security

The rideshare dashboard inherits all of SafeCare's security architecture:

- **Field-level encryption** — all PII (names, addresses, phones) encrypted with pgcrypto (AES-256)
- **Encryption key (DEK) never on disk** — loaded from QR code at each boot
- **HMAC indexing** — lookups without decryption via hashed fields
- **JWT + TOTP 2FA** — admin authentication with optional authenticator app
- **Session management** — Redis-backed, revocable, 24-hour expiry
- **Audit logging** — all admin actions recorded
- **Blind communication** — driver-passenger messaging through WhatsApp/Twilio proxy (no direct contact)

## What's Not Built Yet

- **Driver PWA shift board** — drivers currently need a coordinator to assign rides; self-service claim from the phone app is planned
- **Shift claim notifications** — automatic alerts when a driver claims or a coordinator confirms
- **Day-before passenger messages** — "Your ride tomorrow at 9 AM with [driver's vehicle description]"
- **Blind communication for rides** — the WhatsApp relay proxy works for deliveries but hasn't been wired up for the ride shift flow yet

## Related Documentation

- **[RIDE-COORDINATION.md](RIDE-COORDINATION.md)** — Technical design, data model, and coordinator feedback
- **[GETTING-STARTED.md](../GETTING-STARTED.md)** — Full SafeCare setup guide (Raspberry Pi, developer, troubleshooting)
- **[THREAT-MODEL.md](THREAT-MODEL.md)** — Security threat analysis
