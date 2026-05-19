#!/usr/bin/env bash
# Shared helpers for the cloud-dev scripts.
# Source me, don't run me.

set -euo pipefail

# ---- Resolve paths ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLOUD_DIR/../.." && pwd)"

BASE_COMPOSE="$REPO_ROOT/docker/docker-compose.yml"
CLOUD_COMPOSE="$CLOUD_DIR/docker-compose.cloud.yml"

# ---- Snapshot location -----------------------------------------------------
SNAPSHOT_DIR="${SNAPSHOT_DIR:-/opt/safecare-snapshots}"

# ---- CLI parsing -----------------------------------------------------------
# Every script accepts `--instance NAME`; default is "dev". This is the only
# knob between Shape A (one shared loaner) and Shape B (named instances).
INSTANCE="dev"
PROFILE="full"
REMAINING_ARGS=()

# Instance names are interpolated into shell, volume names, and Caddy site
# blocks. Restrict to a conservative subset so a stray quote can't escape.
INSTANCE_RE='^[a-z0-9][a-z0-9-]{0,30}$'

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --instance)
        INSTANCE="${2:?--instance needs a value}"
        shift 2
        ;;
      --profile)
        PROFILE="${2:?--profile needs a value}"
        shift 2
        ;;
      *)
        REMAINING_ARGS+=("$1")
        shift
        ;;
    esac
  done

  if ! [[ "$INSTANCE" =~ $INSTANCE_RE ]]; then
    err "Invalid --instance '$INSTANCE'. Allowed: lowercase letters, digits, dashes (1-31 chars, start with letter/digit)."
    exit 2
  fi
}

# ---- Compose wrapper -------------------------------------------------------
# Runs docker compose with the right project name and overlay files for the
# selected instance. The project directory defaults to the first -f file's
# directory (docker/), which is why the cloud override's Caddyfile mount
# climbs back up with `../../infra/cloud/...` — the base file's `./nominatim-
# data` and the override's paths share that same anchor.
compose() {
  COMPOSE_PROJECT_NAME="safecare-${INSTANCE}" \
    docker compose \
      -f "$BASE_COMPOSE" \
      -f "$CLOUD_COMPOSE" \
      --profile "$PROFILE" \
      "$@"
}

# ---- Volume helpers --------------------------------------------------------
# Docker prefixes volume names with the compose project name. Use these to
# refer to a specific instance's volumes without hardcoding.
volume_name() {
  echo "safecare-${INSTANCE}_${1}"
}

volume_exists() {
  docker volume inspect "$(volume_name "$1")" >/dev/null 2>&1
}

# ---- Logging ---------------------------------------------------------------
info()  { printf '\033[0;34m[INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[0;32m[OK]\033[0m    %s\n' "$*"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }
err()   { printf '\033[0;31m[ERROR]\033[0m %s\n' "$*" >&2; }

# ---- Migration application -------------------------------------------------
# The repo's init-db.sql autoruns on a fresh Postgres data dir but lags
# behind docker/migrations/00X.sql (e.g. 004 adds referral tables). After
# any reset we have to manually apply the numbered files so the schema is
# current. They're all idempotent (CREATE ... IF NOT EXISTS).
apply_pending_migrations() {
  info "Waiting for postgres to be ready"
  for _ in $(seq 1 60); do
    if compose exec -T postgres pg_isready -U safecare -d safecare >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  shopt -s nullglob
  local applied=0
  for f in "$REPO_ROOT"/docker/migrations/*.sql; do
    info "Applying $(basename "$f")"
    compose exec -T postgres psql -U safecare -d safecare -v ON_ERROR_STOP=1 < "$f" >/dev/null
    applied=$((applied + 1))
  done
  shopt -u nullglob

  if [[ $applied -eq 0 ]]; then
    warn "No migration files found under docker/migrations/"
  else
    ok "Applied $applied migration file(s)"
  fi
}
