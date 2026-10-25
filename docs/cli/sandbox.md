# Sandboxed local Omni

`omni install --sandbox` puts a second, self-contained Omni on this computer. It
shares nothing with an existing install, so it is safe on a machine that already
runs Omni, autopg/pgserve or PM2.

| | Normal `omni install` | `omni install --sandbox` |
|---|---|---|
| Config | `~/.omni/config.json` | `<home>/config/config.json` (mode 0600) |
| Postgres | the shared autopg/pgserve on 5432 | its own cluster (pgserve `postmaster`), own socket dir |
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
omni install --sandbox [--home <dir>] [--at-login] [--no-start] [--package <spec>] [--json]
omni sandbox status    [--home <dir>] [--json]
omni sandbox start     [--home <dir>] [--json]
omni sandbox stop      [--home <dir>] [--json]
omni sandbox uninstall [--home <dir>] [--purge] [--json]
omni sandbox run       [--home <dir>]        # the supervisor; launchd/systemd start this
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

## Requirements

- macOS or Linux (WSL included; `--at-login` on WSL needs systemd enabled).
- `bun`, since the CLI itself runs on it.
- Network on the first install: bun fetches `@automagik/omni` and `pgserve`
  into `<home>/runtime`, nats-server comes from its GitHub release, and pgserve
  fetches the Postgres binaries into `<home>/pgserve`.

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
