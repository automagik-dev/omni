/**
 * Processed Events API routes
 *
 * Placeholder router registered to prevent bare `GET /v2/processed-events`
 * from falling through to the root-mounted `automationsRoutes./:id` catch-all,
 * which would coerce the literal "processed-events" segment into a UUID and
 * surface raw PG driver text in the 500 body. See issue #496.
 *
 * The processed-events ledger (#411) has not yet landed on dev; this module
 * exists solely to reserve the path prefix and return a clean 404 until the
 * real handlers are implemented.
 */

import { Hono } from 'hono';
import type { AppVariables } from '../../types';

const processedEventsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * GET /processed-events - Not yet implemented.
 */
processedEventsRoutes.get('/', (c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'processed-events endpoints are not yet implemented. Tracking issue #411.',
      },
    },
    404,
  );
});

export { processedEventsRoutes };
