#!/usr/bin/env bash
set -euo pipefail

# Rows for scripts/ensure-nats.sh, the dev and CI helper that puts nats-server in bin/.
#
# Each row copies the script into a scratch project with its own nats pin and points it at a
# fixture release (NATS_RELEASE_BASE=file://…), so nothing is downloaded; any network request
# goes to a closed local port and fails. A refused archive must make the script exit non-zero,
# say why, and leave nothing behind: no bin/nats-server and nothing in its temp dir. A verified
# install leaves bin/nats-server.pin; a binary already there is kept only when that marker is the
# pin, and a refused upgrade leaves the old binary and marker as they were.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
ok() { printf 'ok %s\n' "$1"; }
bad() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) printf 'FAIL: unsupported architecture %s\n' "$(uname -m)" >&2 && exit 1 ;;
esac
PLATFORM="${OS}-${ARCH}"
ARCHIVE="nats-server-v2.12.15-${PLATFORM}.tar.gz"

# The fixture release: the real archive layout, with a stand-in binary.
mkdir -p "$WORK/stage/nats-server-v2.12.15-${PLATFORM}" "$WORK/release" "$WORK/tampered" "$WORK/empty"
printf '#!/bin/sh\necho "nats-server: fixture"\n' >"$WORK/stage/nats-server-v2.12.15-${PLATFORM}/nats-server"
chmod +x "$WORK/stage/nats-server-v2.12.15-${PLATFORM}/nats-server"
tar -czf "$WORK/release/${ARCHIVE}" -C "$WORK/stage" "nats-server-v2.12.15-${PLATFORM}"
SIZE="$(wc -c <"$WORK/release/${ARCHIVE}" | tr -d ' ')"
SHA256="$(shasum -a 256 "$WORK/release/${ARCHIVE}" | awk '{print $1}')"

# The same archive with one byte flipped: same size, another sha256.
cp "$WORK/release/${ARCHIVE}" "$WORK/tampered/${ARCHIVE}"
offset=$((SIZE - 20))
byte="$(od -An -tu1 -j "$offset" -N1 "$WORK/tampered/${ARCHIVE}" | tr -d ' ')"
# shellcheck disable=SC2059 # the format is the escaped byte itself
printf "$(printf '\\%03o' "$((byte ^ 1))")" | dd of="$WORK/tampered/${ARCHIVE}" bs=1 seek="$offset" count=1 conv=notrunc 2>/dev/null

