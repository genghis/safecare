#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# OSRM Pre-Build Script
#
# Downloads the full US OSM extract, slices per state with osmium,
# builds OSRM routing files for each state, uploads to GCS.
#
# Runs on a spot VM. Self-terminates on completion.
# Total time: ~2-3 hours. Cost: ~$2-4 on spot pricing.
# ---------------------------------------------------------------------------

exec > >(tee -a /var/log/osrm-build.log) 2>&1

START_TIME=$(date +%s)
BUILD_DATE=$(date -u +%Y-%m-%d)
WORK="/build"
PARALLEL=2

# Get bucket from instance metadata
BUCKET=$(curl -sf "http://metadata.google.internal/computeMetadata/v1/instance/attributes/bucket" \
  -H "Metadata-Flavor: Google" 2>/dev/null || echo "safecare-maps-osrm")

echo "============================================"
echo "  OSRM Pre-Build"
echo "  Date: $BUILD_DATE"
echo "  Bucket: gs://$BUCKET"
echo "  Parallel jobs: $PARALLEL"
echo "============================================"

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------

echo "[1/6] Installing dependencies..."
apt-get update -qq
apt-get install -y -qq docker.io osmium-tool python3 bc curl > /dev/null
systemctl start docker

echo "  Pulling OSRM Docker image..."
docker pull osrm/osrm-backend:latest 2>/dev/null

# ---------------------------------------------------------------------------
# State definitions
# ---------------------------------------------------------------------------

declare -A STATES=(
  ["alabama"]="30.2,-88.5,35.0,-84.9"
  ["alaska"]="51.2,-179.2,71.4,-129.6"
  ["arizona"]="31.3,-114.8,37.0,-109.0"
  ["arkansas"]="33.0,-94.6,36.5,-89.6"
  ["california"]="32.5,-124.4,42.0,-114.1"
  ["colorado"]="37.0,-109.1,41.0,-102.0"
  ["connecticut"]="41.0,-73.7,42.1,-71.8"
  ["delaware"]="38.5,-75.8,39.8,-75.0"
  ["district-of-columbia"]="38.8,-77.1,39.0,-76.9"
  ["florida"]="24.5,-87.6,31.0,-80.0"
  ["georgia"]="30.4,-85.6,35.0,-80.8"
  ["hawaii"]="18.9,-160.2,22.2,-154.8"
  ["idaho"]="42.0,-117.2,49.0,-111.0"
  ["illinois"]="37.0,-91.5,42.5,-87.0"
  ["indiana"]="37.8,-88.1,41.8,-84.8"
  ["iowa"]="40.4,-96.6,43.5,-90.1"
  ["kansas"]="37.0,-102.1,40.0,-94.6"
  ["kentucky"]="36.5,-89.6,39.1,-82.0"
  ["louisiana"]="29.0,-94.0,33.0,-89.0"
  ["maine"]="43.1,-71.1,47.5,-66.9"
  ["maryland"]="38.0,-79.5,39.7,-75.0"
  ["massachusetts"]="41.2,-73.5,42.9,-69.9"
  ["michigan"]="41.7,-90.4,48.3,-82.4"
  ["minnesota"]="43.5,-97.2,49.4,-89.5"
  ["mississippi"]="30.2,-91.7,35.0,-88.1"
  ["missouri"]="36.0,-95.8,40.6,-89.1"
  ["montana"]="44.4,-116.1,49.0,-104.0"
  ["nebraska"]="40.0,-104.1,43.0,-95.3"
  ["nevada"]="35.0,-120.0,42.0,-114.0"
  ["new-hampshire"]="42.7,-72.6,45.3,-71.0"
  ["new-jersey"]="38.9,-75.6,41.4,-73.9"
  ["new-mexico"]="31.3,-109.1,37.0,-103.0"
  ["new-york"]="40.5,-79.8,45.0,-71.9"
  ["north-carolina"]="33.8,-84.3,36.6,-75.5"
  ["north-dakota"]="45.9,-104.1,49.0,-96.6"
  ["ohio"]="38.4,-84.8,42.0,-80.5"
  ["oklahoma"]="33.6,-103.0,37.0,-94.4"
  ["oregon"]="41.9,-124.6,46.3,-116.5"
  ["pennsylvania"]="39.7,-80.5,42.3,-75.0"
  ["rhode-island"]="41.1,-71.9,42.0,-71.1"
  ["south-carolina"]="32.0,-83.4,35.2,-78.5"
  ["south-dakota"]="42.5,-104.1,46.0,-96.4"
  ["tennessee"]="35.0,-90.3,36.7,-81.6"
  ["texas"]="25.8,-106.6,36.5,-93.5"
  ["utah"]="37.0,-114.1,42.0,-109.0"
  ["vermont"]="42.7,-73.4,45.0,-71.5"
  ["virginia"]="36.5,-83.7,39.5,-75.2"
  ["washington"]="45.5,-124.8,49.0,-116.9"
  ["west-virginia"]="37.2,-82.6,40.6,-77.7"
  ["wisconsin"]="42.5,-92.9,47.1,-86.8"
  ["wyoming"]="41.0,-111.1,45.0,-104.1"
)

