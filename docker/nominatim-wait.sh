#!/bin/bash
# Nominatim entrypoint wrapper
# Waits for the PBF file to appear before starting the import.

PBF_FILE="/nominatim/data.osm.pbf"

while [ ! -f "$PBF_FILE" ] || [ ! -s "$PBF_FILE" ]; do
  echo "$(date): Waiting for map data at $PBF_FILE..."
  echo "  Set your service area in the Settings page to provision maps."
  sleep 30
done

echo "PBF file found: $(ls -lh "$PBF_FILE" | awk '{print $5}'). Starting Nominatim import..."

# Hand off to the official entrypoint
exec /app/start.sh
