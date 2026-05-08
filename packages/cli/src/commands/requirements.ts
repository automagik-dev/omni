/**
 * Requirements Command
 *
 * omni requirements [--json] [--check]
 *
 * Surfaces the compile-time peer-version manifest declared in
 * `packages/cli/src/lib/requirements.ts` (this wish, G6 of
 * pgserve-singleton-no-proxy).
 *
 * Output:
 *   - `--json` (handled globally — see packages/cli/src/index.ts:71-75)
 *     emits machine-readable JSON. Same shape as the
 *     `omni --requirements --json` contract documented in
 *     SHARED-DESIGN.md §3.3.
 *   - default — formatted object via `output.data()` (which renders a
 *     table when format=human, JSON when format=json).
 *
 * The flag-based variant `omni --requirements --json` is intentionally
 * NOT wired as a top-level program option. Top-level flags collide with
 * commander's own `--version` / `--help` semantics in the current
 * version-handling stack. The subcommand surface is byte-equivalent for
 * tooling: `omni requirements --json` produces the documented JSON
 * shape verbatim via the global `--json` argv strip.
 *
 * `--check` exits non-zero when ANY peer fails its requirement. Used by
 * `omni update` step 4 (preInstallPeerCheck) and `omni doctor` peer-row.
 */

import { Command } from 'commander';
import { REQUIREMENTS, checkAllPeers } from '../lib/requirements.js';
import * as output from '../output.js';

export function createRequirementsCommand(): Command {
  return new Command('requirements')
    .description('Show declared peer-version requirements (pgserve, genie) and live status')
    .option('--check', 'Exit non-zero if any peer fails its required version')
    .action(async (opts: { check?: boolean }) => {
      const peers = await checkAllPeers();
      const allOk = peers.every((p) => p.ok);

      // `output.data` selects between printObject (human) and JSON-stringify
      // (json) based on the global runtime format. The peers array is
      // surfaced verbatim so JSON consumers always get the documented
      // shape regardless of how output is rendered for humans.
      output.data({
        requirements: REQUIREMENTS,
        peers: peers.map((p) => ({
          name: p.name,
          required: p.required,
          current: p.current,
          ok: p.ok,
          ...(p.reason ? { reason: p.reason } : {}),
        })),
        ok: allOk,
      });

      if (opts.check && !allOk) {
        process.exitCode = 1;
      }
    });
}
