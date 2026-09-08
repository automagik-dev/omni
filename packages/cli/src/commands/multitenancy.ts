/**
 * Multitenancy Commands (read-only; issue #982)
 *
 * omni multitenancy status - Show the server's tenancy posture
 *
 * STRICTLY VISIBILITY, BY DESIGN
 * ------------------------------
 * There is deliberately no `enable`, no cutover, and no write of any kind
 * here: production cutover is receipt-gated and belongs to the separate
 * private production authority. `status` wraps the posture the server already
 * reports on the authenticated `POST /auth/validate` surface — it issues no
 * additional server-side queries.
 *
 * A server that reports no posture is itself an answer: it predates posture
 * reporting (and therefore the tenant control plane), which is one of the
 * three states an operator staring at a `/api/v2/platform` 404 needs to tell
 * apart. That case prints an explanation rather than fabricated defaults.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import { serverPostureFields } from '../lib/credential-status.js';
import * as output from '../output.js';

export function createMultitenancyCommand(): Command {
  const multitenancy = new Command('multitenancy').description('Multitenancy posture (read-only)');

  multitenancy
    .command('status')
    .description("Show the server's multitenancy flag, control plane, and DB enforcement posture")
    .action(async () => {
      const client = getClient();

      try {
        const result = await client.auth.validate();

        if (!result.server) {
          // Nothing invented: absence of the block IS the finding.
          output.data({
            posture: 'unreported',
            note:
              'This server does not report tenancy posture — it predates posture reporting ' +
              '(and likely the tenant control plane). Platform commands will 404 regardless of flags. ' +
              'Upgrade the server to get posture visibility.',
          });
          return;
        }

        output.data(serverPostureFields(result));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to read server posture: ${message}`, undefined, 2);
      }
    });

  return multitenancy;
}
