#!/bin/bash
# SafeCare WiFi Recovery
#
# Runs on every boot AFTER initial provisioning. Waits for WiFi connectivity.
# If no network after 60 seconds, starts a recovery AP so the user can
# reconfigure WiFi without needing SSH or a terminal.
#
# The recovery AP auto-stops once WiFi is restored.

set -euo pipefail

SAFECARE_ROOT="${SAFECARE_ROOT:-/opt/safecare}"
WAIT_SECONDS=60
CHECK_INTERVAL=5
RECOVERY_FLAG="/tmp/safecare-recovery-ap"

log() { echo "[SafeCare WiFi] $*"; }

has_internet() {
  curl -s --max-time 3 http://captive.apple.com/hotspot-detect.html 2>/dev/null | grep -q "Success"
}

start_recovery_ap() {
  log "No WiFi after ${WAIT_SECONDS}s — starting recovery AP..."
  touch "$RECOVERY_FLAG"

  # Disconnect from any broken WiFi
  nmcli device disconnect wlan0 2>/dev/null || true
  sleep 1

  # Assign AP address
  ip addr flush dev wlan0 2>/dev/null || true
  ip addr add 10.42.0.1/24 dev wlan0
  ip link set wlan0 up

  # Start hostapd with recovery SSID
  sed 's/SafeCare-Setup/SafeCare-Recovery/' "$SAFECARE_ROOT/scripts/rpi/config/hostapd.conf" \
    > /tmp/hostapd-recovery.conf
  hostapd -B /tmp/hostapd-recovery.conf
  dnsmasq --conf-file="$SAFECARE_ROOT/scripts/rpi/config/dnsmasq.conf"

  # Start the recovery web server (WiFi-only mode)
  SAFECARE_ROOT="$SAFECARE_ROOT" SAFECARE_RECOVERY=1 \
    python3 "$SAFECARE_ROOT/scripts/rpi/provisioner.py" &
  RECOVERY_PID=$!

  log "Recovery AP active on 'SafeCare-Recovery'. Connect to reconfigure WiFi."

  # Monitor: once WiFi comes back, kill the recovery AP
  while true; do
    sleep 10
    if has_internet; then
      log "WiFi restored — shutting down recovery AP."
      kill $RECOVERY_PID 2>/dev/null || true
      killall dnsmasq 2>/dev/null || true
      killall hostapd 2>/dev/null || true
      ip addr flush dev wlan0 2>/dev/null || true
      rm -f "$RECOVERY_FLAG"
      # Reconnect to saved WiFi
      nmcli device wifi rescan 2>/dev/null || true
      nmcli connection up "$(nmcli -t -f NAME connection show --active | head -1)" 2>/dev/null || true
      # Restart Docker services if they weren't running
      systemctl restart safecare-docker.service 2>/dev/null || true
      exit 0
    fi
  done
}

# ---- Main ----

log "Checking WiFi connectivity..."

elapsed=0
while [ $elapsed -lt $WAIT_SECONDS ]; do
  if has_internet; then
    log "WiFi connected."
    exit 0
  fi
  sleep $CHECK_INTERVAL
  elapsed=$((elapsed + CHECK_INTERVAL))
  log "Waiting for WiFi... (${elapsed}/${WAIT_SECONDS}s)"
done

start_recovery_ap
