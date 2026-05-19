#!/usr/bin/env bash
# Soft reset: wipe app state (Postgres + Redis) and the WhatsApp/Signal auth
# blobs, but leave Nominatim/OSRM/tile data intact. The wizard can re-run
# from a clean state in seconds.
#
# Usage:
#   ./reset-soft.sh                 # resets instance "dev"
#   ./reset-soft.sh --instance foo  # resets instance "foo"

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
parse_args "$@"

info "Soft reset for instance '${INSTANCE}'"
info "Wiping: pgdata, redisdata, whatsappauth, signaldata"
info "Keeping: nominatimdata, osrmdata (use reset-hard.sh to wipe maps too)"

# Stop everything for a clean volume drop.
compose down

# Drop the app-state volumes. `volume rm` errors if missing — we tolerate
# that because a fresh instance won't have them yet.
for v in pgdata redisdata whatsappauth signaldata; do
  name="$(volume_name "$v")"
  if volume_exists "$v"; then
    docker volume rm "$name" >/dev/null
    ok "removed $name"
  else
    warn "$name didn't exist; skipping"
  fi
done

info "Bringing the stack back up"
compose up -d

apply_pending_migrations

ok "Soft reset done. The wizard will run from a fresh app state."
