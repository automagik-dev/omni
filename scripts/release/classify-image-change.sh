#!/usr/bin/env bash
set -euo pipefail
before=""
after=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --before) before="${2:-}"; shift 2 ;;
    --after) after="${2:-}"; shift 2 ;;
    *) echo "classify image change failed: unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ "${before}" =~ ^[0-9a-f]{40}$ ]] || { echo 'classify image change failed: invalid before SHA' >&2; exit 1; }
[[ -n "${after}" ]] || { echo 'classify image change failed: missing after revision' >&2; exit 1; }
after_sha=$(git rev-parse "${after}^{commit}")
zero=0000000000000000000000000000000000000000
if [[ "${before}" == "${zero}" ]]; then
  base=$(git hash-object -t tree /dev/null)
else
  git cat-file -e "${before}^{commit}" 2>/dev/null || {
    echo "classify image change failed: before commit is unavailable: ${before}" >&2
    exit 1
  }
  base="${before}"
fi
changed_output="$(git diff --name-only "${base}" "${after_sha}")" || {
  echo "classify image change failed: could not inspect ${base}..${after_sha}" >&2
  exit 1
}
changed=()
while IFS= read -r path; do
  [[ -n "${path}" ]] && changed+=("${path}")
done <<<"${changed_output}"
if [[ ${#changed[@]} -eq 1 && "${changed[0]}" == "deploy/helm/omni/values-prod-gitops.yaml" ]]; then
  printf '%s\n' 'pin_only=true' 'infra_only=false' 'build_required=false'
  exit 0
fi
infra_only=true
if [[ ${#changed[@]} -eq 0 ]]; then
  infra_only=false
fi
for path in "${changed[@]}"; do
  case "${path}" in
    .github/workflows/*|scripts/release/*|scripts/ci/*|deploy/helm/*) ;;
    *) infra_only=false ;;
  esac
done
if [[ "${infra_only}" == "true" ]]; then
  printf '%s\n' 'pin_only=false' 'infra_only=true' 'build_required=false'
else
  printf '%s\n' 'pin_only=false' 'infra_only=false' 'build_required=true'
fi