# ---------------------------------------------------------------------------
# Download full US PBF
# ---------------------------------------------------------------------------

mkdir -p "$WORK/states" "$WORK/output/us"
US_PBF="$WORK/us-latest.osm.pbf"

echo "[2/6] Downloading US OSM extract..."
if [ ! -f "$US_PBF" ]; then
  curl -L -s -o "$US_PBF" \
    "https://download.geofabrik.de/north-america/us-latest.osm.pbf"
fi
echo "  Size: $(du -h "$US_PBF" | cut -f1)"

# ---------------------------------------------------------------------------
# Slice per state with osmium
# ---------------------------------------------------------------------------

echo "[3/6] Slicing into ${#STATES[@]} state extracts with osmium..."

for state in "${!STATES[@]}"; do
  if [ -f "$WORK/states/${state}.osm.pbf" ]; then
    continue
  fi

  IFS=',' read -r south west north east <<< "${STATES[$state]}"

  osmium extract -b "$west,$south,$east,$north" \
    "$US_PBF" -o "$WORK/states/${state}.osm.pbf" --overwrite &

  # Limit parallel osmium jobs
  if (( $(jobs -r | wc -l) >= PARALLEL )); then
    wait -n
  fi
done
wait

echo "  $(ls "$WORK/states/"*.osm.pbf | wc -l) states extracted."

# ---------------------------------------------------------------------------
# Build OSRM for each state
# ---------------------------------------------------------------------------

echo "[4/6] Building OSRM routing data..."

process_state() {
  local state="$1"
  local pbf="$WORK/states/${state}.osm.pbf"
  local osrm_dir="$WORK/osrm-${state}"
  local archive="$WORK/output/us/${state}-osrm.tar.gz"

  if [ -f "$archive" ]; then
    echo "  [$state] exists, skipping"
    return
  fi

  mkdir -p "$osrm_dir"
  cp "$pbf" "$osrm_dir/data.osm.pbf"

  echo "  [$state] extracting..."
  docker run --rm -v "$osrm_dir:/data" osrm/osrm-backend:latest \
    osrm-extract -p /opt/car.lua /data/data.osm.pbf -t 4 2>/dev/null

  echo "  [$state] partitioning..."
  docker run --rm -v "$osrm_dir:/data" osrm/osrm-backend:latest \
    osrm-partition /data/data.osrm 2>/dev/null

  echo "  [$state] customizing..."
  docker run --rm -v "$osrm_dir:/data" osrm/osrm-backend:latest \
    osrm-customize /data/data.osrm 2>/dev/null

  # Remove PBF from output
  rm -f "$osrm_dir/data.osm.pbf"

  # Package OSRM files
  echo "  [$state] packaging..."
  tar -czf "$archive" -C "$osrm_dir" .

  rm -rf "$osrm_dir"

  local size_mb=$(echo "scale=1; $(stat -c%s "$archive") / 1048576" | bc)
  echo "  [$state] done: ${size_mb} MB"

  # Upload immediately so data is available before the full build finishes
  gsutil -q cp "$archive" "gs://$BUCKET/us/${state}-osrm.tar.gz" 2>/dev/null &
  local pbf_dest="$WORK/output/us/${state}-nominatim.pbf"
  if [ ! -f "$pbf_dest" ]; then
    cp "$WORK/states/${state}.osm.pbf" "$pbf_dest"
  fi
  gsutil -q cp "$pbf_dest" "gs://$BUCKET/us/${state}-nominatim.pbf" 2>/dev/null &
}

