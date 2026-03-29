#!/bin/bash
# Nominatim entrypoint wrapper
# Waits for the PBF file, then starts Nominatim and tails progress
# to a shared file that the backend can read.

PBF_FILE="/nominatim/data.osm.pbf"
PROGRESS_FILE="/nominatim/import-progress.txt"

while [ ! -f "$PBF_FILE" ] || [ ! -s "$PBF_FILE" ]; do
  echo "$(date): Waiting for map data at $PBF_FILE..."
  echo "waiting" > "$PROGRESS_FILE"
  sleep 30
done

echo "PBF file found: $(ls -lh "$PBF_FILE" | awk '{print $5}'). Starting Nominatim import..."
echo "starting" > "$PROGRESS_FILE"

# Start the official entrypoint and tail its output to the progress file
# The last meaningful log line is kept in the progress file for the backend to read
exec /app/start.sh 2>&1 | while IFS= read -r line; do
  echo "$line"
  # Write progress lines to the shared file
  case "$line" in
    *"rank "*|*"Done "*|*"Clustering"*|*"Creating"*|*"Importing"*|*"Loading"*|*"TIGER"*|*"Starting Apache"*|*"osm2pgsql"*|*"Processed"*)
      echo "$line" > "$PROGRESS_FILE"
      ;;
  esac
done
