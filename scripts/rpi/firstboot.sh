#!/bin/bash
# SafeCare First Boot Orchestrator
# Starts the WiFi AP and provisioner captive portal.
# Runs once on first boot only (guarded by ConditionPathExists in systemd).

set -euo pipefail

echo "[SafeCare] First boot detected — starting provisioner..."

# Start the WiFi access point
systemctl start safecare-ap.service

# Start the Flask captive portal
systemctl start safecare-provisioner.service

echo "[SafeCare] Provisioner running. Connect to 'SafeCare-Setup' WiFi to begin setup."
