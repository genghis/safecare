# Map Provisioning Architecture

SafeCare uses a three-tier approach to get map data onto each deployment as fast as possible:

| Tier | Method | Speed | Cost |
|------|--------|-------|------|
| 1. Pre-built | Download pre-computed archives from CDN | ~30 seconds | ~$1/mo storage |
| 2. Cloud | Upload PBF to a processing service | ~5 minutes | ~$0.02/job |
| 3. Local | Process on-device | 30-60 min (hours on Pi) | Free |

The system automatically uses the fastest available tier and falls back gracefully.

## How It Works

1. Admin defines their operating region in the setup wizard
2. SafeCare downloads the relevant state OSM extract and trims it to the viewport
3. If a cloud provisioning service is available, the trimmed PBF is uploaded to it
4. The cloud service builds the Nominatim and OSRM indexes on fast hardware
5. The pre-built indexes are downloaded back to the local machine
6. Nominatim and OSRM start immediately with the pre-built data

If the cloud service is unavailable, SafeCare falls back to local processing automatically.

## Privacy

**No private data is sent to the cloud.** The only data uploaded is an OpenStreetMap extract -- public map data (roads, buildings, addresses from US Census). No recipient information, delivery data, or any PII ever leaves the local machine.

## API Contract

The cloud provisioning service exposes three endpoints:

### `GET /api/health`
Returns `{ "ok": true }` if the service is running.

### `POST /api/provision`
Accepts a multipart form upload with a `pbf` file field.
Returns `{ "jobId": "uuid" }`.

### `GET /api/provision/:jobId`
Returns job status:
```json
{
  "status": "queued | processing | ready | error",
  "progress": 45,
  "message": "Building search indexes...",
  "downloadUrl": "https://...",
  "error": "..."
}
```

When `status` is `"ready"`, `downloadUrl` contains a link to a tar.gz archive with:
- `nominatim/` -- PostgreSQL data directory for Nominatim
- `osrm/` -- Processed OSRM routing files

## Deployment Options

### Cloud Run (Google Cloud)
- Dockerfile with Nominatim + OSRM + osmium
- Triggered by HTTP request, scales to zero
- ~$0.01-0.02 per provisioning job
- 4 vCPUs, 8GB RAM, processes in ~3-5 minutes

### AWS Lambda + EFS
- Similar approach with Lambda for compute and EFS for temp storage
- ~$0.01 per job

### Dedicated VPS
- A single $20/mo VPS can serve hundreds of SafeCare deployments
- Good for organizations that want to run the service for their network

### Self-hosted
- Run the same Docker image on any server with 4+ cores
- Point `PROVISION_SERVICE_URL` to it

## Configuration

Set the environment variable on the SafeCare backend:
```
PROVISION_SERVICE_URL=https://provision.safecare.dev
```

If not set or the service is unreachable, SafeCare processes locally. No configuration needed for the fallback.

## Tier 1: Pre-Built Archives

A monthly build job processes all 50 US states into ready-to-use archives:

```bash
# Build all states (run on a beefy server or Cloud Run)
./tools/build-prebuilt.sh ./prebuilt

# Build specific states
./tools/build-prebuilt.sh ./prebuilt minnesota illinois california

# Upload to cloud storage
gsutil -m rsync -r ./prebuilt gs://safecare-maps/
# or
aws s3 sync ./prebuilt s3://safecare-maps/
```

Each archive contains:
- `osrm/` -- Pre-processed OSRM routing files
- `nominatim/data.osm.pbf` -- State PBF for Nominatim import

A `manifest.json` index lists all available regions with bounds and sizes.
Each SafeCare deployment downloads just the archive covering its viewport.

**Cost:** ~50 GB storage × $0.015/GB = ~$0.75/month for all 50 states.

## Building the Cloud Processing Service (Tier 2)

The cloud provisioning service is a separate project (TODO). It needs:
- Docker image with: Nominatim, OSRM, osmium-tool, PostgreSQL
- HTTP API (Express/Fastify) implementing the three endpoints above
- Object storage (GCS/S3/R2) for temporary result archives
- Cleanup job to delete archives after 24 hours
