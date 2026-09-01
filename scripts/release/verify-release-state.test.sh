#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-release-state.py"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
accept() { "${SCRIPT}" "$@" >/dev/null || fail "valid release state rejected: $*"; }
reject() { if "${SCRIPT}" "$@" >/dev/null 2>&1; then fail "invalid release state accepted: $*"; fi; }
accept --phase existing --channel stable --draft false --prerelease false
accept --phase existing --channel homolog --draft false --prerelease true
accept --phase existing --channel dev --draft true --prerelease false --requested-draft true
reject --phase existing --channel dev --draft false --prerelease false
reject --phase existing --channel stable --draft false --prerelease true
reject --phase existing --channel stable --draft false --prerelease false --requested-draft true
accept --phase final --channel stable --draft false --prerelease false
accept --phase final --channel homolog --draft false --prerelease true
accept --phase final --channel dev --draft true --prerelease false --requested-draft true
reject --phase final --channel dev --draft false --prerelease false
reject --phase final --channel stable --draft false --prerelease true
printf 'PASS: immutable public release channel and final state contract\n'
