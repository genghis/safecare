#!/usr/bin/env bash
# Bring up (or update) the SafeCare stack on the cloud box.
#
# The Caddy env vars (PRIMARY_HOST, RIDESHARE_HOST, DRIVER_HOST,
# ADMIN_BCRYPT, ACME_EMAIL) live in /etc/safecare/cloud-env, written by
# the GitHub Actions deploy workflow. This script sources that file
# before invoking compose so the values reach Caddy without going through
# the `.env` file (which would mangle the bcrypt's `$` characters).
#
# Usage:
#   ./deploy.sh                    # uses instance "dev"
#   ./deploy.sh --instance foo
#   CLOUD_ENV_FILE=/path/to/env ./deploy.sh   # override env file location

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
parse_args "$@"

CLOUD_ENV_FILE="${CLOUD_ENV_FILE:-/etc/safecare/cloud-env}"

if [[ ! -f "$CLOUD_ENV_FILE" ]]; then
  err "Cloud env file missing: $CLOUD_ENV_FILE"
  err "The deploy workflow writes this on every run. Have you run it at least once?"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$CLOUD_ENV_FILE"
set +a

info "Deploying instance '${INSTANCE}'"
info "  PRIMARY_HOST   = ${PRIMARY_HOST}"
info "  RIDESHARE_HOST = ${RIDESHARE_HOST}"
info "  DRIVER_HOST    = ${DRIVER_HOST}"

# Build images locally on the box. For Phase 3 we don't push images to a
# registry — branch deploys just rebuild from source. If build times get
# annoying, switch to GHCR + `compose pull` here instead of `--build`.
info "docker compose up -d --build"
compose up -d --build

apply_pending_migrations

ok "Deploy complete."
ok "Dashboard:  https://${PRIMARY_HOST}"
ok "Rideshare:  https://${RIDESHARE_HOST}"
ok "Driver PWA: https://${DRIVER_HOST}"
