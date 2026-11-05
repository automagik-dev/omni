# Sandboxed local Omni

`omni install --sandbox` puts a second, self-contained Omni on this computer. It
shares nothing with an existing install, so it is safe on a machine that already
runs Omni, autopg/pgserve or PM2.

| | Normal `omni install` | `omni install --sandbox` |
|---|---|---|
| Config | `~/.omni/config.json` | `<home>/config/config.json` (mode 0600) |
| Postgres | the shared autopg/pgserve on 5432 | its own cluster (autopg or pgserve `postmaster`), own socket dir |
| NATS | `~/.omni/nats-server` on 4222 | `<home>/bin/nats-server` on its own port |
| API | 8882 | its own port, bound to 127.0.0.1 |
| Supervisor | PM2 | `omni sandbox run` (one process, no PM2, no node) |
| At login | `--systemd` (sudo) | `--at-login`: launchd agent / `systemd --user` unit, no sudo |

`<home>` is `--home`, else `$OMNI_HOME/sandbox`, else `~/.omni/sandbox`: one
sandbox, whether the CLI or the Automagik app installed it. Ports are picked once
(18882, 15432 and 14222, or the next free ones) and kept in
`<home>/sandbox.json`. The runtime carries the same `@automagik/omni` version as
the CLI that installed it. Running a newer CLI's `omni install --sandbox` moves
it to that version, keeping data, ports and the API key.

## Who runs the supervisor

With `--at-login`, the launchd agent or `systemd --user` unit does, at every
login. Without it, the supervisor still goes to the user's service manager, for
this login only: a transient `systemd --user` service
(`omni-sandbox-<hash>-session.service`, collected once it stops) or a launchd
job in the GUI domain whose plist stays in `<home>/run`. So it belongs to
neither the CLI nor whatever ran the CLI. An app that runs `omni install
--sandbox` in a terminal and then ends that terminal's whole process range (a
systemd scope, a process tree) leaves the sandbox running. Where there is no
service manager to ask (no systemd user session, an ssh login on macOS), it is
a detached child instead. `omni sandbox stop` stops whichever it is.

## Channel configuration environment

The supervisor passes only these app-level channel keys to the API child, when set:

| Key | Purpose |
|---|---|
| `META_APP_SECRET` | Meta webhook and Flows signature verification |
| `META_VERIFY_TOKEN` | Meta webhook verification challenge |
| `META_APP_ID` | Meta Embedded Signup and profile-photo uploads |
| `META_GRAPH_API_VERSION` | Override the persisted Meta Graph API version |
| `META_FLOWS_PUBLIC_BASE_URL` | Public callback base URL for endpoint-backed (dynamic) Flows |

Configure these in the **supervisor's** environment. For an at-login Linux sandbox, use
`systemctl --user edit <sandbox-unit>.service` with a drop-in such as:

```ini
[Service]
Environment="META_APP_SECRET=<app-secret>"
Environment="META_VERIFY_TOKEN=<verify-token>"
```

Reload and restart the sandbox unit after changing it. This Linux `--at-login` drop-in
survives installs and in-app updates. Keep configuration files containing secrets private
to your user.

The other supported path is a foreground `omni sandbox run --home <dir>` (including
`--embedded` when an app runs the supervisor directly): provide the keys in that process's
environment. Exporting keys in the shell running `omni install --sandbox` or
`omni sandbox start` does **not** work for the default sandbox, even for a new job: the
launcher strips them before starting the supervisor.

macOS has **no durable configuration path yet**. Omni regenerates the at-login launchd
plist on install and in-app update, and the session plist on start. Hand-added environment
entries are lost. Use a foreground `omni sandbox run` with the keys in its environment.

On boot, `<home>/logs/supervisor.log` lists the **names** of nonempty allowlisted keys passed
to the API (or `none`), never their values. Empty values are forwarded unchanged but are
not counted as configured in the log. These keys are not stored in `sandbox.json`, and Postgres
and NATS do not inherit them. All other parent variables remain excluded except the basic
shell environment; database, API key, NATS and media paths remain sandbox-owned. There is
no `META_*` or `OMNI_*` prefix passthrough.

Other channels use per-instance credentials. Their optional environment settings for
WhatsApp timing, presence, rate limits, caches and debug output, Discord debug output,
A2A/ASC Flow timeouts and remote S3 media are not inherited; sandboxes keep the defaults
and their local media directory.

