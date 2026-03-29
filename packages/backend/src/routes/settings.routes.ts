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

const serviceAreaSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  zoom: z.number().min(1).max(20),
  label: z.string(),
});

const settingsSchema = z.object({
  orgName: z.string().min(1),
  serviceArea: serviceAreaSchema,
});

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
      const { lat, lng } = settings.serviceArea;

      // 2. Reverse geocode to determine the US state
      let stateName: string;
      try {
        const url = new URL('/reverse', config.GEOCODING_URL);
        url.searchParams.set('lat', String(lat));
        url.searchParams.set('lon', String(lng));
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('addressdetails', '1');

        const geoResponse = await fetch(url.toString(), {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });

        if (!geoResponse.ok) {
          throw new Error(`Reverse geocoding failed: ${geoResponse.status}`);
        }

        const geoData = (await geoResponse.json()) as any;
        stateName = geoData.address?.state;

        if (!stateName) {
          // Fallback: parse from display_name ("City, County, State, Country")
          const parts = (geoData.display_name ?? '').split(',').map((s: string) => s.trim());
          // State is typically the second-to-last part (before "United States")
          stateName = parts.length >= 2 ? parts[parts.length - 2] : '';
        }
      } catch (err) {
        fastify.log.error(err, 'Reverse geocoding failed during map provisioning');
        return reply.code(502).send({
          success: false,
          error: 'Could not determine state from service area. Is the geocoding service running?',
        });
      }

      // 3. Map state name to Geofabrik slug
      const slug = STATE_SLUGS[stateName];
      if (!slug) {
        return reply.code(400).send({
          success: false,
          error: `Could not map "${stateName}" to a known US state. Ensure the service area is within the US.`,
        });
      }

      const pbfUrl = `https://download.geofabrik.de/north-america/us/${slug}-latest.osm.pbf`;

      // 4. Set initial status and kick off download in the background
      await redis.set(
        PROVISION_STATUS_KEY,
        JSON.stringify({
          status: 'downloading',
          progress: 0,
          state: stateName,
          message: `Starting download for ${stateName}...`,
        }),
      );

      // Reply immediately -- download happens in background
      reply.send({
        success: true,
        data: { state: stateName, slug, url: pbfUrl },
      });

      // 5. Download the PBF file with progress tracking
      downloadPbf(pbfUrl, stateName, fastify.log).catch((err) => {
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
        // No status key -- check if PBF file exists
        try {
          const fileInfo = await stat(MAP_DATA_PATH);
          if (fileInfo.size > 1_000_000) { // at least 1MB to be a valid PBF
            return reply.send({
              success: true,
              data: { status: 'ready', sizeBytes: fileInfo.size },
            });
          }
        } catch {
          // File doesn't exist
        }
        return reply.send({
          success: true,
          data: { status: 'not_started' },
        });
      }

      return reply.send({
        success: true,
        data: JSON.parse(raw),
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
