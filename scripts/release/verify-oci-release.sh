#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: verify-oci-release.sh --ref refs/tags/vVERSION --expected-version VERSION \
  --expected-sha FULL_SHA --image REGISTRY/IMAGE [--expected-existing-digest sha256:...]
EOF
  exit 2
}

fail() {
  printf 'release preflight failed: %s\n' "$*" >&2
  exit 1
}

release_ref=""
expected_version=""
expected_sha=""
image=""
expected_existing_digest=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) release_ref="${2:-}"; shift 2 ;;
    --expected-version) expected_version="${2:-}"; shift 2 ;;
    --expected-sha) expected_sha="${2:-}"; shift 2 ;;
    --image) image="${2:-}"; shift 2 ;;
    --expected-existing-digest) expected_existing_digest="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "${release_ref}" && -n "${expected_version}" && -n "${expected_sha}" && -n "${image}" ]] || usage
[[ "${expected_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "expected version is not a numeric dotted version"
[[ "${expected_sha}" =~ ^[0-9a-f]{40}$ ]] || fail "expected SHA must be 40 lowercase hexadecimal characters"
[[ "${release_ref}" == "refs/tags/v${expected_version}" ]] || fail "release ref must be refs/tags/v${expected_version}"
if [[ -n "${expected_existing_digest}" && ! "${expected_existing_digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  fail "expected existing digest is invalid"
fi

head_sha="$(git rev-parse HEAD^{commit})"
[[ "${head_sha}" == "${expected_sha}" ]] || fail "HEAD ${head_sha} does not match expected source ${expected_sha}"
tag_sha="$(git rev-parse "${release_ref}^{commit}" 2>/dev/null)" || fail "release tag does not exist"
[[ "${tag_sha}" == "${expected_sha}" ]] || fail "release tag resolves to ${tag_sha}, not ${expected_sha}"

package_version="$(node -p "require('./packages/cli/package.json').version")"
[[ "${package_version}" == "${expected_version}" ]] || fail "package version ${package_version} does not match ${expected_version}"
chart_version="$(python3 - <<'PY'
import re
text = open('deploy/helm/omni/Chart.yaml', encoding='utf-8').read()
match = re.search(r'^appVersion:\s*["\x27]?([^"\x27\s]+)["\x27]?\s*$', text, flags=re.MULTILINE)
if not match:
    raise SystemExit('Chart.yaml appVersion not found')
print(match.group(1))
PY
)"
[[ "${chart_version}" == "${expected_version}" ]] || fail "chart appVersion ${chart_version} does not match ${expected_version}"

version_ref="${image}:v${expected_version}"
inspect_error="$(mktemp)"
trap 'rm -f "${inspect_error}"' EXIT
if inspect_output="$(docker buildx imagetools inspect "${version_ref}" 2>"${inspect_error}")"; then
  existing_digest=""
  while IFS= read -r line; do
    case "${line}" in
      Digest:*)
        existing_digest="${line#Digest:}"
        existing_digest="${existing_digest#${existing_digest%%[![:space:]]*}}"
        break
        ;;
    esac
  done <<<"${inspect_output}"
  [[ "${existing_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "existing version tag has no valid OCI index digest"
  [[ -n "${expected_existing_digest}" ]] || fail "${version_ref} already exists; supply its exact digest to make the repair idempotent"
  [[ "${existing_digest}" == "${expected_existing_digest}" ]] || fail "${version_ref} resolves to ${existing_digest}, not approved ${expected_existing_digest}"
  publish_required=false
else
  error_text="$(<"${inspect_error}")"
  case "${error_text,,}" in
    *"not found"*|*"manifest unknown"*) publish_required=true ;;
    *) fail "registry inspection failed without a not-found response" ;;
  esac
  existing_digest=""
fi

output="${GITHUB_OUTPUT:-/dev/stdout}"
{
  printf 'release_ref=%s\n' "${release_ref}"
  printf 'version=%s\n' "${expected_version}"
  printf 'source_sha=%s\n' "${expected_sha}"
  printf 'version_ref=%s\n' "${version_ref}"
  printf 'publish_required=%s\n' "${publish_required}"
  printf 'existing_digest=%s\n' "${existing_digest}"
} >>"${output}"
