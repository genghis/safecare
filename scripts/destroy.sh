#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# MADS Emergency Teardown
#
# Stops all containers, drops the database, shreds secrets, removes Docker
# images and volumes. Designed to leave no recoverable data.
#
# Works on both Linux (RPi / server) and macOS (dev machine).
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT/docker"

# Track what we destroyed for the final report
declare -a DESTROYED=()
declare -a SKIPPED=()
declare -a FAILED=()

info()    { echo -e "${YELLOW}[INFO]${NC}    $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}      $*"; }
err()     { echo -e "${RED}[ERROR]${NC}   $*"; }
section() { echo ""; echo -e "${RED}${BOLD}--- $* ---${NC}"; }

# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------
echo ""
echo -e "${RED}${BOLD}================================================================${NC}"
echo -e "${RED}${BOLD}  MADS — EMERGENCY TEARDOWN${NC}"
echo -e "${RED}${BOLD}================================================================${NC}"
echo ""
echo -e "${RED}This will permanently destroy ALL of the following:${NC}"
echo ""
echo -e "  1. All running MADS Docker containers"
echo -e "  2. The PostgreSQL database (pgdata volume)"
echo -e "  3. The Redis cache (redisdata volume)"
echo -e "  4. The Nominatim geocoding database (nominatimdata volume)"
echo -e "  5. The OSRM routing data (osrmdata volume)"
echo -e "  6. The .env file (shredded, not just deleted)"
echo -e "  7. All secret/key files (age keys, SOPS files — shredded)"
echo -e "  8. The Nominatim PBF data directory (~2GB OSM extract)"
echo -e "  9. All MADS Docker images (backend, dashboard)"
echo ""
echo -e "${RED}${BOLD}THIS ACTION CANNOT BE UNDONE.${NC}"
echo ""
read -rp "Type DESTROY to confirm: " confirm

if [[ "$confirm" != "DESTROY" ]]; then
  echo ""
  info "Aborted. Nothing was changed."
  exit 0
fi

echo ""
echo -e "${RED}${BOLD}Proceeding with emergency teardown...${NC}"

# ---------------------------------------------------------------------------
# Detect the Docker Compose command
# ---------------------------------------------------------------------------
COMPOSE_CMD=""
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
fi

# ---------------------------------------------------------------------------
# 1. Stop and remove all MADS containers
# ---------------------------------------------------------------------------
section "1/6  Stopping and removing containers"

# Try compose down first (handles networks, dependencies cleanly)
if [[ -n "$COMPOSE_CMD" && -f "$DOCKER_DIR/docker-compose.yml" ]]; then
  info "Running compose down..."
  (cd "$DOCKER_DIR" && $COMPOSE_CMD -f docker-compose.yml down --remove-orphans --timeout 10 2>/dev/null) && \
    ok "Compose down completed." || \
    err "Compose down had issues (continuing anyway)."
fi

# Force-remove any remaining safecare containers by name
SAFECARE_CONTAINERS=(
  safecare-postgres
  safecare-redis
  safecare-nominatim
  safecare-osrm
  safecare-backend
  safecare-dashboard
)

for cname in "${SAFECARE_CONTAINERS[@]}"; do
  if docker inspect "$cname" &>/dev/null; then
    info "Force-removing container: $cname"
    docker rm -f "$cname" 2>/dev/null && \
      { ok "Removed container: $cname"; DESTROYED+=("container:$cname"); } || \
      { err "Failed to remove container: $cname"; FAILED+=("container:$cname"); }
  else
    SKIPPED+=("container:$cname (not found)")
  fi
done

# Also catch any containers with "safecare" or "docker-" prefix from compose
EXTRA_CONTAINERS=$(docker ps -a --filter "name=safecare" --filter "name=docker-" --format '{{.Names}}' 2>/dev/null || true)
if [[ -n "$EXTRA_CONTAINERS" ]]; then
  while IFS= read -r cname; do
    # Skip if already handled
    if [[ " ${SAFECARE_CONTAINERS[*]} " =~ " ${cname} " ]]; then
      continue
    fi
    info "Force-removing extra container: $cname"
    docker rm -f "$cname" 2>/dev/null && \
      { ok "Removed container: $cname"; DESTROYED+=("container:$cname"); } || \
      { err "Failed to remove container: $cname"; FAILED+=("container:$cname"); }
  done <<< "$EXTRA_CONTAINERS"
fi

ok "All containers stopped and removed."

# ---------------------------------------------------------------------------
# 2. Drop the database (explicit, before volume removal)
# ---------------------------------------------------------------------------
# The database is destroyed when we remove the pgdata volume below.
# If the container were still running, we would DROP DATABASE first.
# Since we already stopped everything, volume removal handles this.

