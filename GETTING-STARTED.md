# Getting Started with SafeCare

SafeCare is a secure mutual aid food delivery system. This guide walks you through setting it up from scratch -- no technical experience required beyond basic computer use.

## What You Need

**One of these to run the server:**
- A Raspberry Pi 4 or 5 (4GB or 8GB) with a USB SSD -- ~$60-100
- Any home PC or laptop with 4GB+ RAM
- A small VPS ($20-40/month) if you prefer not to self-host

A 4GB Raspberry Pi works well for metro-area deployments. The setup wizard shows a RAM estimate as you define your operating region so you can size it appropriately.

**Plus:**
- An internet connection (for initial map data download)
- A web browser (Chrome, Firefox, Safari, or Edge)
- Optionally: a Twilio account (~$6/month) for SMS notifications, or a phone number for free Signal notifications

## Installation

### Option A: Raspberry Pi

*(Coming soon: a pre-built SD card image that boots directly into SafeCare)*

For now, install Docker on your Pi, then:

```bash
git clone https://github.com/safecare-project/safecare.git
cd safecare
bash scripts/setup.sh
cd docker
docker compose up -d
```

### Option B: PC / Mac / Linux

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Open a terminal and run:

```bash
git clone https://github.com/safecare-project/safecare.git
cd safecare
bash scripts/setup.sh
cd docker
docker compose up -d
```

3. Wait about 1 minute for services to start
4. Open your browser to **http://localhost:3000**

## First-Time Setup Wizard

When you first open SafeCare, a setup wizard guides you through three steps:

### Step 1: Create Your Admin Account

- Enter your organization name (e.g., "Minneapolis Mutual Aid")
- Enter an email and password for the admin account
- Click **Create Account & Continue**

This is the only admin account. Additional admins can be added later.

### Step 2: Define Your Operating Region

This is the area where your deliveries happen and your drivers live. It determines which map data gets downloaded.

- **Search for your city** in the search box (e.g., "Minneapolis" or "Kansas City")
- The map will center on that location
- **Pan and zoom** so the visible map area covers your full operating region
  - Include neighborhoods where recipients live
  - Include areas where drivers live (they may come from outside the delivery area)
  - If you're on a state border (like Kansas City), make sure both sides are visible
- Click **Save Region & Continue**

**Tip:** It's better to make the region a bit larger than you think you need. You can always re-provision later if your area expands.

### Step 3: Download Map Data

SafeCare runs its own map and address search engine -- no data is sent to Google or any other company. But it needs to download the map data for your region first.

- Click **Download Map Data**
- The system downloads the state extract that covers your region (typically 100-500 MB), then trims it to just your viewport (typically 10-50 MB for a metro area)
- After trimming, the data is imported into the search and routing engines
- **This takes 5-30 minutes** depending on region size and hardware
- You can close the browser and come back later -- the import continues in the background
- The progress display shows which step it's on and how fast it's going

When the import finishes, you'll see a green checkmark and **"Setup Complete!"**

Click **Go to Dashboard** to start using SafeCare.

## Daily Use

### Adding Recipients

1. Go to **Recipients** in the sidebar
2. Click **Add Recipient**
3. Enter their name and phone number
4. **Find their address**: type in the search box or click on the map to place a pin
   - The address auto-fills from the map location
   - You can edit the address text after placing the pin
5. Choose their preferred notification channel (Signal, SMS, or WhatsApp) and language
6. Click **Add Recipient**

### Adding Drivers

1. Go to **Drivers** in the sidebar
2. Click **Add Driver**
3. Enter their name, phone, vehicle type, and availability
4. Click the driver row to expand details
5. Click **Approve (Vet)** to allow them to receive routes

### Creating Delivery Zones

1. Go to **Zones** in the sidebar
2. Click **Add Zone**
3. Name the zone (e.g., "North Side", "East Bank")
4. Pick a color
5. Click on the map to draw the zone boundary (at least 3 points)
6. Click **Create Zone**

### Running a Delivery Day

1. **Dispatch** → Create a new session with today's date
2. **Distribution** → Select the session, click Auto-Distribute to assign deliveries to drivers
3. **Dispatch** → Wait for drivers to check in, then click **Approve & Release Routes**
4. Drivers download their routes on their phones and start delivering
5. Recipients get notifications when deliveries are on the way and when they arrive
6. The system tracks delivery status in real-time

### How Drivers Use It

