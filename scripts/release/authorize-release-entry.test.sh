#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/authorize-release-entry.py"
VERSION=2.260830.2
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
OTHER_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
BOUND_ARGS=(
  --version "${VERSION}"
  --source-ref "refs/tags/v${VERSION}"
  --source-sha "${SHA}"
  --expected-sha "${SHA}"
)
# Fully bound: every other precondition holds, so the only reason this call can
# be rejected is the direct-stable rule itself. Without BOUND_ARGS the call is
# also missing a version and would still be rejected after that rule was
# deleted, letting the negative test pass for an unrelated reason.
if "${SCRIPT}" --channel stable --orchestrated false --recovery-run-id 123 \
  "${BOUND_ARGS[@]}" 2>"${work}/direct-stable.err"; then
  echo 'FAIL: direct stable dispatch was accepted' >&2; exit 1
fi
grep -q 'direct stable workflow_dispatch is disabled' "${work}/direct-stable.err" || {
  echo 'FAIL: direct stable rejection was not attributable to the direct-stable rule' >&2; exit 1
}
[[ "$("${SCRIPT}" --channel stable --orchestrated true "${BOUND_ARGS[@]}")" == 'mode=orchestrated' ]]
if "${SCRIPT}" --channel stable --orchestrated true --recovery-run-id 123 "${BOUND_ARGS[@]}"; then
  echo 'FAIL: orchestrated run accepted a foreign recovery run id' >&2; exit 1
fi
[[ "$("${SCRIPT}" --channel dev --orchestrated true "${BOUND_ARGS[@]}")" == 'mode=orchestrated' ]]
if "${SCRIPT}" --channel dev --orchestrated true \
  --version "${VERSION}" --source-ref refs/heads/dev \
  --source-sha "${SHA}" --expected-sha "${SHA}"; then
  echo 'FAIL: orchestrated dev branch was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated true \
  --version "${VERSION}" --source-ref "refs/tags/v${VERSION}" \
  --source-sha "${SHA}" --expected-sha ''; then
  echo 'FAIL: orchestrated dev publish with an empty expected SHA was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated true \
  --version "${VERSION}" --source-ref "refs/tags/v${VERSION}" \
  --source-sha "${SHA}" --expected-sha "${OTHER_SHA}"; then
  echo 'FAIL: orchestrated dev publish with a mismatched expected SHA was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated true \
  --version "${VERSION}" --source-ref refs/tags/v2.260830.3 \
  --source-sha "${SHA}" --expected-sha "${SHA}"; then
  echo 'FAIL: orchestrated dev publish from the wrong version tag was accepted' >&2; exit 1
fi
RECOVERY_ARGS=(
  --channel dev
  --orchestrated false
  --recovery-run-id 123
  --version "${VERSION}"
  --source-ref "refs/tags/v${VERSION}"
  --source-sha "${SHA}"
  --expected-sha "${SHA}"
)
[[ "$("${SCRIPT}" "${RECOVERY_ARGS[@]}")" == 'mode=recovery' ]]
if "${SCRIPT}" --channel dev --orchestrated false --recovery-run-id 123 \
  --version "${VERSION}" --source-ref "refs/tags/v${VERSION}" \
  --source-sha "${SHA}" --expected-sha ''; then
  echo 'FAIL: recovery with an empty expected source SHA was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated false --recovery-run-id 123 \
  --version "${VERSION}" --source-ref "refs/tags/v${VERSION}" \
  --source-sha "${SHA}" --expected-sha "${OTHER_SHA}"; then
  echo 'FAIL: recovery with a mismatched expected source SHA was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated false --recovery-run-id 123 \
  --version "${VERSION}" --source-ref refs/heads/dev \
  --source-sha "${SHA}" --expected-sha "${SHA}"; then
  echo 'FAIL: branch-ref recovery was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel homolog --orchestrated false --recovery-run-id 123 \
  "${BOUND_ARGS[@]}"; then
  echo 'FAIL: retired homolog channel was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated false --recovery-run-id '1; touch /tmp/injected' \
  --version "${VERSION}" --source-ref "refs/tags/v${VERSION}" \
  --source-sha "${SHA}" --expected-sha "${SHA}"; then
  echo 'FAIL: invalid recovery run id was accepted' >&2; exit 1
fi
# SemVer 2.0.0 forbids leading zeroes in numeric identifiers, so a
# leading-zero version is a different string that resolves to the same release
# number. Every other argument here is internally consistent, so acceptance
# would admit a non-canonical spelling of an authorized release.
for noncanonical in 01.02.003 2.260830.02 02.260830.2; do
  if "${SCRIPT}" --channel dev --orchestrated true \
    --version "${noncanonical}" --source-ref "refs/tags/v${noncanonical}" \
    --source-sha "${SHA}" --expected-sha "${SHA}" 2>"${work}/noncanonical.err"; then
    echo "FAIL: non-canonical semantic version ${noncanonical} was accepted" >&2; exit 1
  fi
  grep -q 'exact semantic version' "${work}/noncanonical.err" || {
    echo "FAIL: ${noncanonical} rejection was not attributable to the version format" >&2; exit 1
  }
done
printf 'PASS: reusable versus tag-bound direct release entry contract\n'
