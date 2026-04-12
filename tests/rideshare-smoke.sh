#!/bin/bash
# ---------------------------------------------------------------------------
# RideShare E2E Smoke Tests
#
# Tests the ride coordination and referral network API endpoints.
# Requires backend running at $API (default http://localhost:3001).
#
# Usage:
#   # With services already running:
#   ./tests/rideshare-smoke.sh
#
#   # Against a different host:
#   API=http://192.168.1.100:3001 ./tests/rideshare-smoke.sh
#
# Expects core-smoke.json artifact from e2e-smoke.sh (admin credentials).
# If not found, registers a new admin.
# ---------------------------------------------------------------------------
set -uo pipefail

API="${API:-http://localhost:3001}"
ARTIFACT_DIR="tests/integration/.artifacts"
ARTIFACT_FILE="$ARTIFACT_DIR/core-smoke.json"

PASS=0; FAIL=0; SKIP=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

pass() { ((PASS++)); echo -e "  ${GREEN}PASS${NC}  $1"; }
fail() { ((FAIL++)); echo -e "  ${RED}FAIL${NC}  $1${2:+ — $2}"; }
skip() { ((SKIP++)); echo -e "  ${YELLOW}SKIP${NC}  $1${2:+ — $2}"; }

# API helper: method path body expected_status [token]
api() {
  local method="$1" path="$2" body="${3:-}" expected="${4:-200}" token="${5:-}"
  local curl_args=(-s -w '\n%{http_code}' -X "$method" "$API$path")
  [ -n "$token" ] && curl_args+=(-H "Authorization: Bearer $token")
  if [ -n "$body" ]; then
    curl_args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  local output; output=$(curl "${curl_args[@]}" 2>/dev/null) || true
  local status; status=$(echo "$output" | tail -1)
  local response; response=$(echo "$output" | sed '$d')
  echo "$response" > /tmp/rideshare_last_response.json
  if [ "$status" = "$expected" ]; then
    return 0
  else
    return 1
  fi
}

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" < /tmp/rideshare_last_response.json 2>/dev/null; }

artifact_get() { python3 -c "import sys,json; print(json.load(open('$ARTIFACT_FILE')).get('$1',''))" 2>/dev/null; }

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  RideShare E2E Smoke Tests${NC}"
echo -e "${CYAN}  API: $API${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo ""

# ---- Health check ----
echo -e "${CYAN}[1/11] Health Check${NC}"
if api GET /api/health "" 200; then
  pass "Backend health check"
else
  fail "Backend not reachable at $API" "Is the backend running?"
  echo -e "\n  ${RED}Cannot continue without backend. Exiting.${NC}\n"
  exit 1
fi

# ---- Auth setup ----
echo -e "\n${CYAN}[2/11] Authentication${NC}"
TOKEN=""

# Try to reuse existing artifact
if [ -f "$ARTIFACT_FILE" ]; then
  ADMIN_EMAIL=$(artifact_get adminEmail)
  ADMIN_PASS=$(artifact_get adminPassword)
  DEK=$(artifact_get dek)

  if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASS" ]; then
    if api POST /api/auth/admin/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 200; then
      TOKEN=$(json "d.get('data',{}).get('token','')")
      if [ -n "$TOKEN" ]; then
        pass "Authenticated with existing admin ($ADMIN_EMAIL)"
      fi
    fi
  fi

  # Unlock if needed
  if [ -n "$DEK" ] && [ -n "$TOKEN" ]; then
    api POST /api/setup/unlock "{\"dek\":\"$DEK\"}" 200 "$TOKEN" 2>/dev/null || true
  fi
fi

# If no token yet, register fresh admin
if [ -z "$TOKEN" ]; then
  ADMIN_EMAIL="rideshare-test-$(date +%s)@test.local"
  ADMIN_PASS="TestPass123!"

  if api POST /api/auth/admin/register "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 201; then
    pass "Registered new admin ($ADMIN_EMAIL)"
  else
    skip "Admin registration" "admin may already exist"
  fi

  if api POST /api/auth/admin/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 200; then
    TOKEN=$(json "d.get('data',{}).get('token','')")
    if [ -n "$TOKEN" ]; then
      pass "Admin login successful"
    else
      fail "Login returned no token"
    fi
  else
    fail "Admin login failed"
  fi
