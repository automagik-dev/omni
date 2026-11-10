#!/usr/bin/env bash
# Exercise the real bump and Biome against short arrays in every JSON writer.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
REAL_BUN="$(command -v bun)"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
mkdir -p "${work}/repo/scripts/release" "${work}/repo/scripts/lib" "${work}/bin"
repo="${work}/repo"
cp "${ROOT}/scripts/release/prepare-dev-version.sh" "${repo}/scripts/release/"
cp "${ROOT}/scripts/"{generate-version,sync-versions}.ts "${repo}/scripts/"
cp "${ROOT}/scripts/lib/"{version-fields,plugin-versions,bounded-exec}.ts "${repo}/scripts/lib/"
cp "${ROOT}/biome.json" "${repo}/"
ln -s "${ROOT}/node_modules" "${repo}/node_modules"
# No dependency resolution is needed by the fixture; all bump writers and Biome are real.
cat > "${work}/bin/bun" <<'BUN'
#!/usr/bin/env bash
if [[ "${1:-}" == install ]]; then exit 0; fi
exec "${REAL_BUN}" "$@"
BUN
chmod +x "${work}/bin/bun"
export REAL_BUN
cd "${repo}"
git init -q
git config user.name test
git config user.email test@example.com
printf 'node_modules\nversion.json\n' > .gitignore
paths=(package.json packages/cli/package.json apps/ui/package.json plugins/omni/.claude-plugin/plugin.json)
for path in "${paths[@]}"; do
  mkdir -p "$(dirname "${path}")"
  cat > "${path}" <<'JSON'
{
  "name": "fixture",
  "version": "2.000101.1",
  "keywords": ["omni", "cli", "messaging", "agents", "automation"]
}
JSON
done
mkdir -p .claude-plugin deploy/helm/omni
cat > .claude-plugin/marketplace.json <<'JSON'
{
  "plugins": [
    {
      "name": "omni",
      "version": "2.000101.1",
      "keywords": ["omni", "cli"]
    }
  ]
}
JSON
printf 'appVersion: "2.000101.1"\n' > deploy/helm/omni/Chart.yaml
"${ROOT}/node_modules/.bin/biome" check . .claude-plugin/marketplace.json plugins/omni/.claude-plugin/plugin.json >/dev/null
git add .
git commit -qm seed
parent="$(git rev-parse HEAD)"
version="$(PATH="${work}/bin:${PATH}" scripts/release/prepare-dev-version.sh | tail -n 1)"
"${ROOT}/node_modules/.bin/biome" check . .claude-plugin/marketplace.json plugins/omni/.claude-plugin/plugin.json
git commit -qam bump
"${ROOT}/scripts/release/verify-version-only-diff.py" --parent "${parent}" --source HEAD --expected-version "${version}"
# A repeated sync must leave the committed files unchanged.
bun scripts/sync-versions.ts "${version}"
git diff --exit-code

# npm locks and pending engines.omni ranges are also rewritten by the bump.
mkdir -p apps/fixture-dsh
cat > apps/fixture-dsh/package.json <<'JSON'
{
  "name": "fixture-dsh",
  "version": "2.000101.1",
  "engines": { "omni": ">=2.991231.1" },
  "keywords": ["omni", "cli"]
}
JSON
cat > apps/fixture-dsh/package-lock.json <<'JSON'
{
  "version": "2.000101.1",
  "packages": { "": { "version": "2.000101.1" } },
  "keywords": ["omni", "cli"]
}
JSON
# A local tag keeps this test independent of remote tag fetching.
git tag v2.000101.1 "${parent}"
bun scripts/sync-versions.ts 2.991231.2
"${ROOT}/node_modules/.bin/biome" check .
python3 - <<'PY'
import json
from pathlib import Path
root = Path('apps/fixture-dsh')
pkg = json.loads((root / 'package.json').read_text())
lock = json.loads((root / 'package-lock.json').read_text())
assert pkg['version'] == lock['version'] == lock['packages']['']['version'] == '2.991231.2'
assert pkg['engines']['omni'] == '>=2.991231.2'
assert '"keywords": ["omni", "cli"]' in (root / 'package.json').read_text()
# Biome ignores npm lockfiles; their version fields must still stay in sync.
PY
printf 'PASS: version bump keeps every rewritten JSON file Biome-clean and the bump diff version-only\n'
