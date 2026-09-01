#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-release-source.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
repo="${work}/repo"
mkdir -p "${repo}/packages/cli" "${repo}/deploy/helm/omni"
(
  cd "${repo}"
  git init -q
  git config user.name test
  git config user.email test@example.com
  printf '{"version":"2.260830.1"}\n' > package.json
  printf '{"version":"2.260830.1"}\n' > packages/cli/package.json
  printf 'appVersion: "2.260830.1"\n' > deploy/helm/omni/Chart.yaml
  git add .
  git commit -qm base
)
BASE="$(git -C "${repo}" rev-parse HEAD)"

(
  cd "${repo}"
  git switch -qc main
  mkdir -p scripts/release
  printf '# hardened release infrastructure\n' > scripts/release/pin.sh
  git add .
  git commit -qm infra
)
MAIN="$(git -C "${repo}" rev-parse HEAD)"

(
  cd "${repo}"
  git switch -q --detach "${BASE}"
  printf '{"version":"2.260830.2"}\n' > package.json
  printf '{"version":"2.260830.2"}\n' > packages/cli/package.json
  printf 'appVersion: "2.260830.2"\n' > deploy/helm/omni/Chart.yaml
  git add .
  git commit -qm version-only
)
DETACHED="$(git -C "${repo}" rev-parse HEAD)"

mkdir -p "${work}/bin"
REAL_GIT="$(command -v git)"
cat > "${work}/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "diff" && "${2:-}" == "--name-only" &&
      "${3:-}" == "${MOCK_FAIL_FROM:-}" && "${4:-}" == "${MOCK_FAIL_TO:-}" ]]; then
  exit 77
fi
exec "${REAL_GIT}" "$@"
SH
chmod +x "${work}/bin/git"

expect_diff_failure() {
  local from="$1" to="$2" source="$3"
  shift 3
  if (
    cd "${repo}"
    PATH="${work}/bin:${PATH}" REAL_GIT="${REAL_GIT}" \
      MOCK_FAIL_FROM="${from}" MOCK_FAIL_TO="${to}" \
      "${SCRIPT}" --source "${source}" --main "${MAIN}" "$@"
  ) >"${work}/git-diff-failure.out" 2>"${work}/git-diff-failure.err"; then
    fail "git diff failure for ${from}..${to} was accepted"
  fi
}

expect_diff_failure "${BASE}" "${MAIN}" "${BASE}"
expect_diff_failure "${BASE}" "${DETACHED}" "${DETACHED}" --allow-detached-repair --expected-version 2.260830.2
expect_diff_failure "${DETACHED}" "${MAIN}" "${DETACHED}" --allow-detached-repair --expected-version 2.260830.2

(
  cd "${repo}"
  "${SCRIPT}" --source "${DETACHED}" --main "${MAIN}" --allow-detached-repair --expected-version 2.260830.2
) >"${work}/detached.out"
grep -q '^detached_repair=true$' "${work}/detached.out" || fail "version-only detached repair was not accepted"

(
  cd "${repo}"
  git switch -q --detach "${BASE}"
  printf 'unexpected\n' > packages/cli/runtime.ts
  git add .
  git commit -qm unsafe-detached
)
UNSAFE="$(git -C "${repo}" rev-parse HEAD)"
if (
  cd "${repo}"
  "${SCRIPT}" --source "${UNSAFE}" --main "${MAIN}" --allow-detached-repair --expected-version 2.260830.2
) >"${work}/unsafe.out" 2>"${work}/unsafe.err"; then
  fail "detached repair with product-code drift was accepted"
fi

if (
  cd "${repo}"
  "${SCRIPT}" --source "${DETACHED}" --main "${MAIN}"
) >"${work}/disabled.out" 2>"${work}/disabled.err"; then
  fail "detached repair was accepted without explicit authorization"
fi

printf 'PASS: reachable and version-only detached release source contract\n'
