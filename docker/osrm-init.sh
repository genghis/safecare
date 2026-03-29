#!/bin/bash
set -e

# OSRM initialization script
# Pre-processes the OSM PBF file if not already done.
# Uses MLD (Multi-Level Dijkstra) algorithm for fast queries.

DATA_DIR="/data"
PBF_FILE="/osm/data.osm.pbf"
OSRM_FILE="$DATA_DIR/data.osrm"

if [ ! -f "$PBF_FILE" ]; then
  echo "ERROR: No PBF file found at $PBF_FILE"
  echo "Make sure the Midwest OSM extract is downloaded to docker/nominatim-data/data.osm.pbf"
  exit 1
fi

# Check if already processed
if [ -f "$OSRM_FILE.cell_metrics" ]; then
  echo "OSRM data already processed. Starting server..."
else
  echo "Processing OSM data for routing (this takes 10-30 min on first run)..."
  echo "Step 1/3: Extracting road network..."
  osrm-extract -p /opt/car.lua "$PBF_FILE" -t 2
  mv /osm/data.osrm* "$DATA_DIR/" 2>/dev/null || true

  echo "Step 2/3: Partitioning graph..."
  osrm-partition "$OSRM_FILE"

  echo "Step 3/3: Customizing weights..."
  osrm-customize "$OSRM_FILE"

  echo "OSRM data processing complete!"
fi

echo "Starting OSRM routing server on port 5000..."
exec osrm-routed --algorithm mld "$OSRM_FILE" --port 5000 --max-table-size 1000
