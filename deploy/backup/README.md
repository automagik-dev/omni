# omni self-host backups

Host-side backup + restore for a **bundled** (self-host) omni install — the
`values-dev.yaml` shape with in-cluster autopg + MinIO. It logically dumps
Postgres and mirrors the MinIO media bucket to a **local folder on your
machine**, so a cluster/OrbStack reset (or a fat-fingered `kubectl delete`)
doesn't take your WhatsApp/Baileys session state and media with it.

> Managed realms (homolog/prod) use RDS + real S3 and back up through those —
> this tooling is only for the bundled datastores.

## What & why

- **`omni-backup.sh`** — `pg_dump` (custom format) + `pg_dumpall --globals-only`
  for Postgres, and `mc mirror` (incremental) for the media bucket.
- **`omni-restore.sh`** — restore, or **verify** a dump into a throwaway
  container (prove it's restorable, don't just hope).

Both run from the host using throwaway `docker run` images
(`postgres:18`, `minio/mc`) over a short-lived `kubectl port-forward`. Only
**`docker` + `kubectl`** need to be installed — no Homebrew clients, no chart
CronJob, no committed secrets (MinIO creds are read from the release Secret at
run time).

### The two traps this handles for you

- **autopg has no v18 client.** The image ships only the Postgres *server*; its
  in-container `pg_dump` is Debian v15 and refuses to dump the v18 server. The
  script runs a version-matched `postgres:18` client instead.
- **Ports 5432/9000 are often taken.** OrbStack exposes its own services there,
  so the forwards default to **15432 / 19000**.

## Quick start

```bash
# one-off backup (defaults: context orbstack, ns omni, -> ~/omni-backups)
deploy/backup/omni-backup.sh

# prove the newest dump restores (throwaway container, nothing live touched)
deploy/backup/omni-restore.sh
```

### Configuration (env vars)

| var | default | meaning |
|---|---|---|
| `KCTX` | `orbstack` | kube-context |
| `NS` | `omni` | namespace |
| `RELEASE` | `omni` | helm release name (drives service names) |
| `OMNI_BACKUP_DIR` | `~/omni-backups` | destination folder |
| `PG_DB` | `omni` | database to dump |
| `MEDIA_BUCKET` | `omni-media` | MinIO bucket to mirror |
| `PG_FWD_PORT` / `MINIO_FWD_PORT` | `15432` / `19000` | host ports for the forwards |
| `RETENTION_DAYS` | `14` | prune pg dumps older than this (media mirror kept whole) |
| `PG_SVC` / `MINIO_SVC` | derived from `RELEASE` | override the Service names for non-default release layouts |
| `RESTORE_ROLE` | the `--target` db name | restore-only: role that ends up owning restored objects |

## Keep the backups safe (Time Machine)

The default `~/omni-backups` lives under your home dir, so **Time Machine backs
it up automatically** unless you've excluded `~`. Verify it isn't excluded:

```bash
tmutil isexcluded ~/omni-backups   # should print "[Included]"
```

Local backups survive a cluster/OrbStack reset but **not** loss of the machine —
Time Machine (or an occasional copy to an external disk / object store) covers
that. Pick an `OMNI_BACKUP_DIR` on a Time-Machine'd or synced volume.

## Scheduling

### macOS — launchd (daily 03:00)

`~/Library/LaunchAgents/ai.namastex.omni-backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.namastex.omni-backup</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-lc</string>
    <string>/path/to/omni/deploy/backup/omni-backup.sh >> $HOME/omni-backups/backup.log 2>&1</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/ai.namastex.omni-backup.plist
launchctl list | grep omni-backup      # confirm it's registered
```

(launchd runs a missed job at next wake if the Mac was asleep at 03:00.)

### Linux — systemd timer

`~/.config/systemd/user/omni-backup.service`:

```ini
[Service]
Type=oneshot
ExecStart=/path/to/omni/deploy/backup/omni-backup.sh
```

`~/.config/systemd/user/omni-backup.timer`:

```ini
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now omni-backup.timer
```

## Restore runbook

**Verify (safe, do this routinely):**

```bash
deploy/backup/omni-restore.sh            # newest dump -> throwaway postgres:18, prints row counts
deploy/backup/omni-restore.sh --file ~/omni-backups/postgres/omni-YYYYMMDD-HHMM.dump
```

**Restore Postgres into the live cluster** (after data loss — restore into a
fresh/empty DB, or `--clean` to drop objects first):

```bash
# recreate the app role/db from globals if the DB was lost entirely:
#   kubectl -n omni exec -it omni-autopg-0 -- psql -U postgres < <(gunzip -c globals-*.sql.gz)
deploy/backup/omni-restore.sh --target omni --clean --confirm
```

**Restore media** (overwrites the live bucket — guarded, run by hand):

```bash
kubectl -n omni port-forward --address 127.0.0.1 svc/omni-minio 19000:9000 &
# --decode works on GNU (Linux) and modern BSD/macOS base64 (use -D on old macOS)
MU=$(kubectl -n omni get secret -l app.kubernetes.io/component=minio -o jsonpath='{.items[0].data.MINIO_ROOT_USER}' | base64 --decode)
MP=$(kubectl -n omni get secret -l app.kubernetes.io/component=minio -o jsonpath='{.items[0].data.MINIO_ROOT_PASSWORD}' | base64 --decode)
docker run --rm --add-host=host.docker.internal:host-gateway -e MU="$MU" -e MP="$MP" \
  -v ~/omni-backups/media:/backup --entrypoint sh minio/mc -c \
  'mc alias set omni http://host.docker.internal:19000 "$MU" "$MP" && mc mirror --overwrite /backup/omni-media omni/omni-media'
```

See [`../README.md`](../README.md) → *Data safety & backups* for the PV
reclaim-policy note that complements these backups.
