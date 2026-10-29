#!/usr/bin/env bash
set -euo pipefail

# nats-server pin (packages/cli/src/nats-pin.json) against nats' own release. The pin must cover
# the four platforms the installers serve. Each pinned sha256 must equal the release's SHA256SUMS
# line and GitHub's asset digest, and each pinned size must equal the asset's size.
#
# nats publishes no signature, so this guards edits to the pin rather than the download channel.
# A negative control runs every time: a scratch copy of the pin with one digest flipped must fail
# the same check, or the check would accept anything.
#
# NATS_SUMS_FILE and NATS_RELEASE_JSON read SHA256SUMS and the release's asset list (the GitHub
# API's release object) from files instead of the network; NATS_PIN overrides the pin.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIN="${NATS_PIN:-${ROOT}/packages/cli/src/nats-pin.json}"
REPO='nats-io/nats-server'
PLATFORMS=(darwin-amd64 darwin-arm64 linux-amd64 linux-arm64)

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

command -v jq >/dev/null || fail 'jq is required'

VERSION="$(jq -er '.version' "$PIN")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "pin version '${VERSION}' is not a release version"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ -n "${NATS_SUMS_FILE:-}" ]]; then
  cp "$NATS_SUMS_FILE" "$WORK/SHA256SUMS"
else
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 10 \
    -o "$WORK/SHA256SUMS" "https://github.com/${REPO}/releases/download/v${VERSION}/SHA256SUMS"
fi
if [[ -n "${NATS_RELEASE_JSON:-}" ]]; then
  cp "$NATS_RELEASE_JSON" "$WORK/release.json"
else
  gh api "repos/${REPO}/releases/tags/v${VERSION}" >"$WORK/release.json"
fi

# check_pin <pin file>: prints the first difference and returns 1, or prints one line per platform.
check_pin() {
  local keys platform name sha size sums asset
  keys="$(jq -r '.platforms | keys | join(" ")' "$1")"
  [[ "$keys" == "${PLATFORMS[*]}" ]] || { echo "the pin covers '${keys}', not '${PLATFORMS[*]}'"; return 1; }
  for platform in "${PLATFORMS[@]}"; do
    name="nats-server-v${VERSION}-${platform}.tar.gz"
    sha="$(jq -r --arg p "$platform" '.platforms[$p].sha256' "$1")"
    size="$(jq -r --arg p "$platform" '.platforms[$p].size' "$1")"
    sums="$(awk -v n="$name" '$2 == n { print $1 }' "$WORK/SHA256SUMS")"
    [[ "$sums" == "$sha" ]] || { echo "${platform}: pinned sha256 ${sha}, SHA256SUMS says '${sums}'"; return 1; }
    asset="$(jq -r --arg n "$name" '.assets[] | select(.name == $n) | "\(.size) \(.digest)"' "$WORK/release.json")"
    [[ "$asset" == "${size} sha256:${sha}" ]] ||
      { echo "${platform}: pinned '${size} sha256:${sha}', the release asset is '${asset}'"; return 1; }
    echo "ok ${platform} ${size} ${sha}"
  done
}

reason="$(check_pin "$PIN")" || fail "nats ${VERSION}: ${reason##*$'\n'}"
printf '%s\n' "$reason"

# Negative control: one digest flipped in a scratch copy.
jq '.platforms["linux-amd64"].sha256 |= (.[0:63] + (if .[63:64] == "0" then "1" else "0" end))' "$PIN" \
  >"$WORK/flipped-pin.json"
if check_pin "$WORK/flipped-pin.json" >/dev/null; then
  fail 'negative control passed: a pin with a flipped digest matched the release'
fi
echo "ok negative control: a flipped linux-amd64 digest is refused"
