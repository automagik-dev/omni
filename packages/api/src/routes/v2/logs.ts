/**
 * Logs Routes - SSE streaming and recent logs
 *
 * Provides real-time log streaming via Server-Sent Events and
 * a REST endpoint for recent log history.
 */

import { zValidator } from '@hono/zod-validator';
import { type LogEntry, type LogLevel, getLogBuffer } from '@omni/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AppVariables } from '../../types';

export const logsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Parse comma-separated module filters
 */
function parseModules(modules?: string): string[] | undefined {
  if (!modules) return undefined;
  return modules
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * Query params for log streaming/filtering
 */
const logsQuerySchema = z.object({
  modules: z.string().optional().describe('Comma-separated module filters (supports wildcards: whatsapp:*)'),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info').describe('Minimum log level'),
});

/**
 * Query params for recent logs
 */
const recentLogsQuerySchema = logsQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(1000).default(100).describe('Maximum entries to return'),
});

/**
 * GET /logs/stream - SSE endpoint for real-time log streaming
 *
 * Streams logs as Server-Sent Events. Each log entry is sent as a 'log' event.
 * Heartbeat comments are sent every 30 seconds to keep the connection alive.
 *
 * @query modules - Comma-separated module filters (e.g., "whatsapp:*,api")
 * @query level - Minimum log level (debug/info/warn/error)
 */
logsRoutes.get('/stream', zValidator('query', logsQuerySchema), async (c) => {
  const { modules: modulesStr, level } = c.req.valid('query');
  const modules = parseModules(modulesStr);

  const buffer = getLogBuffer();

  return streamSSE(c, async (stream) => {
    // Send connected event with filter info
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({
        modules: modules ?? ['*'],
        level,
      }),
    });

    // Subscribe to new logs
    const unsubscribe = buffer.subscribe(
      async (entry: LogEntry) => {
        try {
          await stream.writeSSE({
            event: 'log',
            data: JSON.stringify(entry),
          });
        } catch {
          // Connection closed, unsubscribe will be called
        }
      },
      { level: level as LogLevel, modules },
    );

    // Send heartbeat every 30 seconds
    const heartbeatInterval = setInterval(async () => {
      try {
        await stream.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // Connection closed
        clearInterval(heartbeatInterval);
      }
    }, 30_000);

    // Wait for connection to close
    try {
      // This will block until the stream is closed
      await stream.sleep(Number.MAX_SAFE_INTEGER);
    } catch {
      // Stream closed
    } finally {
      clearInterval(heartbeatInterval);
      unsubscribe();
    }
  });
});

/**
 * GET /logs/recent - Get recent logs from buffer
 *
 * Returns the most recent log entries from the in-memory buffer.
 *
 * @query modules - Comma-separated module filters (e.g., "whatsapp:*,api")
 * @query level - Minimum log level (debug/info/warn/error)
 * @query limit - Maximum entries to return (1-1000, default 100)
 */
logsRoutes.get('/recent', zValidator('query', recentLogsQuerySchema), async (c) => {
  const { modules: modulesStr, level, limit } = c.req.valid('query');
  const modules = parseModules(modulesStr);

  const buffer = getLogBuffer();
  const entries = buffer.getRecent({
    level: level as LogLevel,
    modules,
    limit,
  });

  return c.json({
    items: entries,
    meta: {
      total: entries.length,
      bufferSize: buffer.maxSize,
      limit,
    },
  });
});
