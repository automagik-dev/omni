#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/authorize-release-entry.py"
VERSION=2.260830.2
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
OTHER_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
if "${SCRIPT}" --channel stable --orchestrated false --recovery-run-id 123; then
  echo 'FAIL: direct stable dispatch was accepted' >&2; exit 1
fi
[[ "$("${SCRIPT}" --channel stable --orchestrated true)" == 'mode=orchestrated' ]]
if "${SCRIPT}" --channel stable --orchestrated true --recovery-run-id 123; then
  echo 'FAIL: orchestrated run accepted a foreign recovery run id' >&2; exit 1
fi
[[ "$("${SCRIPT}" --channel dev --orchestrated true)" == 'mode=orchestrated' ]]
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
if "${SCRIPT}" --channel homolog --orchestrated false --recovery-run-id 123; then
  echo 'FAIL: retired homolog channel was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated false --recovery-run-id '1; touch /tmp/injected' \
  --version "${VERSION}" --source-ref "refs/tags/v${VERSION}" \
  --source-sha "${SHA}" --expected-sha "${SHA}"; then
  echo 'FAIL: invalid recovery run id was accepted' >&2; exit 1
fi
printf 'PASS: reusable versus tag-bound direct release entry contract\n'
