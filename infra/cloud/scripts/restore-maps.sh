#!/usr/bin/env bash
# Restore a map snapshot baked with snapshot-maps.sh.
#
# Typical caller: reset-hard.sh. Also fine to run by hand.
#
# Usage:
#   ./restore-maps.sh /opt/safecare-snapshots/maps-dev.tar.zst
#   ./restore-maps.sh --instance foo /path/to/snap.tar.zst

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

EXTRA=()
parse_args "$@"
for arg in "${REMAINING_ARGS[@]:-}"; do
  [[ -n "$arg" ]] && EXTRA+=("$arg")
done

if [[ ${#EXTRA[@]} -ne 1 ]]; then
  err "Expected exactly one positional arg: the snapshot file to restore."
  err "Usage: $0 [--instance NAME] /path/to/maps.tar.zst"
  exit 1
fi

SNAP="${EXTRA[0]}"
if [[ ! -f "$SNAP" ]]; then
  err "Snapshot not found: $SNAP"
  exit 1
fi

PBF_DIR="$REPO_ROOT/docker/nominatim-data"
mkdir -p "$PBF_DIR"

info "Restoring $SNAP into instance '${INSTANCE}'"

# Make sure target volumes exist (create empty if they don't). Compose creates
# these on `up`, but we restore *before* up so we have to do it ourselves.
for v in nominatimdata osrmdata; do
  docker volume create "$(volume_name "$v")" >/dev/null
done

# Untar into the volumes through a throwaway container.
docker run --rm \
  -v "$(volume_name nominatimdata):/snap/nominatim" \
  -v "$(volume_name osrmdata):/snap/osrm" \
  -v "$PBF_DIR:/snap/pbf" \
  -v "$SNAP:/in/snap.tar.zst:ro" \
  alpine:3 sh -c '
    apk add --no-cache zstd tar >/dev/null
    # Clear before extract so we get pure snapshot state, not a merge.
    rm -rf /snap/nominatim/* /snap/osrm/* /snap/pbf/*
    zstd -d -c /in/snap.tar.zst | tar -C /snap -xf -
  '

ok "Restore complete."
