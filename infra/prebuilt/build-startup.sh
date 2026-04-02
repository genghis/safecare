#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# SafeCare Map Builder — VM Startup Script
#
# Downloads the full US OSM extract, slices it per state, builds
# Nominatim + OSRM indexes for each, uploads to GCS, shuts down.
#
# Runs on a spot VM (c2-standard-30: 30 vCPUs, 120 GB RAM).
# Total wall time: ~3-4 hours. Cost: ~$2-5 on spot pricing.
# ---------------------------------------------------------------------------

BUCKET="safecare-maps-maps"  # will be overridden by metadata
WORK_DIR="/mnt/stateful_partition/build"
PARALLEL_JOBS=6  # Number of states to process in parallel
BUILD_DATE=$(date -u +%Y-%m-%d)
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:v6.0.0"

# Get bucket name from instance metadata
BUCKET=$(curl -s "http://metadata.google.internal/computeMetadata/v1/instance/attributes/bucket" -H "Metadata-Flavor: Google" 2>/dev/null || echo "$BUCKET")

echo "=========================================="
echo "  SafeCare Map Builder"
echo "  Date: $BUILD_DATE"
echo "  Bucket: $BUCKET"
echo "=========================================="

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# ---------------------------------------------------------------------------
# Install tools (Container-Optimized OS uses Docker)
# ---------------------------------------------------------------------------

echo "[1/6] Pulling Docker images..."
docker pull "$OSRM_IMAGE" &
docker pull mediagis/nominatim:4.4 &
docker pull ghcr.io/osmcode/osmium-tool:latest &
wait

# ---------------------------------------------------------------------------
# Download full US PBF
# ---------------------------------------------------------------------------

US_PBF="$WORK_DIR/us-latest.osm.pbf"

if [ ! -f "$US_PBF" ]; then
  echo "[2/6] Downloading full US OSM extract (~10 GB)..."
  curl -L -o "$US_PBF" "https://download.geofabrik.de/north-america/us-latest.osm.pbf"
  echo "  Downloaded: $(ls -lh "$US_PBF" | awk '{print $5}')"
else
  echo "[2/6] US PBF already exists, skipping download."
fi

# ---------------------------------------------------------------------------
# State definitions: id=south,west,north,east
# ---------------------------------------------------------------------------

STATES=(
  "alabama=30.2,-88.5,35.0,-84.9"
  "alaska=51.2,-179.2,71.4,-129.6"
  "arizona=31.3,-114.8,37.0,-109.0"
  "arkansas=33.0,-94.6,36.5,-89.6"
  "california=32.5,-124.4,42.0,-114.1"
  "colorado=37.0,-109.1,41.0,-102.0"
  "connecticut=41.0,-73.7,42.1,-71.8"
  "delaware=38.5,-75.8,39.8,-75.0"
  "district-of-columbia=38.8,-77.1,39.0,-76.9"
  "florida=24.5,-87.6,31.0,-80.0"
  "georgia=30.4,-85.6,35.0,-80.8"
  "hawaii=18.9,-160.2,22.2,-154.8"
  "idaho=42.0,-117.2,49.0,-111.0"
  "illinois=37.0,-91.5,42.5,-87.0"
  "indiana=37.8,-88.1,41.8,-84.8"
  "iowa=40.4,-96.6,43.5,-90.1"
  "kansas=37.0,-102.1,40.0,-94.6"
  "kentucky=36.5,-89.6,39.1,-82.0"
  "louisiana=29.0,-94.0,33.0,-89.0"
  "maine=43.1,-71.1,47.5,-66.9"
  "maryland=38.0,-79.5,39.7,-75.0"
  "massachusetts=41.2,-73.5,42.9,-69.9"
  "michigan=41.7,-90.4,48.3,-82.4"
  "minnesota=43.5,-97.2,49.4,-89.5"
  "mississippi=30.2,-91.7,35.0,-88.1"
  "missouri=36.0,-95.8,40.6,-89.1"
  "montana=44.4,-116.1,49.0,-104.0"
  "nebraska=40.0,-104.1,43.0,-95.3"
  "nevada=35.0,-120.0,42.0,-114.0"
  "new-hampshire=42.7,-72.6,45.3,-71.0"
  "new-jersey=38.9,-75.6,41.4,-73.9"
  "new-mexico=31.3,-109.1,37.0,-103.0"
  "new-york=40.5,-79.8,45.0,-71.9"
  "north-carolina=33.8,-84.3,36.6,-75.5"
  "north-dakota=45.9,-104.1,49.0,-96.6"
  "ohio=38.4,-84.8,42.0,-80.5"
  "oklahoma=33.6,-103.0,37.0,-94.4"
  "oregon=41.9,-124.6,46.3,-116.5"
  "pennsylvania=39.7,-80.5,42.3,-75.0"
  "rhode-island=41.1,-71.9,42.0,-71.1"
  "south-carolina=32.0,-83.4,35.2,-78.5"
  "south-dakota=42.5,-104.1,46.0,-96.4"
  "tennessee=35.0,-90.3,36.7,-81.6"
  "texas=25.8,-106.6,36.5,-93.5"
  "utah=37.0,-114.1,42.0,-109.0"
  "vermont=42.7,-73.4,45.0,-71.5"
  "virginia=36.5,-83.7,39.5,-75.2"
  "washington=45.5,-124.8,49.0,-116.9"
  "west-virginia=37.2,-82.6,40.6,-77.7"
  "wisconsin=42.5,-92.9,47.1,-86.8"
  "wyoming=41.0,-111.1,45.0,-104.1"
)