## Commands

```sh
omni install --sandbox [--home <dir>] [--at-login] [--no-start] [--package <spec>]
                       [--pg-password-file <file>] [--autopg-tarball <file>] [--json]
omni sandbox status    [--home <dir>] [--json]
omni sandbox start     [--home <dir>] [--json]
omni sandbox stop      [--home <dir>] [--json]
omni sandbox uninstall [--home <dir>] [--purge] [--json]
omni sandbox run       [--home <dir>] [--embedded]   # the supervisor; launchd/systemd, or an app, start this
omni sandbox update    [--home <dir>] [--to <version>] [--json]   # what its API runs to update it
```

With `--json`, each command prints one line:

```json
{"ok":true,"installed":true,"home":"…","version":"2.261023.8","apiUrl":"http://127.0.0.1:18882",
 "configPath":"…/config/config.json","running":true,"healthy":true,"atLogin":false,
 "ports":{"api":18882,"pg":15432,"nats":14222},"pid":4242,"logsDir":"…/logs"}
```

On failure it prints `{"ok":false,…,"error":"…"}`. Exit codes:

- `0`: ok
- `1`: failed, for example the API did not answer within 3 minutes
- `3`: no sandbox at that home

The API key never appears in the output. To read it, or to point the CLI at the
sandbox, use its config: `OMNI_CONFIG_DIR=<home>/config omni status`.

`uninstall` stops the sandbox and removes its runtime and at-login unit. It
keeps the data and config, so a later install picks them up again. `--purge`
deletes the whole home.

## Updates from the app

The Automagik app can update a sandbox without a terminal. The app shows that an update is out,
asks you to be sure, and asks the sandbox's API (`POST /api/v2/system/update`). Elsewhere the
owner confirms an update on WhatsApp. A sandbox listens only on 127.0.0.1 and may have no
WhatsApp, so the app's yes is enough: the install sets `OMNI_UPDATE_CONFIRM=app`, which the API
honours only while `API_HOST` is loopback.

The API then runs `omni sandbox update` from the sandbox's own runtime, with the version in
`OMNI_UPDATE_VERSION`. That command runs inside the sandbox's service, which the update has to
stop, so it hands the work off: `omni install --sandbox` of that version runs in a transient
`systemd --user` service of its own on Linux, or a detached process of its own elsewhere. It
keeps the ports, the key, the data and the at-login choice, and logs to `<home>/logs/update.log`.
When the API comes back on the new version, it records that the update finished.

The sandbox passes that log to the API as `OMNI_UPDATE_LOG`. When an update does not complete,
the owner's message and the `system.update.finished` reason say why, from the result the install
logged: a Bun mismatch in fixed words ("It needs Bun 1.4.4; this computer has 1.3.9."), anything
else as a pointer to `<home>/logs/update.log`. No text from the log itself is sent. Without a
result written after the update started (none yet, a log cut short or too large to read, or an
update recorded by an older Omni), the message stays the plain one.

The update only takes a version npm publishes on the sandbox's channel (`latest`, or `next` for a
prerelease), and only one update runs at a time.

## External system service (Linux)

A system unit can run a sandbox without a systemd user manager. Install it once with
`omni install --sandbox --home /var/lib/omni/sandbox --no-start`, as its service user,
and keep `atLogin=false`. An administrator can install this unit; updates themselves
run as `omni`, without root or permission to stop/start system units:

```ini
[Unit]
Description=Omni sandbox
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=omni
WorkingDirectory=/var/lib/omni/sandbox
Environment=HOME=/var/lib/omni
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/bun /var/lib/omni/sandbox/runtime/node_modules/@automagik/omni/bin/omni sandbox run --home /var/lib/omni/sandbox
Restart=always
RestartSec=5
KillMode=control-group
TimeoutStopSec=660
RuntimeMaxSec=infinity
WatchdogSec=0
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
```

Use the actual pinned Bun path and a home writable only by the service user.
Set `TimeoutStopSec` to at least 660 seconds, above the ten-minute install deadline
and its shutdown grace; allow more time for slow drains or large backup copies.
`Type=exec` also works. The unit must run the supervisor as its main PID, use
`Restart=always` and `KillMode=control-group` or `mixed`, and have no watchdog or runtime deadline. `ExitType`, on systemd
versions that support it, must remain `main`. Do not use `--at-login` with an external
system unit. The service user must be able to read its supervisor's `/proc/<pid>/cgroup`
and query the unit with `systemctl show`; neither requires root in a normal systemd setup. A working system D-Bus is required.

