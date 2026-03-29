import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import Redis from 'ioredis';
import { createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { config } from '../config.js';

const redis = new Redis(config.REDIS_URL);

const SETTINGS_KEY = 'org:settings';
const PROVISION_STATUS_KEY = 'map:provision:status';
const MAP_DATA_PATH = process.env.MAP_DATA_PATH || '/app/map-data/data.osm.pbf';
const USER_AGENT = 'SafeCare/1.0 (mutual-aid-delivery)';

// ---------------------------------------------------------------------------
// US State -> Geofabrik slug lookup
// ---------------------------------------------------------------------------
const STATE_SLUGS: Record<string, string> = {
  'Alabama': 'alabama', 'Alaska': 'alaska', 'Arizona': 'arizona',
  'Arkansas': 'arkansas', 'California': 'california', 'Colorado': 'colorado',
  'Connecticut': 'connecticut', 'Delaware': 'delaware', 'Florida': 'florida',
  'Georgia': 'georgia', 'Hawaii': 'hawaii', 'Idaho': 'idaho',
  'Illinois': 'illinois', 'Indiana': 'indiana', 'Iowa': 'iowa',
  'Kansas': 'kansas', 'Kentucky': 'kentucky', 'Louisiana': 'louisiana',
  'Maine': 'maine', 'Maryland': 'maryland', 'Massachusetts': 'massachusetts',
  'Michigan': 'michigan', 'Minnesota': 'minnesota', 'Mississippi': 'mississippi',
  'Missouri': 'missouri', 'Montana': 'montana', 'Nebraska': 'nebraska',
  'Nevada': 'nevada', 'New Hampshire': 'new-hampshire', 'New Jersey': 'new-jersey',
  'New Mexico': 'new-mexico', 'New York': 'new-york', 'North Carolina': 'north-carolina',
  'North Dakota': 'north-dakota', 'Ohio': 'ohio', 'Oklahoma': 'oklahoma',
  'Oregon': 'oregon', 'Pennsylvania': 'pennsylvania', 'Rhode Island': 'rhode-island',
  'South Carolina': 'south-carolina', 'South Dakota': 'south-dakota',
  'Tennessee': 'tennessee', 'Texas': 'texas', 'Utah': 'utah',
  'Vermont': 'vermont', 'Virginia': 'virginia', 'Washington': 'washington',
  'West Virginia': 'west-virginia', 'Wisconsin': 'wisconsin', 'Wyoming': 'wyoming',
  'District of Columbia': 'district-of-columbia',
};

const operatingRegionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  zoom: z.number().min(1).max(20),
  label: z.string(),
  bounds: z.object({
    south: z.number(),
    west: z.number(),
    north: z.number(),
    east: z.number(),
  }).optional(),
});

const settingsSchema = z.object({
  orgName: z.string().optional().default(''),
  serviceArea: operatingRegionSchema,
});

