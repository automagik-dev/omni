#!/usr/bin/env bash
set -euo pipefail
usage() {
  printf 'Usage: verify-remote-tag.sh --remote REMOTE --version VERSION --mode absent|exact [--expected-sha FULL_SHA]\n' >&2
  exit 2
}
fail() { printf 'remote tag verification failed: %s\n' "$*" >&2; exit 1; }
remote=""
version=""
mode=""
expected_sha=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote) remote="${2:-}"; shift 2 ;;
    --version) version="${2:-}"; shift 2 ;;
    --mode) mode="${2:-}"; shift 2 ;;
    --expected-sha) expected_sha="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "${remote}" && "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
[[ "${mode}" == "absent" || "${mode}" == "exact" ]] || usage
if [[ "${mode}" == "exact" && ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then usage; fi
set +e
result=$(git ls-remote --exit-code --tags "${remote}" "refs/tags/v${version}" 2>/dev/null)
status=$?
set -e
if [[ ${status} -ne 0 && ${status} -ne 2 ]]; then
  fail "remote lookup failed"
fi
remote_sha=""
if [[ ${status} -eq 0 ]]; then
  remote_sha=$(awk 'NR == 1 {print $1}' <<<"${result}")
  [[ "${remote_sha}" =~ ^[0-9a-f]{40}$ ]] || fail "remote tag returned an invalid object id"
fi
if [[ "${mode}" == "absent" ]]; then
  [[ -z "${remote_sha}" ]] || fail "refs/tags/v${version} already exists at ${remote_sha}"
  printf 'remote_tag_absent=true\n'
else
  [[ "${remote_sha}" == "${expected_sha}" ]] || fail "refs/tags/v${version} resolves to ${remote_sha:-<absent>}, expected ${expected_sha}"
  printf 'remote_tag_sha=%s\n' "${remote_sha}"
fi