fi

if [ -z "$TOKEN" ]; then
  echo -e "\n  ${RED}No auth token. Cannot continue.${NC}\n"
  exit 1
fi

# ---- Ride Stats (baseline) ----
echo -e "\n${CYAN}[3/11] Ride Stats (baseline)${NC}"
if api GET /api/rides/stats "" 200 "$TOKEN"; then
  pass "GET /api/rides/stats returns 200"
  TODAYS_RIDES=$(json "d.get('data',{}).get('todaysRides',0)")
  echo "       todaysRides=$TODAYS_RIDES"
else
  fail "Ride stats endpoint"
fi

# ---- Create test recipient for rides ----
echo -e "\n${CYAN}[4/11] Create Test Passenger${NC}"
RECIP_ID=""
if api POST /api/recipients "{\"name\":\"Rosa Ride-Test\",\"address\":\"100 Test Ave\",\"phone\":\"+16125550199\",\"lat\":44.95,\"lng\":-93.27,\"communicationPreference\":\"sms\",\"language\":\"es\",\"serviceTypes\":[\"ride\"]}" 201 "$TOKEN"; then
  RECIP_ID=$(json "d.get('data',{}).get('id','')")
  if [ -n "$RECIP_ID" ]; then
    pass "Created ride passenger (id=${RECIP_ID:0:8}...)"
  else
    fail "Recipient created but no ID returned"
  fi
else
  skip "Create passenger" "may require unlock or already exists"
fi

# ---- Saved Locations ----
echo -e "\n${CYAN}[5/11] Saved Locations${NC}"
LOC_HOME="" LOC_WORK=""
if [ -n "$RECIP_ID" ]; then
  if api POST "/api/rides/passengers/$RECIP_ID/locations" "{\"label\":\"home\",\"address\":\"100 Test Ave, Minneapolis\",\"lat\":44.95,\"lng\":-93.27,\"neighborhood\":\"Phillips\",\"isDefault\":true}" 201 "$TOKEN" || \
     api POST "/api/rides/passengers/$RECIP_ID/locations" "{\"label\":\"home\",\"address\":\"100 Test Ave, Minneapolis\",\"lat\":44.95,\"lng\":-93.27,\"neighborhood\":\"Phillips\",\"isDefault\":true}" 200 "$TOKEN"; then
    LOC_HOME=$(json "d.get('data',{}).get('id','')")
    pass "Created home location (${LOC_HOME:0:8}...)"
  else
    fail "Create home location"
  fi

  if api POST "/api/rides/passengers/$RECIP_ID/locations" "{\"label\":\"work 1\",\"address\":\"500 Hennepin Ave, Minneapolis\",\"lat\":44.98,\"lng\":-93.27,\"neighborhood\":\"Downtown\"}" 201 "$TOKEN" || \
     api POST "/api/rides/passengers/$RECIP_ID/locations" "{\"label\":\"work 1\",\"address\":\"500 Hennepin Ave, Minneapolis\",\"lat\":44.98,\"lng\":-93.27,\"neighborhood\":\"Downtown\"}" 200 "$TOKEN"; then
    LOC_WORK=$(json "d.get('data',{}).get('id','')")
    pass "Created work location (${LOC_WORK:0:8}...)"
  else
    fail "Create work location"
  fi

  # List locations
  if api GET "/api/rides/passengers/$RECIP_ID/locations" "" 200 "$TOKEN"; then
    pass "List saved locations"
  else
    fail "List saved locations"
  fi
else
  skip "Saved locations" "no recipient"
fi

