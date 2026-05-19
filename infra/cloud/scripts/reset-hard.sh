#!/usr/bin/env bash
# Hard reset: wipe every stateful volume and start from scratch. If a baked
# map snapshot exists for this instance, restore it before bringing the stack
# up so the wizard's map-provisioning step starts from "ready" instead of
# from "download a state's worth of OSM data."
#
# Usage:
#   ./reset-hard.sh                 # resets instance "dev"
#   ./reset-hard.sh --instance foo
#   ./reset-hard.sh --no-restore    # skip snapshot restore even if present

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

RESTORE=1
parse_args "$@"
for arg in "${REMAINING_ARGS[@]:-}"; do
  case "$arg" in
    --no-restore) RESTORE=0 ;;
    "") ;;
    *) err "Unknown argument: $arg"; exit 2 ;;
  esac
done

SNAPSHOT_FILE="$SNAPSHOT_DIR/maps-${INSTANCE}.tar.zst"

info "Hard reset for instance '${INSTANCE}'"
info "Wiping ALL stateful volumes"

compose down

for v in pgdata redisdata whatsappauth signaldata nominatimdata osrmdata caddydata caddyconfig; do
  name="$(volume_name "$v")"
  if volume_exists "$v"; then
    docker volume rm "$name" >/dev/null
    ok "removed $name"
  fi
done

# Also clear the on-disk PBF the wizard previously downloaded; without this,
# Nominatim/OSRM will pick up stale data on next boot.
if [[ -f "$REPO_ROOT/docker/nominatim-data/data.osm.pbf" ]]; then
  rm -f "$REPO_ROOT/docker/nominatim-data/data.osm.pbf"
  ok "removed stale PBF"
fi

if [[ $RESTORE -eq 1 && -f "$SNAPSHOT_FILE" ]]; then
  info "Restoring map snapshot from $SNAPSHOT_FILE"
  "$SCRIPT_DIR/restore-maps.sh" --instance "$INSTANCE" "$SNAPSHOT_FILE"
elif [[ $RESTORE -eq 1 ]]; then
  warn "No snapshot at $SNAPSHOT_FILE — instance will start with no map data"
  warn "Either bake a snapshot first or expect to run the wizard's map-download step"
fi

info "Bringing the stack back up"
compose up -d

apply_pending_migrations

# Seed Redis with the snapshotted provision status so the wizard skips the
# "Download map data" step on a fresh DB. snapshot-maps.sh writes the meta
# file alongside the tarball; we only re-seed if we actually restored from
# a snapshot (and the meta is present for that snapshot).
META="$SNAPSHOT_DIR/maps-${INSTANCE}.meta.json"
if [[ $RESTORE -eq 1 && -f "$SNAPSHOT_FILE" && -f "$META" ]]; then
  info "Waiting for Redis to accept connections"
  REDIS_READY=0
  for _ in $(seq 1 30); do
    if compose exec -T redis redis-cli PING >/dev/null 2>&1; then
      REDIS_READY=1
      break
    fi
    sleep 1
  done
  if [[ $REDIS_READY -eq 1 ]]; then
    STATUS_JSON="$(cat "$META")"
    compose exec -T redis redis-cli SET map:provision:status "$STATUS_JSON" >/dev/null
    ok "Re-seeded map:provision:status from snapshot metadata"
  else
    warn "Redis didn't respond within 30s; skipping map:provision:status seed."
    warn "The wizard will see maps as 'not provisioned' even though they're restored."
    warn "Either click through the (no-op) download in the wizard, or seed manually:"
    warn "  docker compose ... exec -T redis redis-cli SET map:provision:status \"\$(cat $META)\""
  fi
fi

ok "Hard reset done."