# ---------------------------------------------------------------------------
# Slice US PBF into per-state extracts
# ---------------------------------------------------------------------------

echo "[3/6] Slicing US PBF into ${#STATES[@]} state extracts..."
mkdir -p "$WORK_DIR/states"

for entry in "${STATES[@]}"; do
  state="${entry%%=*}"
  bbox="${entry#*=}"
  state_pbf="$WORK_DIR/states/${state}.osm.pbf"

  if [ -f "$state_pbf" ]; then
    continue
  fi

  IFS=',' read -r south west north east <<< "$bbox"
  echo "  Extracting $state ($bbox)..."
  docker run --rm \
    -v "$WORK_DIR:/data" \
    ghcr.io/osmcode/osmium-tool:latest \
    osmium extract -b "$west,$south,$east,$north" \
    /data/us-latest.osm.pbf -o "/data/states/${state}.osm.pbf" --overwrite &

  # Limit parallel extracts to avoid OOM
  if (( $(jobs -r | wc -l) >= PARALLEL_JOBS )); then
    wait -n
  fi
done
wait
echo "  Done. $(ls "$WORK_DIR/states/" | wc -l) state extracts created."

# ---------------------------------------------------------------------------
# Process each state: OSRM + package
# ---------------------------------------------------------------------------

echo "[4/6] Processing OSRM routing data for each state..."
mkdir -p "$WORK_DIR/output/us"

process_state() {
  local state="$1"
  local state_pbf="$WORK_DIR/states/${state}.osm.pbf"
  local output_dir="$WORK_DIR/processing/${state}"
  local archive="$WORK_DIR/output/us/${state}.tar.gz"

  if [ -f "$archive" ]; then
    echo "  [$state] Archive exists, skipping."
    return
  fi

  mkdir -p "$output_dir/osrm" "$output_dir/nominatim"
  cp "$state_pbf" "$output_dir/osrm/data.osm.pbf"

  echo "  [$state] OSRM extract..."
  docker run --rm -v "$output_dir/osrm:/data" "$OSRM_IMAGE" \
    osrm-extract -p /opt/car.lua /data/data.osm.pbf -t 4 2>/dev/null

  echo "  [$state] OSRM partition..."
  docker run --rm -v "$output_dir/osrm:/data" "$OSRM_IMAGE" \
    osrm-partition /data/data.osrm 2>/dev/null

  echo "  [$state] OSRM customize..."
  docker run --rm -v "$output_dir/osrm:/data" "$OSRM_IMAGE" \
    osrm-customize /data/data.osrm 2>/dev/null

  # Remove the PBF from OSRM output (not needed, saves space)
  rm -f "$output_dir/osrm/data.osm.pbf"

  # Copy PBF for Nominatim (local deployments will import this)
  cp "$state_pbf" "$output_dir/nominatim/data.osm.pbf"

  echo "  [$state] Packaging..."
  tar -czf "$archive" -C "$output_dir" osrm nominatim

  # Cleanup processing dir
  rm -rf "$output_dir"

  local size=$(stat -c%s "$archive" 2>/dev/null || stat -f%z "$archive")
  echo "  [$state] Done: $(echo "scale=1; $size/1048576" | bc) MB"
}

for entry in "${STATES[@]}"; do
  state="${entry%%=*}"
  process_state "$state" &

  if (( $(jobs -r | wc -l) >= PARALLEL_JOBS )); then
    wait -n
  fi
done
wait

echo "  All states processed."

# ---------------------------------------------------------------------------
# Generate manifest.json
# ---------------------------------------------------------------------------

echo "[5/6] Generating manifest.json..."

python3 -c "
import os, json, glob

states_data = '''$(printf '%s\n' "${STATES[@]}")'''

regions = []
for line in states_data.strip().split('\n'):
    state, bbox = line.split('=')
    south, west, north, east = [float(x) for x in bbox.split(',')]
    archive = f'output/us/{state}.tar.gz'
    full_path = f'$WORK_DIR/{archive}'

    if not os.path.exists(full_path):
        continue

    size = os.path.getsize(full_path)
    name = state.replace('-', ' ').title()

    regions.append({
        'id': state,
        'name': name,
        'bounds': {'south': south, 'west': west, 'north': north, 'east': east},
        'archiveUrl': f'/us/{state}.tar.gz',
        'archiveSize': size,
        'pbfDate': '$BUILD_DATE',
    })

manifest = {
    'version': 1,
    'updated': '$BUILD_DATE',
    'baseUrl': 'https://storage.googleapis.com/$BUCKET',
    'regions': sorted(regions, key=lambda r: r['name']),
}

with open('$WORK_DIR/output/manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)

print(f'Manifest: {len(regions)} regions')
"

# ---------------------------------------------------------------------------
# Upload to GCS
# ---------------------------------------------------------------------------

echo "[6/6] Uploading to gs://$BUCKET/..."
gsutil -m rsync -r "$WORK_DIR/output/" "gs://$BUCKET/"
echo "  Upload complete."

echo ""
echo "=========================================="
echo "  Build complete!"
echo "  Manifest: https://storage.googleapis.com/$BUCKET/manifest.json"
echo "=========================================="

# Shut down the VM
echo "Shutting down..."
shutdown -h now
