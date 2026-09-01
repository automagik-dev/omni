#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-npm-stable-state.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"

out=$("${SCRIPT}" --expected 2.260830.2 --published 2.260830.2 --latest 2.260830.2)
grep -q '^npm_action=none$' <<<"${out}" || fail "exact latest state was not idempotent"
out=$("${SCRIPT}" --expected 2.260830.2 --published '' --latest 2.260830.1)
grep -q '^npm_action=publish$' <<<"${out}" || fail "missing package did not require publication"
out=$("${SCRIPT}" --expected 2.260830.2 --published 2.260830.2 --latest 2.260830.1)
grep -q '^npm_action=repair_latest$' <<<"${out}" || fail "existing package under a non-latest dist-tag did not request repair"
if "${SCRIPT}" --expected 2.260830.2 --published 2.260830.1 --latest 2.260830.1; then
  fail "registry returned the wrong requested package version"
fi
printf 'PASS: stable npm version and latest dist-tag contract\n'
