#!/bin/bash
set -e

# OSRM initialization script
# Waits for the OSM PBF file, then pre-processes it for routing.
# Uses MLD (Multi-Level Dijkstra) algorithm for fast queries.

DATA_DIR="/data"
PBF_FILE="/osm/data.osm.pbf"
OSRM_FILE="$DATA_DIR/data.osrm"

# Wait for the PBF file to appear (provisioned via Settings page)
while [ ! -f "$PBF_FILE" ] || [ ! -s "$PBF_FILE" ]; do
  echo "$(date): Waiting for map data at $PBF_FILE..."
  echo "  Set your service area in the Settings page to provision maps."
  sleep 30
done

echo "PBF file found: $(ls -lh "$PBF_FILE" | awk '{print $5}')"

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
