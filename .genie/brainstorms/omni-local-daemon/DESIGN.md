# Design: Omni local daemon — a built-in, sandboxed Omni the desktop app runs

| Field | Value |
|-------|-------|
| **Slug** | `omni-local-daemon` |
| **Date** | 2026-10-23 |
| **Status** | DRAFT: open questions below |

## Problem

The desktop app connects only to an Omni that already exists somewhere. A person who
downloads it has nothing to connect to: there is no "run Omni here". Today a local Omni
is the CLI service path (`omni install`), which needs `bun` and `pm2` on PATH and runs
`omni-api` and `omni-nats` under PM2. Its Postgres is the machine-wide autopg on 5432,
shared with genie and others, with its data in `~/.pgserve`, outside `~/.omni`. The ports
are fixed (8882, 4222, 5432) and the API binds every interface. Self-healing is PM2's ten
restarts plus a manual `omni doctor --fix`. The release tarballs carry only the CLI, so they
cannot run a server. The labs wish deferred "local Omni inside the app" on purpose
(`.genie/wishes/omni-labs-distribution/WISH.md`, Out of scope).

## Outcome

Opening the app for the first time offers **Run Omni on this computer** next to **Connect
to my Omni**. Choosing it starts a local Omni the app owns: no terminal, no PM2, nothing
outside `~/.omni`, reachable only from this machine. The person claims it as its owner
(their WhatsApp number, the human ID the login redesign already uses; Tactu stores its owner
verifier as a salted hash readable only by the daemon and the doctor, and so does this), links WhatsApp by
scanning a QR, and is live. An existing Omni on the machine is detected and offered a
one-click move into the new daemon. The daemon keeps itself healthy and says so, and
`omni doctor` explains and repairs what it cannot.

## What it takes from Tactu

Tactu (the `droid` repo, `dev` branch: `infra/deploy.mjs`, `docs/OPERATIONS.md`, the
`tactu-deploy` and `droid-oss-bundle` designs) already runs a self-healing deployer and has
designed its doctor. This daemon follows it:

- **The platform supervises, not a loop of ours.** On Linux, systemd user units:
  `Restart=on-failure`, `RestartMode=direct`, `StartLimitBurst`, `OnFailure=` (acting only once
  the start limit is hit), `Type=notify` with `READY=1`, `UMask=0077`, `NoNewPrivileges` and
  memory caps. On macOS, launchd `KeepAlive` plus our own record of starts.
- **The healer is apart from what it heals.** Rollback and the doctor run from a pinned copy
  outside every release (`~/.omni/bin/omnid`): never restart from the interpreter being replaced.
- **Restart policy, taken as-is:**
  - A single crash only restarts.
  - A crash loop rolls back only a *new* release, within its bake window: 15 minutes, gates
    every minute, three failures in a row.
  - A promoted release is never rolled back by health. It gets backoff restarts of 1, 2, 4,
    8 and 16 minutes, capped at 30, reset after 60 healthy minutes.
  - Anything else raises `needsOwner`, which stops automation until the owner clears it.
- **Layered probes per service, in order:**
  1. The unit is active and stable (no new restarts in 30 s).
  2. Its socket or CLI answers.
  3. A protocol smoke that changes nothing.
  4. Remote telemetry, advisory only: `inconclusive` when unreachable.

  For Omni that is: `pg_isready` → the NATS monitor and JetStream → `GET /api/v2/health` →
  a read-only API call.
- **Doctor: plain checks, no model, a verdict per check.**
  - Diagnosing is automatic. Fixing comes from a closed list.
  - Each fix is proposed with a single-use id that expires in 15 minutes, and applied only
    after the owner's yes ("it tells you first, and fixes only after your yes").
  - A small list of automatic restarts starts empty at install; the owner adds to it.
  - Exit codes are 0 (done or nothing to do), 1 (refused or rolled back), 2 (config error) and
    3 (needs the owner), with `--json`.
  - The doctor's own page keeps working while the daemon is down.
- **Install and move as transactions with inverses.** `install --check` prints the plan and
  its inverses, and `--undo` reverts. Moving an existing install is a **cutover**: pin the old
  build as `legacy`, snapshot the data with its services stopped, then switch. Migrations are
  append-only and checked before they apply; data is restored only when the schema changed.
- **Receipts:**
  - `journal.jsonl`: one line per step (`at, op, step, result, detail`).
  - `alerts.jsonl`, `state.json`, a failure log per release, and a `FREEZE` file.
  - An O_EXCL lock that is taken over when its pid is dead.
  - Alerts go to the journal and the app. Never to WhatsApp.
- **Before any password prompt:** check the machine (disk, memory, OS) first. When root is
  needed at all, list the steps in plain words and ask once. The daemon itself needs none.

## Shape

### One supervisor: `omnid`

A single long-running process, the only thing started at login, that owns three
children and nothing else:

| Child | What | Where |
|---|---|---|
| Postgres 18 | its own cluster, never the shared autopg | `~/.omni/daemon/pg/` |
| NATS JetStream | the pinned nats-server | `~/.omni/daemon/nats/` |
| API | the server bundle (`dist/server`) on a bundled Bun | — |

