#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# SafeCare Fresh Install Integration Test Runner
#
# Simulates the complete out-of-box experience:
# 1. Tears down any existing instance
# 2. Starts a completely fresh Docker Compose (clean volumes)
# 3. Waits for services to be healthy
# 4. Runs Playwright tests against the fresh instance
# 5. Runs the E2E smoke tests
# 6. Runs the security verification
# 7. Tears down
#
# Usage:
#   ./tests/integration/run.sh              # full test
#   ./tests/integration/run.sh --keep       # keep instance running after tests
#   ./tests/integration/run.sh --skip-reset # test against existing instance
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKER_DIR="$PROJECT_DIR/docker"
KEEP=false
SKIP_RESET=false
SAFECARE_TEST_DEK="${SAFECARE_TEST_DEK:-1111111111111111111111111111111111111111111111111111111111111111}"
SAFECARE_SMOKE_ARTIFACT="${SAFECARE_SMOKE_ARTIFACT:-$SCRIPT_DIR/.artifacts/core-smoke.json}"
export SAFECARE_TEST_DEK
export SAFECARE_SMOKE_ARTIFACT

for arg in "$@"; do
  case $arg in
    --keep) KEEP=true ;;
    --skip-reset) SKIP_RESET=true ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}"
echo "=========================================="
echo "  SafeCare Fresh Install Test"
echo "=========================================="
echo -e "${NC}"

# ---------------------------------------------------------------------------
# Step 1: Clean slate
# ---------------------------------------------------------------------------

if [ "$SKIP_RESET" = "false" ]; then
  echo -e "${YELLOW}[1/6] Resetting to clean slate...${NC}"
  cd "$DOCKER_DIR"

  # Stop everything
  docker compose down 2>/dev/null || true

  # Remove volumes (THIS DELETES ALL DATA)
  for vol in docker_pgdata docker_redisdata docker_nominatimdata docker_osrmdata docker_signaldata; do
    docker volume rm "$vol" 2>/dev/null || true
  done

  # Remove PBF files
  rm -f "$DOCKER_DIR/nominatim-data/data.osm.pbf" \
        "$DOCKER_DIR/nominatim-data/data.raw.osm.pbf" \
        "$DOCKER_DIR/nominatim-data/import-progress.txt" 2>/dev/null

  echo "  Done. Clean slate."
  echo ""

  # ---------------------------------------------------------------------------
  # Step 2: Start fresh instance
  # ---------------------------------------------------------------------------

  echo -e "${YELLOW}[2/6] Starting fresh Docker instance...${NC}"
  export ALLOW_TEST_OTP_ECHO=true
  export SAFECARE_TEST_DEK
  export SAFECARE_SMOKE_ARTIFACT
  docker compose up -d

  # Wait for health
  echo "  Waiting for services..."
  ATTEMPTS=0
  while [ $ATTEMPTS -lt 30 ]; do
    HEALTH=$(curl -sf http://localhost:3001/api/health 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q "ok"; then
      break
    fi
    sleep 2
    ATTEMPTS=$((ATTEMPTS + 1))
  done

  if [ $ATTEMPTS -ge 30 ]; then
    echo -e "${RED}  Backend failed to start within 60 seconds${NC}"
    exit 1
  fi

  echo -e "${GREEN}  All services running.${NC}"
  echo ""
else
  echo -e "${YELLOW}[1-2/6] Skipping reset (--skip-reset)${NC}"
  echo ""
fi

# ---------------------------------------------------------------------------
# Step 3: Playwright browser tests
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[3/6] Running Playwright browser tests...${NC}"
cd "$SCRIPT_DIR"
npx playwright test fresh-install.spec.ts --config=playwright.config.ts
echo ""

# ---------------------------------------------------------------------------
# Step 4: E2E smoke tests
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[4/6] Running E2E smoke tests...${NC}"
"$PROJECT_DIR/tests/e2e-smoke.sh"
echo ""

# ---------------------------------------------------------------------------
# Step 5: Security verification
# ---------------------------------------------------------------------------

echo -e "${YELLOW}[5/6] Running security verification...${NC}"
"$PROJECT_DIR/tests/security-verify.sh"
echo ""

# ---------------------------------------------------------------------------
# Step 6: Cleanup (unless --keep)
# ---------------------------------------------------------------------------

if [ "$KEEP" = "false" ] && [ "$SKIP_RESET" = "false" ]; then
  echo -e "${YELLOW}[6/6] Cleaning up...${NC}"
  cd "$DOCKER_DIR"
  docker compose down 2>/dev/null || true
  echo "  Instance stopped."
else
  echo -e "${YELLOW}[6/6] Keeping instance running (--keep or --skip-reset)${NC}"
  echo "  Dashboard: http://localhost:3000"
  echo "  PWA:       http://localhost:5173"
  echo "  API:       http://localhost:3001"
fi

echo ""
echo -e "${BOLD}=========================================="
echo -e "  Fresh Install Test Complete"
echo -e "==========================================${NC}"
