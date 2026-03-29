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
PARALLEL=6

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
  curl -L --progress-bar -o "$US_PBF" \
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
# Also store per-state PBFs (for Nominatim local import)
# ---------------------------------------------------------------------------

echo "[5/6] Compressing state PBFs for Nominatim..."

for state in "${!STATES[@]}"; do
  pbf="$WORK/states/${state}.osm.pbf"
  dest="$WORK/output/us/${state}-nominatim.pbf"

  if [ ! -f "$dest" ]; then
    cp "$pbf" "$dest"
  fi
done

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
    name = state.replace("-", " ").title()

    regions.append({
        "id": state,
        "name": name,
        "bounds": {"south": south, "west": west, "north": north, "east": east},
        "osrmUrl": f"/us/{state}-osrm.tar.gz",
        "osrmSize": osrm_size,
        "pbfUrl": f"/us/{state}-nominatim.pbf",
        "pbfSize": pbf_size,
        "pbfDate": build_date,
    })

manifest = {
    "version": 2,
    "updated": build_date,
    "baseUrl": f"https://storage.googleapis.com/{bucket}",
    "description": "Pre-built OSRM routing data + Nominatim PBF for all US states",
    "regions": sorted(regions, key=lambda r: r["name"]),
}

out_path = f"{work}/output/manifest.json"
with open(out_path, "w") as f:
    json.dump(manifest, f, indent=2)

total_osrm = sum(r["osrmSize"] for r in regions) / 1024 / 1024 / 1024
total_pbf = sum(r["pbfSize"] for r in regions) / 1024 / 1024 / 1024
print(f"Manifest: {len(regions)} states")
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
