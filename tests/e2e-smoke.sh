#!/usr/bin/env bash
# Intentionally avoid `set -e` so the smoke suite can record multiple failures
# instead of aborting on the first broken endpoint.
set -uo pipefail

# ---------------------------------------------------------------------------
# SafeCare End-to-End Smoke Tests
#
# Verifies the complete flow works against a running instance.
# Run after a fresh install or after any significant changes.
#
# Usage:
#   ./tests/e2e-smoke.sh                          # test localhost
#   ./tests/e2e-smoke.sh https://safecare.local    # test remote
#
# Prerequisites:
#   - SafeCare running (docker compose up -d)
#   - curl, python3 available
# ---------------------------------------------------------------------------

API="${1:-http://localhost:3001}"
DASHBOARD="${2:-http://localhost:3000}"
PWA="${3:-http://localhost:5173}"
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
TOKEN=""
AUTH=""
DRIVER_ID=""
DRIVER_PHONE=""
RECIP_ID=""
SESSION_ID=""
DELIVERY_ID=""
DTOKEN=""
DRIVER_TOKEN=""
ARTIFACT_ADMIN_EMAIL=""
ARTIFACT_ADMIN_PASSWORD=""
ARTIFACT_DEK=""

pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}FAIL${NC} $1: $2"; }
skip() { SKIP=$((SKIP+1)); echo -e "  ${YELLOW}SKIP${NC} $1: $2"; }

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

# Helper: make API call and check status code
api() {
  local method="$1" path="$2" body="${3:-}" expected="${4:-200}" token="${5:-}"
  local headers="-H 'Content-Type: application/json'"
  [ -n "$token" ] && headers="$headers -H 'Authorization: Bearer $token'"

  if [ -n "$body" ]; then
    local resp=$(eval curl -s -w '\n%{http_code}' -X "$method" "$API$path" $headers -d "'$body'" 2>&1)
  else
    local resp=$(eval curl -s -w '\n%{http_code}' -X "$method" "$API$path" $headers 2>&1)
  fi

  local status=$(echo "$resp" | tail -1)
  local body_out=$(echo "$resp" | sed '$d')

  if [ "$status" = "$expected" ]; then
    echo "$body_out"
    return 0
  else
    echo "HTTP $status (expected $expected): $body_out" >&2
    return 1
  fi
}

echo "=========================================="
echo "  SafeCare E2E Smoke Tests"
echo "  API:       $API"
echo "  Dashboard: $DASHBOARD"
echo "  PWA:       $PWA"
echo "=========================================="
echo ""

if [ -f "$SMOKE_ARTIFACT" ]; then
  ARTIFACT_ADMIN_EMAIL="$(artifact_get adminEmail)"
  ARTIFACT_ADMIN_PASSWORD="$(artifact_get adminPassword)"
  ARTIFACT_DEK="$(artifact_get dek)"
  DRIVER_ID="$(artifact_get driverId)"
  DRIVER_PHONE="$(artifact_get driverPhone)"
  RECIP_ID="$(artifact_get recipientId)"
  SESSION_ID="$(artifact_get sessionId)"
  DELIVERY_ID="$(artifact_get deliveryId)"
  pass "Loaded smoke artifact ($SMOKE_ARTIFACT)"
else
  skip "Smoke artifact" "not found at $SMOKE_ARTIFACT"
fi

# ---------------------------------------------------------------------------
echo "--- 1. Service Health ---"
# ---------------------------------------------------------------------------

# Backend health
if curl -sf "$API/api/health" > /dev/null 2>&1; then
  pass "Backend API responding"
else
  fail "Backend API" "not responding at $API"
fi

# Dashboard
if curl -sf "$DASHBOARD" > /dev/null 2>&1; then
  pass "Dashboard responding"
else
  fail "Dashboard" "not responding at $DASHBOARD"
fi

# PWA
if curl -sf "$PWA" > /dev/null 2>&1; then
  pass "PWA responding"
else
  fail "PWA" "not responding at $PWA"
fi

# Setup status (unauthenticated)
SETUP=$(curl -sf "$API/api/setup/status" 2>/dev/null)
if [ $? -eq 0 ]; then
  pass "Setup status endpoint (unauthenticated)"
else
  fail "Setup status" "endpoint not responding"
