# Prepare paired-agent journal indexes before upgrading

Paired-agents slice 2 adds four indexes on `omni_events`. Every build scans the
journal, including partial indexes. Boot migrations run in one transaction under
a 60 s startup budget; a blocking build on a large journal can exceed that budget.
Prepare the indexes online before replacing the serving binary. The boot guard
ignores `OMNI_PAIRED_AGENT_CONSUMERS`, so preparation is required even with the
flag unset. Production execution belongs to the operator.

## Stage and prepare the exact candidate

Keep the previous binary available. Stage the exact candidate release's source
checkout at the same commit as the new binary, and install its dependencies:

```sh
cd <candidate-checkout>
bun install --frozen-lockfile
cd packages/db
```

The old release's checkout cannot build slice 2's indexes. Choose an explicit
DDL-capable database URL for the intended deployment; the runner never reads
`DATABASE_URL`. Run the following from the candidate's `packages/db`:

```sh
bun run db:online-ddl --url <explicit-ddl-url> --check
bun run db:online-ddl --url <explicit-ddl-url>
bun run db:online-ddl --url <explicit-ddl-url> --check
```

`--check` is read-only: exit **3** means a large-table preflight is blocked and
online work is pending; exit **0** means the preflight is clear. Missing `--url`
exits **2**. A clear preflight can still have pending indexes on a small table.
Run the preparation even then; the final check must exit 0 and definitions must
match below. The run path adds nullable columns, drops any invalid or not-ready
owned indexes with `DROP INDEX CONCURRENTLY`, then builds with
`CREATE INDEX CONCURRENTLY IF NOT EXISTS`. It is resumable after interruption.
These operations still need brief catalog locks; schedule them accordingly.

## Verify definitions before starting the candidate

With the authorized DDL identity, inspect definitions and validity, not just names:

```sql
SELECT c.relname AS indexname, pg_get_indexdef(c.oid) AS indexdef,
       i.indisvalid, i.indisready
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND i.indrelid = 'public.omni_events'::regclass
  AND c.relname IN (
    'omni_events_instance_type_seq_idx', 'omni_events_source_type_seq_idx',
    'omni_events_agent_type_seq_idx', 'omni_events_producing_key_idx'
  )
ORDER BY indexname;
```

All four rows must have `indisvalid = t` and `indisready = t`, and match these
expected definitions (PostgreSQL's rendering):

```sql
CREATE INDEX omni_events_instance_type_seq_idx ON public.omni_events USING btree (instance_id, event_type, journal_seq) WHERE (instance_id IS NOT NULL)
CREATE INDEX omni_events_source_type_seq_idx ON public.omni_events USING btree (source_kind, source_id, event_type, journal_seq) WHERE (source_kind IS NOT NULL)
CREATE INDEX omni_events_agent_type_seq_idx ON public.omni_events USING btree (agent_id, event_type, journal_seq) WHERE (agent_id IS NOT NULL)
CREATE INDEX omni_events_producing_key_idx ON public.omni_events USING btree (producing_key_id) WHERE (producing_key_id IS NOT NULL)
```

The final `--check` reports missing, invalid or not-ready indexes as blockers
only when the table reaches the 1,000,000-row estimate threshold (or its bounded
probe reaches that threshold). Below it, exit 0 does not prove index readiness;
require both validity columns above to be `t` regardless of the estimate. Once
preparation and verification succeed, replace the serving binary and start the
candidate. Its ordinary `CREATE INDEX IF NOT EXISTS` migrations no-op over the
prepared indexes. Fresh or small databases can migrate in-band normally.

## Recover a binary that already refused to start

Stop the restart loop and keep the previous binary available. Without starting
the API, run the staged **candidate** runner's `--check`, run, and `--check`
sequence above. Verify all definitions, then start the new binary again. If
preparation cannot finish, return to the previous binary; the additive nullable
columns are harmless to it. Do not retry a blocking migration in a restart loop.

## Estimate limits and operator decisions

The guard reads `pg_class.reltuples`, a planner estimate. It blocks missing,
invalid or not-ready high-volume indexes at **1,000,000** estimated rows and
above. A never-analyzed table (`reltuples < 0`) uses a bounded probe of at most
that many rows. There is no exact-count probe. A stale low estimate can allow a
large journal through to an in-band build. The operator should run
`ANALYZE omni_events` before `--check` to refresh statistics.

`OMNI_ALLOW_BLOCKING_INDEX_BUILD=on` skips the boot guard and accepts the
downtime. This override and statistics refresh are operator decisions; automation
must never set the override. Neither the flag nor a clear estimate-based check
replaces the preparation and definition verification above.
