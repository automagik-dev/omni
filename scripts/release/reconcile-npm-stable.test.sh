#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/reconcile-npm-stable.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
mkdir -p "${work}/bin" "${work}/package"
printf '{"version":"2.260830.2"}\n' > "${work}/package/package.json"
openssl ecparam -name prime256v1 -genkey -noout -out "${work}/private.pem"
openssl pkey -in "${work}/private.pem" -pubout -outform DER -out "${work}/public.der"
key_id="$(python3 - "${work}/public.der" <<'PY'
import base64, hashlib, pathlib, sys
print('SHA256:' + base64.b64encode(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).digest()).decode())
PY
)"
cat > "${work}/bin/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
state="${MOCK_STATE_DIR}"
if [[ "${1:-}" == "pack" ]]; then
  [[ -z "${NPM_RECOVERY_TOKEN:-}" && -z "${NODE_AUTH_TOKEN:-}" ]] || exit 90
  destination=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--pack-destination" ]]; then destination="$2"; break; fi
    shift
  done
  [[ -n "${destination}" ]]
  python3 - "${destination}/omni-2.260830.2.tgz" <<'PY'
import io, tarfile, sys
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    raw = b'expected package bytes\n'
    info = tarfile.TarInfo('package/index.js')
    info.size = len(raw)
    info.mode = 0o644
    archive.addfile(info, io.BytesIO(raw))
PY
  cp "${destination}/omni-2.260830.2.tgz" "${state}/expected.tgz"
  printf '[{"filename":"omni-2.260830.2.tgz"}]\n'
  exit 0
fi
case "${1:-} ${2:-} ${3:-}" in
  "view @automagik/omni@2.260830.2 version")
    if [[ -f "${state}/published-stale" ]]; then
      remaining="$(cat "${state}/published-stale")"
      if (( remaining > 0 )); then
        printf '%s\n' "$((remaining - 1))" > "${state}/published-stale"
        echo 'E404 404 Not Found' >&2
        exit 1
      fi
    fi
    [[ -f "${state}/published" ]] || { echo 'E404 404 Not Found' >&2; exit 1; }
    cat "${state}/published"
    ;;
  "view @automagik/omni dist-tags")
    if [[ -f "${state}/latest-stale" ]]; then
      remaining="$(cat "${state}/latest-stale")"
      if (( remaining > 0 )); then
        printf '%s\n' "$((remaining - 1))" > "${state}/latest-stale"
        echo 'E404 404 Not Found' >&2
        exit 1
      fi
    fi
    latest="$(cat "${state}/latest" 2>/dev/null || true)"
    printf '{"latest":"%s"}\n' "${latest}"
    ;;
  "view @automagik/omni@2.260830.2 dist")
    [[ -f "${state}/published" ]] || exit 93
    python3 - "${state}/expected.tgz" "${MOCK_WRONG_ARTIFACT:-false}" <<'PY'
