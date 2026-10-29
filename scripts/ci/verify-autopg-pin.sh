#!/usr/bin/env bash
set -euo pipefail

# autopg release pin (packages/cli/src/autopg-pin.json): every pinned tarball is the one
# autopg's release workflow signed. The sandbox checks only the sha256 at install, so this is
# where the signature is checked, on every change to the pin.
#
# For each pinned platform: fetch the tarball, its .sig and its .cert from the GitHub release
# (or take them from AUTOPG_ASSETS_DIR, a flat dir of release assets), check the pinned size and
# sha256, and run cosign verify-blob against autopg's exact signing identity for the pinned tag.
#
# Two negative controls run on every platform and must fail: the same signature under a wrong
# identity, and the tarball with one byte flipped. A control that passes fails the check, since
# a verifier that accepts those would accept anything.
#
# AUTOPG_PIN overrides the pin file (a red run against a tampered copy); COSIGN_BIN the cosign.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIN="${AUTOPG_PIN:-${ROOT}/packages/cli/src/autopg-pin.json}"
COSIGN="${COSIGN_BIN:-cosign}"
REPO='automagik-dev/autopg'
ISSUER='https://token.actions.githubusercontent.com'

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

command -v jq >/dev/null || fail 'jq is required'
command -v "$COSIGN" >/dev/null || fail "cosign is required (COSIGN_BIN=${COSIGN})"

VERSION="$(jq -er '.version' "$PIN")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "pin version '${VERSION}' is not a release version"
IDENTITY="https://github.com/${REPO}/.github/workflows/sign-attest.yml@refs/tags/v${VERSION}"
WRONG_IDENTITY="https://github.com/${REPO}/.github/workflows/sign-attest.yml@refs/tags/v0.0.0"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sha256_of() {
  shasum -a 256 "$1" | awk '{print $1}'
}

verify_blob() { # <blob> <sig> <cert> <identity>
  "$COSIGN" verify-blob \
    --certificate-identity "$4" \
    --certificate-oidc-issuer "$ISSUER" \
    --signature "$2" \
    --certificate "$3" \
    "$1" >/dev/null 2>&1
}

fetch() { # <asset name> <dest dir>
  if [[ -n "${AUTOPG_ASSETS_DIR:-}" ]]; then
    cp "${AUTOPG_ASSETS_DIR}/$1" "$2/$1"
  else
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 10 \
      -o "$2/$1" "https://github.com/${REPO}/releases/download/v${VERSION}/$1"
  fi
}

# Writes a copy of <file> with the byte at <offset> XOR 1 to <out>.
flip_byte() { # <file> <offset> <out>
  cp "$1" "$3"
  local byte
  byte="$(od -An -tu1 -j "$2" -N1 "$1" | tr -d ' ')"
  # shellcheck disable=SC2059 # the format is the escaped byte itself
  printf "$(printf '\\%03o' "$((byte ^ 1))")" | dd of="$3" bs=1 seek="$2" count=1 conv=notrunc 2>/dev/null
}

platforms="$(jq -er '.platforms | keys[]' "$PIN")"
[[ -n "$platforms" ]] || fail 'the pin has no platforms'

for platform in $platforms; do
  want="$(jq -er --arg p "$platform" '.platforms[$p].sha256' "$PIN")"
  want_size="$(jq -er --arg p "$platform" '.platforms[$p].size' "$PIN")"
  name="autopg-${VERSION}-${platform}.tar.gz"
  dir="${WORK}/${platform}"
  mkdir "$dir"
  for asset in "$name" "${name}.sig" "${name}.cert"; do fetch "$asset" "$dir"; done
  tarball="${dir}/${name}"

  got_size="$(wc -c <"$tarball" | tr -d ' ')"
  [[ "$got_size" == "$want_size" ]] || fail "${platform}: size ${got_size} is not the pinned ${want_size}"
  got="$(sha256_of "$tarball")"
  [[ "$got" == "$want" ]] || fail "${platform}: sha256 ${got} is not the pinned ${want}"
  verify_blob "$tarball" "${tarball}.sig" "${tarball}.cert" "$IDENTITY" ||
    fail "${platform}: cosign refused ${name} for ${IDENTITY} (issuer ${ISSUER})"

  if verify_blob "$tarball" "${tarball}.sig" "${tarball}.cert" "$WRONG_IDENTITY"; then
    fail "${platform}: negative control passed: cosign accepted ${WRONG_IDENTITY}"
  fi
  flip_byte "$tarball" 1000 "${dir}/flipped.tar.gz"
  [[ "$(sha256_of "${dir}/flipped.tar.gz")" != "$want" ]] ||
    fail "${platform}: negative control passed: a flipped byte kept the pinned sha256"
  if verify_blob "${dir}/flipped.tar.gz" "${tarball}.sig" "${tarball}.cert" "$IDENTITY"; then
    fail "${platform}: negative control passed: cosign accepted a tarball with a flipped byte"
  fi

  printf 'ok %s %s (signed by %s)\n' "$platform" "$want" "$IDENTITY"
done
