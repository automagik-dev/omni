#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: reconcile-npm-stable.sh --expected VERSION --package-dir PATH\n' >&2
  exit 2
}
fail() { printf 'npm stable reconciliation failed: %s\n' "$*" >&2; exit 1; }

expected=""
package_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected) expected="${2:-}"; shift 2 ;;
    --package-dir) package_dir="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "${expected}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && -d "${package_dir}" ]] || usage

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_helper="${script_dir}/verify-npm-stable-state.sh"
artifact_helper="${script_dir}/verify-npm-artifact.py"
[[ -x "${state_helper}" ]] || fail "state verifier is unavailable"
[[ -x "${artifact_helper}" ]] || fail "artifact verifier is unavailable"

# Keep the recovery credential out of every package lifecycle process. Only
# the repair_latest branch reintroduces it as NODE_AUTH_TOKEN for one command.
recovery_token="${NPM_RECOVERY_TOKEN:-}"
unset NPM_RECOVERY_TOKEN NODE_AUTH_TOKEN
pack_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omni-npm-pack.XXXXXX")"
audit_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omni-npm-audit.XXXXXX")"
pack_output="${pack_dir}/npm-pack.out"
if ! (cd "${package_dir}" && npm pack --json --silent --pack-destination "${pack_dir}") >"${pack_output}"; then
  cat "${pack_output}" >&2 || true
  fail "npm pack failed"
fi
pack_name="$(python3 - "${pack_output}" <<'PY'
import json, pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
found = ""
for index, char in enumerate(text):
    if char != "[":
        continue
    try:
        value, end = json.JSONDecoder().raw_decode(text[index:])
    except json.JSONDecodeError:
        continue
    if not text[index + end:].strip() and isinstance(value, list) and len(value) == 1:
        item = value[0]
        if isinstance(item, dict) and isinstance(item.get("filename"), str):
            found = item["filename"]
if not found:
    raise SystemExit("could not parse final npm pack JSON")
print(found)
PY
)"
[[ -n "${pack_name}" && -f "${pack_dir}/${pack_name##*/}" ]] || \
  fail "npm pack did not produce exactly one expected tarball"
tarball="${pack_dir}/${pack_name##*/}"

read_published() {
  local error_file="$1" value=""
  if ! value="$(npm view "@automagik/omni@${expected}" version 2>"${error_file}")"; then
    local error_text
    error_text="$(<"${error_file}")"
    case "${error_text}" in
      *E404*|*"404 Not Found"*) value="" ;;
      *) fail "npm registry lookup failed without a not-found response" ;;
    esac
  fi
  printf '%s\n' "${value}"
}

error_file="${RUNNER_TEMP:-/tmp}/npm-view-${$}.err"
dist_file="${RUNNER_TEMP:-/tmp}/npm-dist-${$}.json"
keys_file="${RUNNER_TEMP:-/tmp}/npm-keys-${$}.json"
trap 'rm -f "${error_file}" "${dist_file}" "${keys_file}"; rm -rf "${pack_dir}" "${audit_dir}"' EXIT
published="$(read_published "${error_file}")"
latest="$(npm view @automagik/omni dist-tags --json | jq -r '.latest // empty')"
state="$("${state_helper}" --expected "${expected}" --published "${published}" --latest "${latest}")"
action="${state#npm_action=}"

case "${action}" in
  none)
    ;;
  publish)
    npm publish "${tarball}" --access public --tag latest
    ;;
  repair_latest)
    [[ -n "${recovery_token}" ]] || \
      fail "NPM_RECOVERY_TOKEN is required to repair an existing package's latest dist-tag"
    NODE_AUTH_TOKEN="${recovery_token}" \
      npm dist-tag add "@automagik/omni@${expected}" latest
    ;;
  *) fail "unexpected state action ${action}" ;;
esac

published_after="$(npm view "@automagik/omni@${expected}" version)"
latest_after="$(npm view @automagik/omni dist-tags --json | jq -r '.latest // empty')"
final_state="$("${state_helper}" \
  --expected "${expected}" --published "${published_after}" --latest "${latest_after}")"
[[ "${final_state}" == "npm_action=none" ]] || \
  fail "registry state did not converge after ${action}"
npm view "@automagik/omni@${expected}" dist --json > "${dist_file}"
integrity="$(jq -r '.integrity // empty' "${dist_file}")"
resolved="$(jq -r '.tarball // empty' "${dist_file}")"
expected_url="https://registry.npmjs.org/@automagik/omni/-/omni-${expected}.tgz"
[[ -n "${integrity}" && "${resolved}" == "${expected_url}" ]] || \
  fail "registry metadata is missing an approved npm tarball URL"
registry_tarball="${pack_dir}/registry-omni-${expected}.tgz"
curl -fsSLo "${registry_tarball}" "${resolved}"
curl -fsSLo "${keys_file}" "https://registry.npmjs.org/-/npm/v1/keys"
"${artifact_helper}" --expected-tarball "${tarball}" \
  --registry-tarball "${registry_tarball}" --dist-json "${dist_file}" \
  --keys-json "${keys_file}" --package @automagik/omni --version "${expected}" >/dev/null
jq -n --arg version "${expected}" \
  '{name:"omni-signature-audit",version:"0.0.0",private:true,dependencies:{"@automagik/omni":$version}}' \
  > "${audit_dir}/package.json"
(
  cd "${audit_dir}"
  npm install --ignore-scripts --no-audit --no-fund >/dev/null
  npm audit signatures --json --include-attestations > "${audit_dir}/audit.json"
)
if [[ "${action}" == "publish" ]]; then
  python3 - "${audit_dir}/audit.json" "${expected}" <<'PY'
import json, pathlib, sys
document = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
matches = [
    item for item in document.get("verified", [])
    if isinstance(item, dict)
    and item.get("name") == "@automagik/omni"
    and item.get("version") == sys.argv[2]
]
if len(matches) != 1:
    raise SystemExit("new npm publication has no verified package attestation")
provenance = matches[0].get("attestations", {}).get("provenance", {})
if provenance.get("predicateType") != "https://slsa.dev/provenance/v1":
    raise SystemExit("new npm publication has no verified SLSA provenance")
PY
fi
printf 'npm_action=%s\n' "${action}"
