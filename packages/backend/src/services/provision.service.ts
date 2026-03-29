/**
 * Map provisioning service — three tiers:
 *
 * 1. PRE-BUILT: Download pre-computed indexes from a CDN. Instant (~30 sec).
 *    A monthly build job processes every US state into Nominatim + OSRM
 *    archives hosted on cloud storage. Each deployment downloads just what
 *    it needs based on the viewport.
 *
 * 2. CLOUD: Upload PBF to a processing service. Fast (~5 min).
 *    Falls back here if no pre-built archive covers the viewport.
 *
 * 3. LOCAL: Process on-device. Slow (30-60 min, hours on Pi).
 *    Always-available fallback when internet is unavailable.
 *
 * No private data is ever sent — only public OpenStreetMap map data.
 */

import { config } from '../config.js';
import { stat } from 'fs/promises';

const USER_AGENT = 'SafeCare/1.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrebuiltRegion {
  id: string;
  name: string;
  bounds: { south: number; west: number; north: number; east: number };
  osrmUrl: string;       // pre-built OSRM routing files
  osrmSize: number;      // bytes
  pbfUrl: string;        // state PBF for local Nominatim import
  pbfSize: number;       // bytes
  pbfDate: string;
  // Legacy single-archive format
  archiveUrl?: string;
  archiveSize?: number;
}

export interface PrebuiltManifest {
  version: number;
  updated: string;
  baseUrl: string;
  regions: PrebuiltRegion[];
}

