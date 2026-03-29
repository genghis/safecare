# Map Provisioning Architecture

## Overview

SafeCare needs two types of map data for each deployment:

1. **OSRM routing files** — pre-computed driving directions. Downloaded from cloud (instant).
2. **Nominatim search index** — address geocoding. Built locally from a PBF file (takes time but keeps address queries private).

## How It Works

### OSRM (Pre-built, ~30 seconds)

A quarterly build job processes all 50 US states into OSRM routing archives hosted on GCS, served via Firebase Hosting. Each SafeCare deployment downloads just the state covering its viewport.

- **Build:** Spot VM (c2-standard-30, 30 cores) downloads the full US OSM extract, slices per state with osmium, builds OSRM in parallel
- **Cost:** ~$2 per quarterly build, ~$1/month storage
- **Download:** 50-500 MB per state, takes ~30 seconds

### Nominatim (Local, 15-60 min background)

Each deployment imports a viewport-trimmed PBF into its local Nominatim instance. This runs in the background — the system is usable immediately (public Nominatim API fallback for geocoding while local import runs).

This must be local because geocoding queries contain recipient addresses (PII).

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
4. Nominatim imports the PBF in the background (15-60 min)
5. Geocoding uses public Nominatim API fallback until local import finishes
6. Once local Nominatim is ready, it takes over (all queries stay local)

## Privacy

- **OSRM files**: public road network data. No PII.
- **PBF files**: public OpenStreetMap data. No PII.
- **Geocoding queries**: contain recipient addresses. Always processed locally.
- **Route queries**: contain delivery coordinates. Always processed locally.

Nothing private ever leaves the deployment.
