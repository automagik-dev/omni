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

The update only takes a version npm publishes on the sandbox's channel (`latest`, or `next` for a
prerelease), and only one update runs at a time.

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