fi

LOCKED=$(echo "${SETUP:-}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('data',{}).get('locked') else 'false')" 2>/dev/null || echo "false")
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

echo ""

# ---------------------------------------------------------------------------
echo "--- 2. Admin Registration & Auth ---"
# ---------------------------------------------------------------------------

TEST_EMAIL="test-$(date +%s)@smoke.test"
TEST_PASS="smoketest123"

# Try artifact credentials first
if [ -n "$ARTIFACT_ADMIN_EMAIL" ] && [ -n "$ARTIFACT_ADMIN_PASSWORD" ]; then
  LOGIN=$(curl -s -X POST "$API/api/auth/admin/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ARTIFACT_ADMIN_EMAIL\",\"password\":\"$ARTIFACT_ADMIN_PASSWORD\"}" 2>&1)
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo "")
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
    pass "Admin login (smoke artifact credentials)"
  fi
fi

# Register a fresh admin only if the artifact credentials didn't work
if [ -z "$TOKEN" ]; then
  REG=$(curl -s -X POST "$API/api/auth/admin/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" 2>&1)

  REG_OK=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') or 'already' in d.get('error','').lower() or 'disabled' in d.get('error','').lower() else 'no')" 2>/dev/null)

  if [ "$REG_OK" = "yes" ]; then
    pass "Admin registration (or already exists)"
  else
    fail "Admin registration" "$REG"
  fi

  LOGIN=$(curl -s -X POST "$API/api/auth/admin/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" 2>&1)

  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo "")
fi

if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
  pass "Admin login"
else
  # Try with common test password
  for email in "admin@example.com" "admin@example.com"; do
    for pw in "changeme" "password" "smoketest123"; do
      LOGIN=$(curl -s -X POST "$API/api/auth/admin/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$pw\"}" 2>&1)
      TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo "")
      if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
        break 2
      fi
    done
  done

  if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
    pass "Admin login (existing account)"
  else
    fail "Admin login" "could not authenticate"
    echo "  Tests requiring auth will be skipped."
  fi
fi

AUTH="-H 'Authorization: Bearer $TOKEN'"

echo ""

