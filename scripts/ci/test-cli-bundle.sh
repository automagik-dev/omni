#!/usr/bin/env bash
set -euo pipefail

# Rows for the CLI bundle (packages/cli/dist after `bun run build`): @anthropic-ai/claude-agent-sdk
# is not inlined into it, it stays a run-time import, and the CLI runs without it installed.
#
# The SDK is matched on markers of its own code, not on its package name (the bundle carries the
# CLI's package.json, which names it):
#   - CLAUDE_AGENT_SDK_VERSION, the variable the SDK sets when it loads. Omni's code never names
#     it, and a property name survives minification.
#   - node_modules/@anthropic-ai/claude-agent-sdk/, the path bun writes above each module it
#     inlines (unminified builds).
#   - "Anthropic PBC", from the notice at the top of the SDK's sdk.mjs, in case a build keeps it.
#
# The no-SDK rows copy dist/, bin/ and package.json into a fresh temp dir with no node_modules
# above it and a scratch HOME, and run only --version and --help. Every bun there runs with
# --no-install: with no node_modules in sight, bun would otherwise fetch a missing package itself.

DIST="${1:?usage: test-cli-bundle.sh <packages/cli/dist>}"
CLI="$(cd "$DIST/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
ok() { printf 'ok %s\n' "$1"; }
bad() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

hits="$(grep -rlE 'CLAUDE_AGENT_SDK_VERSION|node_modules/@anthropic-ai/claude-agent-sdk/|Anthropic PBC' "$DIST" || true)"
if [[ -z "$hits" ]]; then
  ok 'no file in dist/ inlines the Claude agent SDK'
else
  bad "the Claude agent SDK is inlined in: ${hits//$'\n'/ }"
fi

if grep -qE 'import\("@anthropic-ai/claude-agent-sdk"\)' "$DIST/index.js"; then
  ok 'dist/index.js imports the SDK at run time'
else
  bad 'dist/index.js has no run-time import("@anthropic-ai/claude-agent-sdk")'
fi

mkdir -p "$WORK/omni" "$WORK/home"
cp -R "$DIST" "$WORK/omni/dist"
cp -R "$CLI/bin" "$WORK/omni/bin"
cp "$CLI/package.json" "$WORK/omni/package.json"
VERSION="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).version)' "$CLI/package.json")"

# run_cli <args...>: the copied CLI under the scratch HOME; sets CODE and OUT.
run_cli() {
  set +e
  OUT="$(cd "$WORK" && env -i PATH="$(dirname "$(command -v bun)"):/usr/bin:/bin" HOME="$WORK/home" \
    bun --no-install "$WORK/omni/bin/omni" "$@" 2>&1)"
  CODE=$?
  set -e
}

if [[ -e "$WORK/omni/node_modules" ]] || (cd "$WORK" && bun --no-install -e "import.meta.resolve('@anthropic-ai/claude-agent-sdk')" >/dev/null 2>&1); then
  bad 'the scratch copy can still resolve the SDK; the rows below would prove nothing'
fi

run_cli --version
if [[ "$CODE" -eq 0 && "$OUT" == *"$VERSION"* ]]; then
  ok "--version runs without the SDK installed ($VERSION)"
else
  bad "--version without the SDK: exit ${CODE} (output: ${OUT//$'\n'/ | })"
fi

run_cli --help
if [[ "$CODE" -eq 0 && "$OUT" == *'Usage'* ]]; then
  ok '--help runs without the SDK installed'
else
  bad "--help without the SDK: exit ${CODE} (output: ${OUT//$'\n'/ | })"
fi

[[ "$failures" -eq 0 ]] || exit 1