pin_json() { # <size> <sha256>, or no arguments for a pin without this platform
  if [[ $# -eq 0 ]]; then
    printf '{ "version": "2.12.15", "platforms": {} }\n'
  else
    printf '{ "version": "2.12.15", "platforms": { "%s": { "sha256": "%s", "size": %s } } }\n' "$PLATFORM" "$2" "$1"
  fi
}

# installed_earlier <name> [marker]: a nats-server already in the row's bin/, with that .pin marker.
installed_earlier() {
  mkdir -p "$WORK/$1/bin"
  printf 'old nats-server\n' >"$WORK/$1/bin/nats-server"
  chmod +x "$WORK/$1/bin/nats-server"
  if [[ $# -gt 1 ]]; then printf '%s\n' "$2" >"$WORK/$1/bin/nats-server.pin"; fi
}
MARKER="2.12.15 ${SHA256}"
OLD_MARKER="2.12.4 $(printf '0%.0s' {1..64})"

# run_row <name> <release dir> <pin json>: runs the script in a scratch project; sets CODE and OUT.
run_row() {
  local project="$WORK/$1"
  mkdir -p "$project/scripts" "$project/packages/cli/src" "$project/tmp"
  cp "$ROOT/scripts/ensure-nats.sh" "$project/scripts/ensure-nats.sh"
  printf '%s' "$3" >"$project/packages/cli/src/nats-pin.json"
  set +e
  OUT="$(
    TMPDIR="$project/tmp" NATS_RELEASE_BASE="file://$2" \
      https_proxy=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 \
      bash "$project/scripts/ensure-nats.sh" 2>&1
  )"
  CODE=$?
  set -e
  PROJECT="$project"
}

# refused <row> <reason>: non-zero, the reason in the output, no binary, and an empty temp dir.
refused() {
  if [[ "$CODE" -eq 0 ]]; then bad "$1: exit 0 (output: ${OUT//$'\n'/ | })"; return; fi
  if [[ "$OUT" != *"$2"* ]]; then bad "$1: no '$2' in its output (${OUT//$'\n'/ | })"; return; fi
  if [[ -e "$PROJECT/bin/nats-server" ]]; then bad "$1: bin/nats-server was written"; return; fi
  if [[ -n "$(ls -A "$PROJECT/tmp")" ]]; then bad "$1: left $(ls -A "$PROJECT/tmp") in its temp dir"; return; fi
  ok "$1"
}

run_row pinned "$WORK/release" "$(pin_json "$SIZE" "$SHA256")"
if [[ "$CODE" -eq 0 ]] && cmp -s "$PROJECT/bin/nats-server" "$WORK/stage/nats-server-v2.12.15-${PLATFORM}/nats-server" &&
  [[ "$(cat "$PROJECT/bin/nats-server.pin" 2>/dev/null)" == "$MARKER" ]]; then
  ok 'the pinned archive installs, with its marker'
else
  bad "the pinned archive installs, with its marker: exit ${CODE} (output: ${OUT//$'\n'/ | })"
fi

# replaced <row>: exit 0, the fixture binary in place of the old one, and the pin's marker.
replaced() {
  if [[ "$CODE" -eq 0 ]] && cmp -s "$PROJECT/bin/nats-server" "$WORK/stage/nats-server-v2.12.15-${PLATFORM}/nats-server" &&
    [[ "$(cat "$PROJECT/bin/nats-server.pin")" == "$MARKER" ]]; then
    ok "$1"
  else
    bad "$1: exit ${CODE}, bin/nats-server $(head -c 40 "$PROJECT/bin/nats-server" | tr '\n' ' ') (output: ${OUT//$'\n'/ | })"
  fi
}

installed_earlier no-marker
run_row no-marker "$WORK/release" "$(pin_json "$SIZE" "$SHA256")"
replaced 'a binary with no marker is replaced by the pinned release'

installed_earlier old-marker "$OLD_MARKER"
run_row old-marker "$WORK/release" "$(pin_json "$SIZE" "$SHA256")"
replaced 'a binary whose marker names another release is replaced'

installed_earlier kept "$MARKER"
run_row kept "$WORK/empty" "$(pin_json "$SIZE" "$SHA256")"
if [[ "$CODE" -eq 0 && "$(cat "$PROJECT/bin/nats-server")" == 'old nats-server' && "$OUT" != *'Downloading from'* ]]; then
  ok 'a binary whose marker is the pin is kept, with no download'
else
  bad "a binary whose marker is the pin is kept: exit ${CODE} (output: ${OUT//$'\n'/ | })"
fi

installed_earlier refused-upgrade "$OLD_MARKER"
run_row refused-upgrade "$WORK/tampered" "$(pin_json "$SIZE" "$SHA256")"
if [[ "$CODE" -ne 0 && "$(cat "$PROJECT/bin/nats-server")" == 'old nats-server' &&
  "$(cat "$PROJECT/bin/nats-server.pin")" == "$OLD_MARKER" && -z "$(ls -A "$PROJECT/tmp")" ]]; then
  ok 'a refused upgrade leaves the old binary and its marker as they were'
else
  bad "a refused upgrade: exit ${CODE}, bin/ holds $(find "$PROJECT/bin" -mindepth 1 -exec basename {} \; | tr '\n' ' ') (output: ${OUT//$'\n'/ | })"
fi

run_row tampered "$WORK/tampered" "$(pin_json "$SIZE" "$SHA256")"
refused 'an archive whose sha256 is not the pin is refused before it is unpacked' 'not the pinned'

run_row wrong-size "$WORK/release" "$(pin_json "$((SIZE + 1))" "$SHA256")"
refused 'an archive whose size is not the pin is refused, even with the pinned sha256' 'not the pinned'

run_row unpinned "$WORK/empty" "$(pin_json)"
refused 'a platform the pin has no checksum for is refused' 'no checksum'
if [[ "$OUT" == *'Downloading from'* ]]; then bad 'a platform the pin has no checksum for: it tried a download'; fi

[[ "$failures" -eq 0 ]] || exit 1
