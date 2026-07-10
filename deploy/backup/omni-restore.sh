#!/usr/bin/env bash
# omni-restore.sh — restore or verify a Postgres dump produced by omni-backup.sh.
#
# Modes:
#   (default)        VERIFY — restore the dump into a throwaway `postgres:18`
#                    container and print row counts. Touches nothing live; the
#                    container is removed on exit. Run this regularly to prove
#                    your backups are actually restorable. Exits non-zero if
#                    pg_restore reports any error (a corrupt dump must FAIL).
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
# Env: KCTX NS RELEASE OMNI_BACKUP_DIR PG_FWD_PORT PG_SVC PG_SUPERUSER
#      PG_SUPERPASS RESTORE_ROLE (target mode; defaults to the target db name)
set -euo pipefail

KCTX="${KCTX:-orbstack}"; NS="${NS:-omni}"; RELEASE="${RELEASE:-omni}"
DEST="${OMNI_BACKUP_DIR:-$HOME/omni-backups}"
PG_FWD_PORT="${PG_FWD_PORT:-15432}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"; PG_SUPERPASS="${PG_SUPERPASS:-postgres}"
PG_SVC="${PG_SVC:-${RELEASE}-autopg}"

# Centralized cleanup: the throwaway container and any port-forward are removed
# even on a premature exit.
CID=""; PF=""
cleanup(){
  [ -n "${CID:-}" ] && docker rm -f "$CID" >/dev/null 2>&1 || true
  [ -n "${PF:-}" ] && kill "$PF" 2>/dev/null || true
}
trap cleanup EXIT

FILE=""; TARGET=""; CONFIRM=0; CLEAN=""
while [ $# -gt 0 ]; do case "$1" in
  --file)    FILE="$2"; shift 2;;
  --target)  TARGET="$2"; shift 2;;
  --confirm) CONFIRM=1; shift;;
  --clean)   CLEAN="--clean --if-exists"; shift;;
  # Print the leading comment block (after the shebang) up to the first
  # non-comment line — immune to header edits shifting line numbers.
  -h|--help) sed -e '1d' -e '/^[^#]/,$d' "$0"; exit 0;;
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
  for _ in {1..30}; do docker exec "$CID" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  docker exec "$CID" pg_isready -U postgres >/dev/null 2>&1 \
    || { echo "omni-restore: throwaway postgres never became ready" >&2; exit 1; }
  docker exec "$CID" createdb -U postgres verify
  # Preserve pg_restore's exit status — a dump that does not restore cleanly
  # must FAIL the verify, that is the whole point of this mode.
  if ! docker exec "$CID" pg_restore -U postgres -d verify --no-owner "/dumps/$(basename "$FILE")"; then
    log "verify FAIL — pg_restore reported errors (corrupt or partial dump?)"; exit 1
  fi
  docker exec "$CID" psql -U postgres -d verify -qc "ANALYZE;" >/dev/null
  log "restored OK — top tables by row count:"
  docker exec "$CID" psql -U postgres -d verify -P pager=off -c \
    "SELECT relname, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"
  log "verify PASS"
  exit 0
fi

# ---------- TARGET: restore into a live DB (guarded) ----------
[ "$CONFIRM" = 1 ] || { echo "omni-restore: refusing to write live db '$TARGET' without --confirm" >&2; exit 3; }
# Restore AS the app role (SET ROLE via --role) so restored objects stay owned
# by it — restoring as the superuser with --no-owner would leave everything
# owned by postgres and break the app's own access/migrations. The role must
# already exist (globals restore / the chart's provision Job creates it).
RESTORE_ROLE="${RESTORE_ROLE:-$TARGET}"
kubectl --context "$KCTX" -n "$NS" port-forward --address 127.0.0.1 "svc/${PG_SVC}" "${PG_FWD_PORT}:5432" >/dev/null 2>&1 &
PF=$!; sleep 3
kill -0 "$PF" 2>/dev/null || { echo "omni-restore: port-forward failed (svc/${PG_SVC}, host port ${PG_FWD_PORT} taken?)" >&2; exit 1; }
log "restoring $(basename "$FILE") into LIVE db '$TARGET' as role '$RESTORE_ROLE'…"
docker run --rm -i --add-host=host.docker.internal:host-gateway -e PGPASSWORD="$PG_SUPERPASS" \
  -v "$(cd "$(dirname "$FILE")" && pwd):/dumps:ro" postgres:18 \
  pg_restore -h host.docker.internal -p "$PG_FWD_PORT" -U "$PG_SUPERUSER" -d "$TARGET" \
  --no-owner --role "$RESTORE_ROLE" $CLEAN \
  "/dumps/$(basename "$FILE")"
kill "$PF" 2>/dev/null || true; PF=""
log "restore into '$TARGET' complete"