- **Sandboxed.** Every child binds loopback only. Postgres listens on a Unix socket in
  `~/.omni/daemon/run/`, NATS and the API on ports picked at first start and kept in
  `~/.omni/daemon/state.json`, so they never fight an existing install for 8882, 4222 or
  5432. The API gets `API_HOST=127.0.0.1`. The database role is scoped; there is no
  `postgres:postgres`.
- **Ordered.** It starts Postgres, waits until it is ready, then NATS, then the API, whose boot
  migrations run under their advisory lock. It stops them in reverse order.
- **Self-healing.** Restarts are driven by health, not just by exit. It probes each child (a
  Postgres query, NATS `/healthz`, the API's `/api/v2/health`). A failing child restarts
  with backoff, and its dependents restart after it. A crash loop stops trying and raises
  a visible fault instead of spinning. Every few minutes it runs the safe `doctor` checks
  (stale `postmaster.pid`, stale lock files, port taken, disk low, a migration pending, a
  JetStream stream unhealthy) and fixes the safe ones itself.
- **Started at login without root.** A launchd user agent on macOS, a `systemd --user`
  unit on Linux (WSL: started by the app). `omnid` writes and removes its own unit.
- **One status surface.** `~/.omni/daemon/status.json`, plus a loopback status route, say what is
  running, what was repaired and what needs the person. The desktop app shows it, and
  `omni status` reads it.

### What ships where

- **The app does not carry the backend in its download.** On first "Run Omni on this computer",
  the app downloads the daemon bundle for its platform from the Omni release matching its
  own version (one version, as with the plugins): `omnid`, the server bundle, a Bun
  runtime, nats-server and Postgres 18 binaries, checked against `SHA256SUMS` as `omni
  desktop` already does. Keeping the backend out of the dmg keeps it at about 330 MB.
  Someone who only connects to a remote Omni never downloads the backend at all.
- **The same bundle backs the CLI.** `omni install` and `install.sh` move onto `omnid`, and
  PM2 is retired from the default path. So the release tarballs become runnable servers,
  which closes the gap that they carry only the CLI today.

### `~/.omni` layout

```
~/.omni/
  config.json            the CLI's (apiUrl, apiKey, servers), unchanged
  daemon/
    state.json           ports, version, owner claimed, last migration
    status.json          the health surface
    pg/  nats/  media/  logs/  run/
    bin/                 omnid, bun, nats-server, postgres (the downloaded bundle)
  desktop/               the app's DSH and UI, as today
```

Every path derives from one home (`OMNI_HOME`, default `~/.omni`). The hard-coded
`homedir()/.omni` in the CLI's data, logs, NATS and `scoped-role.json` paths changes to
use it.

### First run: claim and connect, nothing typed

1. **Run Omni on this computer**: download (with progress), start `omnid`, wait for healthy.
2. **Claim**: the person enters their WhatsApp number once (the human ID from the login
   redesign), then links WhatsApp by scanning the QR the channel already shows. The first
   message to themselves proves the number; they are now the owner.
3. **The app links itself**: it is on the same machine, so it gets its device key from the local
   daemon directly, with no QR, URL or key typed. It writes the key to `~/.omni/ui/omni.json`.

**Connect to my Omni** (a remote one) starts on that Omni, not in the app, so nothing is
typed and nothing passes through a service of ours. The person opens their Omni in the
browser at `/api/login/app` and chooses "Open in the Omni app". That is an
`omni://connect?url=<the Omni's address>` link, and the app registers the scheme. A link
carries an address and nothing else. The app shows the host and asks before it starts, then
runs the device sign-in against that Omni. The person approves it on the Omni's own page with
a passkey, or with a code sent to themselves on WhatsApp. The Omni then mints the device key,
and the app writes it to `~/.omni/ui/omni.json`. There is no hosted relay. Typing the address,
or pasting an API key, stay available, hidden under "Other ways".

### Moving an existing install in

`omnid` detects what the CLI's reinstall detection already finds: `config.json`, PM2 entries
`omni-api`/`omni-nats`/`omni-v2-*`, an `omni` database on the shared autopg,
`~/.omni/data/pgserve` from before the autopg cutover, and the media and NATS stores under
`~/.omni/data`. It also records how the old API is reached: its port, its bind address
(`API_HOST`), and whether any API key was last used from somewhere other than loopback
(`api_keys.last_used_ip`). Then it offers the move, in this order. The old install is
fenced before any snapshot is taken, so no write can land after the copy.

1. **Survey, still live.** Read the old NATS monitor (`/jsz?streams=true&consumers=true`)
   and keep, per stream, the message count and last sequence, and per durable consumer, the
   delivered sequence, the ack floor, `num_pending` and `num_ack_pending`. Write them, the
   instance count and the bind survey into a manifest in `~/.omni/backups/`.
2. **Fence.** Stop the old writers: `pm2 stop` (not delete) on `omni-api` and every
   `omni-v2-*` process. The channels disconnect and webhooks get no answer. The senders retry
   later; Omni holds no buffer of its own outside the database and JetStream. Then stop
   `omni-nats`, so its store is quiet on disk.
3. **Snapshot.** Run `pg_dump` of the `omni` database into `~/.omni/backups/`. Nothing writes
   to it now, so the dump is final.
4. **Restore.** Restore the dump into the daemon's own cluster and copy media. **Copy the
   JetStream store directory as-is** (`<dataDir>/nats`, the `-sd` the CLI passes) into
   `~/.omni/daemon/nats/`, with both servers stopped. Recreating the streams would lose
   retained messages, pending and unacknowledged deliveries, and every consumer's position.
   Consumers resume only through JetStream: `NatsEventBus.subscribeInternal`
   (`packages/core/src/events/nats/client.ts`) creates or updates a durable consumer, then
   consumes it. The database offsets only drive gap monitoring, never a start position.
   Copying is safer than draining to zero pending. A drain needs the old API consuming while
   nothing new arrives, which is the fence and the API at the same time, and a consumer
   stuck in redelivery never drains. The copy needs two conditions: the daemon's pinned
   nats-server is the same version as the old one or newer, and both use the default
   account. If either fails, the move stops here, before anything is switched, and says why.
5. **Keep the identity and the address.** The `__primary__` API key and the instance
   credentials come along. A moved install also keeps its old API port and bind address
   instead of picking new ones: `state.json` records them as inherited. So devices paired
   from other machines, and a proxy or tailnet in front of the old port, still reach it.
   `config.json` needs no change. A fresh install stays loopback-only on a port of its own.
   Only a moved install keeps exposure it already had, and status shows it as inherited.
6. **Verify** on the daemon before declaring success:
   - the API is healthy;
   - the instance count matches the manifest;
   - every stream's message count and last sequence match;
   - every durable consumer's delivered sequence and ack floor match (consumers are
     read from the copied store before the API starts);
   - the channels reconnect;
   - the old address answers from the daemon.

   Only then does it delete the PM2 entries (`pm2 delete`, `pm2 save`). The shared autopg and
   its `omni` database are left alone, never dropped. The person can remove them later from
   `omni doctor`.
