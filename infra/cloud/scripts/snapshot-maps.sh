#!/usr/bin/env bash
# Bake a map snapshot for fast hard-reset. Tars the Nominatim + OSRM volumes
# (plus the downloaded PBF) into a single zstd-compressed file.
#
# Run this AFTER you've walked the wizard through map provisioning at least
# once and confirmed Nominatim + OSRM are returning real responses. The
# resulting snapshot is what reset-hard.sh restores from.
#
# Usage:
#   ./snapshot-maps.sh                 # snapshots instance "dev"
#   ./snapshot-maps.sh --instance foo
#   SNAPSHOT_DIR=/mnt/big ./snapshot-maps.sh  # override snapshot location

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
parse_args "$@"

mkdir -p "$SNAPSHOT_DIR"
OUT="$SNAPSHOT_DIR/maps-${INSTANCE}.tar.zst"
PBF_DIR="$REPO_ROOT/docker/nominatim-data"

# Sanity: refuse to overwrite a recent snapshot silently.
if [[ -f "$OUT" ]]; then
  warn "Existing snapshot at $OUT"
  read -rp "Overwrite? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
fi

# Sanity: the volumes have to exist or this snapshot is empty.
for v in nominatimdata osrmdata; do
  if ! volume_exists "$v"; then
    err "Volume $(volume_name "$v") doesn't exist. Run the wizard first."
    exit 1
  fi
done

info "Stopping nominatim + osrm to get a consistent snapshot"
compose stop nominatim osrm

# Use a throwaway container to tar both volumes at known mount points,
# along with the downloaded PBF (lives on the host fs, not in a volume).
info "Writing $OUT (this can take a minute on first run)"
docker run --rm \
  -v "$(volume_name nominatimdata):/snap/nominatim:ro" \
  -v "$(volume_name osrmdata):/snap/osrm:ro" \
  -v "$PBF_DIR:/snap/pbf:ro" \
  -v "$SNAPSHOT_DIR:/out" \
  alpine:3 sh -c '
    apk add --no-cache zstd tar >/dev/null
    tar -C /snap -cf - nominatim osrm pbf \
      | zstd -T0 -19 -o "/out/maps-'"$INSTANCE"'.tar.zst"
  '

info "Restarting nominatim + osrm"
compose start nominatim osrm

# Capture the current map:provision:status from Redis so a future restore
# can re-seed it. Without this, the wizard would force a no-op re-download
# because it only knows "ready" via this Redis key.
META="$SNAPSHOT_DIR/maps-${INSTANCE}.meta.json"
STATUS_JSON="$(compose exec -T redis redis-cli GET map:provision:status 2>/dev/null || true)"
if [[ -n "$STATUS_JSON" && "$STATUS_JSON" != "(nil)" ]]; then
  printf '%s' "$STATUS_JSON" > "$META"
  ok "Wrote provision metadata: $META"
else
  warn "No map:provision:status in Redis; restore won't auto-mark wizard as ready"
  rm -f "$META"
fi

SIZE="$(du -h "$OUT" | cut -f1)"
ok "Snapshot baked: $OUT ($SIZE)"