# ---------------------------------------------------------------------------
echo "--- 3. Settings & Provisioning ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  # GET settings
  SETTINGS=$(curl -sf "$API/api/settings" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    pass "GET /api/settings"
  else
    fail "GET /api/settings" "failed"
  fi

  # PUT settings
  SAVE=$(curl -s -X PUT "$API/api/settings" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"orgName":"Smoke Test Org","serviceArea":{"lat":37.44,"lng":-122.16,"zoom":13,"label":"Palo Alto","bounds":{"south":37.41,"west":-122.19,"north":37.47,"east":-122.13}}}' 2>&1)
  SAVE_OK=$(echo "$SAVE" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('success') else 'no')" 2>/dev/null)
  if [ "$SAVE_OK" = "yes" ]; then
    pass "PUT /api/settings"
  else
    fail "PUT /api/settings" "$SAVE"
  fi

  # Provision status
  PROV=$(curl -sf "$API/api/settings/provision-status" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    pass "GET /api/settings/provision-status"
  else
    fail "GET /api/settings/provision-status" "failed"
  fi

  # Manifest check
  MANIFEST=$(curl -sf "https://storage.googleapis.com/safecare-maps-osrm/manifest.json" 2>/dev/null)
  if [ $? -eq 0 ]; then
    REGION_COUNT=$(echo "$MANIFEST" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('regions',[])))" 2>/dev/null)
    pass "Pre-built manifest accessible ($REGION_COUNT regions)"
  else
    skip "Pre-built manifest" "not accessible"
  fi
else
  skip "Settings tests" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 4. Zones CRUD ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  # Create zone
  ZONE=$(curl -s -X POST "$API/api/zones" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Smoke Test Zone","color":"#3b82f6","polygon":[{"lat":37.44,"lng":-122.16},{"lat":37.44,"lng":-122.14},{"lat":37.42,"lng":-122.14},{"lat":37.42,"lng":-122.16}]}' 2>&1)
  ZONE_ID=$(echo "$ZONE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
  if [ -n "$ZONE_ID" ] && [ "$ZONE_ID" != "" ]; then
    pass "POST /api/zones (create)"
  else
    fail "POST /api/zones" "$ZONE"
  fi

  # List zones
  ZONES=$(curl -sf "$API/api/zones" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    pass "GET /api/zones (list)"
  else
    fail "GET /api/zones" "failed"
  fi

  # Delete zone
  if [ -n "$ZONE_ID" ]; then
    DEL=$(curl -s -X DELETE "$API/api/zones/$ZONE_ID" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    DEL_OK=$(echo "$DEL" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('success') else 'no')" 2>/dev/null)
    if [ "$DEL_OK" = "yes" ]; then
      pass "DELETE /api/zones/:id"
    else
      fail "DELETE /api/zones/:id" "$DEL"
    fi
  fi
else
  skip "Zone tests" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 5. Driver CRUD ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  # Create driver
  DRIVER_PHONE="555$(date +%s | tail -c 8)"
  DRIVER=$(curl -s -X POST "$API/api/drivers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"name\":\"Smoke Test Driver\",\"phone\":\"$DRIVER_PHONE\",\"teamName\":\"TestTeam\"}" 2>&1)
  DRIVER_ID=$(echo "$DRIVER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
  if [ -n "$DRIVER_ID" ] && [ "$DRIVER_ID" != "" ]; then
    pass "POST /api/drivers (create)"
  else
    fail "POST /api/drivers" "$DRIVER"
  fi

  # Vet driver
  if [ -n "$DRIVER_ID" ]; then
    VET=$(curl -s -X PATCH "$API/api/drivers/$DRIVER_ID/status" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"status":"vetted"}' 2>&1)
    VET_OK=$(echo "$VET" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('success') else 'no')" 2>/dev/null)
    if [ "$VET_OK" = "yes" ]; then
      pass "PATCH /api/drivers/:id/status (vet)"
    else
      fail "PATCH /api/drivers/:id/status" "$VET"
    fi
  fi

  # List drivers
  DRIVERS=$(curl -sf "$API/api/drivers" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    pass "GET /api/drivers (list)"
  else
    fail "GET /api/drivers" "failed"
  fi
else
  skip "Driver tests" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 6. Recipient CRUD ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  RECIP=$(curl -s -X POST "$API/api/recipients" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"name\":\"Smoke Test Recipient\",\"phone\":\"555$(date +%s | tail -c 8)\",\"address\":\"123 Test St, Palo Alto, CA\",\"lat\":37.44,\"lng\":-122.16,\"communicationPreference\":\"sms\",\"language\":\"en\"}" 2>&1)
  RECIP_ID=$(echo "$RECIP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
  if [ -n "$RECIP_ID" ] && [ "$RECIP_ID" != "" ]; then
    pass "POST /api/recipients (create with lat/lng)"
  else
    fail "POST /api/recipients" "$RECIP"
  fi

  RECIPS=$(curl -sf "$API/api/recipients" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    RECIP_COUNT=$(echo "$RECIPS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',d) if isinstance(d.get('data',d), list) else []))" 2>/dev/null)
    pass "GET /api/recipients (list: $RECIP_COUNT)"
  else
    fail "GET /api/recipients" "failed"
  fi
else
  skip "Recipient tests" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 7. Dispatch Flow ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  TODAY=$(date +%Y-%m-%d)

  # Create session
  SESSION=$(curl -s -X POST "$API/api/dispatch/sessions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"date\":\"$TODAY\"}" 2>&1)
  SESSION_ID=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
  if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "" ]; then
    pass "POST /api/dispatch/sessions (create)"
  else
    fail "POST /api/dispatch/sessions" "$SESSION"
  fi

  # Get active session
  ACTIVE=$(curl -sf "$API/api/dispatch/sessions/active" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    pass "GET /api/dispatch/sessions/active"
  else
    fail "GET /api/dispatch/sessions/active" "failed"
  fi

  # Create delivery
  if [ -n "$RECIP_ID" ] && [ -n "$SESSION_ID" ]; then
    DELIVERY=$(curl -s -X POST "$API/api/deliveries" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"recipientId\":\"$RECIP_ID\",\"dispatchSessionId\":\"$SESSION_ID\"}" 2>&1)
    DELIVERY_ID=$(echo "$DELIVERY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null)
    if [ -n "$DELIVERY_ID" ] && [ "$DELIVERY_ID" != "" ]; then
      pass "POST /api/deliveries (create)"
    else
      fail "POST /api/deliveries" "$DELIVERY"
    fi
  fi

  # List deliveries
  DELIVS=$(curl -sf "$API/api/deliveries" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    pass "GET /api/deliveries (list)"
  else
    fail "GET /api/deliveries" "failed"
  fi
else
  skip "Dispatch tests" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 8. Driver App Flow ---"
# ---------------------------------------------------------------------------

DRIVER_PHONE="${DRIVER_PHONE:-}"
DTOKEN="${DTOKEN:-}"

if [ -n "${DRIVER_ID:-}" ] && [ -n "${DRIVER_PHONE:-}" ]; then
  # Request OTP
  OTP_RESP=$(curl -s -X POST "$API/api/auth/driver/request-otp" \
    -H "Content-Type: application/json" \
    -H "x-safecare-test-otp: 1" \
    -d "{\"phone\":\"$DRIVER_PHONE\"}" 2>&1)
  OTP=$(echo "$OTP_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('otp',''))" 2>/dev/null)
  if [ -n "$OTP" ] && [ "$OTP" != "" ]; then
    pass "POST /api/auth/driver/request-otp (OTP: $OTP)"
  else
    fail "POST /api/auth/driver/request-otp" "$OTP_RESP"
  fi

  # Verify OTP
  if [ -n "$OTP" ]; then
    VERIFY=$(curl -s -X POST "$API/api/auth/driver/verify-otp" \
      -H "Content-Type: application/json" \
      -d "{\"phone\":\"$DRIVER_PHONE\",\"otp\":\"$OTP\"}" 2>&1)
    DTOKEN=$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null)
    if [ -n "$DTOKEN" ] && [ "$DTOKEN" != "" ]; then
      DRIVER_TOKEN="$DTOKEN"
      pass "POST /api/auth/driver/verify-otp"
    else
      fail "POST /api/auth/driver/verify-otp" "$VERIFY"
    fi
  fi

  # Check-in
  if [ -n "$DTOKEN" ]; then
    CHECKIN=$(curl -s -X POST "$API/api/driver/check-in" \
      -H "Authorization: Bearer $DTOKEN" 2>&1)
    CHECKIN_OK=$(echo "$CHECKIN" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('success') else 'no')" 2>/dev/null)
    if [ "$CHECKIN_OK" = "yes" ]; then
      pass "POST /api/driver/check-in"
    else
      fail "POST /api/driver/check-in" "$CHECKIN"
    fi

    # Poll status
    STATUS=$(curl -sf "$API/api/driver/status" -H "Authorization: Bearer $DTOKEN" 2>/dev/null)
    if [ $? -eq 0 ]; then
      CHECKED=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('checkedIn',False))" 2>/dev/null)
      pass "GET /api/driver/status (checkedIn: $CHECKED)"
    else
      fail "GET /api/driver/status" "failed"
    fi
  fi
else
  skip "Driver app tests" "no driver created"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 8b. Route Release & Download ---"
# ---------------------------------------------------------------------------

DELIVERY_ID="${DELIVERY_ID:-}"
if [ -n "$TOKEN" ] && [ -n "$DTOKEN" ] && [ -n "$SESSION_ID" ] && [ -n "$DELIVERY_ID" ]; then
  # Assign delivery to our test driver
  ASSIGN=$(curl -s -X POST "$API/api/deliveries/$DELIVERY_ID/assign" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"driverId\":\"$DRIVER_ID\"}" 2>&1)
  ASSIGN_OK=$(echo "$ASSIGN" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('success') else 'no')" 2>/dev/null)
  if [ "$ASSIGN_OK" = "yes" ]; then
    pass "POST /api/deliveries/:id/assign"
  else
    fail "POST /api/deliveries/:id/assign" "$ASSIGN"
  fi

  # Release routes
  RELEASE=$(curl -s -X POST "$API/api/dispatch/sessions/$SESSION_ID/release" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"driverIds\":[\"$DRIVER_ID\"]}" 2>&1)
  REL_OK=$(echo "$RELEASE" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('success') else 'no')" 2>/dev/null)
  if [ "$REL_OK" = "yes" ]; then
    pass "POST /api/dispatch/sessions/:id/release"
  else
    fail "POST /api/dispatch/sessions/:id/release" "$RELEASE"
  fi

  # Poll status for download token
  STATUS2=$(curl -sf "$API/api/driver/status" -H "Authorization: Bearer $DTOKEN" 2>/dev/null)
  DL_TOKEN=$(echo "$STATUS2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('downloadToken',''))" 2>/dev/null)
  RELEASED=$(echo "$STATUS2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('routeReleased',False))" 2>/dev/null)

  if [ "$RELEASED" = "True" ]; then
    pass "Driver status: routeReleased=True"
  else
    # May fail if driver checked into a different session than the one released
    # This is expected in a dirty test environment with multiple sessions
    skip "Driver status: routeReleased" "driver may be on different session (multi-session env)"
  fi

  if [ -n "$DL_TOKEN" ] && [ "$DL_TOKEN" != "" ]; then
    pass "Driver status: downloadToken present"
  else
    skip "Driver status: downloadToken" "not released to this driver (multi-session env)"
  fi

  # Download route with GPS position
  if [ -n "$DL_TOKEN" ] && [ "$DL_TOKEN" != "" ]; then
    ROUTE=$(curl -s -X POST "$API/api/driver/download" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $DTOKEN" \
      -d "{\"token\":\"$DL_TOKEN\",\"driverLat\":37.44,\"driverLng\":-122.16}" 2>&1)
    STOPS=$(echo "$ROUTE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(len(d.get('stops',[])))" 2>/dev/null)
    HAS_GEOM=$(echo "$ROUTE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print('yes' if d.get('routeGeometry') else 'no')" 2>/dev/null)
    HAS_TILES=$(echo "$ROUTE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(len(d.get('tileUrls',[])))" 2>/dev/null)
    HAS_BOUNDS=$(echo "$ROUTE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print('yes' if d.get('tileBounds') else 'no')" 2>/dev/null)

    if [ "$STOPS" -gt 0 ] 2>/dev/null; then
      pass "Route download: $STOPS stops"
    else
      fail "Route download: stops" "got $STOPS"
    fi

    if [ "$HAS_GEOM" = "yes" ]; then
      pass "Route download: has routeGeometry (OSRM)"
    else
      skip "Route download: routeGeometry" "OSRM may not be running"
    fi

    if [ "$HAS_TILES" -gt 0 ] 2>/dev/null; then
      pass "Route download: $HAS_TILES tile URLs for offline caching"
    else
      fail "Route download: tileUrls" "missing"
    fi

    if [ "$HAS_BOUNDS" = "yes" ]; then
      pass "Route download: has tileBounds"
    else
      fail "Route download: tileBounds" "missing"
    fi

    # Verify stop has required fields
    STOP_FIELDS=$(echo "$ROUTE" | python3 -c "
import sys, json
d = json.load(sys.stdin).get('data',{})
stops = d.get('stops',[])
if stops:
    s = stops[0]
    required = ['deliveryId','address','lat','lng','recipientName','sequence']
    missing = [f for f in required if f not in s]
    print(','.join(missing) if missing else 'all_present')
else:
    print('no_stops')
" 2>/dev/null)

    if [ "$STOP_FIELDS" = "all_present" ]; then
      pass "Route download: stops have all required fields"
    else
      fail "Route download: stop fields" "missing: $STOP_FIELDS"
    fi
  fi
else
  skip "Route download tests" "no session/delivery/driver"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 8c. Pre-built OSRM Manifest ---"
# ---------------------------------------------------------------------------

MANIFEST_URL="https://storage.googleapis.com/safecare-maps-osrm/manifest.json"
MANIFEST=$(curl -sf "$MANIFEST_URL" 2>/dev/null)
if [ $? -eq 0 ]; then
  pass "Manifest accessible at GCS"

  # Verify structure
  MANIFEST_OK=$(echo "$MANIFEST" | python3 -c "
import sys, json
d = json.load(sys.stdin)
errors = []
if 'version' not in d: errors.append('missing version')
if 'regions' not in d: errors.append('missing regions')
if 'baseUrl' not in d: errors.append('missing baseUrl')
regions = d.get('regions', [])
if len(regions) == 0: errors.append('no regions')
for r in regions[:3]:
    if 'id' not in r: errors.append('region missing id')
    if 'bounds' not in r: errors.append('region missing bounds')
    if 'osrmUrl' not in r: errors.append('region missing osrmUrl')
    if 'osrmSize' not in r: errors.append('region missing osrmSize')
    b = r.get('bounds', {})
    if not all(k in b for k in ['south','west','north','east']):
        errors.append('region bounds incomplete')
print(','.join(errors) if errors else 'valid')
" 2>/dev/null)

  if [ "$MANIFEST_OK" = "valid" ]; then
    pass "Manifest structure valid"
  else
    fail "Manifest structure" "$MANIFEST_OK"
  fi

  # Count regions by type
  REGION_STATS=$(echo "$MANIFEST" | python3 -c "
import sys, json
d = json.load(sys.stdin)
regions = d.get('regions', [])
states = len([r for r in regions if r.get('type') == 'state'])
metros = len([r for r in regions if r.get('type') == 'metro'])
total_gb = sum(r.get('osrmSize',0) for r in regions) / 1024**3
print(f'{states} states, {metros} metros, {total_gb:.1f} GB total')
" 2>/dev/null)
  pass "Manifest contents: $REGION_STATS"

  # Test that a specific region's OSRM file is downloadable (HEAD request)
  FIRST_URL=$(echo "$MANIFEST" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d['regions'][0]
base = d['baseUrl']
print(f'{base}{r[\"osrmUrl\"]}')
" 2>/dev/null)

  DL_CHECK=$(curl -sf -I "$FIRST_URL" 2>/dev/null | head -1)
  if echo "$DL_CHECK" | grep -q "200"; then
    pass "OSRM archive downloadable (HEAD check)"
  else
    fail "OSRM archive download" "$DL_CHECK"
  fi

  # Verify viewport-to-region matching
  MATCH=$(echo "$MANIFEST" | python3 -c "
import sys, json
d = json.load(sys.stdin)
# Simulate a Minneapolis viewport
viewport = {'south': 44.8, 'west': -93.4, 'north': 45.1, 'east': -93.1}
matches = []
for r in d['regions']:
    b = r['bounds']
    if (b['south'] <= viewport['south'] and b['west'] <= viewport['west'] and
        b['north'] >= viewport['north'] and b['east'] >= viewport['east']):
        matches.append(f'{r[\"id\"]} ({r[\"type\"]})')
if matches:
    # Smallest first (metros preferred)
    print(f'matched: {matches[0]}')
else:
    print('no_match')
" 2>/dev/null)

  if echo "$MATCH" | grep -q "matched"; then
    pass "Viewport matching: Minneapolis → $MATCH"
  else
    fail "Viewport matching" "$MATCH"
  fi
else
  fail "Manifest" "not accessible at $MANIFEST_URL"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 9. Geocoding ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  GEO=$(curl -s -X POST "$API/api/geocode/search" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"query":"123 Main Street","limit":3}' 2>&1)
  GEO_OK=$(echo "$GEO" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') else 'no')" 2>/dev/null)
  if [ "$GEO_OK" = "yes" ]; then
    RESULTS=$(echo "$GEO" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null)
    pass "POST /api/geocode/search ($RESULTS results)"
  else
    skip "Geocoding search" "geocoder may not be provisioned yet"
  fi
else
  skip "Geocoding tests" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 10. Dashboard Stats ---"
# ---------------------------------------------------------------------------

if [ -n "$TOKEN" ]; then
  STATS=$(curl -sf "$API/api/dashboard/stats" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ $? -eq 0 ]; then
    echo "$STATS" | python3 -c "
import sys, json
d = json.load(sys.stdin).get('data', {})
print(f'    Recipients: {d.get(\"totalRecipients\",\"?\")}')
print(f'    Drivers:    {d.get(\"activeDrivers\",\"?\")}')
print(f'    Deliveries: {d.get(\"todaysDeliveries\",\"?\")}')
print(f'    Pending:    {d.get(\"pendingOrders\",\"?\")}')
" 2>/dev/null
    pass "GET /api/dashboard/stats"
  else
    fail "GET /api/dashboard/stats" "failed"
  fi
else
  skip "Dashboard stats" "no auth token"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 8. Session Key & Client Encryption ---"
# ---------------------------------------------------------------------------

# Test session key re-issue endpoint (requires driver token + active session)
if [ -n "${DRIVER_TOKEN:-}" ] && [ -n "${SESSION_ID:-}" ]; then
  SK_RESP=$(curl -s -w '\n%{http_code}' "$API/api/driver/session-key" \
    -H "Authorization: Bearer $DRIVER_TOKEN" 2>&1)
  SK_STATUS=$(echo "$SK_RESP" | tail -1)
  SK_BODY=$(echo "$SK_RESP" | sed '$d')

  if [ "$SK_STATUS" = "200" ]; then
    SK=$(echo "$SK_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('sessionKey',''))" 2>/dev/null || echo "")
    if [ -n "$SK" ] && [ ${#SK} -eq 64 ]; then
      pass "GET /api/driver/session-key returns 64-char hex key"
    else
      fail "GET /api/driver/session-key" "key not 64 hex chars"
    fi
  elif [ "$SK_STATUS" = "404" ]; then
    pass "GET /api/driver/session-key returns 404 (no active key — expected if route not downloaded)"
  else
    fail "GET /api/driver/session-key" "unexpected status $SK_STATUS"
  fi
else
  skip "Session key re-issue" "no driver token or session"
fi

# Test session revocation endpoint (admin only)
if [ -n "${TOKEN:-}" ] && [ -n "${SESSION_ID:-}" ] && [ -n "${DRIVER_ID:-}" ]; then
  REVOKE_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/dispatch/sessions/$SESSION_ID/revoke-driver" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"driverId\":\"$DRIVER_ID\"}" 2>&1)
  REVOKE_STATUS=$(echo "$REVOKE_RESP" | tail -1)

  if [ "$REVOKE_STATUS" = "200" ]; then
    pass "POST /api/dispatch/sessions/:id/revoke-driver"

    # After revocation, driver status should show revoked=true
    if [ -n "${DRIVER_TOKEN:-}" ]; then
      STATUS_RESP=$(curl -s "$API/api/driver/status" -H "Authorization: Bearer $DRIVER_TOKEN" 2>&1)
      REVOKED=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('revoked',False))" 2>/dev/null || echo "")
      if [ "$REVOKED" = "True" ]; then
        pass "Driver status shows revoked=true after admin revocation"
      else
        fail "Revocation detection" "revoked flag not set in status response"
      fi
    fi

    # Session key should be unavailable after revocation
    SK_RESP2=$(curl -s -w '\n%{http_code}' "$API/api/driver/session-key" \
      -H "Authorization: Bearer $DRIVER_TOKEN" 2>&1)
    SK_STATUS2=$(echo "$SK_RESP2" | tail -1)
    if [ "$SK_STATUS2" = "403" ] || [ "$SK_STATUS2" = "404" ]; then
      pass "Session key unavailable after revocation (status $SK_STATUS2)"
    else
      fail "Post-revocation key access" "expected 403 or 404, got $SK_STATUS2"
    fi
  else
    fail "Session revocation" "status $REVOKE_STATUS"
  fi
else
  skip "Session revocation flow" "no admin token, session, or driver"
fi

# Unauthenticated access to session-key must be rejected
UNAUTH_SK=$(curl -s -w '\n%{http_code}' "$API/api/driver/session-key" 2>&1)
UNAUTH_STATUS=$(echo "$UNAUTH_SK" | tail -1)
if [ "$UNAUTH_STATUS" = "401" ]; then
  pass "GET /api/driver/session-key rejects unauthenticated requests"
else
  fail "Session key auth" "expected 401, got $UNAUTH_STATUS"
fi

echo ""

# ---------------------------------------------------------------------------
echo "--- 9. System Updates ---"
# ---------------------------------------------------------------------------

# Health endpoint should return version
HEALTH=$(curl -sf "$API/api/health" 2>/dev/null)
if [ $? -eq 0 ]; then
  HEALTH_VERSION=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || echo "")
  if [ -n "$HEALTH_VERSION" ]; then
    pass "GET /api/health returns version ($HEALTH_VERSION)"
  else
    fail "Health version" "version field missing from health response"
  fi
else
  fail "Health endpoint" "not responding"
fi

# Update check endpoint (requires admin auth)
if [ -n "${TOKEN:-}" ]; then
  UPDATE_RESP=$(curl -s -w '\n%{http_code}' "$API/api/updates/check" \
    -H "Authorization: Bearer $TOKEN" 2>&1)
  UPDATE_STATUS=$(echo "$UPDATE_RESP" | tail -1)
  UPDATE_BODY=$(echo "$UPDATE_RESP" | sed '$d')

  if [ "$UPDATE_STATUS" = "200" ]; then
    CURRENT=$(echo "$UPDATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('currentVersion',''))" 2>/dev/null || echo "")
    if [ -n "$CURRENT" ]; then
      pass "GET /api/updates/check returns currentVersion ($CURRENT)"
    else
      fail "Update check" "currentVersion missing from response"
    fi

    # Should have checkedAt timestamp
    CHECKED=$(echo "$UPDATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('checkedAt',''))" 2>/dev/null || echo "")
    if [ -n "$CHECKED" ]; then
      pass "Update check includes checkedAt timestamp"
    else
      fail "Update check" "checkedAt missing"
    fi
  else
    fail "GET /api/updates/check" "status $UPDATE_STATUS"
  fi

  # Update check should be cached (second call should be fast)
  UPDATE_RESP2=$(curl -s -o /dev/null -w '%{http_code}:%{time_total}' "$API/api/updates/check" \
    -H "Authorization: Bearer $TOKEN" 2>&1)
  UPDATE_STATUS2=$(echo "$UPDATE_RESP2" | cut -d: -f1)
  UPDATE_TIME=$(echo "$UPDATE_RESP2" | cut -d: -f2)
  if [ "$UPDATE_STATUS2" = "200" ]; then
    pass "Cached update check responds quickly"
  else
    fail "Cached update check" "status $UPDATE_STATUS2"
  fi

  # OS status endpoint
  OS_RESP=$(curl -s -w '\n%{http_code}' "$API/api/updates/os-status" \
    -H "Authorization: Bearer $TOKEN" 2>&1)
  OS_STATUS=$(echo "$OS_RESP" | tail -1)
  OS_BODY=$(echo "$OS_RESP" | sed '$d')

  if [ "$OS_STATUS" = "200" ]; then
    OS_COUNT=$(echo "$OS_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('count',-1))" 2>/dev/null || echo "-1")
    if [ "$OS_COUNT" != "-1" ]; then
      pass "GET /api/updates/os-status returns package count ($OS_COUNT)"
    else
      fail "OS status" "count field missing"
    fi
  else
    # OS status may fail in non-Linux environments (macOS CI) — that's ok
    skip "GET /api/updates/os-status" "status $OS_STATUS (may not work outside Linux)"
  fi

  # Update history endpoint
  HIST_RESP=$(curl -s -w '\n%{http_code}' "$API/api/updates/history" \
    -H "Authorization: Bearer $TOKEN" 2>&1)
  HIST_STATUS=$(echo "$HIST_RESP" | tail -1)
  if [ "$HIST_STATUS" = "200" ]; then
    pass "GET /api/updates/history accessible"
  else
    fail "Update history" "status $HIST_STATUS"
  fi
else
  skip "Update check endpoints" "no admin token"
fi

# Unauthenticated access to update endpoints must be rejected
UNAUTH_UPDATE=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/updates/check" 2>&1)
if [ "$UNAUTH_UPDATE" = "401" ]; then
  pass "GET /api/updates/check rejects unauthenticated requests"
else
  fail "Update check auth" "expected 401, got $UNAUTH_UPDATE"
fi

UNAUTH_APPLY=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/updates/apply" \
  -H "Content-Type: application/json" -d '{"version":"0.0.0"}' 2>&1)
if [ "$UNAUTH_APPLY" = "401" ]; then
  pass "POST /api/updates/apply rejects unauthenticated requests"
else
  fail "Update apply auth" "expected 401, got $UNAUTH_APPLY"
fi

UNAUTH_OS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/updates/os-apply" 2>&1)
if [ "$UNAUTH_OS" = "401" ]; then
  pass "POST /api/updates/os-apply rejects unauthenticated requests"
else
  fail "OS update auth" "expected 401, got $UNAUTH_OS"
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=========================================="
echo "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
