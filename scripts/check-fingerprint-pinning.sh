#!/usr/bin/env bash
# Assert that the pinned cosign keyless signing identity is byte-identical
# across every channel in which @automagik/omni publishes it.
#
# @automagik/omni release signing is cosign KEYLESS ONLY. There is no
# long-lived public key to pin — the "pin" is the three-value tuple below
# (certificate-identity-regexp + OIDC issuer + provenance source-uri). The
# rotation procedure requires two project maintainers to land any
# change; this script is the CI merge-gate that blocks a single-channel
# edit from slipping through.
#
# Witnesses (all four MUST contain each canonical line as a substring):
#   1. SECURITY.md                                            in-repo canonical
#   2. .well-known/security.txt                               RFC 9116 mirror
#   3. .github/ISSUE_TEMPLATE/signing-key-fingerprint.md      out-of-band tmpl
#   4. .github/cosign.pub                                     NO-KEY sentinel
#
# The script greps each witness for three verbatim lines. Prefix characters
# (`- `, `# `, ``` ` ```) are tolerated because grep uses substring matching;
# the value strings themselves must match byte-for-byte. If any witness is
# missing a line or carries a divergent value, the script exits 1 with a
# diagnostic that names the witness, the expected line, and the nearest
# candidate match so operators can locate drift quickly.
#
# Exit codes:
#   0 — all four witnesses agree
#   1 — drift detected (one or more witnesses missing or divergent)
#   2 — misuse / missing witness file / run outside a git repo
#
# Manual: scripts/check-fingerprint-pinning.sh
# CI:     .github/workflows/signing-identity-pin.yml

set -euo pipefail

# --- Resolve repo root -------------------------------------------------------
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
else
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "${REPO_ROOT}"

# --- Canonical identity lines (byte-exact) -----------------------------------
#
# These three lines are the source of truth. They are duplicated verbatim in
# this script on purpose: if the script itself drifts, CI catches it against
# the witnesses below. To rotate the pin, follow the rotation procedure and
# update this constant list in the same two-maintainer PR that updates the
# witnesses.
CANONICAL=(
  "certificate-identity-regexp: ^https://github.com/automagik-dev/omni/.github/workflows/sign-attest.yml@refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$"
  "certificate-oidc-issuer:     https://token.actions.githubusercontent.com"
  "provenance source-uri:       github.com/automagik-dev/omni"
)

WITNESSES=(
  "SECURITY.md"
  ".well-known/security.txt"
  ".github/ISSUE_TEMPLATE/signing-key-fingerprint.md"
  ".github/cosign.pub"
)

# --- Helpers -----------------------------------------------------------------

RED=''
GREEN=''
YELLOW=''
BOLD=''
RESET=''
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
fi

log()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "${GREEN}" "${RESET}" "$*"; }
warn() { printf '%s!%s %s\n' "${YELLOW}" "${RESET}" "$*" >&2; }
err()  { printf '%s✗%s %s\n' "${RED}"   "${RESET}" "$*" >&2; }

# Return the first line in $2 that contains the needle $1 as a substring,
# or the empty string if no line matches.
nearest_match() {
  local needle="$1"
  local file="$2"
  local anchor
  anchor="${needle%%:*}:"
  grep -F -- "${anchor}" "${file}" 2>/dev/null | head -n 1 || true
}

# --- Preflight: every witness file must exist --------------------------------

missing_files=0
for witness in "${WITNESSES[@]}"; do
  if [ ! -f "${witness}" ]; then
    err "witness file missing: ${witness}"
    missing_files=1
  fi
done
if [ "${missing_files}" -ne 0 ]; then
  err "aborting — cannot assert pin against a missing witness"
  exit 2
fi

# --- Per-witness substring match --------------------------------------------

drift=0

log "${BOLD}check-fingerprint-pinning${RESET} — asserting signing-identity pin across ${#WITNESSES[@]} witnesses"
log ""

for witness in "${WITNESSES[@]}"; do
  log "${BOLD}${witness}${RESET}"
  for line in "${CANONICAL[@]}"; do
    if grep -qF -- "${line}" "${witness}"; then
      ok "contains: ${line}"
    else
      err "missing:  ${line}"
      nearest="$(nearest_match "${line}" "${witness}")"
      if [ -n "${nearest}" ]; then
        warn "nearest candidate in ${witness}: ${nearest}"
      else
        warn "no candidate line in ${witness} matched the key prefix — witness may not carry this pin at all"
      fi
      drift=1
    fi
  done
  log ""
done

# --- Result ------------------------------------------------------------------

if [ "${drift}" -ne 0 ]; then
  err "signing-identity pin has drifted across ${#WITNESSES[@]} witnesses"
  err "escalation contact: https://github.com/automagik-dev/omni/security/advisories/new"
  exit 1
fi

ok "signing-identity pin is byte-identical across all ${#WITNESSES[@]} witnesses"
exit 0
