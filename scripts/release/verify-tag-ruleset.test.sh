#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-tag-ruleset.py"
work=$(mktemp -d)
trap 'rm -rf "${work}"' EXIT
cat >"${work}/valid.json" <<'JSON'
{"target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":["refs/tags/dev*"]}},"bypass_actors":[],"rules":[{"type":"update"},{"type":"deletion"}]}
JSON
"${SCRIPT}" --ruleset-json "${work}/valid.json" --tag refs/tags/v2.260830.2
python3 - "${work}/valid.json" "${work}/excluded.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); x["conditions"]["ref_name"]["exclude"]=["refs/tags/v*"]; json.dump(x,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --ruleset-json "${work}/excluded.json" --tag refs/tags/v2.260830.2; then
  echo 'FAIL: excluded tag was accepted' >&2; exit 1
fi
python3 - "${work}/valid.json" "${work}/bypass.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); x["bypass_actors"]=[{"actor_id":1,"actor_type":"Integration","bypass_mode":"always"}]; json.dump(x,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --ruleset-json "${work}/bypass.json" --tag refs/tags/v2.260830.2; then
  echo 'FAIL: bypass actor was accepted' >&2; exit 1
fi
python3 - "${work}/valid.json" "${work}/missing.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); x["rules"]=[{"type":"update"}]; json.dump(x,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --ruleset-json "${work}/missing.json" --tag refs/tags/v2.260830.2; then
  echo 'FAIL: ruleset missing deletion protection was accepted' >&2; exit 1
fi
printf 'PASS: effective immutable tag ruleset contract\n'
