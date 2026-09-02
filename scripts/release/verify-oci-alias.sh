#!/usr/bin/env bash
set -euo pipefail
image=""
version=""
tag=""
expected_digest=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) image="${2:-}"; shift 2 ;;
    --version) version="${2:-}"; shift 2 ;;
    --tag) tag="${2:-}"; shift 2 ;;
    --expected-digest) expected_digest="${2:-}"; shift 2 ;;
    *) echo "OCI alias verification failed: unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ "${image}" =~ ^[a-z0-9.-]+(/[a-z0-9._-]+)+$ ]] || { echo 'OCI alias verification failed: invalid image' >&2; exit 1; }
[[ -n "${version}" && -n "${tag}" ]] && { echo 'OCI alias verification failed: --version and --tag are mutually exclusive' >&2; exit 2; }
if [[ -n "${tag}" ]]; then
  # A non-candidate alias (the dev channel's `dev` / `dev-<sha12>`). Candidate
  # aliases are always named through --version so the `v<version>` identity
  # cannot be spelled two ways.
  [[ "${tag}" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || { echo 'OCI alias verification failed: invalid tag' >&2; exit 1; }
  [[ "${tag}" =~ ^v[0-9] ]] && { echo 'OCI alias verification failed: candidate aliases are verified with --version, not --tag' >&2; exit 1; }
  alias="${image}:${tag}"
else
  [[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'OCI alias verification failed: invalid version' >&2; exit 1; }
  alias="${image}:v${version}"
fi
[[ "${expected_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'OCI alias verification failed: invalid expected digest' >&2; exit 1; }
actual_digest=$(docker buildx imagetools inspect "${alias}" --format '{{.Manifest.Digest}}')
actual_digest="${actual_digest//$'\r'/}"
[[ "${actual_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'OCI alias verification failed: registry returned a malformed digest' >&2; exit 1; }
[[ "${actual_digest}" == "${expected_digest}" ]] || {
  echo "OCI alias verification failed: ${alias} resolves to ${actual_digest}, expected ${expected_digest}" >&2
  exit 1
}
printf 'oci_alias_verified=true\n'