The update detects the supervisor's system-service cgroup, including a system unit
whose name happens to equal Omni's user-unit name. It checks the unit settings and
the running supervisor's update protocol before doing anything destructive. Unsupported
settings, an unreadable cgroup, an incompatible supervisor, an existing recovery backup,
or absolute install symlinks or links outside the protected install directories cause an immediate refusal:
"In-app update is unavailable for this system service; update it manually first."
No installer is detached into the unit and no 15-minute wait is needed for this refusal.

The compatible supervisor accepts the request, stops API, NATS and Postgres in order,
and keeps its own PID alive. This keeps the unit active: systemd neither kills the
installer's cgroup nor races the install by restarting an old runtime. Once all children
have exited, the supervisor preserves independent copies under `<home>/.update-backup`
(without sharing Bun cache hardlinks), and runs the target CLI's install with `--no-start`. Runtime,
autopg, pgserve tooling, NATS, config and sandbox state are protected; the data directory
is never replaced. New concurrent sandbox start/stop/install commands are refused during
this maintenance window. Allow enough free disk space for another copy of the install.

The installer has a ten-minute deadline. On timeout its entire process group is killed,
and rollback waits for the installer to close. If that cannot be confirmed, the backup
stays for operator recovery rather than racing possible writers. If install fails and
rollback completes, the same supervisor restarts the old Postgres, NATS and API. The
owner gets a mapped failure reason, including a timeout or the required/current Bun
versions when applicable. On success the supervisor exits as its final step, and the
external unit starts the new runtime. Migrations run on the new API's boot, after install.

Readiness still means that a child's port answers, including an API returning HTTP 503.
A persistent 503 (for example an old dead letter) never stops or restarts the sandbox.
Only backup retirement requires HTTP 200: the new supervisor checks every five seconds
until health succeeds. Until then the backup stays and `logs/update.log` records a fixed
unhealthy reason. Identical consecutive refused-boot/health result lines are not repeated.

A retained backup blocks later in-app updates. To keep the new version after a lasting
503, confirm the backup manifest is `installed` and its `to` matches the running version,
then stop the external unit and confirm its processes have exited. Move the entire
`.update-backup` directory to an archive outside the sandbox home, without restoring
its components, and start the unit again. This keeps the new install, preserves an
operator rollback archive, and permits later updates. Resolve the degraded health
condition separately; archiving the backup does not fix it.

Crash recovery distinguishes copying from installation. `.update-backup/manifest.json`
starts in `backing-up`, changes to `installing` only after every protected component was
copied, then to `installed` after a verified install. A boot with `backing-up`, or a backup
directory with no manifest, discards that partial copy, records the fixed interrupted-backup
reason, and starts the untouched old install. Never restore a partial `backing-up` copy.
An `installing`, invalid, or wrong-version manifest refuses boot and retains the backup.

`run/update-owner.json` is a 30-minute maintenance lease bound to Linux boot identity,
process start time, PID and a random installer token. A dead process or a different
process incarnation cannot block boot through PID reuse (even when kill-zero returns
EPERM). An unreadable identity, legacy/malformed lease, or expired possibly-live lease
refuses boot with a mapped lease-recovery reason. Expiry never authorizes racing a
possibly live installer. To recover: stop the external system unit and confirm all its
installer/child processes have exited, then archive/remove `run/update-owner.json` and
`run/update-request.json`. Do not remove a live lease merely because its deadline passed.

With the unit stopped, inspect the manifest. Discard a `backing-up`/missing-manifest copy;
for an interrupted `installing` or failed `installed` boot, restore the complete saved
components to their corresponding paths directly under the home, then archive/remove
the consumed backup and start the unit. A rollback that failed partway may already have
moved some components back: inspect those original paths rather than deleting them when
the corresponding backup component is absent. An invalid manifest needs manual inspection.
Keep `data/` intact. **Migrations remain applied after rollback**, including migrations
from a new API that already booted; they are never reversed. Additive migrations normally
allow old code to read the migrated database, but an autopg/Postgres data-format change
may prevent old binaries from using that data. Check compatibility before manual rollback.
Do not manually stop or kill the unit during an update; forced stops, filesystem failures
and interrupted installs can still require operator recovery.

