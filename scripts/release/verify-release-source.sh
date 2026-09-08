#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: verify-release-source.sh --source FULL_SHA --main MAIN_REF [--allow-detached-repair --expected-version VERSION]\n' >&2
  exit 2
}

fail() {
  printf 'release source verification failed: %s\n' "$*" >&2
  exit 1
}

source_sha=""
main_ref=""
allow_detached=false
expected_version=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) source_sha="${2:-}"; shift 2 ;;
    --main) main_ref="${2:-}"; shift 2 ;;
    --allow-detached-repair) allow_detached=true; shift ;;
    --expected-version) expected_version="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ "${source_sha}" =~ ^[0-9a-f]{40}$ && -n "${main_ref}" ]] || usage
git cat-file -e "${source_sha}^{commit}" 2>/dev/null || fail "source commit does not exist"
git cat-file -e "${main_ref}^{commit}" 2>/dev/null || fail "main ref does not resolve to a commit"

changed_paths() {
  local from="$1" to="$2" output
  output="$(git diff --name-only "${from}" "${to}")" || \
    fail "could not inspect source drift from ${from} to ${to}"
  printf '%s\n' "${output}"
}

if git merge-base --is-ancestor "${source_sha}" "${main_ref}"; then
  drift="$(changed_paths "${source_sha}" "${main_ref}")"
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    case "${path}" in
      .github/workflows/*|scripts/release/*|scripts/ci/*|deploy/helm/*|.well-known/*.json) ;;
      *) fail "reachable source has non-infrastructure main drift at ${path}" ;;
    esac
  done <<<"${drift}"
  printf 'detached_repair=false\n'
  exit 0
fi

[[ "${allow_detached}" == "true" ]] || fail "source is not reachable from main"
[[ "${expected_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
  fail "detached repair requires an exact expected version"
lineage="$(git rev-list --parents -n 1 "${source_sha}")" || \
  fail "could not inspect detached source parents"
read -r -a source_lineage <<<"${lineage}"
[[ ${#source_lineage[@]} -eq 2 ]] || \
  fail "detached repair source must be a single-parent non-root commit"
parent="${source_lineage[1]}"
git merge-base --is-ancestor "${parent}" "${main_ref}" || fail "detached source parent is not reachable from main"
self_verifier="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-version-only-diff.py"
"${self_verifier}" --parent "${parent}" --source "${source_sha}" \
  --expected-version "${expected_version}" >/dev/null
self_drift="$(changed_paths "${parent}" "${source_sha}")"
while IFS= read -r path; do
  [[ -n "${path}" ]] || continue
  case "${path}" in
    package.json|bun.lock|packages/*/package.json|apps/*/package.json|deploy/helm/omni/Chart.yaml|.claude-plugin/marketplace.json|plugins/omni/.claude-plugin/plugin.json) ;;
    *) fail "detached source commit itself changes non-version path ${path}" ;;
  esac
done <<<"${self_drift}"
main_drift="$(changed_paths "${source_sha}" "${main_ref}")"
while IFS= read -r path; do
  [[ -n "${path}" ]] || continue
  case "${path}" in
    package.json|bun.lock|packages/*/package.json|apps/*/package.json|deploy/helm/omni/Chart.yaml|.claude-plugin/marketplace.json|plugins/omni/.claude-plugin/plugin.json|.github/workflows/*|scripts/release/*|scripts/ci/*|deploy/helm/*|.well-known/*.json) ;;
    *) fail "version-only detached repair differs from main at non-version path ${path}" ;;
  esac
done <<<"${main_drift}"
printf 'detached_repair=true\n'
