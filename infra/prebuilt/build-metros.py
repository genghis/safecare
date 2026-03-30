#!/usr/bin/env python3
"""Extract and build OSRM for all metro areas."""
import json, subprocess, os

WORK = "/build"
BUCKET = "safecare-maps-osrm"
US_PBF = f"{WORK}/us-latest.osm.pbf"

with open(f"{WORK}/metros.json") as f:
    metros = json.load(f)["metros"]

os.makedirs(f"{WORK}/metros", exist_ok=True)
os.makedirs(f"{WORK}/output/us", exist_ok=True)

print(f"Processing {len(metros)} metro areas...")

for m in metros:
    mid = m["id"]
    south, west, north, east = m["bounds"]
    pbf = f"{WORK}/metros/{mid}.osm.pbf"
    archive = f"{WORK}/output/us/metro-{mid}-osrm.tar.gz"

    # Extract PBF
    if not os.path.exists(pbf):
        print(f"  {mid}: extracting...")
        bbox = f"{west},{south},{east},{north}"
        subprocess.run(["osmium", "extract", "-b", bbox, US_PBF, "-o", pbf, "--overwrite"],
                       check=True, capture_output=True)

    # Build OSRM
    if os.path.exists(archive):
        print(f"  {mid}: already built")
        continue

    print(f"  {mid}: building OSRM...")
    osrm_dir = f"{WORK}/osrm-metro-{mid}"
    os.makedirs(osrm_dir, exist_ok=True)
    subprocess.run(["cp", pbf, f"{osrm_dir}/data.osm.pbf"], check=True)

    for step in ["osrm-extract -p /opt/car.lua /data/data.osm.pbf -t 4",
                  "osrm-partition /data/data.osrm",
                  "osrm-customize /data/data.osrm"]:
        subprocess.run(["docker", "run", "--rm", "-v", f"{osrm_dir}:/data",
                       "osrm/osrm-backend:latest"] + step.split(),
                       capture_output=True)

    os.remove(f"{osrm_dir}/data.osm.pbf")
    subprocess.run(["tar", "-czf", archive, "-C", osrm_dir, "."], check=True)
    subprocess.run(["rm", "-rf", osrm_dir])

    size = os.path.getsize(archive) / 1024 / 1024
    print(f"  {mid}: done ({size:.0f} MB)")

    # Upload to GCS
    subprocess.Popen(["gsutil", "-q", "cp", archive,
                      f"gs://{BUCKET}/us/metro-{mid}-osrm.tar.gz"])

print(f"\nDone. {len([f for f in os.listdir(f'{WORK}/output/us') if 'metro-' in f])} metro archives.")
