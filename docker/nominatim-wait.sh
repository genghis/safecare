#!/bin/bash
# Nominatim entrypoint wrapper
# Waits for the PBF file, then starts Nominatim and tracks progress.

PBF_FILE="/nominatim/data.osm.pbf"
PROGRESS_FILE="/nominatim/import-progress.txt"

while [ ! -f "$PBF_FILE" ] || [ ! -s "$PBF_FILE" ]; do
  echo "$(date): Waiting for map data at $PBF_FILE..."
  echo "waiting" > "$PROGRESS_FILE"
  sleep 30
done

PBF_SIZE=$(ls -lh "$PBF_FILE" | awk '{print $5}')
echo "PBF file found: $PBF_SIZE. Starting Nominatim import..."

# Check for pre-processed TIGER data
TIGER_DIR="/nominatim/tiger"
if [ -d "$TIGER_DIR" ] && [ "$(ls -A "$TIGER_DIR" 2>/dev/null)" ]; then
  TIGER_COUNT=$(ls "$TIGER_DIR"/*.zip 2>/dev/null | wc -l)
  echo "Pre-processed TIGER data found: $TIGER_COUNT files"
  export IMPORT_TIGER_ADDRESSES=true
fi

echo "starting import ($PBF_SIZE)" > "$PROGRESS_FILE"
START_TIME=$(date +%s)

# Run the official entrypoint and capture output line by line
# Use stdbuf to force line buffering so progress updates appear immediately
stdbuf -oL /app/start.sh 2>&1 | while IFS= read -r line; do
  echo "$line"
  # Update progress file with meaningful lines
  case "$line" in
    *"rank "*|*"Done "*|*"Clustering"*|*"Creating"*|*"Importing"*|*"Loading"*|*"TIGER"*|*"Starting Apache"*|*"Recompute"*|*"Setup website"*|*"Processed"*|*"osm2pgsql"*|*"Create "*|*"Starting rank"*)
      ELAPSED=$(( $(date +%s) - START_TIME ))
      MINS=$(( ELAPSED / 60 ))
      echo "${line} [${MINS}m elapsed]" > "$PROGRESS_FILE"
      ;;
  esac
done
