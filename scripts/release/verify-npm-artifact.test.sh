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
  "${work}/packument.json" "${work}/private.pem" "${work}/public.der" <<'PY'
import base64, hashlib, json, pathlib, subprocess, sys
raw = pathlib.Path(sys.argv[1]).read_bytes()
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
public = pathlib.Path(sys.argv[6]).read_bytes()
keyid = 'SHA256:' + base64.b64encode(hashlib.sha256(public).digest()).decode()
payload = f'@automagik/omni@2.260830.2:{integrity}'.encode()
signature = subprocess.run(
    ['openssl', 'dgst', '-sha256', '-sign', sys.argv[5]],
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
    'scheme': 'ecdsa-sha2-nistp256', 'key': base64.b64encode(public).decode(), 'expires': None,
}]}))
pathlib.Path(sys.argv[4]).write_text(json.dumps({
    'time': {'2.260830.2': '2026-08-30T21:45:27Z'},
}))
PY
"${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist.json" \
  --keys-json "${work}/keys.json" --packument-json "${work}/packument.json" \
  --package @automagik/omni --version 2.260830.2 \
  | grep -qx 'npm_artifact_verified=true' || fail "exact signed artifact was rejected"
python3 - "${work}/keys.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
document = json.loads(path.read_text())
document['keys'][0]['expires'] = '2026-08-30T21:45:26Z'
path.write_text(json.dumps(document))
PY
if "${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist.json" \
  --keys-json "${work}/keys.json" --packument-json "${work}/packument.json" \
  --package @automagik/omni --version 2.260830.2 >/dev/null 2>"${work}/expired.err"; then
  fail "signature from a key expired before publication was accepted"
fi
grep -q 'expired before package publication' "${work}/expired.err" || \
  fail "expired-key rejection did not identify publication-time ordering"
python3 - "${work}/keys.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
document = json.loads(path.read_text())
document['keys'][0]['expires'] = '2026-08-30T21:45:28Z'
path.write_text(json.dumps(document))
PY
"${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist.json" \
  --keys-json "${work}/keys.json" --packument-json "${work}/packument.json" \
  --package @automagik/omni --version 2.260830.2 >/dev/null || \
  fail "key valid at publication time was rejected after later expiry"
# A package may be co-signed by several registry keys. Only one authoritative
# key valid at publication time is required, so an expired co-signer must be
# skipped rather than condemning the artifact. The expired key is listed and
# signed FIRST so the verifier cannot pass by never reaching it.
openssl ecparam -name prime256v1 -genkey -noout -out "${work}/expired-private.pem"
openssl pkey -in "${work}/expired-private.pem" -pubout -outform DER -out "${work}/expired-public.der"
python3 - "${work}/registry.tgz" "${work}/dist-mixed.json" "${work}/keys-mixed.json" \
  "${work}/packument-untimed.json" "${work}/private.pem" "${work}/public.der" \
  "${work}/expired-private.pem" "${work}/expired-public.der" <<'PY'
import base64, hashlib, json, pathlib, subprocess, sys
raw = pathlib.Path(sys.argv[1]).read_bytes()
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
payload = f'@automagik/omni@2.260830.2:{integrity}'.encode()


def signer(private_path, public_path):
    public = pathlib.Path(public_path).read_bytes()
    keyid = 'SHA256:' + base64.b64encode(hashlib.sha256(public).digest()).decode()
    signature = subprocess.run(
        ['openssl', 'dgst', '-sha256', '-sign', private_path],
        input=payload, check=True, capture_output=True,
    ).stdout
    return keyid, base64.b64encode(public).decode(), base64.b64encode(signature).decode()


valid_id, valid_key, valid_sig = signer(sys.argv[5], sys.argv[6])
expired_id, expired_key, expired_sig = signer(sys.argv[7], sys.argv[8])
pathlib.Path(sys.argv[2]).write_text(json.dumps({
    'integrity': integrity,
    'shasum': hashlib.sha1(raw).hexdigest(),
    'tarball': 'https://registry.npmjs.org/@automagik/omni/-/omni-2.260830.2.tgz',
    'signatures': [
        {'keyid': expired_id, 'sig': expired_sig},
        {'keyid': valid_id, 'sig': valid_sig},
    ],
}))
pathlib.Path(sys.argv[3]).write_text(json.dumps({'keys': [
    {'keyid': expired_id, 'keytype': 'ecdsa-sha2-nistp256',
     'scheme': 'ecdsa-sha2-nistp256', 'key': expired_key,
     'expires': '2026-08-30T21:45:26Z'},
    {'keyid': valid_id, 'keytype': 'ecdsa-sha2-nistp256',
     'scheme': 'ecdsa-sha2-nistp256', 'key': valid_key, 'expires': None},
]}))
# Publication metadata that records some other version but not the one asked
# for: the packument is well formed, so only the per-version lookup can reject.
pathlib.Path(sys.argv[4]).write_text(json.dumps({
    'time': {'2.260830.3': '2026-08-30T21:45:27Z'},
}))
PY
"${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist-mixed.json" \
  --keys-json "${work}/keys-mixed.json" --packument-json "${work}/packument.json" \
  --package @automagik/omni --version 2.260830.2 \
  | grep -qx 'npm_artifact_verified=true' || \
  fail "co-signed artifact was rejected because one co-signing key expired before publication"
# Reverse the same fixture: with the valid co-signer removed from the registry
# key set, the surviving expired co-signer must condemn the artifact and say so.
python3 - "${work}/keys-mixed.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
document = json.loads(path.read_text())
document['keys'] = [key for key in document['keys'] if key['expires'] is not None]
path.write_text(json.dumps(document))
PY
if "${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist-mixed.json" \
  --keys-json "${work}/keys-mixed.json" --packument-json "${work}/packument.json" \
  --package @automagik/omni --version 2.260830.2 >/dev/null 2>"${work}/mixed.err"; then
  fail "artifact whose only authoritative co-signer expired before publication was accepted"
fi
grep -q 'expired before package publication' "${work}/mixed.err" || \
  fail "sole-expired-co-signer rejection did not identify publication-time ordering"
# No publication time for this version: expiry ordering cannot be evaluated at
# all, so the verifier must refuse rather than treat the key as unexpired.
if "${SCRIPT}" --expected-tarball "${work}/expected.tgz" \
  --registry-tarball "${work}/registry.tgz" --dist-json "${work}/dist.json" \
  --keys-json "${work}/keys.json" --packument-json "${work}/packument-untimed.json" \
  --package @automagik/omni --version 2.260830.2 >/dev/null 2>"${work}/untimed.err"; then
  fail "artifact with no registry publication time was accepted"
fi
grep -q 'package publication timestamp is missing' "${work}/untimed.err" || \
  fail "missing-publication-time rejection was not attributable to the packument"
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
  --keys-json "${work}/keys.json" --packument-json "${work}/packument.json" \
  --package @automagik/omni --version 2.260830.2 >/dev/null 2>&1; then
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
  --keys-json "${work}/keys.json" --packument-json "${work}/packument.json" \
  --package @automagik/omni --version 2.260830.2 >/dev/null 2>&1; then
  fail "unsigned registry metadata was accepted"
fi
printf 'PASS: exact signed npm artifact identity contract\n'
