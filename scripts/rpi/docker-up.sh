#!/bin/bash
# Starts Docker Compose with the correct profile for this image variant.
# Called by safecare-docker.service on boot.

SAFECARE_ROOT="${SAFECARE_ROOT:-/opt/safecare}"
VARIANT_FILE="$SAFECARE_ROOT/.variant"

if [ -f "$VARIANT_FILE" ]; then
    VARIANT=$(cat "$VARIANT_FILE")
else
    VARIANT="safecare"
fi

# Validate
case "$VARIANT" in
    safecare|rideshare|full) ;;
    *) VARIANT="safecare" ;;
esac

exec docker compose --profile "$VARIANT" "$@"