**One manual upgrade is required for supervisors predating this protocol**, including
the lembr incident's `2.261104.23`. Stop the external unit, install a release containing
this fix as the service user with `--no-start`, then start the unit. The updated handoff
refuses an older running supervisor with the fixed reason above. An entirely old runtime
still runs its old handoff code; this change cannot retroactively add that refusal before
the manual upgrade. Do not retry its in-app update as a substitute for that upgrade.

## Embedded in an app

An app that ships Omni inside itself runs the supervisor with `omni sandbox run --embedded
--home <dir>`. The app then owns Omni's updates and its network policy, so under `--embedded`
the API gets:

- `SENTRY_DSN=""`: no crash reports or traces (without it, the API reports to Omni's own
  Sentry project);
- `OMNI_UPDATE_CHECK=false` and no `OMNI_UPDATE_COMMAND`: the npm registry is never read and
  updates from the app are off;
- `OMNI_PLUGIN_LANE=off`: no plugin lane is read.

The app also starts the supervisor itself with `OMNI_TELEMETRY=false` and
`OMNI_SKIP_POSTINSTALL_PIN=1`. `--embedded` cannot do this, because the CLI acts before the
`run` command does: without the first, a CLI error can send Omni's Sentry project an event with
the command line (and so the `--home` path); without the second, the CLI may pin the user's own
global `@automagik/omni` to the version the app ships.

The database URL and Postgres are as in any sandbox, unless the app asks for a password file
(below). Without one, autopg and pgserve set no listen address, so Postgres takes its default,
`localhost`: 127.0.0.1, and `::1` where `localhost` resolves to it, plus its socket, with the
`postgres`/`postgres` login. The API dials it over TCP.

## Postgres

On the platforms autopg ships a build for (darwin-arm64, linux-arm64 and linux-x64, glibc),
Postgres comes from autopg's GitHub release, the version Omni pins in
`packages/cli/src/autopg-pin.json` with the sha256 of each platform's tarball. The install:

- downloads the tarball, or takes `--autopg-tarball <file>` without the network;
- checks its sha256 against the pin, and refuses anything else (there is no fallback);
- unpacks it to `<home>/autopg/<version>/`;
- moves its Postgres into autopg's binary cache, `<home>/pgserve/bin/<platform>`, so autopg
  downloads nothing on its first start.

Omni's CI checks every pinned tarball's cosign signature against autopg's release workflow
whenever the pin changes (`scripts/ci/verify-autopg-pin.sh`).

On every other platform (darwin-x64, Linux with musl), the runtime carries npm `pgserve` 2.6.10,
as before, and pgserve fetches Postgres on its first start.

### Password file (opt-in)

`--pg-password-file <file>` runs autopg's password-file cluster, and the sandbox keeps the path
across reinstalls and updates. Under it:

- Postgres takes scram logins on 127.0.0.1 only and makes no Unix socket;
- the API's `DATABASE_URL` carries the password with `127.0.0.1`, and the API gets no `PGHOST`;
- `config.json` gets the URL without the password.

The supervisor reads the file at every start and refuses one that is not an absolute path to a
regular file, owned by the user, mode 0600 or stricter, one line of at least 16 characters.

Nothing turns it on by default. An existing cluster made without the file cannot take one, so
asking for it there is refused: use a new `--home`. It needs autopg, so it is refused on the
other platforms too.

## Requirements

- macOS or Linux (WSL included; `--at-login` on WSL needs systemd enabled).
- `bun`, since the CLI itself runs on it.
- Network on the first install: bun fetches `@automagik/omni` (and `pgserve`
  off the autopg platforms) into `<home>/runtime`, and nats-server comes from
  its GitHub release. Postgres comes from autopg's GitHub release (see
  Postgres), or else pgserve fetches it into `<home>/pgserve`.

## Relation to omnid

This is the first concrete step of the local-daemon design
(`.genie/brainstorms/omni-local-daemon/DESIGN.md`): one supervisor owning Postgres,
NATS and the API on loopback, started in order and restarted with backoff. That
design's other parts are still to come:

- moving the default `omni install` off PM2;
- the downloadable daemon bundle;
- a scoped database role (the sandbox uses `postgres:postgres` over its private
  Unix socket);
- health-driven restarts and periodic doctor checks.
