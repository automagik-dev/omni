#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-release-assets.py"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
mkdir -p "${work}/dist"
VERSION=2.260830.2
for platform in linux-x64-glibc linux-x64-musl linux-arm64 darwin-arm64; do
  for suffix in "" .bundle .intoto.jsonl; do
    name="omni-${VERSION}-${platform}.tar.gz${suffix}"
    printf '%s\n' "${name}" > "${work}/dist/${name}"
  done
done
python3 - "${work}/dist" "${work}/release.json" <<'PY'
import hashlib, json, pathlib, sys
dist = pathlib.Path(sys.argv[1])
assets = []
for path in sorted(dist.iterdir()):
    assets.append({"name": path.name, "digest": "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()})
json.dump({"draft": False, "prerelease": False, "assets": assets}, open(sys.argv[2], "w", encoding="utf-8"))
PY

"${SCRIPT}" --version "${VERSION}" --release-json "${work}/release.json" --dist "${work}/dist"

python3 - "${work}/release.json" "${work}/bad.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
data["assets"][0]["digest"] = "sha256:" + "0" * 64
json.dump(data, open(sys.argv[2], "w", encoding="utf-8"))
PY
if "${SCRIPT}" --version "${VERSION}" --release-json "${work}/bad.json" --dist "${work}/dist"; then
  fail "mismatched public asset digest was accepted"
fi

python3 - "${work}/release.json" "${work}/missing.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
data["assets"].pop()
json.dump(data, open(sys.argv[2], "w", encoding="utf-8"))
PY
if "${SCRIPT}" --version "${VERSION}" --release-json "${work}/missing.json" --dist "${work}/dist"; then
  fail "incomplete public asset inventory was accepted"
fi

printf 'PASS: immutable public GitHub release asset contract\n'
