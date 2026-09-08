#!/usr/bin/env bun
/**
 * Platform credential bootstrap — operator entrypoint (issue #980).
 *
 * Creates (or validates / rotates) the ONE platform operator identity a fresh
 * deployment needs: an active principal, a `platform_api_keys` row, and its
 * PLATFORM-class `auth_credentials` index row — satisfying every invariant
 * `AuthBootstrapService.resolvePlatformContext` checks. Runs server-side
 * against the database directly, so it works before any API credential exists
 * and does not require a running API (verification resolves the credential
 * through the real in-process auth path).
 *
 * Safety properties:
 *   - Idempotent: a re-run with the same --subject/--key-name converges.
 *   - Rotation is explicit (--rotate); drift is reported, never auto-repaired.
 *   - Legacy god keys (`*` scope / unrestricted `api_keys`) are surfaced via
 *     the G6 report-only classifier and require --acknowledge-legacy-keys to
 *     proceed. NOTHING is ever converted or revoked.
 *   - The plaintext secret is printed exactly ONCE to stdout, never logged,
 *     and never part of the JSON report (which is redaction-scanned).
 *
 * Usage:
 *   bun scripts/bootstrap-platform-credential.ts --url postgres://USER:PASSWORD@DB_HOST:5432/omni
 *   bun scripts/bootstrap-platform-credential.ts                # uses DATABASE_URL
 *   bun scripts/bootstrap-platform-credential.ts --rotate       # replace credential material
 *   bun scripts/bootstrap-platform-credential.ts --acknowledge-legacy-keys
 *
 * Exit codes: 0 success (created/converged/rotated + verified), 1 usage/error,
 * 2 legacy god-key worklist requires a decision, 3 blocked (drift/conflict),
 * 4 credential written but failed in-process verification.
 */

import { parseArgs } from 'node:util';
import { z } from 'zod';
import { PlatformBootstrapService } from '../packages/api/src/services/platform-bootstrap';
import type { ToolingSql } from '../packages/db/src/backfill/db';
import { auditLegacyKeysForBootstrap } from '../packages/db/src/backfill/legacy-key-gate';
import { assertNoSecrets } from '../packages/db/src/backfill/redaction';
import { createDbHandle, createPostgresClient } from '../packages/db/src/client';

const USAGE = `Usage: bun scripts/bootstrap-platform-credential.ts [options]

Options:
  --url <postgres-url>        Database URL (defaults to DATABASE_URL)
  --subject <subject>         Principal subject (default: platform-operator)
  --key-name <name>           platform_api_keys name (default: platform-operator)
  --display-name <name>       Display name when creating the principal
  --principal-type <type>     human | service (default: service)
  --scope <scope>             Credential scope, repeatable (default: platform:*)
  --description <text>        Optional platform key description
  --rotate                    Replace the credential material for the same key
  --acknowledge-legacy-keys   Proceed despite an unclassified legacy god-key
                              worklist (converts NOTHING; the worklist remains)
  --help                      Show this help
`;

const ArgsSchema = z.object({
  url: z.string().url(),
  subject: z.string().min(1),
  keyName: z.string().min(1),
  displayName: z.string().min(1).optional(),
  principalType: z.enum(['human', 'service']),
  scopes: z.array(z.string().min(1)).nonempty(),
  description: z.string().optional(),
  rotate: z.boolean(),
  acknowledgeLegacyKeys: z.boolean(),
});

function parseCliArgs(argv: string[]): z.infer<typeof ArgsSchema> | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      subject: { type: 'string', default: 'platform-operator' },
      'key-name': { type: 'string', default: 'platform-operator' },
      'display-name': { type: 'string' },
      'principal-type': { type: 'string', default: 'service' },
      scope: { type: 'string', multiple: true },
      description: { type: 'string' },
      rotate: { type: 'boolean', default: false },
      'acknowledge-legacy-keys': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return null;
  }
  const url = values.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('no database target: pass --url or set DATABASE_URL');
  }
  return ArgsSchema.parse({
    url,
    subject: values.subject,
    keyName: values['key-name'],
    displayName: values['display-name'],
    principalType: values['principal-type'],
    scopes: values.scope && values.scope.length > 0 ? values.scope : ['platform:*'],
    description: values.description,
    rotate: values.rotate,
    acknowledgeLegacyKeys: values['acknowledge-legacy-keys'],
  });
}

/** Display form of the target with credentials stripped. */
function describeTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args) return 0;

  process.stdout.write(`platform-bootstrap: target ${describeTarget(args.url)}\n`);

  // Direct client for the report-only legacy-key classifier.
  const sql = createPostgresClient({ url: args.url, maxConnections: 1 }) as unknown as ToolingSql;
  const handle = createDbHandle({ url: args.url, maxConnections: 4 });
  try {
    // 1. Legacy god-key gate — report-only, requires an explicit decision.
    const legacyKeys = await auditLegacyKeysForBootstrap(sql);
    if (legacyKeys.requiresExplicitDecision && !args.acknowledgeLegacyKeys) {
      process.stdout.write(`${JSON.stringify({ legacyKeys }, null, 2)}\n`);
      process.stderr.write(
        `platform-bootstrap: ${legacyKeys.godKeyWorklist.length} active legacy god key(s) (scope '*' or unrestricted) need an explicit owner + purpose classification decision. Nothing was written.\nReview the worklist above, then either revoke/scope those keys or re-run with --acknowledge-legacy-keys to bootstrap anyway (the legacy keys are NEVER converted or revoked).\n`,
      );
      return 2;
    }

    // 2. Converge the platform principal + key + credential triple.
    const service = new PlatformBootstrapService(handle.db);
    const { report, secret } = await service.bootstrap({
      subject: args.subject,
      keyName: args.keyName,
      displayName: args.displayName,
      principalType: args.principalType,
      scopes: args.scopes,
      rotate: args.rotate,
      description: args.description,
    });

    // 3. Emit the redaction-scanned report (never contains the secret).
    const fullReport = { bootstrap: report, legacyKeys };
    assertNoSecrets(fullReport, 'platform bootstrap report');
    process.stdout.write(`${JSON.stringify(fullReport, null, 2)}\n`);

    if (report.status === 'blocked') {
      process.stderr.write('platform-bootstrap: blocked — nothing was written. See reasons above.\n');
      return 3;
    }
    if (!report.verification.ok) {
      process.stderr.write(
        'platform-bootstrap: credential state was written but FAILED in-process verification — ' +
          'investigate before using it.\n',
      );
      return 4;
    }

    // 4. Plaintext shown exactly once. Never logged, never stored, not in the report.
    if (secret) {
      process.stdout.write(
        `\nPLATFORM CREDENTIAL SECRET — shown once, never stored or logged. Save it now:\n${secret}\n`,
      );
    } else {
      process.stdout.write('\nConverged: the existing credential is valid. No new secret was generated.\n');
    }
    return 0;
  } finally {
    await handle.close().catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`platform-bootstrap: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
