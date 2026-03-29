#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Trigger a quarterly OSRM pre-build
#
# Usage:
#   ./trigger-build.sh                    # start the build
#   ./trigger-build.sh --status           # check if running
#   ./trigger-build.sh --logs             # tail build logs
# ---------------------------------------------------------------------------

PROJECT="safecare-maps"
ZONE="us-central1-a"
VM="osrm-builder"

case "${1:-start}" in
  --status)
    STATUS=$(gcloud compute instances describe "$VM" \
      --zone="$ZONE" --project="$PROJECT" \
      --format="value(status)" 2>/dev/null)
    echo "VM status: $STATUS"
    if [ "$STATUS" = "RUNNING" ]; then
      echo "Build is in progress. Check logs with: $0 --logs"
    fi
    ;;

  --logs)
    echo "Connecting to build VM logs..."
    gcloud compute ssh "$VM" \
      --zone="$ZONE" --project="$PROJECT" \
      --command="tail -f /var/log/osrm-build.log"
    ;;

  start|*)
    echo "Starting OSRM pre-build VM..."
    echo "  Project: $PROJECT"
    echo "  VM: $VM ($ZONE)"
    echo "  Machine: c2-standard-30 (spot)"
    echo "  Estimated time: 2-3 hours"
    echo "  Estimated cost: ~\$1-2"
    echo ""

    gcloud compute instances start "$VM" \
      --zone="$ZONE" --project="$PROJECT"

    echo ""
    echo "Build started. The VM will:"
    echo "  1. Download full US OSM extract (~10 GB)"
    echo "  2. Slice into 50 state extracts"
    echo "  3. Build OSRM routing data for each state (6 in parallel)"
    echo "  4. Upload results to GCS"
    echo "  5. Shut itself down"
    echo ""
    echo "Monitor with: $0 --logs"
    echo "Check status: $0 --status"
    ;;
esac
