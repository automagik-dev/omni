#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: verify-promotion-candidate.sh --candidate-sha FULL_SHA --final-sha FULL_SHA --version VERSION --digest sha256:...\n' >&2
  exit 2
}

fail() {
  printf 'promotion candidate verification failed: %s\n' "$*" >&2
  exit 1
}

candidate_sha=""
final_sha=""
version=""
digest=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidate-sha) candidate_sha="${2:-}"; shift 2 ;;
    --final-sha) final_sha="${2:-}"; shift 2 ;;
    --version) version="${2:-}"; shift 2 ;;
    --digest) digest="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ "${candidate_sha}" =~ ^[0-9a-f]{40}$ ]] || fail "candidate SHA must be 40 lowercase hexadecimal characters"
[[ "${final_sha}" =~ ^[0-9a-f]{40}$ ]] || fail "final SHA must be 40 lowercase hexadecimal characters"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version must be numeric dotted form"
[[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "digest must be lowercase sha256 with 64 hexadecimal characters"

git cat-file -e "${candidate_sha}^{commit}" 2>/dev/null || fail "candidate commit does not exist"
git cat-file -e "${final_sha}^{commit}" 2>/dev/null || fail "final commit does not exist"
git merge-base --is-ancestor "${candidate_sha}" "${final_sha}" || \
  fail "candidate commit is not an ancestor of the final tree"

tag_sha="$(git rev-parse "refs/tags/v${version}^{commit}" 2>/dev/null)" || \
  fail "immutable tag v${version} does not exist"
[[ "${tag_sha}" == "${candidate_sha}" ]] || \
  fail "immutable tag v${version} points to ${tag_sha}, expected ${candidate_sha}"

candidate_version="$(git show "${candidate_sha}:packages/cli/package.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')" || \
  fail "candidate package version could not be read"
[[ "${candidate_version}" == "${version}" ]] || \
  fail "candidate package version ${candidate_version} does not match ${version}"

build_inputs=(deploy/Dockerfile package.json bun.lock packages apps)
set +e
git diff --quiet "${candidate_sha}" "${final_sha}" -- "${build_inputs[@]}"
diff_status=$?
set -e
case "${diff_status}" in
  0) ;;
  1)
    drift="$(git diff --name-status "${candidate_sha}" "${final_sha}" -- "${build_inputs[@]}")" || \
      fail "could not enumerate final image build-input drift"
    fail "final image build-input drift from ${candidate_sha}: ${drift//$'\n'/, }"
    ;;
  *) fail "could not inspect final image build inputs" ;;
esac

output="${GITHUB_OUTPUT:-/dev/stdout}"
{
  printf 'promotion_candidate_verified=true\n'
  printf 'candidate_sha=%s\n' "${candidate_sha}"
  printf 'final_sha=%s\n' "${final_sha}"
  printf 'version=%s\n' "${version}"
  printf 'digest=%s\n' "${digest}"
} >>"${output}"