// Map state bounding boxes to determine which extracts cover a region
// Each state has [south, west, north, east] approximate bounds
const STATE_BOUNDS: Record<string, [number, number, number, number]> = {
  'alabama': [30.2, -88.5, 35.0, -84.9],
  'alaska': [51.2, -179.2, 71.4, -129.6],
  'arizona': [31.3, -114.8, 37.0, -109.0],
  'arkansas': [33.0, -94.6, 36.5, -89.6],
  'california': [32.5, -124.4, 42.0, -114.1],
  'colorado': [37.0, -109.1, 41.0, -102.0],
  'connecticut': [41.0, -73.7, 42.1, -71.8],
  'delaware': [38.5, -75.8, 39.8, -75.0],
  'district-of-columbia': [38.8, -77.1, 39.0, -76.9],
  'florida': [24.5, -87.6, 31.0, -80.0],
  'georgia': [30.4, -85.6, 35.0, -80.8],
  'hawaii': [18.9, -160.2, 22.2, -154.8],
  'idaho': [42.0, -117.2, 49.0, -111.0],
  'illinois': [37.0, -91.5, 42.5, -87.0],
  'indiana': [37.8, -88.1, 41.8, -84.8],
  'iowa': [40.4, -96.6, 43.5, -90.1],
  'kansas': [37.0, -102.1, 40.0, -94.6],
  'kentucky': [36.5, -89.6, 39.1, -82.0],
  'louisiana': [29.0, -94.0, 33.0, -89.0],
  'maine': [43.1, -71.1, 47.5, -66.9],
  'maryland': [38.0, -79.5, 39.7, -75.0],
  'massachusetts': [41.2, -73.5, 42.9, -69.9],
  'michigan': [41.7, -90.4, 48.3, -82.4],
  'minnesota': [43.5, -97.2, 49.4, -89.5],
  'mississippi': [30.2, -91.7, 35.0, -88.1],
  'missouri': [36.0, -95.8, 40.6, -89.1],
  'montana': [44.4, -116.1, 49.0, -104.0],
  'nebraska': [40.0, -104.1, 43.0, -95.3],
  'nevada': [35.0, -120.0, 42.0, -114.0],
  'new-hampshire': [42.7, -72.6, 45.3, -71.0],
  'new-jersey': [38.9, -75.6, 41.4, -73.9],
  'new-mexico': [31.3, -109.1, 37.0, -103.0],
  'new-york': [40.5, -79.8, 45.0, -71.9],
  'north-carolina': [33.8, -84.3, 36.6, -75.5],
  'north-dakota': [45.9, -104.1, 49.0, -96.6],
  'ohio': [38.4, -84.8, 42.0, -80.5],
  'oklahoma': [33.6, -103.0, 37.0, -94.4],
  'oregon': [41.9, -124.6, 46.3, -116.5],
  'pennsylvania': [39.7, -80.5, 42.3, -75.0],
  'rhode-island': [41.1, -71.9, 42.0, -71.1],
  'south-carolina': [32.0, -83.4, 35.2, -78.5],
  'south-dakota': [42.5, -104.1, 46.0, -96.4],
  'tennessee': [35.0, -90.3, 36.7, -81.6],
  'texas': [25.8, -106.6, 36.5, -93.5],
  'utah': [37.0, -114.1, 42.0, -109.0],
  'vermont': [42.7, -73.4, 45.0, -71.5],
  'virginia': [36.5, -83.7, 39.5, -75.2],
  'washington': [45.5, -124.8, 49.0, -116.9],
  'west-virginia': [37.2, -82.6, 40.6, -77.7],
  'wisconsin': [42.5, -92.9, 47.1, -86.8],
  'wyoming': [41.0, -111.1, 45.0, -104.1],
};

/**
 * Find the smallest set of Geofabrik state extracts that fully cover
 * the given bounding box.
 */
function findCoveringExtracts(bounds: { south: number; west: number; north: number; east: number }): string[] {
  const covering: string[] = [];
  for (const [slug, [s, w, n, e]] of Object.entries(STATE_BOUNDS)) {
    // Does this state overlap with the requested bounds?
    const overlaps = !(bounds.east < w || bounds.west > e || bounds.north < s || bounds.south > n);
    if (overlaps) {
      covering.push(slug);
    }
  }
  return covering;
}

