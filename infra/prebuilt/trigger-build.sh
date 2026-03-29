#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# SafeCare OSRM Build Trigger
#
# Starts the build VM, uploads and runs the build script via SSH.
# This avoids the GCP metadata startup script buffer overflow issue.
#
# Usage:
#   ./trigger-build.sh                    # start build
#   ./trigger-build.sh --status           # check VM status
#   ./trigger-build.sh --logs             # tail build logs
#   ./trigger-build.sh --stop             # stop the VM
# ---------------------------------------------------------------------------

PROJECT="safecare-maps"
ZONE="us-central1-a"
VM="osrm-builder"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-start}" in
  --status)
    STATUS=$(gcloud compute instances describe "$VM" \
      --zone="$ZONE" --project="$PROJECT" \
      --format="value(status)" 2>/dev/null || echo "NOT FOUND")
    echo "VM status: $STATUS"
    if [ "$STATUS" = "RUNNING" ]; then
      echo "Checking build progress..."
      gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" \
        --command="tail -5 /build/build.log 2>/dev/null || echo 'No build log yet'" 2>&1 | \
        grep -v "^Warning\|^Updating\|^Waiting"
    fi
    ;;

  --logs)
    echo "Connecting to build logs..."
    gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" \
      --command="tail -f /build/build.log" 2>&1 | \
      grep -v "^Warning\|^Updating\|^Waiting"
    ;;

  --stop)
    echo "Stopping build VM..."
    gcloud compute instances stop "$VM" --zone="$ZONE" --project="$PROJECT"
    ;;

  start|*)
    echo "================================================"
    echo "  SafeCare OSRM Pre-Build"
    echo "  Project: $PROJECT"
    echo "  VM: $VM ($ZONE)"
    echo "  Estimated time: 4-8 hours"
    echo "  Estimated cost: ~\$1-2 (spot pricing)"
    echo "================================================"
    echo ""

    # Start the VM
    echo "Starting VM..."
    gcloud compute instances start "$VM" --zone="$ZONE" --project="$PROJECT" 2>&1

    echo "Waiting for SSH access..."
    sleep 30

    # Upload the build script
    echo "Uploading build script..."
    gcloud compute scp "$SCRIPT_DIR/build-osrm.sh" "$VM:/build/build-osrm.sh" \
      --zone="$ZONE" --project="$PROJECT" 2>&1 | grep -v "^Warning\|^Updating\|^Waiting"

    # Upload metros.json
    gcloud compute scp "$SCRIPT_DIR/metros.json" "$VM:/build/metros.json" \
      --zone="$ZONE" --project="$PROJECT" 2>&1 | grep -v "^Warning\|^Updating\|^Waiting"

    # Run the build in the background via SSH
    echo "Starting build (running in background on VM)..."
    gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" \
      --command="sudo bash -c 'chmod +x /build/build-osrm.sh && nohup /build/build-osrm.sh > /build/build.log 2>&1 &'" 2>&1 | \
      grep -v "^Warning\|^Updating\|^Waiting"

    echo ""
    echo "Build started! Monitor with:"
    echo "  $0 --logs      # tail live logs"
    echo "  $0 --status    # check progress"
    echo "  $0 --stop      # stop VM (if needed)"
    echo ""
    echo "The VM will shut itself down when the build completes."
    ;;
esac
