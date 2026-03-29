/**
 * OSM tile pre-caching for offline map navigation.
 *
 * Uses the Cache API to store tile images so the service worker can serve
 * them when the device is offline. Tiles are downloaded in batches to avoid
 * saturating the network.
 */

const TILE_CACHE_NAME = "safecare-tiles-v1";

/** Batch size for parallel tile downloads. */
const BATCH_SIZE = 10;

/**
 * Pre-cache a list of OSM tile URLs into the Cache API.
 *
 * Downloads tiles in batches of {@link BATCH_SIZE} to avoid overwhelming
 * the network. Failed tiles are silently skipped so one bad URL does not
 * block the whole operation.
 *
 * @param tileUrls - Array of full tile URLs to cache.
 * @param onProgress - Optional callback invoked after each batch with the
 *   number of tiles cached so far and the total count.
 */
export async function cacheTiles(
  tileUrls: string[],
  onProgress?: (cached: number, total: number) => void,
): Promise<void> {
  if (!tileUrls.length) return;

  const cache = await caches.open(TILE_CACHE_NAME);
  const total = tileUrls.length;
  let cached = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = tileUrls.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          // Skip if already cached
          const existing = await cache.match(url);
          if (existing) return;

          const response = await fetch(url, { mode: "cors" });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch {
          // Silently skip failed tiles
        }
      }),
    );

    cached += results.length;
    onProgress?.(Math.min(cached, total), total);
  }
}

/**
 * Delete the entire tile cache.
 * Called during end-of-shift purge to free storage.
 */
export async function clearTileCache(): Promise<void> {
  await caches.delete(TILE_CACHE_NAME);
}

/**
 * Check whether a specific tile URL is present in the cache.
 */
export async function isTileCached(url: string): Promise<boolean> {
  try {
    const cache = await caches.open(TILE_CACHE_NAME);
    const response = await cache.match(url);
    return response !== undefined;
  } catch {
    return false;
  }
}
