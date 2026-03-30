#!/usr/bin/env python3
"""Generate manifest.json from files in GCS bucket."""
import json
import subprocess
import sys
from datetime import date

BUCKET = "safecare-maps-osrm"
BASE_URL = f"https://storage.googleapis.com/{BUCKET}"

# State bounding boxes
STATE_BOUNDS = {
    "alabama": [30.2, -88.5, 35.0, -84.9], "alaska": [51.2, -179.2, 71.4, -129.6],
    "arizona": [31.3, -114.8, 37.0, -109.0], "arkansas": [33.0, -94.6, 36.5, -89.6],
    "california": [32.5, -124.4, 42.0, -114.1], "colorado": [37.0, -109.1, 41.0, -102.0],
    "connecticut": [41.0, -73.7, 42.1, -71.8], "delaware": [38.5, -75.8, 39.8, -75.0],
    "district-of-columbia": [38.8, -77.1, 39.0, -76.9], "florida": [24.5, -87.6, 31.0, -80.0],
    "georgia": [30.4, -85.6, 35.0, -80.8], "hawaii": [18.9, -160.2, 22.2, -154.8],
    "idaho": [42.0, -117.2, 49.0, -111.0], "illinois": [37.0, -91.5, 42.5, -87.0],
    "indiana": [37.8, -88.1, 41.8, -84.8], "iowa": [40.4, -96.6, 43.5, -90.1],
    "kansas": [37.0, -102.1, 40.0, -94.6], "kentucky": [36.5, -89.6, 39.1, -82.0],
    "louisiana": [29.0, -94.0, 33.0, -89.0], "maine": [43.1, -71.1, 47.5, -66.9],
    "maryland": [38.0, -79.5, 39.7, -75.0], "massachusetts": [41.2, -73.5, 42.9, -69.9],
    "michigan": [41.7, -90.4, 48.3, -82.4], "minnesota": [43.5, -97.2, 49.4, -89.5],
    "mississippi": [30.2, -91.7, 35.0, -88.1], "missouri": [36.0, -95.8, 40.6, -89.1],
    "montana": [44.4, -116.1, 49.0, -104.0], "nebraska": [40.0, -104.1, 43.0, -95.3],
    "nevada": [35.0, -120.0, 42.0, -114.0], "new-hampshire": [42.7, -72.6, 45.3, -71.0],
    "new-jersey": [38.9, -75.6, 41.4, -73.9], "new-mexico": [31.3, -109.1, 37.0, -103.0],
    "new-york": [40.5, -79.8, 45.0, -71.9], "north-carolina": [33.8, -84.3, 36.6, -75.5],
    "north-dakota": [45.9, -104.1, 49.0, -96.6], "ohio": [38.4, -84.8, 42.0, -80.5],
    "oklahoma": [33.6, -103.0, 37.0, -94.4], "oregon": [41.9, -124.6, 46.3, -116.5],
    "pennsylvania": [39.7, -80.5, 42.3, -75.0], "rhode-island": [41.1, -71.9, 42.0, -71.1],
    "south-carolina": [32.0, -83.4, 35.2, -78.5], "south-dakota": [42.5, -104.1, 46.0, -96.4],
    "tennessee": [35.0, -90.3, 36.7, -81.6], "texas": [25.8, -106.6, 36.5, -93.5],
    "utah": [37.0, -114.1, 42.0, -109.0], "vermont": [42.7, -73.4, 45.0, -71.5],
    "virginia": [36.5, -83.7, 39.5, -75.2], "washington": [45.5, -124.8, 49.0, -116.9],
    "west-virginia": [37.2, -82.6, 40.6, -77.7], "wisconsin": [42.5, -92.9, 47.1, -86.8],
    "wyoming": [41.0, -111.1, 45.0, -104.1],
}

# Load metro definitions
import os
metros_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metros.json")
METROS = {}
if os.path.exists(metros_file):
    with open(metros_file) as f:
        for m in json.load(f)["metros"]:
            METROS[m["id"]] = {"name": m["name"], "bounds": m["bounds"]}

def get_gcs_files():
    """List all files in the GCS bucket with sizes."""
    result = subprocess.run(
        ["gsutil", "ls", "-l", f"gs://{BUCKET}/us/"],
        capture_output=True, text=True
    )
    files = {}
    for line in result.stdout.strip().split("\n"):
        parts = line.strip().split()
        if len(parts) >= 3 and parts[2].startswith("gs://"):
            size = int(parts[0])
            path = parts[2]
            name = path.split("/")[-1]
            files[name] = size
    return files

def main():
    print("Fetching GCS file list...")
    files = get_gcs_files()
    print(f"Found {len(files)} files")

    regions = []
    build_date = date.today().isoformat()

    # Process states
    for state, bounds in sorted(STATE_BOUNDS.items()):
        osrm_file = f"{state}-osrm.tar.gz"
        if osrm_file not in files:
            continue

        south, west, north, east = bounds
        name = state.replace("-", " ").title()

        regions.append({
            "id": state,
            "name": name,
            "type": "state",
            "bounds": {"south": south, "west": west, "north": north, "east": east},
            "osrmUrl": f"/us/{osrm_file}",
            "osrmSize": files[osrm_file],
            "pbfDate": build_date,
        })

    # Process metros
    for metro_id, meta in sorted(METROS.items()):
        osrm_file = f"metro-{metro_id}-osrm.tar.gz"
        if osrm_file not in files:
            continue

        south, west, north, east = meta["bounds"]

        regions.append({
            "id": f"metro-{metro_id}",
            "name": meta["name"],
            "type": "metro",
            "bounds": {"south": south, "west": west, "north": north, "east": east},
            "osrmUrl": f"/us/{osrm_file}",
            "osrmSize": files[osrm_file],
            "pbfDate": build_date,
        })

    manifest = {
        "version": 2,
        "updated": build_date,
        "baseUrl": BASE_URL,
        "description": "Pre-built OSRM routing data for US states and metro areas",
        "regions": sorted(regions, key=lambda r: r["name"]),
    }

    # Write locally
    manifest_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    # Upload to GCS
    subprocess.run(["gsutil", "cp", manifest_path, f"gs://{BUCKET}/manifest.json"])

    states = [r for r in regions if r["type"] == "state"]
    metros = [r for r in regions if r["type"] == "metro"]
    total_gb = sum(r["osrmSize"] for r in regions) / 1024**3

    print(f"\nManifest: {len(states)} states + {len(metros)} metros")
    print(f"Total: {total_gb:.1f} GB")
    print(f"Uploaded to gs://{BUCKET}/manifest.json")
    print(f"URL: {BASE_URL}/manifest.json")

if __name__ == "__main__":
    main()