7. **Roll back** if any step fails: stop the daemon, start the old NATS and then the PM2
   entries, exactly as they were, and report what failed. The old database and store were
   only read, so the old install picks up where it stopped.

Reuse: `install-helpers.ts` reinstall detection, `legacy-cleanup.ts`,
`embedded-canonical-migration.ts`, the pg_dump/psql path in `canonical-pgserve.ts`, and
`runtime-env.ts`'s hermetic environment.

### `omni doctor`, keyed to the daemon

Today about half the checks are PM2-specific. With a daemon the checks become: the daemon
is installed and running, it starts at login, each child is healthy, ports are free and
owned by us, the Postgres cluster is consistent and its version matches, migrations have
run, JetStream is healthy, there is disk headroom, the CLI and daemon versions match, the
owner is claimed, and whether leftovers of an old install remain. After a move it also
checks for a **stranded device**: an API key last used from a non-loopback address before the
move that has not been seen since, while the old address no longer answers from the daemon.
It reports which device and since when, and offers two repairs: restore the inherited bind, or
send that device a fresh connect (`/api/login/app`). `--fix` runs the same repairs the
supervisor runs automatically, plus the ones it never runs alone (the move, cleaning up an
old install, a version change of Postgres).

## Decisions to take

Decided: remote connect is an `omni://` link from the Omni's own page, then a passkey or
WhatsApp sign-in on that Omni. No relay is hosted.

1. **Postgres binaries.** Fetch autopg's PG 18 build per platform (the version we already
   run), or ship plain upstream binaries? Each is 30–60 MB per platform.
2. **The CLI path.** Should `omni install` move to `omnid` in the same release (one runtime,
   PM2 gone), or after the desktop path has run for a release?

## Not in scope

- Windows outside WSL.
- Multiple local Omnis per user.
- Exposing a fresh local daemon to the LAN or the internet. The tailnet gate
  (dev/omni-ui.mjs) stays the way to reach a machine remotely. A moved install keeps only
  the exposure it already had (see the move).

## Risks

| Risk | Mitigation |
|---|---|
| Memory: the app is about 1.0 GB RSS idle before the backend | Measure the daemon's RSS on first build (Postgres with small `shared_buffers`, NATS memory caps); show it in status. |
| A move loses data | Fence the old writers before the snapshot, copy the JetStream store rather than recreate it, verify streams and consumer positions, never drop the old database, roll back on failure. |
| A move strands devices on other machines | Keep the old port and bind for a moved install; doctor flags a remote key not seen since the move and offers a fresh connect. |
| Two Omnis competing for one WhatsApp session | The fence stops the old API before the daemon's channels connect; doctor flags two live sessions. |
| Start-at-login units outliving an uninstall | `omnid uninstall` removes its units; the app's uninstall notes say how. |