# ---- Ride Schedules ----
echo -e "\n${CYAN}[6/11] Ride Schedules${NC}"
SCHED_ID=""
if [ -n "$RECIP_ID" ] && [ -n "$LOC_HOME" ] && [ -n "$LOC_WORK" ]; then
  if api POST /api/rides/schedules "{\"recipientId\":\"$RECIP_ID\",\"pickupLocationId\":\"$LOC_HOME\",\"dropoffLocationId\":\"$LOC_WORK\",\"daysOfWeek\":[\"mon\",\"wed\",\"fri\"],\"pickupTime\":\"09:00\",\"estimatedDurationMinutes\":30,\"label\":\"home to work 1\"}" 200 "$TOKEN"; then
    SCHED_ID=$(json "d.get('data',{}).get('id','')")
    if [ -n "$SCHED_ID" ]; then
      pass "Created ride schedule (${SCHED_ID:0:8}...)"
    else
      fail "Schedule created but no ID returned"
    fi
  else
    fail "Create ride schedule"
  fi

  # List schedules
  if api GET /api/rides/schedules "" 200 "$TOKEN"; then
    pass "List ride schedules"
  else
    fail "List ride schedules"
  fi

  # Generate shifts from schedule
  if [ -n "$SCHED_ID" ]; then
    NEXT_MON=$(python3 -c "from datetime import date,timedelta; d=date.today(); d+=timedelta((7-d.weekday())%7 or 7); print(d)")
    if api POST "/api/rides/schedules/$SCHED_ID/generate" "{\"weekStartDate\":\"$NEXT_MON\"}" 200 "$TOKEN"; then
      GENERATED=$(json "len(d.get('data',[]))")
      pass "Generated $GENERATED shifts from schedule"
    else
      fail "Generate shifts from schedule"
    fi
  fi
else
  skip "Ride schedules" "missing recipient or locations"
fi

# ---- Ad-hoc Shifts ----
echo -e "\n${CYAN}[7/11] Ad-hoc Shifts & Lifecycle${NC}"
SHIFT_ID=""
TODAY=$(date +%Y-%m-%d)
if [ -n "$RECIP_ID" ] && [ -n "$LOC_HOME" ] && [ -n "$LOC_WORK" ]; then
  # Create an ad-hoc shift with clean vehicle requirement
  if api POST /api/rides/shifts "{\"recipientId\":\"$RECIP_ID\",\"pickupLocationId\":\"$LOC_HOME\",\"dropoffLocationId\":\"$LOC_WORK\",\"serviceType\":\"ride\",\"date\":\"$TODAY\",\"pickupTime\":\"14:00\",\"requiresCleanVehicle\":true,\"passengerCount\":2,\"carSeatRequired\":true,\"label\":\"clinic visit\",\"notes\":\"Mom + infant with car seat\"}" 200 "$TOKEN"; then
    SHIFT_ID=$(json "d.get('data',{}).get('id','')")
    if [ -n "$SHIFT_ID" ]; then
      pass "Created ad-hoc shift (clean vehicle, 2 pax, car seat)"
    else
      fail "Shift created but no ID returned"
    fi
  else
    fail "Create ad-hoc shift"
  fi

  # Create a transit escort shift
  if api POST /api/rides/shifts "{\"recipientId\":\"$RECIP_ID\",\"pickupLocationId\":\"$LOC_HOME\",\"dropoffLocationId\":\"$LOC_WORK\",\"serviceType\":\"transit_escort\",\"date\":\"$TODAY\",\"pickupTime\":\"16:00\",\"label\":\"bus escort downtown\"}" 200 "$TOKEN"; then
    pass "Created transit escort shift"
  else
    fail "Create transit escort shift"
  fi

  # List today's shifts
  if api GET "/api/rides/shifts?from=$TODAY&to=$TODAY" "" 200 "$TOKEN"; then
    COUNT=$(json "len(d.get('data',[]))")
    if [ "$COUNT" -ge 2 ] 2>/dev/null; then
      pass "List shifts returns $COUNT shifts for today"
    else
      fail "Expected 2+ shifts, got $COUNT"
    fi
  else
    fail "List today's shifts"
  fi

  # Get single shift
  if [ -n "$SHIFT_ID" ]; then
    if api GET "/api/rides/shifts/$SHIFT_ID" "" 200 "$TOKEN"; then
      pass "GET single shift by ID"
    else
      fail "GET single shift"
    fi
  fi

  # Cancel a shift (test status transition)
  if [ -n "$SHIFT_ID" ]; then
    if api POST "/api/rides/shifts/$SHIFT_ID/cancel" "{\"reason\":\"Test cancellation\"}" 200 "$TOKEN"; then
      pass "Cancel shift with reason"
    else
      fail "Cancel shift"
    fi
  fi
