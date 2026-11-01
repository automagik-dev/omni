# Release note: agent key scope upgrade (#1462)

Tenant-owned turn-based dispatch now requires an active, system-provisioned
agent key with an explicit grant for its instance. No-tenant instances retain
the legacy single lookup by name without a membership check.

On every API startup, before dispatch starts, an idempotent repair revokes active
`system:auto-provision` keys whose names start with `agent:` and whose
`instance_ids` are NULL or empty. These unsafe credentials, including route-only
agent keys, are revoked once; their old secrets no longer work. Every existing
agent-bound instance then receives a fresh narrow key if it has no safe scoped
system key. The repair adds missing grants to safe existing keys using the
agent's declared scopes (or the existing turn defaults).

Both tenant-qualified and legacy candidate names are considered. A bare legacy
key is extended only when its existing instance grants prove the same agent and
tenant; a foreign tenant's key is never extended. Concurrent repairs serialize,
and bound instance rows stay locked while repairing grants. Repeated startups
change neither revoked keys nor already-correct replacements.

A route-only agent with no instance binding may stop answering after its widened
key is revoked. Startup logs one warning per revoked key it cannot re-provision,
naming the agent and the fix: bind the agent to an instance. Run
`omni instances update <instance-id> --agent <agent-id>` to provision a narrow
system key.

This is a startup step rather than a schema migration so it can reuse key hashing,
scopes, and cache invalidation from the key service. The runtime revokes unsafe
legacy global keys; under database enforcement each tenant's bindings are read
through its own runtime scope. No schema change or migration number is needed. Repair
failure stops startup before dispatch begins.

## Detect bindings without an explicit scoped system key

Run this read-only query with an authorized database identity. Row-level security
limits the result to the instances that identity can see.

```sql
SELECT i.id AS instance_id, i.name AS instance_name, i.tenant_id,
       i.agent_id, a.name AS agent_name
FROM instances AS i
JOIN agents AS a ON a.id = i.agent_id
WHERE NOT EXISTS (
  SELECT 1
  FROM api_keys AS k
  WHERE k.status = 'active'
    AND k.created_by = 'system:auto-provision'
    AND (
      k.name = 'agent:' || a.name
      OR (
        i.tenant_id IS NOT NULL
        AND k.name = 'agent:' || i.tenant_id::text || ':' || a.name
      )
    )
    AND i.id = ANY(k.instance_ids)
);
```

Bound instances should disappear from this result after startup reconciliation.
For no-tenant instances, this query checks explicit grants even though their
legacy dispatcher still resolves keys by name. Route-only agents have no bound
instance row and must be identified from the startup warning instead.

## Restore dispatch

If a binding still appears after startup, inspect the repair logs. To recover
through the normal assignment path, save its current agent ID from the query, then
unbind and rebind that same agent using the normal API or CLI:

```sh
omni instances update <instance-id> --agent null
omni instances update <instance-id> --agent <saved-agent-id>
```

The equivalent requests are `PATCH /api/v2/instances/<instance-id>` with
`{"agentId":null}`, followed by `{"agentId":"<saved-agent-id>"}`. Re-run the
detection query to confirm that the instance now has an explicit key grant.
Unbinding checks every matching system key, including legacy candidates, and
removes that instance from each scoped key that lists it.

A rebind that creates a replacement key does not show its one-time secret to
operators. Key changes are best effort: a failed revoke is logged while PATCH
returns 200, and bind/unbind are not locked. Check the logs and the detection
query after recovery.