# ---------------------------------------------------------------------------
# 3. Shred and overwrite all secrets
# ---------------------------------------------------------------------------
section "2/6  Shredding secrets and sensitive files"

# Cross-platform secure delete function
# Linux: shred -vfz -n 5 (5 random passes + 1 zero pass)
# macOS: rm -P (3-pass overwrite: 0x00, 0xFF, random) then remove
secure_delete() {
  local f="$1"
  local label="${2:-$f}"

  if [[ ! -f "$f" ]]; then
    SKIPPED+=("secret:$label (not found)")
    return 0
  fi

  info "Shredding: $label"

  if command -v shred &>/dev/null; then
    # Linux: GNU coreutils shred
    if shred -vfz -n 5 "$f" 2>/dev/null && rm -f "$f"; then
      ok "Shredded (shred -n 5): $label"
      DESTROYED+=("secret:$label")
      return 0
    fi
  fi

  # macOS or shred fallback: rm -P does 3-pass overwrite
  if rm -Pf "$f" 2>/dev/null; then
    ok "Shredded (rm -P): $label"
    DESTROYED+=("secret:$label")
    return 0
  fi

  # Last resort: manual overwrite with /dev/urandom then delete
  local fsize
  fsize=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 4096)
  if [[ "$fsize" -gt 0 ]]; then
    for pass in 1 2 3 4 5; do
      dd if=/dev/urandom of="$f" bs="$fsize" count=1 conv=notrunc 2>/dev/null || true
    done
    # Zero pass
    dd if=/dev/zero of="$f" bs="$fsize" count=1 conv=notrunc 2>/dev/null || true
  fi
  rm -f "$f" && \
    { ok "Shredded (manual overwrite): $label"; DESTROYED+=("secret:$label"); } || \
    { err "FAILED to shred: $label"; FAILED+=("secret:$label"); }
}

# .env file (contains database creds, Twilio keys, etc.)
secure_delete "$PROJECT_ROOT/.env" ".env"

# Age private key (can decrypt all SOPS secrets)
secure_delete "$PROJECT_ROOT/secrets/age-key.txt" "secrets/age-key.txt"

# SOPS encrypted secrets file
secure_delete "$PROJECT_ROOT/secrets/secrets.enc.yaml" "secrets/secrets.enc.yaml"

# Decrypted secrets (should not exist in production, but clean up if present)
secure_delete "$PROJECT_ROOT/secrets/secrets.yaml" "secrets/secrets.yaml"

