#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# MADS Emergency Teardown
# Stops containers, removes volumes, shreds secrets.
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT/docker"

info()  { echo -e "${YELLOW}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

echo ""
echo -e "${RED}${BOLD}========================================${NC}"
echo -e "${RED}${BOLD}  MADS — EMERGENCY TEARDOWN${NC}"
echo -e "${RED}${BOLD}========================================${NC}"
echo ""
echo -e "${RED}This will permanently destroy:${NC}"
echo -e "  - All running MADS containers"
echo -e "  - All database data (Postgres volume)"
echo -e "  - All cache data (Redis volume)"
echo -e "  - .env and secrets files"
echo -e "  - Docker images for MADS services"
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

# ---- Stop containers ------------------------------------------------------
info "Stopping all MADS containers..."
cd "$DOCKER_DIR"

if docker compose version &>/dev/null; then
  docker compose -f docker-compose.yml down --remove-orphans 2>/dev/null || true
else
  docker-compose -f docker-compose.yml down --remove-orphans 2>/dev/null || true
fi
ok "Containers stopped."

# ---- Remove volumes -------------------------------------------------------
info "Removing Docker volumes..."
for vol in docker_pgdata docker_redisdata; do
  if docker volume inspect "$vol" &>/dev/null; then
    docker volume rm "$vol" && ok "Removed volume: $vol"
  fi
done

# Also try with project-prefixed names
for vol in safecare_pgdata safecare_redisdata; do
  if docker volume inspect "$vol" &>/dev/null; then
    docker volume rm "$vol" && ok "Removed volume: $vol"
  fi
done
ok "Volumes removed."

# ---- Shred secrets --------------------------------------------------------
info "Shredding secret files..."

shred_file() {
  local f="$1"
  if [[ -f "$f" ]]; then
    if command -v shred &>/dev/null; then
      shred -vfz -n 3 "$f" 2>/dev/null && rm -f "$f"
    else
      # macOS fallback: overwrite then remove
      dd if=/dev/urandom of="$f" bs=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 4096) count=1 2>/dev/null || true
      rm -f "$f"
    fi
    ok "Shredded: $f"
  fi
}

shred_file "$PROJECT_ROOT/.env"
shred_file "$PROJECT_ROOT/secrets/secrets.enc.yaml"
shred_file "$PROJECT_ROOT/secrets/secrets.yaml"
shred_file "$PROJECT_ROOT/secrets/age-key.txt"
ok "Secret files destroyed."

# ---- Remove Docker images -------------------------------------------------
info "Removing MADS Docker images..."
for img in safecare-backend safecare-dashboard docker-backend docker-dashboard; do
  if docker image inspect "$img" &>/dev/null; then
    docker image rm "$img" 2>/dev/null && ok "Removed image: $img"
  fi
done
ok "Images removed."

echo ""
echo -e "${GREEN}${BOLD}========================================${NC}"
echo -e "${GREEN}${BOLD}  Teardown complete.${NC}"
echo -e "${GREEN}${BOLD}========================================${NC}"
echo ""
echo -e "All MADS data has been destroyed."
echo -e "To set up again, run: ${BOLD}bash scripts/setup.sh${NC}"
echo ""