for state in "${!STATES[@]}"; do
  process_state "$state" &

  if (( $(jobs -r | wc -l) >= PARALLEL )); then
    wait -n
  fi
done
wait

echo "  All states processed."

# ---------------------------------------------------------------------------
# Process metro areas (cross-border routing)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
METROS_FILE="${SCRIPT_DIR}/metros.json"

if [ -f "$METROS_FILE" ] && command -v python3 &>/dev/null; then
  echo "[4b/6] Processing metro area OSRM data..."
  mkdir -p "$WORK/metros"

  # Extract metro PBFs from the full US PBF
  python3 -c "
import json, subprocess, os

with open('$METROS_FILE') as f:
    metros = json.load(f)['metros']

for m in metros:
    metro_id = m['id']
    south, west, north, east = m['bounds']
    pbf = f'$WORK/metros/{metro_id}.osm.pbf'

    if os.path.exists(pbf):
        continue

    print(f'  Extracting {metro_id}...')
    subprocess.run([
        'osmium', 'extract', '-b', f'{west},{south},{east},{north}',
        '$US_PBF', '-o', pbf, '--overwrite'
    ], check=True, capture_output=True)
"

  # Build OSRM for each metro
  process_metro() {
    local metro_id="$1"
    local pbf="$WORK/metros/${metro_id}.osm.pbf"
    local osrm_dir="$WORK/osrm-metro-${metro_id}"
    local archive="$WORK/output/us/metro-${metro_id}-osrm.tar.gz"

    if [ -f "$archive" ]; then
      echo "  [metro:$metro_id] exists, skipping"
      return
    fi

    if [ ! -f "$pbf" ]; then
      echo "  [metro:$metro_id] no PBF, skipping"
      return
    fi

    mkdir -p "$osrm_dir"
    cp "$pbf" "$osrm_dir/data.osm.pbf"

    echo "  [metro:$metro_id] extracting..."
    docker run --rm -v "$osrm_dir:/data" osrm/osrm-backend:latest \
      osrm-extract -p /opt/car.lua /data/data.osm.pbf -t 4 2>/dev/null

    echo "  [metro:$metro_id] partitioning..."
    docker run --rm -v "$osrm_dir:/data" osrm/osrm-backend:latest \
      osrm-partition /data/data.osrm 2>/dev/null

    echo "  [metro:$metro_id] customizing..."
    docker run --rm -v "$osrm_dir:/data" osrm/osrm-backend:latest \
      osrm-customize /data/data.osrm 2>/dev/null

    rm -f "$osrm_dir/data.osm.pbf"

    echo "  [metro:$metro_id] packaging..."
    tar -czf "$archive" -C "$osrm_dir" .
    rm -rf "$osrm_dir"

    local size_mb=$(echo "scale=1; $(stat -c%s "$archive") / 1048576" | bc)
    echo "  [metro:$metro_id] done: ${size_mb} MB"

    # Upload immediately
    gsutil -q cp "$archive" "gs://$BUCKET/us/metro-${metro_id}-osrm.tar.gz" 2>/dev/null &
  }

  # Get metro IDs from JSON
  METRO_IDS=$(python3 -c "
import json
with open('$METROS_FILE') as f:
    for m in json.load(f)['metros']:
        print(m['id'])
")

  for metro_id in $METRO_IDS; do
    process_metro "$metro_id" &
    if (( $(jobs -r | wc -l) >= PARALLEL )); then
      wait -n
    fi
  done
  wait

  # Also store metro PBFs for local Nominatim import
  for metro_id in $METRO_IDS; do
    pbf="$WORK/metros/${metro_id}.osm.pbf"
    dest="$WORK/output/us/metro-${metro_id}-nominatim.pbf"
    if [ -f "$pbf" ] && [ ! -f "$dest" ]; then
      cp "$pbf" "$dest"
    fi
  done

  echo "  All metros processed."
else
  echo "[4b/6] Skipping metros (metros.json not found or python3 not available)"
fi

# ---------------------------------------------------------------------------
# Also store per-state PBFs (for Nominatim local import)
# ---------------------------------------------------------------------------

echo "[5/6] Storing state PBFs for Nominatim..."

for state in "${!STATES[@]}"; do
  pbf="$WORK/states/${state}.osm.pbf"
  dest="$WORK/output/us/${state}-nominatim.pbf"

  if [ ! -f "$dest" ]; then
    cp "$pbf" "$dest"
  fi
done

# ---------------------------------------------------------------------------
# Intermediate upload — OSRM + PBFs are ready, publish manifest now
# TIGER will be added in a second pass
# ---------------------------------------------------------------------------

echo "[5a/6] Publishing intermediate manifest (OSRM + PBFs ready, TIGER pending)..."
# Generate and upload manifest without TIGER — deployments can start now
WORK="$WORK" BUCKET="$BUCKET" BUILD_DATE="$BUILD_DATE" python3 << 'PYEOF_INTERIM'
import os, json
work = os.environ["WORK"]
bucket = os.environ["BUCKET"]
build_date = os.environ["BUILD_DATE"]
# Quick manifest with just OSRM + PBF (no TIGER yet)
regions = []
for f in sorted(os.listdir(f"{work}/output/us")):
    if f.endswith("-osrm.tar.gz"):
        rid = f.replace("-osrm.tar.gz", "")
        osrm_size = os.path.getsize(f"{work}/output/us/{f}")
        pbf_f = f"{rid}-nominatim.pbf"
        pbf_size = os.path.getsize(f"{work}/output/us/{pbf_f}") if os.path.exists(f"{work}/output/us/{pbf_f}") else 0
        name = rid.replace("metro-", "").replace("-", " ").title()
        if rid.startswith("metro-"):
            name = name + " Metro"
        regions.append({
            "id": rid, "name": name,
            "type": "metro" if rid.startswith("metro-") else "state",
            "bounds": {"south": 0, "west": 0, "north": 0, "east": 0},
            "osrmUrl": f"/us/{f}", "osrmSize": osrm_size,
            "pbfUrl": f"/us/{pbf_f}" if pbf_size > 0 else "",
            "pbfSize": pbf_size, "pbfDate": build_date,
        })
manifest = {"version": 2, "updated": build_date,
    "baseUrl": f"https://storage.googleapis.com/{bucket}",
    "description": "Pre-built OSRM + PBFs (TIGER pending)",
    "regions": sorted(regions, key=lambda r: r["name"])}
with open(f"{work}/output/manifest.json", "w") as fh:
    json.dump(manifest, fh, indent=2)
print(f"Interim manifest: {len(regions)} regions")
PYEOF_INTERIM

gsutil -q cp "$WORK/output/manifest.json" "gs://$BUCKET/manifest.json"
echo "  Manifest published. Deployments can start downloading OSRM + PBFs."

# ---------------------------------------------------------------------------
# Pre-process TIGER address data
# ---------------------------------------------------------------------------

echo "[5b/6] Pre-processing TIGER address data per state..."
TIGER_RAW="$WORK/tiger-raw"
TIGER_OUT="$WORK/output/tiger"

if [ ! -d "$TIGER_OUT" ]; then
  mkdir -p "$TIGER_RAW" "$TIGER_OUT"

  # Download TIGER address files from Census Bureau
  echo "  Downloading TIGER address files from Census Bureau..."
  TIGER_YEAR=2023
  TIGER_URL="https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}/ADDR"

  # Use Nominatim's built-in TIGER preprocessor
  # It downloads, converts to CSV, and produces nominatim-ready files
  docker run --rm \
    -v "$TIGER_RAW:/tiger-raw" \
    -v "$TIGER_OUT:/tiger-out" \
    mediagis/nominatim:4.4 \
    bash -c '
      set -e
      cd /tiger-raw

      # Download all TIGER address files
      YEAR=2023
      BASE="https://www2.census.gov/geo/tiger/TIGER${YEAR}/ADDR"

      echo "Fetching file list..."
      curl -sf "$BASE/" | grep -oP "tl_${YEAR}_\d+_addr\.zip" | sort -u > filelist.txt
      TOTAL=$(wc -l < filelist.txt)
      echo "Downloading $TOTAL TIGER files..."

      COUNT=0
      while read f; do
        COUNT=$((COUNT + 1))
        if [ ! -f "$f" ]; then
          curl -sf -O "$BASE/$f" 2>/dev/null || true
        fi
        if [ $((COUNT % 500)) -eq 0 ]; then
          echo "  Downloaded $COUNT / $TOTAL"
        fi
      done < filelist.txt
      echo "  Downloaded $COUNT TIGER files"

      # Use Nominatim tiger-line import preprocessor to generate CSVs
      echo "Preprocessing TIGER data..."
      if command -v nominatim-tiger &>/dev/null; then
        nominatim-tiger /tiger-raw /tiger-out
      else
        # Manual preprocessing: just package the zips per state FIPS code
        # State FIPS codes are the first 2 digits of the county FIPS in the filename
        for zip in /tiger-raw/tl_*.zip; do
          fname=$(basename "$zip")
          # Extract 5-digit FIPS, first 2 = state
          fips=$(echo "$fname" | grep -oP "\d{5}" | head -1)
          state_fips=${fips:0:2}
          mkdir -p "/tiger-out/$state_fips"
          cp "$zip" "/tiger-out/$state_fips/"
        done
      fi
      echo "Done preprocessing TIGER data"
    ' 2>&1

  # Package per-state TIGER data
  echo "  Packaging per-state TIGER archives..."

  # FIPS to state mapping
  declare -A FIPS_TO_STATE=(
    [01]=alabama [02]=alaska [04]=arizona [05]=arkansas [06]=california
    [08]=colorado [09]=connecticut [10]=delaware [11]=district-of-columbia
    [12]=florida [13]=georgia [15]=hawaii [16]=idaho [17]=illinois
    [18]=indiana [19]=iowa [20]=kansas [21]=kentucky [22]=louisiana
    [23]=maine [24]=maryland [25]=massachusetts [26]=michigan [27]=minnesota
    [28]=mississippi [29]=missouri [30]=montana [31]=nebraska [32]=nevada
    [33]=new-hampshire [34]=new-jersey [35]=new-mexico [36]=new-york
    [37]=north-carolina [38]=north-dakota [39]=ohio [40]=oklahoma
    [41]=oregon [42]=pennsylvania [44]=rhode-island [45]=south-carolina
    [46]=south-dakota [47]=tennessee [48]=texas [49]=utah [50]=vermont
    [51]=virginia [53]=washington [54]=west-virginia [55]=wisconsin
    [56]=wyoming
  )

  for fips_dir in "$TIGER_OUT"/*/; do
    fips=$(basename "$fips_dir")
    state="${FIPS_TO_STATE[$fips]:-}"
    if [ -n "$state" ] && [ -d "$fips_dir" ]; then
      tiger_archive="$WORK/output/us/${state}-tiger.tar.gz"
      if [ ! -f "$tiger_archive" ]; then
        tar -czf "$tiger_archive" -C "$fips_dir" .
        size_mb=$(echo "scale=1; $(stat -c%s "$tiger_archive" 2>/dev/null || stat -f%z "$tiger_archive") / 1048576" | bc)
        echo "  $state: ${size_mb} MB"
      fi
    fi
  done

  rm -rf "$TIGER_RAW"
  echo "  TIGER preprocessing complete."
else
  echo "  TIGER data already processed, skipping."
fi

# ---------------------------------------------------------------------------
# Generate manifest
# ---------------------------------------------------------------------------

echo "[5.5/6] Generating manifest.json..."

python3 << 'PYEOF'
import os, json

work = os.environ.get("WORK", "/build")
bucket = os.environ.get("BUCKET", "safecare-maps-osrm")
build_date = os.environ.get("BUILD_DATE", "unknown")

states_raw = """alabama=30.2,-88.5,35.0,-84.9
alaska=51.2,-179.2,71.4,-129.6
arizona=31.3,-114.8,37.0,-109.0
arkansas=33.0,-94.6,36.5,-89.6
california=32.5,-124.4,42.0,-114.1
colorado=37.0,-109.1,41.0,-102.0
connecticut=41.0,-73.7,42.1,-71.8
delaware=38.5,-75.8,39.8,-75.0
district-of-columbia=38.8,-77.1,39.0,-76.9
florida=24.5,-87.6,31.0,-80.0
georgia=30.4,-85.6,35.0,-80.8
hawaii=18.9,-160.2,22.2,-154.8
idaho=42.0,-117.2,49.0,-111.0
illinois=37.0,-91.5,42.5,-87.0
indiana=37.8,-88.1,41.8,-84.8
iowa=40.4,-96.6,43.5,-90.1
kansas=37.0,-102.1,40.0,-94.6
kentucky=36.5,-89.6,39.1,-82.0
louisiana=29.0,-94.0,33.0,-89.0
maine=43.1,-71.1,47.5,-66.9
maryland=38.0,-79.5,39.7,-75.0
massachusetts=41.2,-73.5,42.9,-69.9
michigan=41.7,-90.4,48.3,-82.4
minnesota=43.5,-97.2,49.4,-89.5
mississippi=30.2,-91.7,35.0,-88.1
missouri=36.0,-95.8,40.6,-89.1
montana=44.4,-116.1,49.0,-104.0
nebraska=40.0,-104.1,43.0,-95.3
nevada=35.0,-120.0,42.0,-114.0
new-hampshire=42.7,-72.6,45.3,-71.0
new-jersey=38.9,-75.6,41.4,-73.9
new-mexico=31.3,-109.1,37.0,-103.0
new-york=40.5,-79.8,45.0,-71.9
north-carolina=33.8,-84.3,36.6,-75.5
north-dakota=45.9,-104.1,49.0,-96.6
ohio=38.4,-84.8,42.0,-80.5
oklahoma=33.6,-103.0,37.0,-94.4
oregon=41.9,-124.6,46.3,-116.5
pennsylvania=39.7,-80.5,42.3,-75.0
rhode-island=41.1,-71.9,42.0,-71.1
south-carolina=32.0,-83.4,35.2,-78.5
south-dakota=42.5,-104.1,46.0,-96.4
tennessee=35.0,-90.3,36.7,-81.6
texas=25.8,-106.6,36.5,-93.5
utah=37.0,-114.1,42.0,-109.0
vermont=42.7,-73.4,45.0,-71.5
virginia=36.5,-83.7,39.5,-75.2
washington=45.5,-124.8,49.0,-116.9
west-virginia=37.2,-82.6,40.6,-77.7
wisconsin=42.5,-92.9,47.1,-86.8
wyoming=41.0,-111.1,45.0,-104.1"""

regions = []
for line in states_raw.strip().split("\n"):
    state, bbox = line.split("=")
    south, west, north, east = [float(x) for x in bbox.split(",")]

    osrm_path = f"{work}/output/us/{state}-osrm.tar.gz"
    pbf_path = f"{work}/output/us/{state}-nominatim.pbf"

    if not os.path.exists(osrm_path):
        continue

    osrm_size = os.path.getsize(osrm_path)
    pbf_size = os.path.getsize(pbf_path) if os.path.exists(pbf_path) else 0
    tiger_path = f"{work}/output/us/{state}-tiger.tar.gz"
    tiger_size = os.path.getsize(tiger_path) if os.path.exists(tiger_path) else 0
    name = state.replace("-", " ").title()

    entry = {
        "id": state,
        "name": name,
        "bounds": {"south": south, "west": west, "north": north, "east": east},
        "osrmUrl": f"/us/{state}-osrm.tar.gz",
        "osrmSize": osrm_size,
        "pbfUrl": f"/us/{state}-nominatim.pbf",
        "pbfSize": pbf_size,
        "pbfDate": build_date,
    }
    if tiger_size > 0:
        entry["tigerUrl"] = f"/us/{state}-tiger.tar.gz"
        entry["tigerSize"] = tiger_size
    regions.append(entry)

# Add metro areas
metros_file = os.path.join(os.path.dirname(os.path.abspath("$0")), "metros.json")
# Try multiple paths for metros.json
for mpath in ["$SCRIPT_DIR/metros.json", "/build/metros.json", "metros.json"]:
    if os.path.exists(mpath):
        metros_file = mpath
        break

metros = []
if os.path.exists(metros_file):
    with open(metros_file) as f:
        metros = json.load(f).get("metros", [])

for m in metros:
    metro_id = m["id"]
    south, west, north, east = m["bounds"]

    osrm_path = f"{work}/output/us/metro-{metro_id}-osrm.tar.gz"
    pbf_path = f"{work}/output/us/metro-{metro_id}-nominatim.pbf"

    if not os.path.exists(osrm_path):
        continue

    osrm_size = os.path.getsize(osrm_path)
    pbf_size = os.path.getsize(pbf_path) if os.path.exists(pbf_path) else 0

    regions.append({
        "id": f"metro-{metro_id}",
        "name": m["name"],
        "type": "metro",
        "bounds": {"south": south, "west": west, "north": north, "east": east},
        "osrmUrl": f"/us/metro-{metro_id}-osrm.tar.gz",
        "osrmSize": osrm_size,
        "pbfUrl": f"/us/metro-{metro_id}-nominatim.pbf",
        "pbfSize": pbf_size,
        "pbfDate": build_date,
    })

manifest = {
    "version": 2,
    "updated": build_date,
    "baseUrl": f"https://storage.googleapis.com/{bucket}",
    "description": "Pre-built OSRM routing + Nominatim PBFs for US states and metro areas",
    "regions": sorted(regions, key=lambda r: r["name"]),
}

out_path = f"{work}/output/manifest.json"
with open(out_path, "w") as f:
    json.dump(manifest, f, indent=2)

state_regions = [r for r in regions if r.get("type") != "metro"]
metro_regions = [r for r in regions if r.get("type") == "metro"]
total_osrm = sum(r["osrmSize"] for r in regions) / 1024 / 1024 / 1024
total_pbf = sum(r["pbfSize"] for r in regions) / 1024 / 1024 / 1024
print(f"Manifest: {len(state_regions)} states + {len(metro_regions)} metros")
print(f"Total OSRM: {total_osrm:.1f} GB")
print(f"Total PBF:  {total_pbf:.1f} GB")
PYEOF

# ---------------------------------------------------------------------------
# Upload to GCS
# ---------------------------------------------------------------------------

echo "[6/6] Uploading to gs://$BUCKET/..."
gsutil -m -q rsync -r "$WORK/output/" "gs://$BUCKET/"

ELAPSED=$(( $(date +%s) - START_TIME ))
HOURS=$(( ELAPSED / 3600 ))
MINS=$(( (ELAPSED % 3600) / 60 ))

echo ""
echo "============================================"
echo "  Build complete!"
echo "  Time: ${HOURS}h ${MINS}m"
echo "  Manifest: https://storage.googleapis.com/$BUCKET/manifest.json"
echo "============================================"

# Self-terminate
shutdown -h now
