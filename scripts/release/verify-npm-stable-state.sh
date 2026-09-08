#!/usr/bin/env bash
set -euo pipefail
usage() {
  printf 'Usage: verify-npm-stable-state.sh --expected VERSION --published VERSION_OR_EMPTY --latest VERSION_OR_EMPTY\n' >&2
  exit 2
}
fail() { printf 'npm stable state verification failed: %s\n' "$*" >&2; exit 1; }
expected=""
published=""
latest=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected) expected="${2:-}"; shift 2 ;;
    --published) published="${2:-}"; shift 2 ;;
    --latest) latest="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "${expected}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
if [[ -z "${published}" ]]; then
  printf 'npm_action=publish\n'
  exit 0
fi
[[ "${published}" == "${expected}" ]] || fail "registry returned ${published}, expected ${expected}"
if [[ "${latest}" != "${expected}" ]]; then
  if [[ -n "${latest}" ]]; then
    [[ "${latest}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
      fail "latest dist-tag returned invalid version ${latest}"
    newest="$(printf '%s\n%s\n' "${expected}" "${latest}" | sort -V | tail -n 1)"
    [[ "${newest}" != "${latest}" ]] || \
      fail "latest ${latest} is newer than expected ${expected}; refusing to move it backwards"
  fi
  printf 'npm_action=repair_latest\n'
  exit 0
fi
printf 'npm_action=none\n'