import base64, hashlib, json, os, pathlib, subprocess, sys
raw = pathlib.Path(sys.argv[1]).read_bytes()
if sys.argv[2] == 'true': raw += b'wrong'
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
payload = f'@automagik/omni@2.260830.2:{integrity}'.encode()
signature = subprocess.run(
    ['openssl', 'dgst', '-sha256', '-sign', os.environ['MOCK_PRIVATE_KEY']],
    input=payload, check=True, capture_output=True,
).stdout
print(json.dumps({
    'integrity': integrity,
    'shasum': hashlib.sha1(raw).hexdigest(),
    'tarball': 'https://registry.npmjs.org/@automagik/omni/-/omni-2.260830.2.tgz',
    'signatures': [{'keyid': os.environ['MOCK_KEY_ID'], 'sig': base64.b64encode(signature).decode()}],
}))
PY
    ;;
  "audit signatures --json")
    [[ -z "${NPM_RECOVERY_TOKEN:-}" && -z "${NODE_AUTH_TOKEN:-}" ]] || exit 95
    [[ "${MOCK_AUDIT_FAIL:-false}" != "true" ]] || exit 96
    if [[ "${MOCK_NO_ATTESTATIONS:-false}" == "true" ]]; then
      printf '{"verified":[]}\n'
    else
      printf '{"verified":[{"name":"@automagik/omni","version":"2.260830.2","attestations":{"provenance":{"predicateType":"https://slsa.dev/provenance/v1"}}}]}\n'
    fi
    ;;
  "install --ignore-scripts --no-audit")
    [[ -z "${NPM_RECOVERY_TOKEN:-}" && -z "${NODE_AUTH_TOKEN:-}" ]] || exit 97
    ;;
  publish*)
    [[ -z "${NPM_RECOVERY_TOKEN:-}" && -z "${NODE_AUTH_TOKEN:-}" ]] || exit 94
    printf 'publish\n' >> "${state}/mutations"
    printf '2.260830.2\n' > "${state}/published"
    if [[ "${MOCK_NO_CONVERGE:-false}" != "true" ]]; then
      printf '2.260830.2\n' > "${state}/latest"
    fi
    if (( ${MOCK_STALE_READS:-0} > 0 )); then
      printf '%s\n' "${MOCK_STALE_READS}" > "${state}/published-stale"
      printf '%s\n' "${MOCK_STALE_READS}" > "${state}/latest-stale"
    fi
    ;;
  "dist-tag add @automagik/omni@2.260830.2")
    [[ -n "${NODE_AUTH_TOKEN:-}" ]] || exit 91
    printf 'repair_latest\n' >> "${state}/mutations"
    if [[ "${MOCK_NO_CONVERGE:-false}" != "true" ]]; then
      printf '2.260830.2\n' > "${state}/latest"
    fi
    ;;
  *)
    printf 'unexpected npm invocation: %s\n' "$*" >&2
    exit 92
    ;;
esac
SH
chmod +x "${work}/bin/npm"
cat > "${work}/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args=" $* "
[[ "${args}" == *" --connect-timeout 10 "* ]]
[[ "${args}" == *" --max-time "* ]]
[[ "${args}" == *" --retry 3 "* ]]
[[ "${args}" == *" --retry-connrefused "* ]]
output=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="${2:-}"; shift 2 ;;
    --connect-timeout|--max-time|--retry) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ -n "${output}" && -n "${url}" ]]
if [[ "${url}" == "https://registry.npmjs.org/-/npm/v1/keys" ]]; then
  python3 - "${MOCK_PUBLIC_KEY}" "${MOCK_KEY_ID}" "${output}" <<'PY'
import base64, json, pathlib, sys
public = pathlib.Path(sys.argv[1]).read_bytes()
pathlib.Path(sys.argv[3]).write_text(json.dumps({'keys': [{
    'keyid': sys.argv[2], 'keytype': 'ecdsa-sha2-nistp256',
    'scheme': 'ecdsa-sha2-nistp256', 'key': base64.b64encode(public).decode(), 'expires': None,
}]}))
PY
elif [[ "${url}" == "https://registry.npmjs.org/@automagik%2fomni" ]]; then
  printf '{"time":{"2.260830.2":"2026-08-30T21:45:27Z"}}\n' > "${output}"
else
  cp "${MOCK_STATE_DIR}/expected.tgz" "${output}"
fi
SH
chmod +x "${work}/bin/curl"
cat > "${work}/bin/sleep" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${1:-}" >> "${MOCK_STATE_DIR}/sleeps"
SH
chmod +x "${work}/bin/sleep"

run_case() {
  local state="$1"
  shift
  mkdir -p "${state}"
  PATH="${work}/bin:${PATH}" MOCK_STATE_DIR="${state}" \
    MOCK_PRIVATE_KEY="${work}/private.pem" MOCK_PUBLIC_KEY="${work}/public.der" MOCK_KEY_ID="${key_id}" \
    "${SCRIPT}" --expected 2.260830.2 --package-dir "${work}/package" "$@"
}

exact="${work}/exact"
mkdir -p "${exact}"
printf '2.260830.2\n' > "${exact}/published"
printf '2.260830.2\n' > "${exact}/latest"
out="$(run_case "${exact}")"
grep -q '^npm_action=none$' <<<"${out}" || fail "exact state was not idempotent"
[[ ! -e "${exact}/mutations" ]] || fail "exact state mutated npm"

