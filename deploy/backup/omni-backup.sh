#!/usr/bin/env bash
# omni-backup.sh — logical backup of a bundled (self-host) omni stack.
#
#   • Postgres (autopg)  -> pg_dump custom-format (+ pg_dumpall globals)
#   • MinIO media bucket -> incremental mirror
#
# Writes to a LOCAL directory (default ~/omni-backups) — point it at a
# Time Machine / backed-up path. There is NO in-cluster CronJob; run this from
# the host on a schedule (launchd on macOS, a systemd timer on Linux). See
# README.md for scheduling + restore.
#
# Why throwaway `docker run` images instead of `kubectl exec`:
#   autopg ships only the Postgres *server* binaries — the in-container pg_dump
#   is Debian v15 and REFUSES to dump the v18 server. So we run a version-matched
#   `postgres:18` client over a short-lived port-forward. Media uses `minio/mc`
#   the same way. Only `docker` + `kubectl` need to be on the host.
#
# Config via env (defaults suit an OrbStack dev install):
#   KCTX=orbstack  NS=omni  RELEASE=omni  OMNI_BACKUP_DIR=~/omni-backups
#   PG_DB=omni     MEDIA_BUCKET=omni-media
#   PG_FWD_PORT=15432  MINIO_FWD_PORT=19000  RETENTION_DAYS=14
# The forwards use NON-standard host ports on purpose: :5432/:9000 are commonly
# already bound on a dev box (OrbStack exposes its own services there).
set -euo pipefail

KCTX="${KCTX:-orbstack}"
NS="${NS:-omni}"
RELEASE="${RELEASE:-omni}"
DEST="${OMNI_BACKUP_DIR:-$HOME/omni-backups}"
PG_DB="${PG_DB:-omni}"
MEDIA_BUCKET="${MEDIA_BUCKET:-omni-media}"
PG_FWD_PORT="${PG_FWD_PORT:-15432}"
MINIO_FWD_PORT="${MINIO_FWD_PORT:-19000}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PG_SUPERPASS="${PG_SUPERPASS:-postgres}"   # autopg pins the superuser to postgres/postgres

STAMP="$(date +%Y%m%d-%H%M)"
kc(){ kubectl --context "$KCTX" -n "$NS" "$@"; }
log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
need(){ command -v "$1" >/dev/null || { echo "omni-backup: missing required tool: $1" >&2; exit 1; }; }
need kubectl; need docker
mkdir -p "$DEST/postgres" "$DEST/media"
log "=== omni-backup start ($STAMP) — release=$RELEASE ns=$NS -> $DEST ==="

# --- Postgres: globals + the app DB (custom format) via a v18 client ---------
kc port-forward --address 127.0.0.1 "svc/${RELEASE}-autopg" "${PG_FWD_PORT}:5432" >/dev/null 2>&1 &
PF=$!; trap 'kill $PF 2>/dev/null || true' EXIT; sleep 3
docker run --rm --add-host=host.docker.internal:host-gateway -e PGPASSWORD="$PG_SUPERPASS" postgres:18 \
  pg_dumpall -h host.docker.internal -p "$PG_FWD_PORT" -U "$PG_SUPERUSER" --globals-only \
  | gzip > "$DEST/postgres/globals-$STAMP.sql.gz"
docker run --rm --add-host=host.docker.internal:host-gateway -e PGPASSWORD="$PG_SUPERPASS" postgres:18 \
  pg_dump -h host.docker.internal -p "$PG_FWD_PORT" -U "$PG_SUPERUSER" -Fc -d "$PG_DB" \
  > "$DEST/postgres/${PG_DB}-$STAMP.dump"
kill $PF 2>/dev/null || true; trap - EXIT
log "postgres dumped -> ${PG_DB}-$STAMP.dump ($(du -h "$DEST/postgres/${PG_DB}-$STAMP.dump" | cut -f1))"

# --- MinIO media: incremental mirror (creds read from the release Secret) ----
MINIO_SECRET="$(kc get secret \
  -l "app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=minio" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [ -z "$MINIO_SECRET" ]; then
  log "no bundled MinIO Secret found (external S3?) — skipping media backup"
  log "=== omni-backup done (postgres only) ==="; exit 0
fi
MU="$(kc get secret "$MINIO_SECRET" -o jsonpath='{.data.MINIO_ROOT_USER}' | base64 -d)"
MP="$(kc get secret "$MINIO_SECRET" -o jsonpath='{.data.MINIO_ROOT_PASSWORD}' | base64 -d)"
kc port-forward --address 127.0.0.1 "svc/${RELEASE}-minio" "${MINIO_FWD_PORT}:9000" >/dev/null 2>&1 &
PF=$!; trap 'kill $PF 2>/dev/null || true' EXIT; sleep 3
# `mc alias set` (not the MC_HOST URL) so passwords with @ : / don't corrupt a URL.
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e MU="$MU" -e MP="$MP" -v "$DEST/media:/backup" --entrypoint sh minio/mc -c \
  "mc alias set omni \"http://host.docker.internal:${MINIO_FWD_PORT}\" \"\$MU\" \"\$MP\" >/dev/null && \
   mc mirror --overwrite \"omni/${MEDIA_BUCKET}\" \"/backup/${MEDIA_BUCKET}\""
kill $PF 2>/dev/null || true; trap - EXIT
log "media mirrored -> media/${MEDIA_BUCKET} ($(du -sh "$DEST/media/${MEDIA_BUCKET}" 2>/dev/null | cut -f1))"

# --- Retention: prune pg dumps older than N days (media mirror kept whole) ---
find "$DEST/postgres" -type f \( -name '*.dump' -o -name '*.sql.gz' \) -mtime "+$RETENTION_DAYS" -delete
log "=== omni-backup done ==="
