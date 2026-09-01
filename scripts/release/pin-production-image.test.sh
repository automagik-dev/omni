#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/pin-production-image.sh"
OLD_DIGEST="sha256:c4ede7c3a0f8768a1307e5534c00f163b12eb89ba8d882e75a5cafaae16cd414"
NEW_DIGEST="sha256:dba9b81cead5efacf9303ab75487a762fa100992dc2bb52741524a7a036b2da8"
OTHER_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SOURCE_SHA="b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
repo="${work}/repo"
mkdir -p "${repo}/deploy/helm/omni"
cat >"${repo}/deploy/helm/omni/values-prod-gitops.yaml" <<EOF
image:
  digest: ${OLD_DIGEST}

gitopsRelease:
  version: "2.260830.1"
  sourceRevision: "01a1f26f206437d272c23035f1ae989f664aee72"
EOF
(
  cd "${repo}"
  git init -q
  git config user.name test
  git config user.email test@example.com
  git add .
  git commit -qm fixture
)
PARENT="$(git -C "${repo}" rev-parse HEAD)"

run_pin() {
  (
    # GitHub Actions exports this for every step. The fixture asserts the
    # command's stdout contract, so do not let the runner redirect it to the
    # workflow output file while this unit test is capturing stdout.
    unset GITHUB_OUTPUT
    cd "${repo}"
    "${SCRIPT}" \
      --version 2.260830.2 \
      --digest "${NEW_DIGEST}" \
      --source-sha "${SOURCE_SHA}" \
      --expected-parent "${PARENT}" \
      "$@"
  )
}

run_pin >"${work}/changed.out"
python3 - "${work}/changed.out" "${repo}/deploy/helm/omni/values-prod-gitops.yaml" <<'PY' || fail "upgrade pin did not update exactly"
import sys
out = open(sys.argv[1], encoding="utf-8").read()
text = open(sys.argv[2], encoding="utf-8").read()
expected = {
  "changed=true",
  "version=2.260830.2",
  "digest=sha256:dba9b81cead5efacf9303ab75487a762fa100992dc2bb52741524a7a036b2da8",
  "source_sha=b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031",
}
if not all(x in out for x in expected): raise SystemExit(1)
if text.count("digest:") != 1 or text.count("version:") != 1 or text.count("sourceRevision:") != 1: raise SystemExit(1)
if "2.260830.2" not in text or "dba9b81c" not in text or "b8c1bf20" not in text: raise SystemExit(1)
PY

git -C "${repo}" add deploy/helm/omni/values-prod-gitops.yaml
git -C "${repo}" commit -qm pinned
PARENT="$(git -C "${repo}" rev-parse HEAD)"
run_pin >"${work}/same.out"
python3 - "${work}/same.out" <<'PY' || fail "idempotent pin did not no-op"
import sys
raise SystemExit(0 if "changed=false" in open(sys.argv[1], encoding="utf-8").read() else 1)
PY
[[ -z "$(git -C "${repo}" status --porcelain)" ]] || fail "idempotent pin dirtied the tree"

if (
  cd "${repo}"
  "${SCRIPT}" --version 2.260830.1 --digest "${OLD_DIGEST}" --source-sha "${SOURCE_SHA}" --expected-parent "${PARENT}"
) >"${work}/downgrade.out" 2>"${work}/downgrade.err"; then
  fail "version downgrade was accepted"
fi

if (
  cd "${repo}"
  "${SCRIPT}" --version 2.260830.2 --digest "${OTHER_DIGEST}" --source-sha "${SOURCE_SHA}" --expected-parent "${PARENT}"
) >"${work}/rebind.out" 2>"${work}/rebind.err"; then
  fail "existing version was rebound to a different digest"
fi

if (
  cd "${repo}"
  "${SCRIPT}" --version 2.260830.3 --digest sha256:ABC --source-sha "${SOURCE_SHA}" --expected-parent "${PARENT}"
) >"${work}/invalid.out" 2>"${work}/invalid.err"; then
  fail "invalid digest was accepted"
fi

if (
  cd "${repo}"
  "${SCRIPT}" --version 2.260830.3 --digest "${OTHER_DIGEST}" --source-sha "${SOURCE_SHA}" --expected-parent 0000000000000000000000000000000000000000
) >"${work}/parent.out" 2>"${work}/parent.err"; then
  fail "wrong expected parent was accepted"
fi

printf 'PASS: race-safe production digest pin contract\n'