missing="${work}/missing"
out="$(run_case "${missing}")"
grep -q '^npm_action=publish$' <<<"${out}" || fail "missing package was not published"
[[ "$(cat "${missing}/latest")" == "2.260830.2" ]] || fail "publish did not converge latest"

repair="${work}/repair"
mkdir -p "${repair}"
printf '2.260830.2\n' > "${repair}/published"
printf '2.260830.1\n' > "${repair}/latest"
out="$(NPM_RECOVERY_TOKEN=token run_case "${repair}")"
grep -q '^npm_action=repair_latest$' <<<"${out}" || fail "latest drift was not repaired"
[[ "$(cat "${repair}/latest")" == "2.260830.2" ]] || fail "latest repair did not converge"

no_token="${work}/no-token"
mkdir -p "${no_token}"
printf '2.260830.2\n' > "${no_token}/published"
printf '2.260830.1\n' > "${no_token}/latest"
if run_case "${no_token}" >"${work}/no-token.out" 2>"${work}/no-token.err"; then
  fail "latest repair succeeded without NPM_RECOVERY_TOKEN"
fi

no_converge="${work}/no-converge"
if MOCK_NO_CONVERGE=true run_case "${no_converge}" >"${work}/no-converge.out" 2>"${work}/no-converge.err"; then
  fail "publish succeeded without exact post-mutation readback convergence"
fi

eventual="${work}/eventual"
out="$(MOCK_STALE_READS=2 run_case "${eventual}")"
grep -q '^npm_action=publish$' <<<"${out}" || fail "eventually consistent publish did not converge"
[[ -s "${eventual}/sleeps" ]] || fail "post-publish stale reads were not retried with backoff"

wrong_artifact="${work}/wrong-artifact"
mkdir -p "${wrong_artifact}"
printf '2.260830.2\n' > "${wrong_artifact}/published"
printf '2.260830.2\n' > "${wrong_artifact}/latest"
if MOCK_WRONG_ARTIFACT=true run_case "${wrong_artifact}" >"${work}/wrong-artifact.out" 2>"${work}/wrong-artifact.err"; then
  fail "registry version/tag state accepted wrong package bytes"
fi

bad_signature="${work}/bad-signature"
mkdir -p "${bad_signature}"
printf '2.260830.2\n' > "${bad_signature}/published"
printf '2.260830.2\n' > "${bad_signature}/latest"
if MOCK_AUDIT_FAIL=true run_case "${bad_signature}" >"${work}/bad-signature.out" 2>"${work}/bad-signature.err"; then
  fail "failed npm signature/provenance audit was accepted"
fi

no_provenance="${work}/no-provenance"
if MOCK_NO_ATTESTATIONS=true run_case "${no_provenance}" >"${work}/no-provenance.out" 2>"${work}/no-provenance.err"; then
  fail "new trusted publication without verified SLSA provenance was accepted"
fi

exact_no_provenance="${work}/exact-no-provenance"
mkdir -p "${exact_no_provenance}"
printf '2.260830.2\n' > "${exact_no_provenance}/published"
printf '2.260830.2\n' > "${exact_no_provenance}/latest"
if MOCK_NO_ATTESTATIONS=true run_case "${exact_no_provenance}" \
  >"${work}/exact-no-provenance.out" 2>"${work}/exact-no-provenance.err"; then
  fail "existing stable package bypassed verified SLSA provenance"
fi

repair_no_provenance="${work}/repair-no-provenance"
mkdir -p "${repair_no_provenance}"
printf '2.260830.2\n' > "${repair_no_provenance}/published"
printf '2.260830.1\n' > "${repair_no_provenance}/latest"
if MOCK_NO_ATTESTATIONS=true NPM_RECOVERY_TOKEN=token run_case "${repair_no_provenance}" \
  >"${work}/repair-no-provenance.out" 2>"${work}/repair-no-provenance.err"; then
  fail "latest repair bypassed verified SLSA provenance"
fi

printf 'PASS: token-isolated npm publish, latest repair, and exact signed artifact readback contract\n'
