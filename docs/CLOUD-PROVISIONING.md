# Map Provisioning Architecture

## Overview

SafeCare needs two types of map data for each deployment:

1. **OSRM routing files** — pre-computed driving directions. Downloaded from cloud (instant).
2. **Nominatim search index** — address geocoding. Built locally from a PBF file (takes time but keeps address queries private).
3. **Tile cache for driver maps** — map tiles cached onto the SafeCare server, then served locally to dashboard and driver devices.

## How It Works

### OSRM (Pre-built, ~30 seconds)

A quarterly build job processes all 50 US states into OSRM routing archives hosted on GCS, served via Firebase Hosting. Each SafeCare deployment downloads just the state covering its viewport.

- **Build:** Spot VM (c2-standard-30, 30 cores) downloads the full US OSM extract, slices per state with osmium, builds OSRM in parallel
- **Cost:** ~$2 per quarterly build, ~$1/month storage
- **Download:** 50-500 MB per state, takes ~30 seconds

### Nominatim (Local, 15-60 min background)

Each deployment imports a viewport-trimmed PBF into its local Nominatim instance. The system now fails closed for address search until the local geocoder is ready, so recipient addresses are never sent to a public geocoding service.

This must be local because geocoding queries contain recipient addresses (PII).

### Driver Map Tiles (Local serving from the SafeCare box)

The dashboard and driver PWA now fetch map tiles from the SafeCare server, not directly from a public tile CDN at route time.

SafeCare supports two tile-source patterns:

- **Default:** store tiles under `TILE_STORAGE_PATH` on the SafeCare server and serve them locally at `/api/tiles/{z}/{x}/{y}.png`
- **Optional backfill:** set `TILE_DOWNLOAD_URL_TEMPLATE` if you want SafeCare to fetch and cache missing tiles from a separate tile source

With the default local-only setup, no external tile fetch happens at all. If you enable an optional backfill source, that source sees only tile coordinates during cache verification or cache misses, never recipient addresses.

**Estimated Nominatim import times (viewport-trimmed PBF):**

| Region size | PBF size | Laptop (M2) | RPi 5 (8GB) | RPi 4 (4GB) |
|-------------|----------|-------------|-------------|-------------|
| Metro area | 10-20 MB | ~20 min | ~45 min | ~60 min |
| Large metro | 20-50 MB | ~30 min | ~60 min | ~90 min |
| Full state | 100-500 MB | ~60 min | ~2-3 hours | Not recommended |

## Infrastructure

### GCP Resources (Terraform)

```
infra/prebuilt/
├── main.tf              # GCS bucket, service account, spot VM
├── build-osrm.sh        # VM startup script (builds all states)
├── trigger-build.sh     # CLI to start/monitor builds
└── hosting/
    ├── firebase.json    # Firebase Hosting config (CDN)
    └── public/
        └── index.html
```

### Quarterly Build Process

```bash
# One-time setup
cd infra/prebuilt
terraform init && terraform apply

# Trigger a build (~2-3 hours, ~$2 on spot pricing)
./trigger-build.sh

# Monitor
./trigger-build.sh --status
./trigger-build.sh --logs
```

The VM:
1. Downloads the full US OSM extract (~10 GB)
2. Slices into 50 state PBFs with osmium (parallel)
3. Builds OSRM routing data for each state (6 states in parallel, 4 cores each)
4. Uploads OSRM archives + state PBFs to GCS
5. Generates manifest.json
6. Shuts itself down

### What Gets Stored

```
gs://safecare-maps-osrm/
├── manifest.json                 # Index of all regions
├── us/
│   ├── minnesota-osrm.tar.gz   # Pre-built OSRM (~200 MB)
│   ├── minnesota-nominatim.pbf  # State PBF for local import (~300 MB)
│   ├── california-osrm.tar.gz
│   ├── california-nominatim.pbf
│   └── ...
```

### Costs

| Item | Cost |
|------|------|
| Quarterly build (spot VM, ~3 hours) | ~$2 |
| GCS storage (~25 GB OSRM + ~15 GB PBFs) | ~$1/month |
| Firebase Hosting (free tier) | $0 |
| Bandwidth (~10 downloads/month × 500 MB) | ~$0.60/month |
| **Total** | **~$4/quarter** |

## SafeCare Deployment Flow

When an admin clicks "Provision Maps":

1. Check manifest for pre-built OSRM covering the viewport → download (~30 sec)
2. Download the state PBF for Nominatim (~30 sec)
3. OSRM starts immediately with pre-built data (routing works instantly)
4. Verify that the local tile set for the operating region / route zoom levels is present on the SafeCare server
5. Nominatim imports the PBF in the background (15-60 min)
6. Geocoding remains unavailable until the local Nominatim import finishes
7. Once local Nominatim is ready, all queries stay local

## Privacy

- **OSRM files**: public road network data. No PII.
- **PBF files**: public OpenStreetMap data. No PII.
- **Tile availability checks / optional backfill**: tile coordinates only, no recipient addresses.
- **Geocoding queries**: contain recipient addresses. Always processed locally.
- **Route queries**: contain delivery coordinates. Always processed locally.

Nothing private ever leaves the deployment.
