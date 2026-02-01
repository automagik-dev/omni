/**
 * Media routes - serve stored media files
 *
 * @see history-sync wish
 */

import { Hono } from 'hono';

import { MediaStorageService } from '../../services/media-storage';
import type { AppVariables } from '../../types';

const mediaRoutes = new Hono<{ Variables: AppVariables }>();

// Singleton media storage service (initialized lazily)
let mediaStorage: MediaStorageService | null = null;

function getMediaStorage(db: unknown): MediaStorageService {
  if (!mediaStorage) {
    // @ts-expect-error - db type mismatch
    mediaStorage = new MediaStorageService(db);
  }
  return mediaStorage;
}

/**
 * Validate path component to prevent path traversal attacks
 */
function isValidPathComponent(component: string): boolean {
  // Reject empty, dot sequences, or absolute paths
  if (!component || component === '.' || component === '..') {
    return false;
  }
  // Reject if contains path traversal patterns
  if (component.includes('..') || component.includes('\0')) {
    return false;
  }
  return true;
}

/**
 * Validate UUID format for instanceId
 */
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * GET /media/:instanceId/* - Serve stored media files
 *
 * Supports range requests for audio/video streaming.
 */
mediaRoutes.get('/:instanceId/*', async (c) => {
  const instanceId = c.req.param('instanceId');

  // Validate instanceId is a valid UUID
  if (!isValidUUID(instanceId)) {
    return c.json({ error: { code: 'INVALID_INSTANCE', message: 'Invalid instance ID format' } }, 400);
  }

  const path = c.req.path.replace(`/api/v2/media/${instanceId}/`, '');

  if (!path) {
    return c.json({ error: { code: 'INVALID_PATH', message: 'No path specified' } }, 400);
  }

  // Security: Validate path to prevent path traversal attacks
  // Check each path segment
  const pathSegments = path.split('/');
  for (const segment of pathSegments) {
    if (!isValidPathComponent(segment)) {
      return c.json({ error: { code: 'INVALID_PATH', message: 'Invalid path' } }, 400);
    }
  }

  // Additional check: reject paths starting with /
  if (path.startsWith('/')) {
    return c.json({ error: { code: 'INVALID_PATH', message: 'Invalid path' } }, 400);
  }

  // Build relative path
  const relativePath = `${instanceId}/${path}`;

  // Get media storage service
  const db = c.get('services');
  const storage = getMediaStorage(db);

  // Read the file
  const result = storage.readMedia(relativePath);

  if (!result) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404);
  }

  const buffer = result.buffer;
  const fileSize = result.size;
  const mimeType = storage.getMimeType(path);

  // Handle range requests for streaming
  const rangeHeader = c.req.header('Range');

  if (rangeHeader) {
    const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (matches?.[1]) {
      const start = Number.parseInt(matches[1], 10);
      const end = matches[2] ? Number.parseInt(matches[2], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      return new Response(buffer.subarray(start, end + 1), {
        status: 206,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }

  // Return full file
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000', // 1 year cache (content-addressable)
    },
  });
});

export { mediaRoutes };