else
  skip "Shift creation" "missing recipient or locations"
fi

# ---- Intake Queue ----
echo -e "\n${CYAN}[8/11] Intake Queue${NC}"
INTAKE_ID=""

# Create intake request (public endpoint)
if api POST /api/rides/intake "{\"source\":\"whatsapp\",\"rawText\":\"Need ride to perinatal care Mon/Wed 9am from Phillips neighborhood\",\"parsedData\":{\"days\":[\"mon\",\"wed\"],\"time\":\"09:00\",\"neighborhood\":\"Phillips\",\"type\":\"perinatal\"}}"; then
  INTAKE_ID=$(json "d.get('data',{}).get('id','')")
  if [ -n "$INTAKE_ID" ]; then
    pass "Created intake request from WhatsApp"
  else
    fail "Intake created but no ID"
  fi
else
  fail "Create intake request"
fi

# Create Signal intake
if api POST /api/rides/intake "{\"source\":\"signal\",\"rawText\":\"Anyone know if we can get a ride for mom+infant to Bloomington court date Thursday?\"}"; then
  pass "Created intake request from Signal"
else
  fail "Create Signal intake"
fi

# List pending intake
if api GET "/api/rides/intake?status=pending" "" 200 "$TOKEN"; then
  COUNT=$(json "len(d.get('data',[]))")
  pass "List pending intake ($COUNT requests)"
else
  fail "List pending intake"
fi

# Process intake
if [ -n "$INTAKE_ID" ]; then
  if api POST "/api/rides/intake/$INTAKE_ID/process" "{\"status\":\"processed\"}" 200 "$TOKEN"; then
    pass "Process intake request"
  else
    fail "Process intake request"
  fi
fi

# ---- Affinity Tracking ----
echo -e "\n${CYAN}[9/11] Driver-Passenger Affinity${NC}"
if [ -n "$RECIP_ID" ]; then
  # Set preferred pairing
  if api POST /api/rides/affinities/preferred "{\"driverId\":\"00000000-0000-0000-0000-000000000001\",\"recipientId\":\"$RECIP_ID\",\"preferred\":true}" 200 "$TOKEN"; then
    pass "Set preferred driver-passenger pairing"
  else
    fail "Set preferred pairing"
  fi

  # Get affinities
  if api GET "/api/rides/passengers/$RECIP_ID/affinities" "" 200 "$TOKEN"; then
    pass "Get passenger affinities"
  else
    fail "Get passenger affinities"
  fi
else
  skip "Affinity tracking" "no recipient"
fi

# ---- Referral Network ----
echo -e "\n${CYAN}[10/11] Vetted Referral Network${NC}"
PROVIDER_ID=""

# Create a provider
if api POST /api/referrals/providers "{\"category\":\"veterinary\",\"name\":\"Dr. Pet Care\",\"businessName\":\"Phillips Animal Clinic\",\"phone\":\"+16125551234\",\"address\":\"200 E Lake St, Minneapolis\",\"neighborhoods\":[\"Phillips\",\"Powderhorn\"],\"languages\":[\"en\",\"es\"],\"lowBono\":true,\"slidingScale\":true,\"specialties\":[\"small animals\",\"emergency\"]}" 200 "$TOKEN"; then
  PROVIDER_ID=$(json "d.get('data',{}).get('id','')")
  if [ -n "$PROVIDER_ID" ]; then
    pass "Created referral provider (vet, low-bono)"
  else
    fail "Provider created but no ID"
  fi
else
  fail "Create referral provider"
fi

# Create another provider (legal)
if api POST /api/referrals/providers "{\"category\":\"legal\",\"name\":\"Jane Atty\",\"businessName\":\"Community Legal Aid\",\"neighborhoods\":[\"Seward\",\"Longfellow\"],\"languages\":[\"en\",\"so\"],\"lowBono\":true,\"specialties\":[\"immigration\",\"family law\"]}" 200 "$TOKEN"; then
  pass "Created legal referral provider"
