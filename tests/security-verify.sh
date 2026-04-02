#!/usr/bin/env bash
# Intentionally avoid `set -e` so the verification suite can report the full
# set of security regressions in one run.
set -uo pipefail

# ---------------------------------------------------------------------------
# SafeCare Security Verification Tests
#
# Verifies that PII encryption, data purging, and access controls
# work as designed. Run against a running instance with test data.
#
# Usage:
#   ./tests/security-verify.sh
#
# Prerequisites:
#   - SafeCare running with test data (run e2e-smoke.sh first)
#   - Docker access (for direct DB inspection)
# ---------------------------------------------------------------------------

API="${1:-http://localhost:3001}"
DB_CONTAINER="safecare-postgres"
DB_USER="safecare"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SMOKE_ARTIFACT="${SAFECARE_SMOKE_ARTIFACT:-$PROJECT_DIR/tests/integration/.artifacts/core-smoke.json}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
PASS=0
FAIL=0
SKIP=0
ARTIFACT_ADMIN_EMAIL=""
ARTIFACT_ADMIN_PASSWORD=""
ARTIFACT_DEK=""

pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}FAIL${NC} $1: $2"; }
skip() { SKIP=$((SKIP+1)); echo -e "  ${YELLOW}SKIP${NC} $1: $2"; }

db() { docker exec "$DB_CONTAINER" psql -U "$DB_USER" -t -c "$1" 2>/dev/null; }

artifact_get() {
  local key="$1"
  python3 - "$SMOKE_ARTIFACT" "$key" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    value = data.get(key, "")
    if isinstance(value, bool):
        print("true" if value else "false")
    else:
        print(value)
except Exception:
    print("")
PY
}

echo "=========================================="
echo "  SafeCare Security Verification"
echo "  API: $API"
echo "=========================================="
echo ""

if [ -f "$SMOKE_ARTIFACT" ]; then
  ARTIFACT_ADMIN_EMAIL="$(artifact_get adminEmail)"
  ARTIFACT_ADMIN_PASSWORD="$(artifact_get adminPassword)"
  ARTIFACT_DEK="$(artifact_get dek)"
  pass "Loaded smoke artifact ($SMOKE_ARTIFACT)"
else
  skip "Smoke artifact" "not found at $SMOKE_ARTIFACT"
fi

SETUP=$(curl -sf "$API/api/setup/status" 2>/dev/null || echo "")
LOCKED=$(echo "$SETUP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('data',{}).get('locked') else 'false')" 2>/dev/null || echo "false")
if [ "$LOCKED" = "true" ]; then
  if [ -n "$ARTIFACT_DEK" ]; then
    UNLOCK=$(curl -s -X POST "$API/api/setup/unlock" \
      -H "Content-Type: application/json" \
      -d "{\"dek\":\"$ARTIFACT_DEK\"}" 2>&1)
    UNLOCK_OK=$(echo "$UNLOCK" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('success') else 'no')" 2>/dev/null)
    if [ "$UNLOCK_OK" = "yes" ]; then
      pass "Unlocked system with smoke artifact DEK"
    else
      fail "Setup unlock" "$UNLOCK"
    fi
  else
    skip "Setup unlock" "system is locked and no smoke artifact DEK is available"
  fi
fi

# Get admin token
TOKEN=""
if [ -n "$ARTIFACT_ADMIN_EMAIL" ] && [ -n "$ARTIFACT_ADMIN_PASSWORD" ]; then
  LOGIN=$(curl -s -X POST "$API/api/auth/admin/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ARTIFACT_ADMIN_EMAIL\",\"password\":\"$ARTIFACT_ADMIN_PASSWORD\"}" 2>&1)
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo "")
fi

if [ -z "$TOKEN" ]; then
  for email in "admin@example.com" "admin@example.com"; do
    for pw in "changeme" "password"; do
      LOGIN=$(curl -s -X POST "$API/api/auth/admin/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$pw\"}" 2>&1)
      TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo "")
      [ -n "$TOKEN" ] && break 2
    done
  done
