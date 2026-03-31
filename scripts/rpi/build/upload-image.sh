#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Upload SafeCare RPi image to GCS and update safecare.app download link
#
# Usage:
#   ./scripts/rpi/build/upload-image.sh path/to/safecare-YYYYMMDD.img.xz
#
# Prerequisites:
#   - gcloud authenticated with safecare-maps project
#   - firebase CLI authenticated
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[SafeCare]${NC} $*"; }

IMG_PATH="${1:?Usage: upload-image.sh <path-to-image.img.xz>}"
IMG_NAME=$(basename "$IMG_PATH")
BUCKET="gs://safecare-maps-osrm"
GCS_PATH="$BUCKET/images/$IMG_NAME"
PUBLIC_URL="https://storage.googleapis.com/safecare-maps-osrm/images/$IMG_NAME"

if [ ! -f "$IMG_PATH" ]; then
  echo "File not found: $IMG_PATH" >&2
  exit 1
fi

SIZE=$(du -h "$IMG_PATH" | cut -f1)
log "Uploading $IMG_NAME ($SIZE) to GCS..."

gcloud storage cp "$IMG_PATH" "$GCS_PATH"

# Make publicly readable
gcloud storage objects update "$GCS_PATH" --add-acl-grant=entity=allUsers,role=READER 2>/dev/null || \
  gsutil acl ch -u AllUsers:R "$GCS_PATH" 2>/dev/null || true

log "Uploaded to: $PUBLIC_URL"

# ---------------------------------------------------------------------------
# Update Firebase Hosting redirect
# ---------------------------------------------------------------------------

FIREBASE_JSON="$REPO_ROOT/infra/prebuilt/hosting/firebase.json"

# Check if download redirect already exists
if ! grep -q '"/download"' "$FIREBASE_JSON" 2>/dev/null; then
  log "Adding /download redirect to firebase.json..."

  # Use python to add the redirect properly
  python3 -c "
import json
with open('$FIREBASE_JSON') as f:
    config = json.load(f)

# Add or update the download redirect
redirects = config['hosting']['redirects']
# Remove any existing /download redirect
redirects = [r for r in redirects if r.get('source') != '/download']
redirects.append({
    'source': '/download',
    'destination': '$PUBLIC_URL',
    'type': 302
})
config['hosting']['redirects'] = redirects

with open('$FIREBASE_JSON', 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
"
else
  log "Updating /download redirect in firebase.json..."
  python3 -c "
import json
with open('$FIREBASE_JSON') as f:
    config = json.load(f)

for r in config['hosting']['redirects']:
    if r.get('source') == '/download':
        r['destination'] = '$PUBLIC_URL'
        break

with open('$FIREBASE_JSON', 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
"
fi

log ""
log "============================================"
log "  Upload complete!"
log "  Direct: $PUBLIC_URL"
log "  Via safecare.app: https://safecare.app/download"
log "============================================"
log ""
log "To deploy the redirect:"
log "  cd $REPO_ROOT/infra/prebuilt/hosting && firebase deploy --only hosting"
