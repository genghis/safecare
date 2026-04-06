# Product Specification: Secure Mutual Aid Delivery System (MADS)

## 1. Executive Summary

A secure, low-persistence logistics platform designed to manage volunteer food deliveries to at-risk families. The system prioritizes the physical safety and data privacy of recipients through offline-first driver routing, strict data compartmentalization, field-level database encryption, and secure, blind communications utilizing a mix of SMS, WhatsApp, and Signal.

## 2. Core Security & Privacy Principles

- **Low Data Persistence & Zero-Trust APIs:** Delivery data must be treated as ephemeral. Identifiable route data is purged upon delivery acknowledgment. WhatsApp uses Baileys (direct connection, no third-party logs). SMS via Twilio must be continuously scrubbed via automated log-deletion scripts to prevent metadata honeypots.
- **Zero-Exposure Routing:** Drivers operate primarily in Airplane Mode near recipient homes to prevent location tracking or device compromise from exposing addresses.
- **Blind Communication:** Drivers and recipients never see each other's real phone numbers. All communication is proxied through a rotating central server or handled via decentralized, disposable hardware.
- **Data Encryption:** Field-level encryption for all Personally Identifiable Information (PII) in the database (names, addresses, phone numbers).

## 3. System Architecture High-Level

The system consists of three main components:

1. **Backend Server (Dockerized):** Handles routing logic, blind communication proxying (SMS/WhatsApp/Signal), JotForm ingestion, and database management.
2. **Admin Web Dashboard:** Used by dispatchers to vet volunteers, manage exceptions (driver dropouts), and generate routes.
3. **Driver Mobile App (iOS/Android):** An offline-first mobile application that downloads encrypted route packets and queues delivery status updates.

***

## 4. Feature Specifications: Admin Server & Web Dashboard

### 4.1. Order Intake & Multi-Channel Verification

- **JotForm Integration:** Webhook integration to ingest weekly order submissions.
- **Authentication:** The system accepts orders only if the phone number matches a verified number in the encrypted database.
- **WhatsApp Opt-In (Security Friction):** During intake, users are offered WhatsApp (estimated 70% preference) but are presented with an explicit disclaimer: *"We offer WhatsApp for convenience, but it retains metadata on your device. Do you consent to receive updates via WhatsApp?"* (Implementation note: WhatsApp uses Baileys, a direct connection that avoids Meta Business API and its server-side log retention.)

**4.2. Volunteer Management & Vetting**

- **Vetting Protocol:** Strict onboarding workflow. Volunteers are assigned a "Vetted Status" before they can be assigned routes.
- **Driver Profiles:** \* Vehicle Model / Cargo Capacity (crucial for Monday bulk deliveries).
    - Language skills (e.g., Spanish fluency).
    - Time constraints and geographic preferences (e.g., "delivering on the way home").
- **Team Gamification (Lighthearted UI):** Volunteers are grouped into teams with lighthearted names (e.g., *Team Squirrels*, *Team Reindeer*) to boost morale and provide internal, non-identifying shorthand.

### 4.3. Route Optimization & Security

- **Risk Avoidance:** Admins can draw "Exclusion Zones" (e.g., known ICE activity, surveillance areas) that the routing algorithm will strictly bypass.
- **Dynamic Routing:** The system automatically varies routes and delivery days to ensure patterns cannot be easily established by outside observers.
- **Signal Export:** Admins can export a manifest or route summary directly to Signal as a disappearing message for high-security internal coordination.

***

## 5. Feature Specifications: Driver Mobile App & Communications

### 5.1. The "Air-Gap Check-In" Workflow (Airplane Mode Support)

1. **Download:** Driver downloads the encrypted route packet at the depot.
2. **En Route (Online):** Driver taps "Heading to Route." Server sends recipient the initial alert via their preferred channel (WhatsApp, Signal, or SMS).
3. **The Approach (Airplane Mode):** App plays a loud audio alert and displays a red banner when the driver is within 500 m of a delivery address, prompting them to enable Airplane Mode.
4. **The Drop (Offline):** Driver completes the drop-off and taps "Delivered." The app caches this timestamp.
5. **The Sync (Online):** Driver drives away, turns Airplane Mode OFF. The app connects to the server and sends the final "Left food at door" message.

### 5.2. Two-Way Blind Communication Options

The system must support two distinct architectural models for driver-to-family communication, configurable by the Admin based on the current threat level:

- **Model A: The Centralized API Proxy (High Convenience, Moderate Risk)**
    - The driver presses "Call/Text" in the app. The server dials/messages the driver, then the recipient via Twilio (SMS or WhatsApp Business API), bridging them without exposing numbers.
    - *Mitigation:* The server immediately executes an API command to delete the interaction logs from Twilio/Meta the moment the communication concludes.
    - *Mitigation:* The server automatically rotates the organization's sender phone numbers every 14–30 days.
- **Model B: The Decentralized "Burner" Protocol (High Security, Low Convenience)**
    - For extreme risk environments, the centralized proxy is bypassed. Vetted drivers are issued cheap, pre-paid burner phones.
    - Drivers message families directly via WhatsApp from the burner device.
    - Devices are wiped, and SIM cards are physically destroyed every 30 days.

### 5.3. Exception Handling

- **Recipient Acknowledgment:** After the final drop-off message, the system prompts the recipient to reply "YES" / "GOT IT".
- **Orphaned Food Alert:** If no reply is received within 15 minutes, the Admin Dashboard flags the delivery for follow-up to prevent theft.

***

## 6. Technical Requirements

- **Infrastructure:** Docker containers for reproducible, easily-destroyed deployments.
- **Database:** PostgreSQL with field-level encryption (e.g., `pgcrypto`). Keys must be managed externally (e.g., AWS KMS, HashiCorp Vault).
- **Communication APIs:**
    - **WhatsApp:** Baileys (direct WhatsApp Web connection). No third-party API, no Meta business verification, no message templates required. Messages are sent directly from a linked WhatsApp account. No server-side logs to scrub.
    - **SMS:** Twilio for SMS routing. Auto-delete scripts use Twilio's `MessageResource.Delete` endpoint to purge metadata immediately post-delivery.
    - **Signal:** signal-cli REST API (self-hosted, E2E encrypted).
- **Mapping:** Mapbox or OpenStreetMap (OSM) for offline-capable routing, utilizing custom edge-weighting to avoid Exclusion Zones.