#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Build pre-computed map archives for all US states.
#
# This script runs on a build server (Cloud Run, VPS, or beefy local machine).
# It downloads each state's OSM extract, builds Nominatim + OSRM indexes,
# packages them as tar.gz archives, and generates a manifest.json.
#
# Usage:
#   ./tools/build-prebuilt.sh [output-dir] [state...]
#
# Examples:
#   ./tools/build-prebuilt.sh ./prebuilt                    # all states
#   ./tools/build-prebuilt.sh ./prebuilt minnesota illinois  # specific states
#
# Requirements:
#   - Docker (for Nominatim and OSRM processing)
#   - osmium-tool
#   - ~50 GB disk for all states, ~2 GB per state
#   - 4+ CPU cores, 8+ GB RAM recommended
#
# Output structure:
#   output-dir/
#     manifest.json
#     us/
#       minnesota.tar.gz
#       illinois.tar.gz
#       ...
# ---------------------------------------------------------------------------

OUTPUT_DIR="${1:-./prebuilt}"
shift || true
STATES=("$@")

GEOFABRIK_BASE="https://download.geofabrik.de/north-america/us"

# All 50 states + DC with bounding boxes [south, west, north, east]
declare -A STATE_BOUNDS=(
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

# If no states specified, build all
if [ ${#STATES[@]} -eq 0 ]; then
  STATES=("${!STATE_BOUNDS[@]}")
fi

mkdir -p "$OUTPUT_DIR/us"

echo "=========================================="
echo "  SafeCare Pre-built Map Archive Builder"
echo "=========================================="
echo ""
echo "States to build: ${#STATES[@]}"
echo "Output: $OUTPUT_DIR"
echo ""

MANIFEST_REGIONS="[]"
BUILD_DATE=$(date -u +%Y-%m-%d)

for state in "${STATES[@]}"; do
  bounds="${STATE_BOUNDS[$state]}"
  if [ -z "$bounds" ]; then
    echo "WARNING: Unknown state '$state', skipping."
    continue
  fi

  IFS=',' read -r south west north east <<< "$bounds"
  name=$(echo "$state" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
  archive="$OUTPUT_DIR/us/${state}.tar.gz"

  echo "---"
  echo "Building: $name ($state)"
  echo "Bounds: $south,$west,$north,$east"

  # Skip if already built
  if [ -f "$archive" ]; then
    echo "  Archive exists, skipping. Delete to rebuild."
    size=$(stat -f%z "$archive" 2>/dev/null || stat -c%s "$archive" 2>/dev/null)
    MANIFEST_REGIONS=$(echo "$MANIFEST_REGIONS" | python3 -c "
import sys, json
regions = json.load(sys.stdin)
regions.append({
    'id': '$state',
    'name': '$name',
    'bounds': {'south': $south, 'west': $west, 'north': $north, 'east': $east},
    'archiveUrl': '/us/${state}.tar.gz',
    'archiveSize': $size,
    'pbfDate': '$BUILD_DATE'
})
json.dump(regions, sys.stdout)
")
    continue
  fi

  WORK_DIR=$(mktemp -d)
  PBF_FILE="$WORK_DIR/data.osm.pbf"

  # 1. Download state PBF
  echo "  Downloading ${state}-latest.osm.pbf..."
  curl -L -s -o "$PBF_FILE" "$GEOFABRIK_BASE/${state}-latest.osm.pbf"

  # 2. Build OSRM
  echo "  Building OSRM routing data..."
  OSRM_DIR="$WORK_DIR/osrm"
  mkdir -p "$OSRM_DIR"
  cp "$PBF_FILE" "$OSRM_DIR/data.osm.pbf"

  docker run --rm -v "$OSRM_DIR:/data" osrm/osrm-backend:latest \
    osrm-extract -p /opt/car.lua /data/data.osm.pbf -t 4 2>/dev/null
  docker run --rm -v "$OSRM_DIR:/data" osrm/osrm-backend:latest \
    osrm-partition /data/data.osrm 2>/dev/null
  docker run --rm -v "$OSRM_DIR:/data" osrm/osrm-backend:latest \
    osrm-customize /data/data.osrm 2>/dev/null
  rm -f "$OSRM_DIR/data.osm.pbf"

  # 3. Build Nominatim (using the PBF directly -- import happens in container)
  echo "  Building Nominatim search index..."
  NOM_DIR="$WORK_DIR/nominatim"
  mkdir -p "$NOM_DIR"
  # Nominatim needs a running PostgreSQL -- use docker compose or a temp container
  # For simplicity, just include the PBF and let each deployment import it
  # (pre-built Nominatim DB export is complex; PBF is simpler)
  cp "$PBF_FILE" "$NOM_DIR/data.osm.pbf"

  # 4. Package as tar.gz
  echo "  Packaging archive..."
  tar -czf "$archive" -C "$WORK_DIR" osrm nominatim

  size=$(stat -f%z "$archive" 2>/dev/null || stat -c%s "$archive" 2>/dev/null)
  echo "  Done: $archive ($(echo "scale=1; $size/1048576" | bc) MB)"

  # 5. Add to manifest
  MANIFEST_REGIONS=$(echo "$MANIFEST_REGIONS" | python3 -c "
import sys, json
regions = json.load(sys.stdin)
regions.append({
    'id': '$state',
    'name': '$name',
    'bounds': {'south': $south, 'west': $west, 'north': $north, 'east': $east},
    'archiveUrl': '/us/${state}.tar.gz',
    'archiveSize': $size,
    'pbfDate': '$BUILD_DATE'
})
json.dump(regions, sys.stdout)
")

  # Cleanup
  rm -rf "$WORK_DIR"
done

# Write manifest
echo ""
echo "Writing manifest.json..."
echo "$MANIFEST_REGIONS" | python3 -c "
import sys, json
regions = json.load(sys.stdin)
manifest = {
    'version': 1,
    'updated': '$BUILD_DATE',
    'baseUrl': 'https://maps.safecare.dev',
    'regions': sorted(regions, key=lambda r: r['name'])
}
json.dump(manifest, sys.stdout, indent=2)
" > "$OUTPUT_DIR/manifest.json"

echo "Done! $(echo "$MANIFEST_REGIONS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))") states built."
echo "Manifest: $OUTPUT_DIR/manifest.json"
echo ""
echo "To upload to cloud storage:"
echo "  gsutil -m rsync -r $OUTPUT_DIR gs://safecare-maps/"
echo "  # or"
echo "  aws s3 sync $OUTPUT_DIR s3://safecare-maps/"
