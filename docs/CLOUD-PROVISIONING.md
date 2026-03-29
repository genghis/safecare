# Cloud Map Provisioning Service

SafeCare can optionally offload map data processing to a cloud service. This dramatically reduces setup time from 30-60 minutes (local) to ~5 minutes (cloud).

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

## Building the Service

The cloud provisioning service is a separate project (TODO). It needs:
- Docker image with: Nominatim, OSRM, osmium-tool, PostgreSQL
- HTTP API (Express/Fastify) implementing the three endpoints above
- Object storage (GCS/S3/R2) for temporary result archives
- Cleanup job to delete archives after 24 hours
