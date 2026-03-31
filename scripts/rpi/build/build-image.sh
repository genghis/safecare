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
  log "Cloning pi-gen (arm64 branch)..."
  git clone --depth 1 --branch arm64 https://github.com/RPi-Distro/pi-gen.git "$PIGEN_DIR"
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
# Skip stage2 (Pi desktop packages) — SafeCare stage installs what we need
STAGE_LIST="stage0 stage1 stage-safecare"
# Build 64-bit ARM image (required for Pi 4/5, and for native build on ARM64 macOS)
ARCH=arm64
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

# Copy the entire SafeCare stage (preserves directory structure)
cp -r "$REPO_ROOT/scripts/rpi/pi-gen/safecare-stage" "$STAGE_DIR"
chmod +x "$STAGE_DIR/prerun.sh" "$STAGE_DIR/01-safecare-config/00-run.sh"

# Copy SafeCare app into the config sub-stage's files directory
# Pi-gen copies files/<path> into the rootfs at /<path>
CONFIG_FILES="$STAGE_DIR/01-safecare-config/files"
mkdir -p "$CONFIG_FILES/opt/safecare"
log "Copying SafeCare application files..."

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
         "$REPO_ROOT/" "$CONFIG_FILES/opt/safecare/"

# ---------------------------------------------------------------------------
# Build the image
# ---------------------------------------------------------------------------

cd "$PIGEN_DIR"

log "Starting pi-gen Docker build (arm64 branch)..."
log "This will take 30-60 minutes."

# Clean any previous failed build and containers
rm -rf work/ deploy/
docker rm -v pigen_work 2>/dev/null || true

# Use Docker build mode
./build-docker.sh

# ---------------------------------------------------------------------------
# Collect output
# ---------------------------------------------------------------------------

mkdir -p "$OUTPUT_DIR"
DATE=$(date +%Y%m%d)

# pi-gen outputs to deploy/ as .zip or .img.xz
IMG_FILE=$(find "$PIGEN_DIR/deploy" -name "*.zip" -o -name "*.img.xz" | head -1)

if [ -n "$IMG_FILE" ]; then
  EXT="${IMG_FILE##*.}"
  FINAL_NAME="safecare-${DATE}.${EXT}"
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
  err "Build completed but no image file found in deploy/"
  ls -la "$PIGEN_DIR/deploy/" 2>/dev/null
  exit 1
fi