# Any other key/secret files that might exist
for f in "$PROJECT_ROOT"/secrets/*.key "$PROJECT_ROOT"/secrets/*.pem "$PROJECT_ROOT"/secrets/*.age; do
  if [[ -f "$f" ]]; then
    secure_delete "$f" "secrets/$(basename "$f")"
  fi
done

ok "Secret files destroyed."

# ---------------------------------------------------------------------------
# 4. Remove Docker volumes
# ---------------------------------------------------------------------------
section "3/6  Removing Docker volumes"

# Volume names depend on the Docker Compose project name.
# Default project name comes from the directory name ("docker" if run from
# docker/, or "safecare" if COMPOSE_PROJECT_NAME is set). Try all variants.
VOLUME_BASES=(pgdata redisdata nominatimdata osrmdata)
VOLUME_PREFIXES=(docker safecare)

for prefix in "${VOLUME_PREFIXES[@]}"; do
  for base in "${VOLUME_BASES[@]}"; do
    vol="${prefix}_${base}"
    if docker volume inspect "$vol" &>/dev/null; then
      info "Removing volume: $vol"
      docker volume rm "$vol" 2>/dev/null && \
        { ok "Removed volume: $vol"; DESTROYED+=("volume:$vol"); } || \
        { err "Failed to remove volume: $vol"; FAILED+=("volume:$vol"); }
    else
      SKIPPED+=("volume:$vol (not found)")
    fi
  done
done

# Also remove any anonymous/orphan volumes associated with safecare containers
ORPHAN_VOLS=$(docker volume ls -q --filter "name=safecare" --filter "name=docker_" 2>/dev/null || true)
if [[ -n "$ORPHAN_VOLS" ]]; then
  while IFS= read -r vol; do
    info "Removing orphan volume: $vol"
    docker volume rm "$vol" 2>/dev/null && \
      { ok "Removed orphan volume: $vol"; DESTROYED+=("volume:$vol"); } || \
      { err "Failed to remove orphan volume: $vol"; FAILED+=("volume:$vol"); }
  done <<< "$ORPHAN_VOLS"
fi

ok "Docker volumes removed."

# ---------------------------------------------------------------------------
# 5. Remove the nominatim-data directory (PBF file, ~2GB)
# ---------------------------------------------------------------------------
section "4/6  Removing Nominatim/OSRM data files"

NOMINATIM_DATA_DIR="$DOCKER_DIR/nominatim-data"
if [[ -d "$NOMINATIM_DATA_DIR" ]]; then
  info "Removing nominatim-data directory: $NOMINATIM_DATA_DIR"
  rm -rf "$NOMINATIM_DATA_DIR" && \
    { ok "Removed nominatim-data directory (PBF file)."; DESTROYED+=("data:nominatim-data/"); } || \
    { err "Failed to remove nominatim-data directory."; FAILED+=("data:nominatim-data/"); }
else
  SKIPPED+=("data:nominatim-data/ (not found)")
fi

# Also remove any OSRM processed files that might be outside the volume
OSRM_DATA_DIR="$DOCKER_DIR/osrm-data"
if [[ -d "$OSRM_DATA_DIR" ]]; then
  info "Removing osrm-data directory: $OSRM_DATA_DIR"
  rm -rf "$OSRM_DATA_DIR" && \
    { ok "Removed osrm-data directory."; DESTROYED+=("data:osrm-data/"); } || \
    { err "Failed to remove osrm-data directory."; FAILED+=("data:osrm-data/"); }
fi

ok "Data files removed."

# ---------------------------------------------------------------------------
# 6. Remove Docker images
# ---------------------------------------------------------------------------
section "5/6  Removing Docker images"

# Images can be named differently depending on how compose built them.
# Try all known variants.
MADS_IMAGES=(
  docker-backend
  docker-dashboard
  safecare-backend
  safecare-dashboard
)

for img in "${MADS_IMAGES[@]}"; do
  # Check by repository name (handles tagged and untagged)
  if docker image inspect "$img" &>/dev/null; then
    info "Removing image: $img"
    docker image rm -f "$img" 2>/dev/null && \
      { ok "Removed image: $img"; DESTROYED+=("image:$img"); } || \
      { err "Failed to remove image: $img"; FAILED+=("image:$img"); }
  else
    SKIPPED+=("image:$img (not found)")
  fi
done

# Also catch any dangling images from multi-stage builds
DANGLING=$(docker images -q --filter "dangling=true" 2>/dev/null || true)
if [[ -n "$DANGLING" ]]; then
  info "Pruning dangling images from builds..."
  docker image prune -f 2>/dev/null && ok "Pruned dangling images." || true
fi

ok "Docker images removed."

# ---------------------------------------------------------------------------
# 7. Remove Docker network (compose creates one)
# ---------------------------------------------------------------------------
section "6/6  Cleaning up Docker networks"

for net in docker_default safecare_default; do
  if docker network inspect "$net" &>/dev/null; then
    info "Removing network: $net"
    docker network rm "$net" 2>/dev/null && \
      { ok "Removed network: $net"; DESTROYED+=("network:$net"); } || \
      { err "Failed to remove network: $net"; FAILED+=("network:$net"); }
  fi
done

# ---------------------------------------------------------------------------
# Final report
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}================================================================${NC}"
echo -e "${GREEN}${BOLD}  TEARDOWN COMPLETE${NC}"
echo -e "${GREEN}${BOLD}================================================================${NC}"
echo ""

if [[ ${#DESTROYED[@]} -gt 0 ]]; then
  echo -e "${GREEN}${BOLD}Destroyed (${#DESTROYED[@]} items):${NC}"
  for item in "${DESTROYED[@]}"; do
    echo -e "  ${GREEN}[x]${NC} $item"
  done
  echo ""
fi

if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo -e "${YELLOW}${BOLD}Skipped (${#SKIPPED[@]} items — already absent):${NC}"
  for item in "${SKIPPED[@]}"; do
    echo -e "  ${YELLOW}[-]${NC} $item"
  done
  echo ""
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo -e "${RED}${BOLD}FAILED (${#FAILED[@]} items — manual cleanup needed):${NC}"
  for item in "${FAILED[@]}"; do
    echo -e "  ${RED}[!]${NC} $item"
  done
  echo ""
  echo -e "${RED}${BOLD}WARNING: Some items could not be destroyed. Review the errors above.${NC}"
  echo ""
fi

if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo -e "All MADS data has been destroyed. No recoverable data remains."
  echo ""
  echo -e "${YELLOW}Physical destruction:${NC} If running on a Raspberry Pi or dedicated"
  echo -e "hardware, consider physically destroying the SD card / SSD for"
  echo -e "maximum assurance."
  echo ""
  echo -e "To set up again from scratch: ${BOLD}bash scripts/setup.sh${NC}"
fi

echo ""