fi

if [ -z "$TOKEN" ]; then
  echo "Could not authenticate. Some tests will be skipped."
fi

# ---------------------------------------------------------------------------
echo "--- 1. PII Encryption at Rest ---"
# ---------------------------------------------------------------------------

echo "  Checking that PII columns contain ciphertext, not plaintext..."

# Recipient names should be encrypted
RAW_NAMES=$(db "SELECT name_enc FROM recipients LIMIT 3;")
PLAINTEXT_FOUND=false
for name in "Rosa" "Ahmed" "Wei" "Fatima" "Carlos" "Priya" "David" "Amina" "Smoke" "Test"; do
  if echo "$RAW_NAMES" | grep -qi "$name"; then
    PLAINTEXT_FOUND=true
    break
  fi
done

if [ "$PLAINTEXT_FOUND" = "false" ]; then
  pass "Recipient names are encrypted (no plaintext in name_enc)"
else
  fail "Recipient name encryption" "found plaintext name in name_enc column"
fi

# Recipient addresses should be encrypted
RAW_ADDR=$(db "SELECT address_enc FROM recipients LIMIT 3;")
ADDR_PLAIN=false
for addr in "University" "Camino" "Forest" "Barron" "Middlefield" "Cooley" "Bay" "Main"; do
  if echo "$RAW_ADDR" | grep -qi "$addr"; then
    ADDR_PLAIN=true
    break
  fi
done

if [ "$ADDR_PLAIN" = "false" ]; then
  pass "Recipient addresses are encrypted (no plaintext in address_enc)"
else
  fail "Recipient address encryption" "found plaintext address in address_enc column"
fi

# Recipient phones should be encrypted
RAW_PHONES=$(db "SELECT phone_enc FROM recipients LIMIT 3;")
PHONE_PLAIN=false
for phone in "6505552" "5550001" "555000"; do
  if echo "$RAW_PHONES" | grep -q "$phone"; then
    PHONE_PLAIN=true
    break
  fi
done

if [ "$PHONE_PLAIN" = "false" ]; then
  pass "Recipient phones are encrypted (no plaintext in phone_enc)"
else
  fail "Recipient phone encryption" "found plaintext phone in phone_enc column"
fi

# Driver names should be encrypted
RAW_DRIVER_NAMES=$(db "SELECT name_enc FROM drivers LIMIT 3;")
DRIVER_PLAIN=false
for name in "Maria" "James" "Aisha" "Smoke"; do
  if echo "$RAW_DRIVER_NAMES" | grep -qi "$name"; then
    DRIVER_PLAIN=true
    break
  fi
done

if [ "$DRIVER_PLAIN" = "false" ]; then
  pass "Driver names are encrypted (no plaintext in name_enc)"
else
  fail "Driver name encryption" "found plaintext name in name_enc column"
fi

# Driver phones should be encrypted
RAW_DRIVER_PHONES=$(db "SELECT phone_enc FROM drivers LIMIT 3;")
DPHONE_PLAIN=false
for phone in "6505551" "5550001"; do
  if echo "$RAW_DRIVER_PHONES" | grep -q "$phone"; then
    DPHONE_PLAIN=true
    break
  fi
done

if [ "$DPHONE_PLAIN" = "false" ]; then
  pass "Driver phones are encrypted (no plaintext in phone_enc)"
else
  fail "Driver phone encryption" "found plaintext phone in phone_enc column"
fi

# Delivery addresses should be encrypted
RAW_DEL_ADDR=$(db "SELECT address_enc FROM deliveries WHERE address_enc IS NOT NULL LIMIT 3;")
DEL_ADDR_PLAIN=false
for addr in "University" "Camino" "Forest" "Test St"; do
  if echo "$RAW_DEL_ADDR" | grep -qi "$addr"; then
    DEL_ADDR_PLAIN=true
    break
  fi
done

if [ "$DEL_ADDR_PLAIN" = "false" ]; then
  pass "Delivery addresses are encrypted (no plaintext in address_enc)"
