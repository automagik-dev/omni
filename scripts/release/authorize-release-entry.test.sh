#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/authorize-release-entry.py"
if "${SCRIPT}" --channel stable --orchestrated false --recovery-run-id 123; then
  echo 'FAIL: direct stable dispatch was accepted' >&2; exit 1
fi
[[ "$("${SCRIPT}" --channel stable --orchestrated true)" == 'mode=orchestrated' ]]
if "${SCRIPT}" --channel stable --orchestrated true --recovery-run-id 123; then
  echo 'FAIL: orchestrated run accepted a foreign recovery run id' >&2; exit 1
fi
[[ "$("${SCRIPT}" --channel dev --orchestrated true)" == 'mode=orchestrated' ]]
[[ "$("${SCRIPT}" --channel dev --orchestrated false --recovery-run-id 123)" == 'mode=recovery' ]]
if "${SCRIPT}" --channel homolog --orchestrated false --recovery-run-id 123; then
  echo 'FAIL: retired homolog channel was accepted' >&2; exit 1
fi
if "${SCRIPT}" --channel dev --orchestrated false --recovery-run-id '1; touch /tmp/injected'; then
  echo 'FAIL: invalid recovery run id was accepted' >&2; exit 1
fi
printf 'PASS: reusable versus direct release entry contract\n'
