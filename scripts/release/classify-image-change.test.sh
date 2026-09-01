#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/classify-image-change.sh"
work=$(mktemp -d)
trap 'rm -rf "${work}"' EXIT
git -C "${work}" init -q
git -C "${work}" config user.name test
git -C "${work}" config user.email test@example.com
mkdir -p "${work}/packages/api" "${work}/scripts/release" "${work}/deploy/helm/omni"
printf 'base\n' >"${work}/README.md"
git -C "${work}" add . && git -C "${work}" commit -qm base
base=$(git -C "${work}" rev-parse HEAD)
printf 'app\n' >"${work}/packages/api/index.ts"
git -C "${work}" add . && git -C "${work}" commit -qm app
printf 'infra\n' >"${work}/scripts/release/contract.sh"
git -C "${work}" add . && git -C "${work}" commit -qm infra
out=$(cd "${work}" && "${SCRIPT}" --before "${base}" --after HEAD)
grep -qx 'build_required=true' <<<"${out}"
grep -qx 'infra_only=false' <<<"${out}"

git -C "${work}" checkout -q -b infra-only "${base}"
mkdir -p "${work}/.github/workflows" "${work}/scripts/release"
printf 'name: x\n' >"${work}/.github/workflows/x.yml"
printf 'infra\n' >"${work}/scripts/release/x.sh"
git -C "${work}" add . && git -C "${work}" commit -qm infra1
printf 'infra2\n' >>"${work}/scripts/release/x.sh"
git -C "${work}" commit -qam infra2
out=$(cd "${work}" && "${SCRIPT}" --before "${base}" --after HEAD)
grep -qx 'build_required=false' <<<"${out}"
grep -qx 'infra_only=true' <<<"${out}"

git -C "${work}" checkout -q -b pin-only "${base}"
printf 'image:\n' >"${work}/deploy/helm/omni/values-prod-gitops.yaml"
git -C "${work}" add . && git -C "${work}" commit -qm pin
out=$(cd "${work}" && "${SCRIPT}" --before "${base}" --after HEAD)
grep -qx 'pin_only=true' <<<"${out}"

out=$(cd "${work}" && "${SCRIPT}" --before 0000000000000000000000000000000000000000 --after HEAD)
grep -qx 'build_required=true' <<<"${out}"

real_git=$(command -v git)
mkdir -p "${work}/mock-bin"
cat >"${work}/mock-bin/git" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "diff" ]]; then
  exit 90
fi
exec "${REAL_GIT}" "$@"
SH
chmod +x "${work}/mock-bin/git"
if (cd "${work}" && PATH="${work}/mock-bin:${PATH}" REAL_GIT="${real_git}" \
  "${SCRIPT}" --before "${base}" --after HEAD >/dev/null 2>&1); then
  echo 'classification hid a git diff failure' >&2
  exit 1
fi
printf 'PASS: full push-range image classification contract\n'
