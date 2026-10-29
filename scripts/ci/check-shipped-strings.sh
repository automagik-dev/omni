#!/usr/bin/env bash
set -euo pipefail

# Fails when what `npm pack` ships for @automagik/omni names a private host, a person or an
# internal service. It reads the built package, not the sources: run it after
# `bun run prepack` in packages/cli. It checks dist/ (the CLI, the server and the SDK),
# db/ (the migrations), and every plugin tarball in dist/market, unpacked.
#
# Fails closed: a build part that is missing or empty is a failure, not a pass.
#
#   check-shipped-strings.sh <packages/cli>

CLI="${1:?usage: check-shipped-strings.sh <packages/cli>}"
# Substrings, plus one personal name as a whole word. That name is also a city, so the IANA
# timezone id Europe/<city> is matched as one token and then dropped: timezone data never trips it.
PATTERN='lembr\.ai|juice|felipe|(europe/)?\bsofia\b'
TIMEZONE='^europe/sofia$'
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
ok() { printf 'ok %s\n' "$1"; }
bad() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

for part in dist/index.js dist/server/index.js dist/market/market.json; do
  if [[ -s "$CLI/$part" ]]; then ok "$part is built"; else bad "$part is missing or empty"; fi
done
tarballs=("$CLI"/dist/market/*.tgz)
if [[ ! -e "${tarballs[0]}" ]]; then
  bad 'dist/market holds no plugin tarball'
  tarballs=()
fi

# report <label> <dir>: every file under <dir> that matches, with the matching words.
report() {
  local files file words found=0
  files="$(grep -rliE --exclude='*.tgz' "$PATTERN" "$2" 2>/dev/null || true)"
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    words="$(grep -oiE "$PATTERN" "$file" | tr '[:upper:]' '[:lower:]' | grep -vE "$TIMEZONE" | sort | uniq -c |
      tr -s ' ' | tr '\n' ',' || true)"
    [[ -n "$words" ]] || continue
    bad "$1: ${file#"$2"/} ($words)"
    found=1
  done <<<"$files"
  [[ "$found" -eq 1 ]] || ok "$1 names no private host, person or internal service"
}

[[ -d "$CLI/dist" ]] && report 'dist/' "$CLI/dist"
[[ -d "$CLI/db" ]] && report 'db/' "$CLI/db"
for tarball in ${tarballs[@]+"${tarballs[@]}"}; do
  name="$(basename "$tarball" .tgz)"
  mkdir -p "$WORK/$name"
  if tar -xzf "$tarball" -C "$WORK/$name"; then
    report "market/$name" "$WORK/$name"
  else
    bad "market/$name does not unpack"
  fi
done

[[ "$failures" -eq 0 ]] || exit 1
