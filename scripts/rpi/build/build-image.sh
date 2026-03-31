#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# SafeCare RPi Image Builder
#
# Builds a flashable SD card image using pi-gen in Docker.
# Works on ARM64 macOS (native) or x86_64 with QEMU.
#
# Usage:
#   ./scripts/rpi/build/build-image.sh
#
# Output:
#   scripts/rpi/build/output/safecare-<date>.img.xz
#
# Prerequisites:
#   - Docker running
#   - ~10 GB free disk space
#   - ~30-60 min build time
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BUILD_DIR="$SCRIPT_DIR"
OUTPUT_DIR="$BUILD_DIR/output"
PIGEN_DIR="$BUILD_DIR/pi-gen"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[SafeCare]${NC} $*"; }
warn() { echo -e "${YELLOW}[SafeCare]${NC} $*"; }
err() { echo -e "${RED}[SafeCare]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Clone pi-gen if not present
# ---------------------------------------------------------------------------

if [ ! -d "$PIGEN_DIR" ]; then
  log "Cloning pi-gen..."
  git clone --depth 1 https://github.com/RPi-Distro/pi-gen.git "$PIGEN_DIR"
else
  log "pi-gen already cloned."
fi

# ---------------------------------------------------------------------------
# Write pi-gen config
# ---------------------------------------------------------------------------

log "Writing pi-gen config..."

cat > "$PIGEN_DIR/config" <<'EOF'
IMG_NAME=safecare
FIRST_USER_NAME=pi
FIRST_USER_PASSWD=safecare
ENABLE_SSH=1
LOCALE_DEFAULT=en_US.UTF-8
KEYBOARD_KEYMAP=us
TIMEZONE_DEFAULT=UTC
TARGET_HOSTNAME=safecare
STAGE_LIST="stage0 stage1 stage2 stage-safecare"
EOF

# ---------------------------------------------------------------------------
# Skip desktop stages
# ---------------------------------------------------------------------------

for stage in stage3 stage4 stage5; do
  mkdir -p "$PIGEN_DIR/$stage"
  touch "$PIGEN_DIR/$stage/SKIP" "$PIGEN_DIR/$stage/SKIP_IMAGES"
done

# ---------------------------------------------------------------------------
# Copy SafeCare stage
# ---------------------------------------------------------------------------

log "Preparing SafeCare stage..."

STAGE_DIR="$PIGEN_DIR/stage-safecare"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# Copy pi-gen stage files
cp "$REPO_ROOT/scripts/rpi/pi-gen/safecare-stage/EXPORT_IMAGE" "$STAGE_DIR/"
cp "$REPO_ROOT/scripts/rpi/pi-gen/safecare-stage/00-run.sh" "$STAGE_DIR/"
cp "$REPO_ROOT/scripts/rpi/pi-gen/safecare-stage/01-packages" "$STAGE_DIR/"
cp "$REPO_ROOT/scripts/rpi/pi-gen/safecare-stage/02-docker-images.sh" "$STAGE_DIR/"

# Copy the SafeCare application into the stage files directory
mkdir -p "$STAGE_DIR/files/opt/safecare"
log "Copying SafeCare application files..."

# Copy essential directories (exclude .git, node_modules, build artifacts)
rsync -a --exclude='.git' \
         --exclude='node_modules' \
         --exclude='dist' \
         --exclude='.next' \
         --exclude='.turbo' \
         --exclude='coverage' \
         --exclude='.env' \
         --exclude='.env.local' \
         --exclude='scripts/rpi/build/pi-gen' \
         --exclude='scripts/rpi/build/output' \
         --exclude='__pycache__' \
         "$REPO_ROOT/" "$STAGE_DIR/files/opt/safecare/"

# ---------------------------------------------------------------------------
# Build the image
# ---------------------------------------------------------------------------

log "Starting pi-gen Docker build..."
log "This will take 30-60 minutes."

cd "$PIGEN_DIR"

# Use Docker build mode
./build-docker.sh

# ---------------------------------------------------------------------------
# Collect output
# ---------------------------------------------------------------------------

mkdir -p "$OUTPUT_DIR"
DATE=$(date +%Y%m%d)

# pi-gen outputs to deploy/
IMG_FILE=$(find "$PIGEN_DIR/deploy" -name "*.img.xz" | head -1)

if [ -n "$IMG_FILE" ]; then
  FINAL_NAME="safecare-${DATE}.img.xz"
  cp "$IMG_FILE" "$OUTPUT_DIR/$FINAL_NAME"
  SIZE=$(du -h "$OUTPUT_DIR/$FINAL_NAME" | cut -f1)
  log ""
  log "============================================"
  log "  Image built successfully!"
  log "  File: $OUTPUT_DIR/$FINAL_NAME"
  log "  Size: $SIZE"
  log "============================================"
  log ""
  log "To upload to GCS:"
  log "  ./scripts/rpi/build/upload-image.sh $OUTPUT_DIR/$FINAL_NAME"
else
  err "Build completed but no .img.xz file found in deploy/"
  exit 1
fi