export default async function settingsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/settings
   * Return the current org settings (admin only).
   */
  fastify.get(
    '/api/settings',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const raw = await redis.get(SETTINGS_KEY);

      if (!raw) {
        return reply.send({
          success: true,
          data: null,
        });
      }

      return reply.send({
        success: true,
        data: JSON.parse(raw),
      });
    },
  );

  /**
   * PUT /api/settings
   * Save org settings to Redis (admin only).
   */
  fastify.put(
    '/api/settings',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      await redis.set(SETTINGS_KEY, JSON.stringify(parsed.data));

      return reply.send({
        success: true,
        data: parsed.data,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/settings/provision-maps
  // Downloads state-level OSM PBF data based on the service area center.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/settings/provision-maps',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. Read org settings to get service area center
      const raw = await redis.get(SETTINGS_KEY);
      if (!raw) {
        return reply.code(400).send({
          success: false,
          error: 'No service area configured. Save your settings first.',
        });
      }

      const settings = JSON.parse(raw);
      const { bounds, label } = settings.serviceArea;

      if (!bounds) {
        return reply.code(400).send({
          success: false,
          error: 'No operating region bounds saved. Pan/zoom the map in Settings to define your region, then save.',
        });
      }

      // 2. Find which state extracts cover the operating region
      const extracts = findCoveringExtracts(bounds);
      if (extracts.length === 0) {
        return reply.code(400).send({
          success: false,
          error: 'Could not find map data for this region. Ensure the operating region is within the US.',
        });
      }

      const regionLabel = extracts.length === 1
        ? extracts[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : `${extracts.length} states`;

      // For now, download extracts sequentially and merge isn't supported --
      // use the first extract if single state, or fall back to a regional extract
      // that covers all the states
      let pbfUrl: string;
      let downloadLabel: string;

      if (extracts.length === 1) {
        pbfUrl = `https://download.geofabrik.de/north-america/us/${extracts[0]}-latest.osm.pbf`;
        downloadLabel = regionLabel;
      } else {
        // Multiple states -- use the regional extract that covers them
        // Determine region from first extract's location
        const midLat = (bounds.south + bounds.north) / 2;
        const midLng = (bounds.west + bounds.east) / 2;
        let region = 'us-midwest';
        if (midLng > -80) region = 'us-northeast';
        else if (midLat < 37 && midLng > -105) region = 'us-south';
        else if (midLng < -105) region = 'us-west';
        pbfUrl = `https://download.geofabrik.de/north-america/${region}-latest.osm.pbf`;
        downloadLabel = `${region.replace('us-', 'US ').replace(/\b\w/g, (c) => c.toUpperCase())} (covers ${extracts.join(', ')})`;
      }

      // 3. Set initial status and kick off download
      await redis.set(
        PROVISION_STATUS_KEY,
        JSON.stringify({
          status: 'downloading',
          progress: 0,
          state: downloadLabel,
          message: `Starting download for ${downloadLabel}...`,
        }),
      );

      reply.send({
        success: true,
        data: { region: downloadLabel, extracts, url: pbfUrl },
      });

      // 4. Download in background
      downloadPbf(pbfUrl, downloadLabel, fastify.log).catch((err) => {
        fastify.log.error(err, 'Map provisioning download failed');
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/settings/provision-status
  // Returns the current map provisioning status.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/settings/provision-status',
    { preHandler: [fastify.requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const raw = await redis.get(PROVISION_STATUS_KEY);

      if (!raw) {
        // No status key -- check if PBF file exists AND Nominatim is responding
        let fileExists = false;
        let fileSize = 0;
        try {
          const fileInfo = await stat(MAP_DATA_PATH);
          fileExists = fileInfo.size > 1_000_000;
          fileSize = fileInfo.size;
        } catch {
          // File doesn't exist
        }

        if (!fileExists) {
          return reply.send({
            success: true,
            data: { status: 'not_started' },
          });
        }

        // File exists -- check if Nominatim is actually serving
        try {
          const res = await fetch(`${config.GEOCODING_URL}/status`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            return reply.send({
              success: true,
              data: { status: 'ready', sizeBytes: fileSize },
            });
          }
        } catch {
          // Nominatim not ready yet
        }

        return reply.send({
          success: true,
          data: {
            status: 'importing',
            sizeBytes: fileSize,
            message: 'Map data downloaded. Geocoding and routing engines are still importing. This can take 30-60 minutes.',
          },
        });
      }

      const stored = JSON.parse(raw);

      // If Redis says "ready" or "importing", verify Nominatim is actually live
      if (stored.status === 'ready' || stored.status === 'importing') {
        let nominatimLive = false;
        try {
          const check = await fetch(`${config.GEOCODING_URL}/status`, {
            signal: AbortSignal.timeout(3000),
          });
          nominatimLive = check.ok;
        } catch {
          // not responding yet
        }

        if (!nominatimLive) {
          stored.status = 'importing';

          // Read Nominatim import progress from shared file
          let progressLine = '';
          try {
            const { readFile } = await import('fs/promises');
            progressLine = (await readFile('/app/map-data/import-progress.txt', 'utf-8')).trim();
          } catch {
            // File doesn't exist yet
          }

          // Show elapsed time
          const downloadedAt = stored.downloadedAt || stored.completedAt;
          let elapsed = '';
          if (downloadedAt) {
            const mins = Math.round((Date.now() - new Date(downloadedAt).getTime()) / 60000);
            elapsed = mins < 1 ? 'less than 1 min' : `${mins} min`;
          }

          // Parse the progress line for structured info
          let step = 'Importing map data...';
          let importProgress: number | null = null;

          if (progressLine === 'waiting' || progressLine === 'starting') {
            step = 'Preparing to import...';
          } else if (progressLine) {
            // "Done 5584 in 11 @ 490/s - rank 20 ETA (seconds): 34.52"
            const rankMatch = progressLine.match(/rank (\d+)/);
            const etaMatch = progressLine.match(/ETA \(seconds\): ([\d.]+)/);
            const rateMatch = progressLine.match(/@ ([\d.]+) per second/);
            const processedMatch = progressLine.match(/Processed (\d+) (nodes|ways|relations)/);

            if (rankMatch) {
              const rank = parseInt(rankMatch[1]);
              importProgress = Math.round(((rank - 4) / 26) * 100);
              step = `Indexing addresses (rank ${rank}/30, ~${importProgress}% overall)`;
              if (rateMatch) step += ` — ${Math.round(parseFloat(rateMatch[1]))}/sec`;
              if (etaMatch) {
                const secs = parseFloat(etaMatch[1]);
                step += secs > 60 ? `, ~${Math.round(secs / 60)} min left for this rank` : `, ~${Math.round(secs)}s left`;
              }
            } else if (processedMatch) {
              step = `Processed ${processedMatch[1]} ${processedMatch[2]}`;
            } else if (progressLine.includes('Clustering')) {
              step = 'Clustering geographic data...';
              importProgress = 10;
            } else if (progressLine.includes('TIGER')) {
              step = 'Importing US house number data (TIGER)...';
              importProgress = 95;
            } else if (progressLine.includes('Loading')) {
              step = 'Loading data into database...';
              importProgress = 5;
            } else if (progressLine.includes('Creating')) {
              step = 'Creating database indexes...';
              importProgress = 8;
            } else if (progressLine.includes('Starting Apache')) {
              step = 'Almost ready — starting web server...';
              importProgress = 99;
            } else {
              step = progressLine.length > 100 ? progressLine.substring(0, 100) + '...' : progressLine;
            }
          }

          stored.message = step;
          stored.elapsed = elapsed;
          stored.importProgress = importProgress;
        } else if (stored.status !== 'ready') {
          stored.status = 'ready';
          delete stored.message;
          delete stored.importProgress;
          await redis.set(PROVISION_STATUS_KEY, JSON.stringify(stored));
        }
      }

      return reply.send({
        success: true,
        data: stored,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Background download helper
// ---------------------------------------------------------------------------
async function downloadPbf(
  url: string,
  stateName: string,
  log: { error: (...args: any[]) => void; info: (...args: any[]) => void },
): Promise<void> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status} from ${url}`);
    }

    const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
    let downloadedBytes = 0;
    let lastProgressUpdate = 0;

    const reader = response.body!.getReader();
    const fileStream = createWriteStream(MAP_DATA_PATH);

    // Create a readable stream from the fetch reader
    const readable = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
            return;
          }
          downloadedBytes += value.byteLength;

          // Update progress in Redis at most every 2 seconds
          const now = Date.now();
          if (now - lastProgressUpdate > 2000) {
            lastProgressUpdate = now;
            const progress = totalBytes > 0
              ? Math.round((downloadedBytes / totalBytes) * 100)
              : 0;
            const dlMB = (downloadedBytes / 1024 / 1024).toFixed(0);
            const totalMB = totalBytes > 0
              ? (totalBytes / 1024 / 1024).toFixed(0)
              : '?';

            await redis.set(
              PROVISION_STATUS_KEY,
              JSON.stringify({
                status: 'downloading',
                progress,
                state: stateName,
                sizeBytes: totalBytes,
                downloadedBytes,
                message: `Downloading ${stateName} (${dlMB} MB / ${totalMB} MB)...`,
              }),
            );
          }

          this.push(value);
        } catch (err) {
          this.destroy(err as Error);
        }
      },
    });

    await pipeline(readable, fileStream);

    // Download complete -- set status to importing
    const finalSizeBytes = totalBytes || downloadedBytes;
    await redis.set(
      PROVISION_STATUS_KEY,
      JSON.stringify({
        status: 'importing',
        state: stateName,
        sizeBytes: finalSizeBytes,
        downloadedAt: new Date().toISOString(),
        message: 'Map data downloaded. Nominatim and OSRM are importing...',
      }),
    );

    log.info(
      `Map provisioning: downloaded ${stateName} PBF (${(finalSizeBytes / 1024 / 1024).toFixed(0)} MB)`,
    );

    // After import completes (detected by containers), they will become healthy.
    // We set ready status here; the containers do the actual import work.
    // In a production system we'd poll container health; for now, mark as ready
    // after a brief delay to let the containers detect the file.
    setTimeout(async () => {
      const current = await redis.get(PROVISION_STATUS_KEY);
      if (current) {
        const parsed = JSON.parse(current);
        // Only transition to ready if still in importing state
        if (parsed.status === 'importing') {
          await redis.set(
            PROVISION_STATUS_KEY,
            JSON.stringify({
              status: 'ready',
              state: stateName,
              sizeBytes: finalSizeBytes,
            }),
          );
        }
      }
    }, 5000);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown download error';
    log.error(err, 'Map provisioning download failed');
    await redis.set(
      PROVISION_STATUS_KEY,
      JSON.stringify({
        status: 'error',
        state: stateName,
        message,
      }),
    );
  }
}
