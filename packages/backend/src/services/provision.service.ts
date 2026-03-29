/**
 * Map provisioning service.
 *
 * Supports two paths:
 * 1. Cloud: upload PBF to a remote provisioning service, download pre-built
 *    Nominatim + OSRM indexes. Fast (~5 min) but requires internet + the
 *    service to be available.
 * 2. Local: process the PBF on-device. Slow (15-60 min on laptop, 1-3 hours
 *    on Pi) but always works.
 *
 * The provisioning service contract:
 *   GET  /api/health         → { ok: true }
 *   POST /api/provision      → { jobId: string }  (multipart PBF upload)
 *   GET  /api/provision/:id  → { status, progress?, downloadUrl?, error? }
 *
 * No private data is sent -- only OpenStreetMap map data (public).
 */

import { config } from '../config.js';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

const USER_AGENT = 'SafeCare/1.0';

export interface CloudProvisionStatus {
  status: 'queued' | 'processing' | 'ready' | 'error';
  progress?: number;
  message?: string;
  downloadUrl?: string;
  error?: string;
}

export class ProvisionService {
  /**
   * Check if the cloud provisioning service is available.
   */
  async isCloudAvailable(): Promise<boolean> {
    if (!config.PROVISION_SERVICE_URL) return false;

    try {
      const res = await fetch(`${config.PROVISION_SERVICE_URL}/api/health`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        return data.ok === true;
      }
    } catch {
      // Service not reachable
    }
    return false;
  }

  /**
   * Upload a PBF file to the cloud provisioning service.
   * Returns a job ID for polling.
   */
  async submitCloudJob(pbfPath: string): Promise<string> {
    const fileInfo = await stat(pbfPath);
    const fileStream = createReadStream(pbfPath);

    // Read file into buffer for fetch body
    const chunks: Buffer[] = [];
    for await (const chunk of fileStream) {
      chunks.push(chunk as Buffer);
    }
    const fileBuffer = Buffer.concat(chunks);

    const formData = new FormData();
    formData.append('pbf', new Blob([fileBuffer]), 'data.osm.pbf');

    const res = await fetch(`${config.PROVISION_SERVICE_URL}/api/provision`, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT },
      body: formData,
      signal: AbortSignal.timeout(120000), // 2 min upload timeout
    });

    if (!res.ok) {
      throw new Error(`Cloud provision submit failed: ${res.status}`);
    }

    const data = (await res.json()) as any;
    return data.jobId;
  }

  /**
   * Poll the cloud provisioning service for job status.
   */
  async getCloudJobStatus(jobId: string): Promise<CloudProvisionStatus> {
    const res = await fetch(
      `${config.PROVISION_SERVICE_URL}/api/provision/${jobId}`,
      {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) {
      throw new Error(`Cloud provision status failed: ${res.status}`);
    }

    return (await res.json()) as CloudProvisionStatus;
  }

  /**
   * Download the processed indexes from the cloud service.
   * Returns the path to the downloaded archive.
   */
  async downloadCloudResult(
    downloadUrl: string,
    destDir: string,
  ): Promise<void> {
    const { pipeline } = await import('stream/promises');
    const { createWriteStream } = await import('fs');
    const { Readable } = await import('stream');

    const res = await fetch(downloadUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!res.ok || !res.body) {
      throw new Error(`Cloud download failed: ${res.status}`);
    }

    const archivePath = `${destDir}/cloud-indexes.tar.gz`;
    const fileStream = createWriteStream(archivePath);
    const readable = Readable.fromWeb(res.body as any);
    await pipeline(readable, fileStream);

    // Extract the archive
    const { execSync } = await import('child_process');
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { timeout: 300000 });

    // Clean up archive
    const { unlink } = await import('fs/promises');
    await unlink(archivePath).catch(() => {});
  }
}

export const provisionService = new ProvisionService();
