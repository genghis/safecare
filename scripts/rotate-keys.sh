#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# MADS DEK Rotation Helper
# Generates a new Data Encryption Key and guides re-encryption.
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  MADS — DEK Rotation${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# ---- Pre-flight checks ---------------------------------------------------
if ! command -v openssl &>/dev/null; then
  err "openssl is required but not found."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  err ".env file not found at $ENV_FILE"
  err "Run scripts/setup.sh first."
  exit 1
fi

# ---- Warnings -------------------------------------------------------------
echo -e "${RED}${BOLD}WARNING: DEK rotation requires re-encrypting all encrypted${NC}"
echo -e "${RED}${BOLD}database fields. This is a multi-step process.${NC}"
echo ""
echo -e "${YELLOW}Before proceeding, ensure you have:${NC}"
echo -e "  1. A full database backup"
echo -e "  2. No active write operations"
echo -e "  3. A maintenance window scheduled"
echo ""
read -rp "Have you created a database backup? [y/N] " backup_answer
if [[ ! "$backup_answer" =~ ^[Yy]$ ]]; then
  warn "Aborting. Create a backup first:"
  echo ""
  echo -e "  ${BLUE}pg_dump -U safecare safecare > backup_\$(date +%Y%m%d_%H%M%S).sql${NC}"
  echo ""
  exit 1
fi

# ---- Read current DEK -----------------------------------------------------
CURRENT_DEK=$(grep '^DEK=' "$ENV_FILE" | cut -d'=' -f2)
if [[ -z "$CURRENT_DEK" ]]; then
  warn "No current DEK found in .env"
fi

# ---- Generate new DEK -----------------------------------------------------
NEW_DEK="$(openssl rand -hex 32)"

echo ""
info "Current DEK: ${CURRENT_DEK:-(not set)}"
info "New DEK:     $NEW_DEK"
echo ""

read -rp "Proceed with rotation? [y/N] " proceed
if [[ ! "$proceed" =~ ^[Yy]$ ]]; then
  info "Aborted."
  exit 0
fi

# ---- Update .env ----------------------------------------------------------
if [[ -n "$CURRENT_DEK" ]]; then
  sed -i "s/^DEK=.*/DEK=$NEW_DEK/" "$ENV_FILE"
else
  echo "DEK=$NEW_DEK" >> "$ENV_FILE"
fi
ok "Updated DEK in .env"

# ---- Instructions ---------------------------------------------------------
echo ""
echo -e "${BOLD}----------------------------------------${NC}"
echo -e "${GREEN}${BOLD}  DEK updated in .env${NC}"
echo -e "${BOLD}----------------------------------------${NC}"
echo ""
echo -e "${BOLD}Next steps to complete the rotation:${NC}"
echo ""
echo -e "  1. Run the re-encryption migration:"
echo -e "     ${BLUE}pnpm db:reencrypt --old-dek $CURRENT_DEK${NC}"
echo ""
echo -e "  2. Verify data integrity:"
echo -e "     ${BLUE}pnpm db:verify-encryption${NC}"
echo ""
echo -e "  3. Restart the backend:"
echo -e "     ${BLUE}pnpm dev${NC}"
echo ""
echo -e "  4. If using SOPS, update the encrypted secrets:"
echo -e "     ${BLUE}sops secrets/secrets.enc.yaml${NC}"
echo ""
echo -e "${YELLOW}Keep the old DEK until you have verified all data${NC}"
echo -e "${YELLOW}has been successfully re-encrypted.${NC}"
echo ""
echo -e "  Old DEK (save until verified): ${BOLD}$CURRENT_DEK${NC}"
echo ""
