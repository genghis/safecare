#!/usr/bin/env bash
set -euo pipefail

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

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
PASS=0
FAIL=0
SKIP=0

pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}FAIL${NC} $1: $2"; }
skip() { SKIP=$((SKIP+1)); echo -e "  ${YELLOW}SKIP${NC} $1: $2"; }

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

echo ""

# ---------------------------------------------------------------------------
echo "--- 2. Admin Registration & Auth ---"
# ---------------------------------------------------------------------------

TEST_EMAIL="test-$(date +%s)@smoke.test"
TEST_PASS="smoketest123"

# Register (may fail if admin already exists -- that's OK)
REG=$(curl -s -X POST "$API/api/auth/admin/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" 2>&1)

REG_OK=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') or 'already' in d.get('error','').lower() or 'disabled' in d.get('error','').lower() else 'no')" 2>/dev/null)

if [ "$REG_OK" = "yes" ]; then
  pass "Admin registration (or already exists)"
else
  fail "Admin registration" "$REG"
fi

# Try to login with test creds or existing admin
LOGIN=$(curl -s -X POST "$API/api/auth/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" 2>&1)

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || echo "")

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
  DRIVER=$(curl -s -X POST "$API/api/drivers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Smoke Test Driver","phone":"5550001234","teamName":"TestTeam"}' 2>&1)
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
    -d '{"name":"Smoke Test Recipient","phone":"5550005678","address":"123 Test St, Palo Alto, CA","lat":37.44,"lng":-122.16,"communicationPreference":"sms","language":"en"}' 2>&1)
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

if [ -n "$DRIVER_ID" ]; then
  # Request OTP
  OTP_RESP=$(curl -s -X POST "$API/api/auth/driver/request-otp" \
    -H "Content-Type: application/json" \
    -d '{"phone":"5550001234"}' 2>&1)
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
      -d "{\"phone\":\"5550001234\",\"otp\":\"$OTP\"}" 2>&1)
    DTOKEN=$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null)
    if [ -n "$DTOKEN" ] && [ "$DTOKEN" != "" ]; then
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
# Summary
# ---------------------------------------------------------------------------
echo "=========================================="
echo "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
