#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-promotion-candidate.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
repo="${work}/repo"
mkdir -p \
  "${repo}/deploy" \
  "${repo}/packages/cli" \
  "${repo}/apps/api" \
  "${repo}/.github/workflows"

(
  cd "${repo}"
  git init -q
  git config user.name test
  git config user.email test@example.com
  printf 'FROM scratch\n' > deploy/Dockerfile
  printf '{"name":"omni","version":"2.260830.2"}\n' > package.json
  printf 'lockfileVersion = 1\n' > bun.lock
  printf '{"name":"@automagik/omni","version":"2.260830.2"}\n' > packages/cli/package.json
  printf 'export const api = true;\n' > apps/api/index.ts
  git add .
  git commit -qm candidate
  git tag v2.260830.2
)
candidate="$(git -C "${repo}" rev-parse HEAD)"

(
  cd "${repo}"
  printf 'name: read-only control\n' > .github/workflows/control.yml
  git add .
  git commit -qm control-only
)
final="$(git -C "${repo}" rev-parse HEAD)"

(
  # GitHub Actions exports this for every step. This assertion reads the
  # verifier's stdout contract, so do not let the runner redirect it.
  unset GITHUB_OUTPUT
  cd "${repo}"
  "${SCRIPT}" \
    --candidate-sha "${candidate}" \
    --final-sha "${final}" \
    --version 2.260830.2 \
    --digest sha256:dba9b81cead5efacf9303ab75487a762fa100992dc2bb52741524a7a036b2da8
) | grep -qx 'promotion_candidate_verified=true' || \
  fail "control-only final tree was not accepted"

(
  cd "${repo}"
  printf 'export const api = false;\n' > apps/api/index.ts
  git add .
  git commit -qm drift
)
drifted="$(git -C "${repo}" rev-parse HEAD)"
if (
  cd "${repo}"
  "${SCRIPT}" \
    --candidate-sha "${candidate}" \
    --final-sha "${drifted}" \
    --version 2.260830.2 \
    --digest sha256:dba9b81cead5efacf9303ab75487a762fa100992dc2bb52741524a7a036b2da8
) >"${work}/drift.out" 2>"${work}/drift.err"; then
  fail "final image build-input drift was accepted"
fi
grep -q 'image build-input drift' "${work}/drift.err" || \
  fail "build-input rejection did not identify the violated contract"

if (
  cd "${repo}"
  "${SCRIPT}" \
    --candidate-sha "${final}" \
    --final-sha "${candidate}" \
    --version 2.260830.2 \
    --digest sha256:dba9b81cead5efacf9303ab75487a762fa100992dc2bb52741524a7a036b2da8
) >"${work}/ancestry.out" 2>"${work}/ancestry.err"; then
  fail "non-ancestor candidate was accepted"
fi

if (
  cd "${repo}"
  "${SCRIPT}" \
    --candidate-sha "${candidate}" \
    --final-sha "${final}" \
    --version 2.260830.2 \
    --digest sha256:ABC
) >"${work}/digest.out" 2>"${work}/digest.err"; then
  fail "invalid candidate digest was accepted"
fi

printf 'PASS: immutable promotion candidate and final build-input identity contract\n'
