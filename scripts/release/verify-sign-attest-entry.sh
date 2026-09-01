#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: verify-sign-attest-entry.sh --remote REMOTE --version VERSION --source-ref REF --source-sha FULL_SHA\n' >&2
  exit 2
}

fail() {
  printf 'sign-attest entry verification failed: %s\n' "$*" >&2
  exit 1
}

remote=""
version=""
source_ref=""
source_sha=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote) remote="${2:-}"; shift 2 ;;
    --version) version="${2:-}"; shift 2 ;;
    --source-ref) source_ref="${2:-}"; shift 2 ;;
    --source-sha) source_sha="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "${remote}" ]] || usage
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
  fail "version must be an exact semantic version"
[[ "${source_ref}" == "refs/tags/v${version}" ]] || \
  fail "source ref must be refs/tags/v${version}"
[[ "${source_sha}" =~ ^[0-9a-f]{40}$ ]] || \
  fail "source SHA must be a full lowercase commit SHA"

"$(dirname "${BASH_SOURCE[0]}")/verify-remote-tag.sh" \
  --remote "${remote}" \
  --version "${version}" \
  --mode exact \
  --expected-sha "${source_sha}"

printf 'sign_attest_entry=authorized\n'
