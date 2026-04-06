# Getting Started with SafeCare

SafeCare is a secure mutual aid food delivery system. This guide walks you through setting it up from scratch -- no technical experience required beyond basic computer use.

## What You Need

### Shopping list for a Raspberry Pi setup

| Item | Cost | Where to buy |
|------|------|-------------|
| Raspberry Pi 5 (8GB) | ~$80 | [raspberrypi.com](https://www.raspberrypi.com/products/raspberry-pi-5/), Amazon, Micro Center |
| microSD card (32GB or larger) | ~$10 | Amazon, any electronics store |
| USB-C power supply (27W for Pi 5, 15W for Pi 4) | ~$12 | Buy the official one to avoid power issues |
| Ethernet cable (optional but recommended) | ~$5 | Faster and more reliable than WiFi for the server |

A Raspberry Pi 4 (4GB) also works for metro-area deployments. The 8GB Pi 5 is recommended for larger regions.

**You also need:**
- A WiFi network with internet access
- A phone or laptop with a web browser
- Optionally: a Twilio account (~$6/month) for SMS notifications, or a phone number for free Signal notifications

---

## Setting Up Your SafeCare Server

### Step 1: Write the SafeCare image to your SD card

"Flashing" just means copying SafeCare onto the SD card so the Pi can boot from it.

1. On your regular computer (not the Pi), download and install **Raspberry Pi Imager** from [raspberrypi.com/software](https://www.raspberrypi.com/software/). It's free and works on Windows, Mac, and Linux.

2. Download the **SafeCare SD card image** from [safecare.app/download](https://safecare.app/download). It's a `.img.xz` file, about 440 MB.

3. Insert your microSD card into your computer (you may need an adapter).

4. Open Raspberry Pi Imager:
   - Click **Choose OS** -> scroll down to **Use custom** -> select the SafeCare `.img.xz` file you downloaded
   - Click **Choose Storage** -> select your microSD card (be careful to pick the right drive!)
   - Click **Write** and wait for it to finish (about 5-10 minutes)

5. When it says "Write successful", remove the SD card from your computer.

### Step 2: Start the Pi

1. Insert the SD card into the Raspberry Pi (the slot is on the bottom of the board)
2. If you have an ethernet cable, plug it into the Pi and your router now (this makes map downloads faster later, but it's optional)
3. Plug in the power supply

The Pi will boot up. You don't need a monitor or keyboard -- everything is done from your phone.

### Step 3: Connect to the setup WiFi

1. On your **phone**, go to your WiFi settings
2. Look for a network called **SafeCare-Setup** -- it will appear within 1-2 minutes of plugging in the Pi
3. Connect to it (no password needed)
4. A setup page should open automatically in your browser

**If the setup page doesn't open automatically:**
- On iPhone: it usually opens as a popup -- look for a notification
- On Android: you may see a "Sign in to network" notification -- tap it
- If nothing happens: open your browser and go to **http://10.42.0.1**

### Step 4: Connect the Pi to your WiFi

The setup page shows "Welcome to SafeCare" with a **Get Started** button.

1. Tap **Get Started**
2. You'll see a list of WiFi networks that the Pi can detect
3. Tap your home/office WiFi network
4. Enter your WiFi password and tap **Connect**
5. Wait about 15-30 seconds -- your phone may briefly disconnect while the Pi switches networks. That's normal.
6. Once connected, the page advances automatically

**If it fails:** The Pi restarts the setup WiFi. Reconnect to **SafeCare-Setup** and try again. Double-check your WiFi password.

### Step 5: Set a device password

1. Choose a password for the Pi itself (at least 8 characters)
2. You'll only need this if you ever SSH into the server for maintenance -- most people never will
3. Tap **Set Password** (or **Skip for now** if you want to do this later)

### Step 6: Save your encryption key (CRITICAL)

This is the most important step. SafeCare generates an encryption key that protects all recipient data. **This key is NOT stored on the Pi** -- if someone takes the Pi, they cannot read your data without it.

1. The screen shows a QR code -- this IS your encryption key
2. **Take a photo of the QR code with your phone's camera** (not a screenshot of this page -- use the actual camera app)
3. **Print the QR code** if you can, and store the printout in a safe or locked drawer
4. Check the "I have saved the QR code" box
5. Tap **Continue**

**You will need this QR code every time the Pi restarts.** Without it, SafeCare cannot access recipient data. This is a security feature -- treat the QR code like you would treat a key to a filing cabinet full of addresses.

### Step 7: Wait for services to start

The setup page shows a list of services starting up (database, search engine, etc.). This takes about 1-3 minutes.

When you see green checkmarks next to "Backend API" and "Admin Dashboard", tap **Continue**.

### Step 8: Open the SafeCare dashboard

1. On your phone or any computer connected to the same WiFi, open a browser
2. Go to **http://safecare.local:3000**

**If safecare.local doesn't work:**
- The setup page shows a fallback IP address (like http://192.168.1.42:3000) -- try that instead
- On some Android devices, `.local` addresses don't work. The IP address always works.

### Step 9: Unlock and finish setup

1. The dashboard shows a lock screen -- **scan your encryption key QR code** (the photo you took in Step 6)
2. If you can't scan, tap "Enter key manually" and type the 64-character code from the QR
3. After unlocking, the setup wizard guides you through:
   - **Create your admin account** (email + password)
   - **Define your operating region** (search for your city, pan/zoom the map)
   - **Download map data** (5-30 minutes depending on region size and internet speed)
   - **Configure notifications** (Twilio for SMS, or Signal for free E2E encrypted messages)
   - **Security briefing** (explains what SafeCare does to protect data)

After the wizard completes, you're ready to add recipients and drivers.

---

## After Setup: Daily Use

Every time the Pi restarts (power outage, intentional reboot, etc.):

1. Wait 1-2 minutes for services to start
2. Open **http://safecare.local:3000**
3. Scan your encryption key QR code to unlock
4. Use SafeCare normally

The QR unlock takes 5 seconds and is what keeps the data safe if the Pi is seized.

---

## Troubleshooting

### "SafeCare-Setup WiFi doesn't appear"
- Wait 2 minutes after plugging in the Pi
- Make sure the Pi has power (look for a green or red light on the board)
- If using a Pi 4, make sure the SD card is fully inserted

### "I can't reach safecare.local"
- Try the IP address shown on the setup completion page
- Make sure your phone/computer is on the same WiFi as the Pi
- On Android, try `http://safecare:3000` or the IP address directly

### "I lost my encryption key QR code"
- If SafeCare is currently unlocked, you can still use it normally
- **There is no way to recover the key** -- this is intentional for security
- If the Pi is destroyed and you don't have the key, the encrypted data is permanently unreadable
- Going forward: print the QR code and store it in a safe

### "My WiFi changed and I can't access SafeCare"
- Wait 60 seconds after the Pi boots
- A new WiFi network called **SafeCare-Recovery** will appear
- Connect to it and select your new WiFi network
- SafeCare reconnects automatically

### "Map data is still downloading"
- Large regions (whole states) can take 30-60 minutes on a Pi
- You can close the browser and come back later -- the download continues
- Check progress at **http://safecare.local:3000/settings**

---

## For Developers: Option B (PC / Mac / Linux)

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

When you first open SafeCare, a setup wizard guides you through each step. Here's the full flow from a fresh install to a ready dashboard — account creation, region selection, map download, WhatsApp pairing, security briefing, and the finished dashboard:

![Setup wizard walkthrough](docs/screenshots/setup-wizard.webp)

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

### WhatsApp (Free -- uses your own WhatsApp account)

WhatsApp messaging uses [Baileys](https://github.com/WhiskeySockets/Baileys), which connects SafeCare as a linked device on a regular WhatsApp account — just like linking WhatsApp Web on a computer. No Twilio, no Meta business verification, no monthly cost.

**Setup:**

1. Get a **dedicated prepaid phone number** for your group's WhatsApp (~$3/month). Don't use a personal number.
2. Install WhatsApp on a phone with that number and complete registration
3. In the SafeCare dashboard, go to **Settings > WhatsApp**
4. Click **Connect WhatsApp** — a QR code appears
5. On the WhatsApp phone, go to **Settings > Linked Devices > Link a Device** and scan the QR code
6. That's it — SafeCare is now linked. The pairing persists across restarts.

**Important notes:**

- Keep the WhatsApp phone charged and connected to the internet (it needs to stay active for the link to work)
- This uses an unofficial API — WhatsApp accounts can be banned for automation, though low-volume person-to-person messages rarely trigger detection
- Use a **dedicated number**, not a personal one, so a ban doesn't affect anyone's personal WhatsApp
- Always configure a **fallback channel** (Signal or SMS) — if the WhatsApp number gets banned, SafeCare automatically falls back
- No message logs are stored on third-party servers (unlike Twilio), which is better for privacy

**If the account gets banned:** Get a new prepaid number, register WhatsApp on it, and re-scan the QR code from the dashboard. The system reconnects in under a minute.

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