Drivers use a phone app (Progressive Web App -- works on any phone's browser):

1. Open the driver app URL in their phone browser
2. Log in with their phone number (they receive a one-time code)
3. Tap **Ready for Routes** to check in
4. When the admin releases routes, they download automatically with offline maps
5. The app shows a map with numbered stops and driving directions
6. Near the delivery area, the app plays a loud audio alert and suggests enabling airplane mode for privacy
7. Tap each delivery to mark it complete
8. At the end, tap **End Shift** -- all route data is deleted from the phone

## Setting Up Notifications

Recipients can be notified via Signal, SMS, or WhatsApp. You can use any combination.

### Signal (Recommended -- free, private)

Signal is the most private option. Messages are end-to-end encrypted and the service runs on your hardware.

1. You need a phone number that can receive an SMS (for one-time verification)
2. Run these commands (replace with your number):
   ```bash
   curl -X POST http://localhost:8089/v1/register/+1234567890
   # You'll receive a verification code via SMS
   curl -X POST http://localhost:8089/v1/register/+1234567890/verify/123456
   ```
3. Add this line to your `.env` file: `SIGNAL_PHONE_NUMBER=+1234567890`
4. Restart: `cd docker && docker compose restart backend`

### SMS (Simple, works everywhere)

1. Create a [Twilio](https://www.twilio.com) account (pay-as-you-go, ~$6/month)
2. Get a phone number from Twilio
3. Add these lines to your `.env` file:
   ```
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_PHONE_NUMBER=+1234567890
   ```
4. Restart: `cd docker && docker compose restart backend`

### WhatsApp

WhatsApp requires Meta business verification (1-2 weeks) through Twilio. Use the same Twilio credentials as SMS, and recipients who prefer WhatsApp will receive messages there instead.

## Localization

All recipient-facing messages (notifications, delivery confirmations) are available in:

- English
- Spanish (Espa\u00f1ol)
- Arabic (\u0627\u0644\u0639\u0631\u0628\u064a\u0629)
- Somali (Soomaali)
- French (Fran\u00e7ais)
- Chinese (\u4e2d\u6587)

When adding a recipient, select their preferred language. Notifications will be sent in that language.

## Changing Your Operating Region

If your service area expands or changes:

1. Go to **Settings** in the sidebar
2. Pan and zoom the map to cover the new area
3. Click **Save Settings**
4. Click **Re-provision** to download new map data
5. Wait for the import to complete (15-60 minutes)

## Data Security

SafeCare is designed to protect recipient privacy:

- **Addresses and phone numbers** are encrypted in the database -- even if someone steals the hard drive, they can't read them without the encryption key (DEK). **Note:** by default the DEK is stored in the `.env` file on the server. For stronger protection, run the optional SOPS + age setup during installation and keep the age private key physically separate from the server.
- **Map data and address search** run on your hardware -- no addresses are sent to Google, Mapbox, or any external service
- **Delivery records are deleted** within 24 hours after delivery
- **Driver phones** purge all route data at end of shift
- **Signal notifications** are end-to-end encrypted -- nobody can read them except the recipient
- **Twilio message logs** are automatically deleted after each delivery

## Emergency Shutdown

If you need to immediately destroy all data:

```bash
cd safecare
scripts/destroy.sh
```

This will:
- Stop all services
- Shred the encryption keys and secrets
- Delete all data (database, maps, Redis)
- Remove Docker images

You'll be asked to type `DESTROY` to confirm. This cannot be undone.

On a Raspberry Pi, you can also physically destroy the SD card or SSD.

## Troubleshooting

### "Address search isn't working"

The geocoding engine may still be importing. Go to **Settings** and check the Map Data status. If it shows "Importing," wait for it to finish.

### "Maps show the wrong area"

Go to **Settings**, adjust your operating region, save, and re-provision.

### "Drivers can't download routes"

Make sure:
1. A dispatch session is created for today
2. Deliveries are assigned to drivers (use Distribution page)
3. The admin has clicked "Approve & Release Routes" in Dispatch
4. The driver has checked in (tapped "Ready for Routes")

### "Notifications aren't being sent"

Check that at least one notification channel is configured:
- Signal: `SIGNAL_PHONE_NUMBER` set in `.env`
- SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` set in `.env`

Restart the backend after changing `.env`: `cd docker && docker compose restart backend`

### "I forgot my admin password"

There's no password reset yet. You'll need to delete the admin from the database:
```bash
docker exec safecare-postgres psql -U safecare -c "DELETE FROM admin_users;"
```
Then open the setup wizard again at http://localhost:3000/setup to create a new account.

## Getting Help

- GitHub Issues: https://github.com/safecare-project/safecare/issues
- See [STATUS.md](STATUS.md) for current implementation status
- See [PLAN.md](PLAN.md) for the full product plan
