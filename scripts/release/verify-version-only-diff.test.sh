#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-version-only-diff.py"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
repo="${work}/repo"
git init -q "${repo}"
git -C "${repo}" config user.name test
git -C "${repo}" config user.email test@example.com
paths=(
  package.json bun.lock apps/ui/package.json deploy/helm/omni/Chart.yaml
  .claude-plugin/marketplace.json plugins/omni/.claude-plugin/plugin.json
)
for name in api channel-a2a channel-discord channel-gupshup channel-hermes channel-internal channel-sdk channel-slack channel-telegram channel-twilio-whatsapp channel-whatsapp channel-whatsapp-business cli core db media-processing plugin-openclaw sdk voice-client; do
  paths+=("packages/${name}/package.json")
done
for path in "${paths[@]}"; do
  mkdir -p "${repo}/$(dirname "${path}")"
  printf '{"version":"2.260830.1"}\n' > "${repo}/${path}"
done
git -C "${repo}" add .
git -C "${repo}" commit -qm parent
parent="$(git -C "${repo}" rev-parse HEAD)"
python3 - "${repo}" "${paths[@]}" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
for name in sys.argv[2:]:
    path = root / name
    path.write_text(path.read_text().replace('2.260830.1', '2.260830.2'))
PY
git -C "${repo}" commit -qam clean-version-bump
clean="$(git -C "${repo}" rev-parse HEAD)"
(
  cd "${repo}"
  "${SCRIPT}" --parent "${parent}" --source "${clean}" --expected-version 2.260830.2
) | grep -qx 'version_only_diff_verified=true' || fail "exact version-only bump was rejected"

git -C "${repo}" checkout -q -b malicious "${parent}"
python3 - "${repo}" "${paths[@]}" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
for name in sys.argv[2:]:
    path = root / name
    path.write_text(path.read_text().replace('2.260830.1', '2.260830.2'))
cli = root / 'packages/cli/package.json'
data = json.loads(cli.read_text())
data['scripts'] = {'prepack': 'steal-secret'}
cli.write_text(json.dumps(data) + '\n')
PY
git -C "${repo}" add .
git -C "${repo}" commit -qm malicious-version-bump
malicious="$(git -C "${repo}" rev-parse HEAD)"
if (cd "${repo}" && "${SCRIPT}" --parent "${parent}" --source "${malicious}" --expected-version 2.260830.2 >/dev/null 2>&1); then
  fail "version-only validation accepted a package lifecycle-script injection"
fi
printf 'PASS: semantic version-only detached source contract\n'