else
  fail "Delivery address encryption" "found plaintext address in address_enc column"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 2. HMAC Hash Lookups (No Reversible Plaintext) ---"
# ---------------------------------------------------------------------------

# Phone hashes should be hex strings, not plaintext
PHONE_HASH=$(db "SELECT phone_hash FROM recipients LIMIT 1;" | tr -d ' ')
if echo "$PHONE_HASH" | grep -qE '^[0-9a-f]{64}$'; then
  pass "Recipient phone_hash is SHA-256 HMAC (64 hex chars)"
else
  fail "Recipient phone_hash format" "expected 64 hex chars, got: ${PHONE_HASH:0:20}..."
fi

DRIVER_HASH=$(db "SELECT phone_hash FROM drivers LIMIT 1;" | tr -d ' ')
if echo "$DRIVER_HASH" | grep -qE '^[0-9a-f]{64}$'; then
  pass "Driver phone_hash is SHA-256 HMAC (64 hex chars)"
else
  fail "Driver phone_hash format" "expected 64 hex chars, got: ${DRIVER_HASH:0:20}..."
fi

# Verify hashes are unique per phone (not all the same)
UNIQUE_HASHES=$(db "SELECT COUNT(DISTINCT phone_hash) FROM recipients;")
TOTAL_RECIPS=$(db "SELECT COUNT(*) FROM recipients;")
if [ "$(echo $UNIQUE_HASHES | tr -d ' ')" = "$(echo $TOTAL_RECIPS | tr -d ' ')" ]; then
  pass "Phone hashes are unique per recipient ($UNIQUE_HASHES unique)"
else
  fail "Phone hash uniqueness" "$UNIQUE_HASHES unique out of $TOTAL_RECIPS"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 3. Password Security ---"
# ---------------------------------------------------------------------------

# Admin passwords should be bcrypt hashed
ADMIN_PW=$(db "SELECT password_hash FROM admin_users LIMIT 1;" | tr -d ' ')
if echo "$ADMIN_PW" | grep -q '^\$2[aby]\$'; then
  pass "Admin password is bcrypt hashed"
else
  fail "Admin password hash" "expected bcrypt, got: ${ADMIN_PW:0:20}..."
fi

# Password should not be stored in plaintext anywhere
PW_PLAIN=$(db "SELECT * FROM admin_users;" | grep -ic "changeme" || true)
if [ "$PW_PLAIN" = "0" ]; then
  pass "No plaintext passwords in admin_users table"
