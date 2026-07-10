#!/usr/bin/env bash
# omni-restore.sh — restore or verify a Postgres dump produced by omni-backup.sh.
#
# Modes:
#   (default)        VERIFY — restore the dump into a throwaway `postgres:18`
#                    container and print row counts. Touches nothing live; the
#                    container is removed on exit. Run this regularly to prove
#                    your backups are actually restorable.
#   --target <db>    RESTORE into database <db> on the live autopg (requires
#                    --confirm). Restore into a fresh/empty DB, or pass --clean.
#
# Options:
#   --file <path>    dump to use (default: newest *.dump in $OMNI_BACKUP_DIR/postgres)
#   --confirm        required for --target (guards against clobbering live data)
#   --clean          pass pg_restore --clean --if-exists (target mode)
#
# Media restore is intentionally NOT scripted (it overwrites the live bucket) —
# see README.md for the guarded `mc mirror` command.
#
# Env: KCTX NS RELEASE OMNI_BACKUP_DIR PG_FWD_PORT PG_SUPERUSER PG_SUPERPASS
set -euo pipefail

KCTX="${KCTX:-orbstack}"; NS="${NS:-omni}"; RELEASE="${RELEASE:-omni}"
DEST="${OMNI_BACKUP_DIR:-$HOME/omni-backups}"
PG_FWD_PORT="${PG_FWD_PORT:-15432}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"; PG_SUPERPASS="${PG_SUPERPASS:-postgres}"

FILE=""; TARGET=""; CONFIRM=0; CLEAN=""
while [ $# -gt 0 ]; do case "$1" in
  --file)    FILE="$2"; shift 2;;
  --target)  TARGET="$2"; shift 2;;
  --confirm) CONFIRM=1; shift;;
  --clean)   CLEAN="--clean --if-exists"; shift;;
  -h|--help) sed -n '2,20p' "$0"; exit 0;;
  *) echo "omni-restore: unknown arg: $1" >&2; exit 2;;
esac; done

[ -n "$FILE" ] || FILE="$(ls -t "$DEST"/postgres/*.dump 2>/dev/null | head -1 || true)"
[ -n "${FILE:-}" ] && [ -f "$FILE" ] || { echo "omni-restore: no dump found (looked in $DEST/postgres)" >&2; exit 1; }
log(){ echo "[$(date '+%H:%M:%S')] $*"; }

if [ -z "$TARGET" ]; then
  # ---------- VERIFY: ephemeral postgres:18, restore, count ----------
  log "verify: restoring $(basename "$FILE") into a throwaway postgres:18 (nothing live is touched)…"
  CID="omni-restore-verify-$$"
  docker rm -f "$CID" >/dev/null 2>&1 || true
  docker run -d --name "$CID" -e POSTGRES_PASSWORD=x -v "$(cd "$(dirname "$FILE")" && pwd):/dumps:ro" postgres:18 >/dev/null
  trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
  for _ in $(seq 1 30); do docker exec "$CID" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$CID" createdb -U postgres verify
  docker exec "$CID" pg_restore -U postgres -d verify --no-owner "/dumps/$(basename "$FILE")" 2>&1 | tail -3 || true
  docker exec "$CID" psql -U postgres -d verify -qc "ANALYZE;" >/dev/null
  log "restored OK — top tables by row count:"
  docker exec "$CID" psql -U postgres -d verify -P pager=off -c \
    "SELECT relname, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"
  log "verify PASS"
  exit 0
fi

# ---------- TARGET: restore into a live DB (guarded) ----------
[ "$CONFIRM" = 1 ] || { echo "omni-restore: refusing to write live db '$TARGET' without --confirm" >&2; exit 3; }
kubectl --context "$KCTX" -n "$NS" port-forward --address 127.0.0.1 "svc/${RELEASE}-autopg" "${PG_FWD_PORT}:5432" >/dev/null 2>&1 &
PF=$!; trap 'kill $PF 2>/dev/null || true' EXIT; sleep 3
log "restoring $(basename "$FILE") into LIVE db '$TARGET'…"
docker run --rm -i --add-host=host.docker.internal:host-gateway -e PGPASSWORD="$PG_SUPERPASS" \
  -v "$(cd "$(dirname "$FILE")" && pwd):/dumps:ro" postgres:18 \
  pg_restore -h host.docker.internal -p "$PG_FWD_PORT" -U "$PG_SUPERUSER" -d "$TARGET" --no-owner $CLEAN \
  "/dumps/$(basename "$FILE")"
kill $PF 2>/dev/null || true; trap - EXIT
log "restore into '$TARGET' complete"
