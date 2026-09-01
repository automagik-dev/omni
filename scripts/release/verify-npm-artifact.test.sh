#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-npm-artifact.py"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
python3 - "${work}" <<'PY'
import io, pathlib, tarfile, sys
root = pathlib.Path(sys.argv[1])
for name, mtime in [('expected.tgz', 1), ('registry.tgz', 2)]:
    with tarfile.open(root / name, 'w:gz') as archive:
        prefix = b'/tmp/build' if name == 'expected.tgz' else b'/home/runner/work/omni/omni'
        raw = b'var __filename = "' + prefix + b'/node_modules/.bun/pkg/node_modules/pkg/index.js";\n'
        info = tarfile.TarInfo('package/dist/index.js')
        info.size = len(raw)
        info.mode = 0o644
        info.mtime = mtime
        archive.addfile(info, io.BytesIO(raw))
PY
openssl ecparam -name prime256v1 -genkey -noout -out "${work}/private.pem"
openssl pkey -in "${work}/private.pem" -pubout -outform DER -out "${work}/public.der"
python3 - "${work}/registry.tgz" "${work}/dist.json" "${work}/keys.json" \
  "${work}/private.pem" "${work}/public.der" <<'PY'
import base64, hashlib, json, pathlib, subprocess, sys
raw = pathlib.Path(sys.argv[1]).read_bytes()
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
public = pathlib.Path(sys.argv[5]).read_bytes()
keyid = 'SHA256:' + base64.b64encode(hashlib.sha256(public).digest()).decode()
payload = f'@automagik/omni@2.260830.2:{integrity}'.encode()
signature = subprocess.run(
    ['openssl', 'dgst', '-sha256', '-sign', sys.argv[4]],
    input=payload, check=True, capture_output=True,
).stdout
pathlib.Path(sys.argv[2]).write_text(json.dumps({
    'integrity': integrity,
    'shasum': hashlib.sha1(raw).hexdigest(),
    'tarball': 'https://registry.npmjs.org/@automagik/omni/-/omni-2.260830.2.tgz',
    'signatures': [{'keyid': keyid, 'sig': base64.b64encode(signature).decode()}],
}))
pathlib.Path(sys.argv[3]).write_text(json.dumps({'keys': [{
    'keyid': keyid, 'keytype': 'ecdsa-sha2-nistp256',
    'scheme': 'ecdsa-sha2-nistp256', 'key': base64.b64encode(public).decode(),
}]}))
PY
"${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist.json" \
  --keys-json "${work}/keys.json" --package @automagik/omni --version 2.260830.2 \
  | grep -qx 'npm_artifact_verified=true' || fail "exact signed artifact was rejected"
python3 - "${work}/expected.tgz" <<'PY'
import io, tarfile, sys
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    raw = b'wrong package file\n'
    info = tarfile.TarInfo('package/dist/index.js')
    info.size = len(raw)
    archive.addfile(info, io.BytesIO(raw))
PY
if "${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist.json" \
  --keys-json "${work}/keys.json" --package @automagik/omni --version 2.260830.2 >/dev/null 2>&1; then
  fail "wrong package bytes were accepted"
fi
python3 - "${work}/dist.json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
data = json.loads(p.read_text())
data['signatures'] = []
p.write_text(json.dumps(data))
PY
if "${SCRIPT}" --expected-tarball "${work}/registry.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist.json" \
  --keys-json "${work}/keys.json" --package @automagik/omni --version 2.260830.2 >/dev/null 2>&1; then
  fail "unsigned registry metadata was accepted"
fi
printf 'PASS: exact signed npm artifact identity contract\n'
