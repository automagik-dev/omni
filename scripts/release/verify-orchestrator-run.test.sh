#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-orchestrator-run.py"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
cat >"${work}/valid.json" <<JSON
{"repository":{"full_name":"automagik-dev/omni"},"path":".github/workflows/image-build.yml","head_sha":"${SHA}","status":"in_progress","event":"workflow_dispatch"}
JSON
"${SCRIPT}" --run-json "${work}/valid.json" --repository automagik-dev/omni --source-sha "${SHA}"

python3 - "${work}/valid.json" "${work}/wrong-workflow.json" <<'PY'
import json, sys
data=json.load(open(sys.argv[1])); data["path"]=".github/workflows/evil.yml"; json.dump(data,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --run-json "${work}/wrong-workflow.json" --repository automagik-dev/omni --source-sha "${SHA}"; then
  fail "generic bot workflow substitution was accepted"
fi

python3 - "${work}/valid.json" "${work}/retired-orchestrator.json" <<'PY'
import json, sys
data=json.load(open(sys.argv[1])); data["path"]=".github/workflows/image-publish.yml"; json.dump(data,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --run-json "${work}/retired-orchestrator.json" --repository automagik-dev/omni --source-sha "${SHA}"; then
  fail "the retired read-only promotion workflow was accepted as the default orchestrator"
fi

python3 - "${work}/valid.json" "${work}/push-event.json" <<'PY'
import json, sys
data=json.load(open(sys.argv[1])); data["event"]="push"; json.dump(data,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --run-json "${work}/push-event.json" --repository automagik-dev/omni --source-sha "${SHA}" \
  --expected-workflow .github/workflows/image-build.yml --allowed-event workflow_dispatch; then
  fail "a push-triggered run was accepted as the dispatch-only candidate orchestrator"
fi
"${SCRIPT}" --run-json "${work}/valid.json" --repository automagik-dev/omni --source-sha "${SHA}" \
  --expected-workflow .github/workflows/image-build.yml --allowed-event workflow_dispatch

python3 - "${work}/valid.json" "${work}/completed.json" <<'PY'
import json, sys
data=json.load(open(sys.argv[1])); data["status"]="completed"; json.dump(data,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --run-json "${work}/completed.json" --repository automagik-dev/omni --source-sha "${SHA}"; then
  fail "replay of a completed orchestrator run was accepted"
fi

cat >"${work}/completed-build.json" <<JSON
{"repository":{"full_name":"automagik-dev/omni"},"path":".github/workflows/build-tarballs.yml","head_sha":"${SHA}","status":"completed","conclusion":"success","event":"workflow_dispatch"}
JSON
"${SCRIPT}" --run-json "${work}/completed-build.json" --repository automagik-dev/omni --source-sha "${SHA}" \
  --expected-workflow .github/workflows/build-tarballs.yml --required-status completed
python3 - "${work}/completed-build.json" "${work}/failed-build.json" <<'PY'
import json, sys
data=json.load(open(sys.argv[1])); data["conclusion"]="failure"; json.dump(data,open(sys.argv[2],"w"))
PY
if "${SCRIPT}" --run-json "${work}/failed-build.json" --repository automagik-dev/omni --source-sha "${SHA}" \
  --expected-workflow .github/workflows/build-tarballs.yml --required-status completed; then
  fail "failed recovery source run was accepted"
fi

printf 'PASS: exact in-progress image orchestrator run contract\n'
