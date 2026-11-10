# Operational ground rules

These references support operational peer skills; this directory is not a skill or router.

- Verify the selected server and credentials before interpreting results: `omni server current --json`, `omni status --json`, `omni auth status --json`. A credential or scope denial does not prove server downtime. Use global `--server <name>` for a per-command target.
- Discover installed options with `omni --help` and the relevant group's help. Add `--json` to output you parse and select only needed fields with `jq`. Never print keys or config secrets.
- Within the authorized task, use reads, estimates and dry-run tests to inspect state. `automations test --execute` runs real actions and has the same effect boundary as `automations execute`.
- Following a durable consumer normally advances its cursor. `events follow --no-ack` omits acknowledgement but still pulls and can claim a shared lease. Use consumer `inspect` for metadata-only reads.
- Pause for the user before destructive or irreversible operations: deleting or logging out instances, deleting keys, merging persons, abandoning dead letters, executing automations against production traffic, flipping live access modes, or large batch jobs.
- Discovery does not authorize sending, changing trust, widening scope or tenancy, or changing a runtime. Preserve the user's target and authorization boundaries.
- Report what commands actually returned. A change counts as done when a follow-up read confirms it. Distinguish configuration, runtime health and observed channel delivery.