else
  fail "Create legal provider"
fi

# Create automotive provider
if api POST /api/referrals/providers "{\"category\":\"automotive\",\"name\":\"Bob Mechanic\",\"businessName\":\"Neighborhood Auto\",\"neighborhoods\":[\"Phillips\"],\"languages\":[\"en\"],\"specialties\":[\"brakes\",\"oil change\"],\"acceptsUninsured\":true}" 200 "$TOKEN"; then
  pass "Created automotive referral provider"
else
  fail "Create automotive provider"
fi

# Get single provider
if [ -n "$PROVIDER_ID" ]; then
  if api GET "/api/referrals/providers/$PROVIDER_ID" "" 200 "$TOKEN"; then
    pass "GET provider with decrypted PII"
    # Verify vouch was auto-created
    VOUCH_COUNT=$(json "d.get('data',{}).get('vouchCount',0)")
    if [ "$VOUCH_COUNT" -ge 1 ] 2>/dev/null; then
      pass "Auto-vouch created for provider creator (count=$VOUCH_COUNT)"
    else
      fail "Expected auto-vouch on creation"
    fi
  else
    fail "GET provider"
  fi
fi

# Vouch for a provider
if [ -n "$PROVIDER_ID" ]; then
  if api POST "/api/referrals/providers/$PROVIDER_ID/vouch" "{\"level\":\"personally_used\",\"notes\":\"Took my cat there, great service\"}" 200 "$TOKEN"; then
    pass "Vouch for provider (personally_used)"
  else
    fail "Vouch for provider"
  fi
fi

# Search the directory
if api GET "/api/referrals/search?category=veterinary" "" 200 "$TOKEN"; then
  COUNT=$(json "len(d.get('data',[]))")
  pass "Search by category: veterinary ($COUNT results)"
else
  fail "Search by category"
fi

if api GET "/api/referrals/search?neighborhood=Phillips" "" 200 "$TOKEN"; then
  COUNT=$(json "len(d.get('data',[]))")
  pass "Search by neighborhood: Phillips ($COUNT results)"
else
  fail "Search by neighborhood"
fi

if api GET "/api/referrals/search?query=immigration" "" 200 "$TOKEN"; then
  COUNT=$(json "len(d.get('data',[]))")
  pass "Search by text: immigration ($COUNT results)"
else
  fail "Search by text"
fi

if api GET "/api/referrals/search?lowBono=true" "" 200 "$TOKEN"; then
  COUNT=$(json "len(d.get('data',[]))")
  pass "Search by low-bono flag ($COUNT results)"
else
  fail "Search by low-bono"
fi

# List all providers
if api GET /api/referrals/providers "" 200 "$TOKEN"; then
  COUNT=$(json "len(d.get('data',[]))")
  pass "List all providers ($COUNT total)"
else
  fail "List all providers"
fi

# Referral stats
if api GET /api/referrals/stats "" 200 "$TOKEN"; then
  pass "GET referral stats"
  TOTAL=$(json "d.get('data',{}).get('totalProviders',0)")
  echo "       totalProviders=$TOTAL"
else
  fail "Referral stats"
fi

# ---- Access Controls ----
echo -e "\n${CYAN}[11/11] Access Controls${NC}"

# Unauthenticated requests should fail
if api GET /api/rides/stats "" 401; then
  pass "Ride stats rejects unauthenticated request (401)"
else
  fail "Ride stats should require auth"
fi

if api GET /api/referrals/providers "" 401; then
  pass "Referral providers rejects unauthenticated request (401)"
else
  fail "Referral providers should require auth"
fi

if api GET /api/referrals/search "" 401; then
  pass "Referral search rejects unauthenticated request (401)"
else
  fail "Referral search should require auth"
fi

# Intake is public (webhook endpoint)
if api POST /api/rides/intake "{\"source\":\"manual\",\"rawText\":\"test\"}" 200; then
  pass "Intake accepts unauthenticated request (public webhook)"
else
  fail "Intake should be public"
fi

# ---- Summary ----
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC} ($TOTAL total)"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo ""

[ "$FAIL" -eq 0 ]