export interface CloudProvisionStatus {
  status: 'queued' | 'processing' | 'ready' | 'error';
  progress?: number;
  message?: string;
  downloadUrl?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Manifest URL — points to the index of pre-built archives
// ---------------------------------------------------------------------------

const MANIFEST_URL =
  config.PROVISION_SERVICE_URL
    ? `${config.PROVISION_SERVICE_URL}/manifest.json`
    : 'https://maps.safecare.dev/manifest.json';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProvisionService {
  private manifestCache: PrebuiltManifest | null = null;
  private manifestFetchedAt = 0;
  private readonly MANIFEST_TTL = 60 * 60 * 1000; // 1 hour cache

  // -----------------------------------------------------------------------
  // Tier 1: Pre-built archives
  // -----------------------------------------------------------------------

  /**
   * Fetch the manifest of pre-built regions.
   * Cached for 1 hour.
   */
  async getManifest(): Promise<PrebuiltManifest | null> {
    if (
      this.manifestCache &&
      Date.now() - this.manifestFetchedAt < this.MANIFEST_TTL
    ) {
      return this.manifestCache;
    }

    try {
      const res = await fetch(MANIFEST_URL, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        this.manifestCache = (await res.json()) as PrebuiltManifest;
        this.manifestFetchedAt = Date.now();
        return this.manifestCache;
      }
    } catch {
      // Manifest not available
    }
    return null;
  }

  /**
   * Find pre-built regions that cover the given viewport.
   * Returns the smallest region that fully contains the viewport,
   * or null if no pre-built region covers it.
   */
  async findPrebuiltRegion(
    bounds: { south: number; west: number; north: number; east: number },
  ): Promise<PrebuiltRegion | null> {
    const manifest = await this.getManifest();
    if (!manifest) return null;

    // Find regions that overlap the viewport significantly
    const covering = manifest.regions.filter((r) => {
      // Check if this region fully contains the viewport
      const contains =
        r.bounds.south <= bounds.south &&
        r.bounds.west <= bounds.west &&
        r.bounds.north >= bounds.north &&
        r.bounds.east >= bounds.east;
      if (contains) return true;

      // Also accept regions that contain the viewport center
      // (for metro areas that may not fully enclose a large viewport)
      const centerLat = (bounds.south + bounds.north) / 2;
      const centerLng = (bounds.west + bounds.east) / 2;
      return (
        r.bounds.south <= centerLat &&
        r.bounds.north >= centerLat &&
        r.bounds.west <= centerLng &&
        r.bounds.east >= centerLng
      );
    });

    if (covering.length === 0) return null;

    // Prefer metros over states (smaller download, cross-border routing)
    const metros = covering.filter((r) => (r as any).type === 'metro' || r.id.startsWith('metro-'));
    if (metros.length > 0) {
      // Return the smallest metro that covers the viewport
      metros.sort((a, b) => (a.osrmSize || 0) - (b.osrmSize || 0));
      return metros[0];
    }

    // Fall back to smallest state
    covering.sort((a, b) => (a.osrmSize || a.archiveSize || 0) - (b.osrmSize || b.archiveSize || 0));
    return covering[0];
  }

  /**
   * Download pre-built OSRM files and state PBF (for local Nominatim import).
   */
  async downloadPrebuilt(
    region: PrebuiltRegion,
    destDir: string,
    onProgress?: (phase: string, downloaded: number, total: number) => void,
  ): Promise<void> {
    const baseUrl = (await this.getManifest())?.baseUrl ?? '';

    // 1. Download OSRM routing files (pre-built, instant routing)
    const osrmUrl = (region.osrmUrl || region.archiveUrl || '').startsWith('http')
      ? (region.osrmUrl || region.archiveUrl || '')
      : `${baseUrl}${region.osrmUrl || region.archiveUrl}`;

    await this.streamDownload(
      osrmUrl,
      `${destDir}/osrm.tar.gz`,
      (dl, total) => onProgress?.('osrm', dl, total),
    );

    // Extract OSRM into the OSRM data directory
    const { execSync } = await import('child_process');
    const { mkdir } = await import('fs/promises');
    const osrmDir = `${destDir}/osrm`;
    await mkdir(osrmDir, { recursive: true });
    execSync(`tar -xzf "${destDir}/osrm.tar.gz" -C "${osrmDir}"`, { timeout: 300000 });
    const { unlink } = await import('fs/promises');
    await unlink(`${destDir}/osrm.tar.gz`).catch(() => {});

    // 2. Download state PBF for local Nominatim import
    if (region.pbfUrl) {
      const pbfUrl = region.pbfUrl.startsWith('http')
        ? region.pbfUrl
        : `${baseUrl}${region.pbfUrl}`;

      await this.streamDownload(
        pbfUrl,
        `${destDir}/data.osm.pbf`,
        (dl, total) => onProgress?.('nominatim', dl, total),
      );
    }
  }

  /**
   * Stream a URL to a local file with progress callback.
   */
  private async streamDownload(
    url: string,
    destPath: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<void> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`);

    const totalBytes = parseInt(res.headers.get('content-length') || '0');
    const { createWriteStream } = await import('fs');
    const { Readable } = await import('stream');
    const { pipeline } = await import('stream/promises');

    let downloadedBytes = 0;
    const reader = res.body.getReader();
    const readable = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) { this.push(null); return; }
        downloadedBytes += value.byteLength;
        onProgress?.(downloadedBytes, totalBytes);
        this.push(Buffer.from(value));
      },
    });

    await pipeline(readable, createWriteStream(destPath));
  }

  // -----------------------------------------------------------------------
  // Tier 2: Cloud processing
  // -----------------------------------------------------------------------

  async isCloudAvailable(): Promise<boolean> {
    if (!config.PROVISION_SERVICE_URL) return false;
    try {
      const res = await fetch(`${config.PROVISION_SERVICE_URL}/api/health`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok && ((await res.json()) as any).ok === true;
    } catch {
      return false;
    }
  }

  async submitCloudJob(pbfPath: string): Promise<string> {
    const chunks: Buffer[] = [];
    const { createReadStream } = await import('fs');
    for await (const chunk of createReadStream(pbfPath)) {
      chunks.push(chunk as Buffer);
    }

    const formData = new FormData();
    formData.append('pbf', new Blob([Buffer.concat(chunks)]), 'data.osm.pbf');

    const res = await fetch(`${config.PROVISION_SERVICE_URL}/api/provision`, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT },
      body: formData,
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) throw new Error(`Cloud submit failed: ${res.status}`);
    return ((await res.json()) as any).jobId;
  }

  async getCloudJobStatus(jobId: string): Promise<CloudProvisionStatus> {
    const res = await fetch(
      `${config.PROVISION_SERVICE_URL}/api/provision/${jobId}`,
      {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) throw new Error(`Cloud status failed: ${res.status}`);
    return (await res.json()) as CloudProvisionStatus;
  }

  async downloadCloudResult(downloadUrl: string, destDir: string): Promise<void> {
    const res = await fetch(downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`Cloud download failed: ${res.status}`);

    const { createWriteStream } = await import('fs');
    const { Readable } = await import('stream');
    const { pipeline } = await import('stream/promises');

    const archivePath = `${destDir}/cloud-indexes.tar.gz`;
    const readable = Readable.fromWeb(res.body as any);
    await pipeline(readable, createWriteStream(archivePath));

    const { execSync } = await import('child_process');
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { timeout: 300000 });

    const { unlink } = await import('fs/promises');
    await unlink(archivePath).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Tier selection
  // -----------------------------------------------------------------------

  /**
   * Determine the best provisioning method for the given viewport.
   * Returns: 'prebuilt' | 'cloud' | 'local'
   */
  async getBestMethod(
    bounds: { south: number; west: number; north: number; east: number },
  ): Promise<{ method: 'prebuilt' | 'cloud' | 'local'; region?: PrebuiltRegion }> {
    // Tier 1: check for pre-built archive
    const prebuilt = await this.findPrebuiltRegion(bounds);
    if (prebuilt) {
      return { method: 'prebuilt', region: prebuilt };
    }

    // Tier 2: check for cloud processing
    const cloud = await this.isCloudAvailable();
    if (cloud) {
      return { method: 'cloud' };
    }

    // Tier 3: local
    return { method: 'local' };
  }
}

export const provisionService = new ProvisionService();