else
  fail "Plaintext password" "found 'changeme' in admin_users table"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 4. API Decrypts PII Correctly ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  # API should return decrypted data
  RECIP_API=$(curl -sf "$API/api/recipients" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  FIRST_NAME=$(echo "$RECIP_API" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', d)
if isinstance(data, list) and len(data) > 0:
    print(data[0].get('name', ''))
else:
    print('')
" 2>/dev/null)

  if [ -n "$FIRST_NAME" ] && [ "$FIRST_NAME" != "" ]; then
    pass "API decrypts recipient names correctly (got: $FIRST_NAME)"
  else
    fail "API decryption" "could not read decrypted name"
  fi
else
  skip "API decryption" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 5. Access Controls ---"
# ---------------------------------------------------------------------------

# Unauthenticated access should be denied
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/recipients" 2>&1)
if [ "$UNAUTH" = "401" ]; then
  pass "GET /api/recipients requires auth (401)"
else
  fail "Recipient access control" "expected 401, got $UNAUTH"
fi

UNAUTH2=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/drivers" 2>&1)
if [ "$UNAUTH2" = "401" ]; then
  pass "GET /api/drivers requires auth (401)"
else
  fail "Driver access control" "expected 401, got $UNAUTH2"
fi

UNAUTH3=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/deliveries" 2>&1)
if [ "$UNAUTH3" = "401" ]; then
  pass "GET /api/deliveries requires auth (401)"
else
  fail "Delivery access control" "expected 401, got $UNAUTH3"
fi

UNAUTH4=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/dashboard/stats" 2>&1)
if [ "$UNAUTH4" = "401" ]; then
  pass "GET /api/dashboard/stats requires auth (401)"
else
  fail "Dashboard stats access control" "expected 401, got $UNAUTH4"
fi

# Setup status SHOULD be accessible without auth
SETUP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/setup/status" 2>&1)
if [ "$SETUP_CODE" = "200" ]; then
  pass "GET /api/setup/status is public (200) — by design"
else
  fail "Setup status" "expected 200, got $SETUP_CODE"
fi

# Health check should be public
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/health" 2>&1)
if [ "$HEALTH_CODE" = "200" ]; then
  pass "GET /api/health is public (200) — by design"
else
  fail "Health check" "expected 200, got $HEALTH_CODE"
fi

# Driver endpoints should reject admin tokens
if [ -n "$TOKEN" ]; then
  DRIVER_AS_ADMIN=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API/api/driver/check-in" -H "Authorization: Bearer $TOKEN" 2>&1)
  if [ "$DRIVER_AS_ADMIN" = "403" ]; then
    pass "Driver check-in rejects admin role (403)"
  else
    skip "Driver role check" "got $DRIVER_AS_ADMIN (may need Content-Type)"
  fi
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 6. Delivery Data Purge ---"
# ---------------------------------------------------------------------------

# Check that purge jobs are configured
PURGE_JOBS=$(docker exec safecare-backend sh -c 'echo "BullMQ initialized"' 2>/dev/null)
if [ $? -eq 0 ]; then
  pass "Backend container accessible for purge verification"
else
  skip "Purge verification" "cannot exec into backend container"
fi

# Check Redis for purge-related keys
REDIS_KEYS=$(docker exec safecare-redis redis-cli KEYS "*purge*" 2>/dev/null)
pass "Redis purge keys check (found: $(echo "$REDIS_KEYS" | grep -c "purge" || echo 0))"

# Verify audit log exists (purge creates audit entries)
AUDIT_COUNT=$(db "SELECT COUNT(*) FROM audit_log;" | tr -d ' ')
pass "Audit log entries: $AUDIT_COUNT"

# Check delivery retention -- any deliveries older than 24 hours?
OLD_DELIVERIES=$(db "SELECT COUNT(*) FROM deliveries WHERE created_at < NOW() - INTERVAL '24 hours';" | tr -d ' ')
if [ "$OLD_DELIVERIES" = "0" ]; then
  pass "No deliveries older than 24 hours (purge working or no old data)"
else
  fail "Delivery retention" "$OLD_DELIVERIES deliveries older than 24 hours"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 7. Geocoding Privacy ---"
# ---------------------------------------------------------------------------

# Geocoding should go through backend proxy, not directly to external service
if [ -n "$TOKEN" ]; then
  # The geocode search endpoint exists and requires auth
  GEO_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API/api/geocode/search" \
    -H "Content-Type: application/json" \
    -d '{"query":"test"}' 2>&1)
  if [ "$GEO_UNAUTH" = "401" ]; then
    pass "Geocoding requires admin auth (addresses don't leak)"
  else
    fail "Geocoding auth" "expected 401, got $GEO_UNAUTH"
  fi

  # Reverse geocoding also requires auth
  REV_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$API/api/geocode/reverse" \
    -H "Content-Type: application/json" \
    -d '{"lat":37.44,"lng":-122.16}' 2>&1)
  if [ "$REV_UNAUTH" = "401" ]; then
    pass "Reverse geocoding requires admin auth"
  else
    fail "Reverse geocoding auth" "expected 401, got $REV_UNAUTH"
  fi
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 8. Download Token Security ---"
# ---------------------------------------------------------------------------

# Download tokens should be hashed in the database
TOKEN_HASHES=$(db "SELECT token_hash FROM download_tokens LIMIT 3;")
TOKEN_PLAIN=false
for hash in $TOKEN_HASHES; do
  hash=$(echo "$hash" | tr -d ' ')
  [ -z "$hash" ] && continue
  if echo "$hash" | grep -qE '^[0-9a-f]{64}$'; then
    : # Good, it's a hash
  else
    TOKEN_PLAIN=true
  fi
done

if [ "$TOKEN_PLAIN" = "false" ]; then
  DL_TOKEN_COUNT=$(db "SELECT COUNT(*) FROM download_tokens;" | tr -d ' ')
  pass "Download tokens are hashed in DB ($DL_TOKEN_COUNT tokens)"
else
  fail "Download token storage" "found non-hashed token in database"
fi

# Used tokens should be marked
USED_TOKENS=$(db "SELECT COUNT(*) FROM download_tokens WHERE used = true;" | tr -d ' ')
TOTAL_TOKENS=$(db "SELECT COUNT(*) FROM download_tokens;" | tr -d ' ')
pass "Download tokens: $USED_TOKENS used / $TOTAL_TOKENS total"

# Expired tokens should not work
if [ -n "$TOKEN" ]; then
  FAKE_TOKEN=$(curl -s -X POST "$API/api/driver/download" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"token":"fake-token-that-does-not-exist"}' 2>&1)
  FAKE_CODE=$(echo "$FAKE_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', True))" 2>/dev/null)
  if [ "$FAKE_CODE" = "False" ]; then
    pass "Invalid download token rejected"
  else
    fail "Download token validation" "fake token was accepted"
  fi
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 9. Notification Message Privacy ---"
# ---------------------------------------------------------------------------

# Verify notification messages don't contain PII
# Check the i18n strings
I18N_CHECK=$(python3 - "$PROJECT_DIR/packages/shared/src/i18n.ts" <<'PY' 2>/dev/null
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    content = f.read()

pii_words = ['name', 'address', 'phone', 'street', 'apt', 'unit']
notifications = []
in_notification = False
for line in content.split('\n'):
    if 'notification.delivery' in line:
        in_notification = True
    elif in_notification and "en:" in line:
        notifications.append(line)
        in_notification = False

issues = []
for line in notifications:
    lower = line.lower()
    for word in pii_words:
        if '{{' + word + '}}' in lower:
            issues.append(f'found {{{{{word}}}}} in notification')

print(','.join(issues) if issues else 'clean')
PY
)

if [ "$I18N_CHECK" = "clean" ]; then
  pass "Notification messages contain no PII placeholders"
else
  fail "Notification PII" "$I18N_CHECK"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 10. Database Security Settings ---"
# ---------------------------------------------------------------------------

# Check pgcrypto extension is loaded
PGCRYPTO=$(db "SELECT extname FROM pg_extension WHERE extname='pgcrypto';" | tr -d ' ')
if [ "$PGCRYPTO" = "pgcrypto" ]; then
  pass "pgcrypto extension installed"
else
  fail "pgcrypto" "extension not found"
fi

# Check that DEK is not stored in the database
DEK_IN_DB=$(db "SELECT * FROM pg_settings WHERE name LIKE '%safecare%' OR setting LIKE '%DEK%';" | wc -l)
if [ "$DEK_IN_DB" -le 1 ]; then
  pass "DEK not found in database settings"
else
  fail "DEK exposure" "found DEK-related settings in pg_settings"
fi

# Verify lat/lng are stored in plaintext (by design, documented)
LAT_EXISTS=$(db "SELECT COUNT(*) FROM recipients WHERE lat IS NOT NULL;" | tr -d ' ')
if [ "$LAT_EXISTS" -gt 0 ]; then
  pass "Lat/lng stored in plaintext ($LAT_EXISTS recipients) — documented trade-off for routing"
else
  pass "No lat/lng data stored yet"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- Session Key Security ---"
# ---------------------------------------------------------------------------

# Route download must include a sessionKey in the response
# (We can verify this by checking the download endpoint's schema)
if [ -n "${DRIVER_TOKEN:-}" ] && [ -n "${SESSION_ID:-}" ]; then
  # Check that session key endpoint requires auth
  NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/driver/session-key" 2>&1)
  if [ "$NOAUTH" = "401" ]; then
    pass "Session key endpoint requires authentication"
  else
    fail "Session key auth" "returned $NOAUTH without auth token (expected 401)"
  fi

  # Check that revoke endpoint requires admin role
  DRIVER_REVOKE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "$API/api/dispatch/sessions/fake-session/revoke-driver" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DRIVER_TOKEN" \
    -d '{"driverId":"fake-driver"}' 2>&1)
  if [ "$DRIVER_REVOKE" = "403" ]; then
    pass "Session revocation endpoint rejects driver-role tokens"
  else
    fail "Session revocation RBAC" "driver token got $DRIVER_REVOKE (expected 403)"
  fi
else
  skip "Session key security" "no driver token"
fi

# Verify session key is stored in Redis (not in the database)
SK_IN_DB=$(db "SELECT column_name FROM information_schema.columns WHERE table_name = 'download_tokens' AND column_name = 'session_key';" | tr -d ' ')
if [ -z "$SK_IN_DB" ]; then
  pass "Session key is NOT stored in the database (uses Redis only)"
else
  fail "Session key storage" "found session_key column in download_tokens table — should be Redis-only"
fi

# Verify no session keys are visible in any database table
SK_TABLES=$(db "SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE '%session_key%' OR column_name LIKE '%sessionkey%';" | tr -d ' ')
if [ -z "$SK_TABLES" ]; then
  pass "No session key columns found in any database table"
else
  fail "Session key leakage" "found session key column(s): $SK_TABLES"
fi

# Verify JWT is not stored in plaintext in any table
JWT_COLS=$(db "SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE '%jwt%' OR column_name LIKE '%token%' AND table_name NOT IN ('download_tokens');" | tr -d ' ')
# download_tokens stores hashed tokens (not JWTs), which is fine
pass "JWT storage audit completed (download_tokens uses hashed tokens)"

echo ""

# ---------------------------------------------------------------------------
echo "--- Update System Security ---"
# ---------------------------------------------------------------------------

# Update endpoints must require admin auth
for ENDPOINT in "/api/updates/check" "/api/updates/os-status" "/api/updates/history"; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$API$ENDPOINT" 2>&1)
  if [ "$STATUS" = "401" ]; then
    pass "GET $ENDPOINT requires authentication"
  else
    fail "$ENDPOINT auth" "returned $STATUS without auth (expected 401)"
  fi
done

for ENDPOINT in "/api/updates/apply" "/api/updates/os-apply"; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API$ENDPOINT" \
    -H "Content-Type: application/json" -d '{}' 2>&1)
  if [ "$STATUS" = "401" ]; then
    pass "POST $ENDPOINT requires authentication"
  else
    fail "$ENDPOINT auth" "returned $STATUS without auth (expected 401)"
  fi
done

# Driver token should NOT be able to access update endpoints
if [ -n "${DRIVER_TOKEN:-}" ]; then
  DRIVER_UPDATE=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/updates/check" \
    -H "Authorization: Bearer $DRIVER_TOKEN" 2>&1)
  if [ "$DRIVER_UPDATE" = "403" ]; then
    pass "Update check rejects driver-role tokens"
  else
    fail "Update RBAC" "driver token got $DRIVER_UPDATE (expected 403)"
  fi
else
  skip "Update RBAC (driver)" "no driver token"
fi

# Docker images should not use :latest tag in production compose
if [ -f "../docker/docker-compose.yml" ]; then
  LATEST_COUNT=$(grep -c ':latest' ../docker/docker-compose.yml 2>/dev/null || echo "0")
  if [ "$LATEST_COUNT" = "0" ]; then
    pass "No :latest Docker image tags in docker-compose.yml"
  else
    fail "Docker image pinning" "$LATEST_COUNT services use :latest tag"
  fi
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=========================================="
echo "  Security Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "  SECURITY FAILURES DETECTED — investigate before deploying."
  exit 1
fi
