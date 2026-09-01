#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: pin-production-image.sh --version VERSION --digest sha256:... \
  --source-sha FULL_SHA --expected-parent FULL_SHA [--file PATH]
EOF
  exit 2
}

fail() {
  printf 'production pin failed: %s\n' "$*" >&2
  exit 1
}

version=""
digest=""
source_sha=""
expected_parent=""
pin_file="deploy/helm/omni/values-prod-gitops.yaml"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) version="${2:-}"; shift 2 ;;
    --digest) digest="${2:-}"; shift 2 ;;
    --source-sha) source_sha="${2:-}"; shift 2 ;;
    --expected-parent) expected_parent="${2:-}"; shift 2 ;;
    --file) pin_file="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "${version}" && -n "${digest}" && -n "${source_sha}" && -n "${expected_parent}" ]] || usage
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version must be numeric dotted form"
[[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "digest must be lowercase sha256 with 64 hexadecimal characters"
[[ "${source_sha}" =~ ^[0-9a-f]{40}$ ]] || fail "source SHA must be 40 lowercase hexadecimal characters"
[[ "${expected_parent}" =~ ^[0-9a-f]{40}$ ]] || fail "expected parent must be 40 lowercase hexadecimal characters"
[[ -f "${pin_file}" ]] || fail "pin file does not exist: ${pin_file}"

actual_parent="$(git rev-parse HEAD^{commit})"
[[ "${actual_parent}" == "${expected_parent}" ]] || fail "HEAD ${actual_parent} moved from expected parent ${expected_parent}"
if ! git diff --quiet -- "${pin_file}" || ! git diff --cached --quiet -- "${pin_file}"; then
  fail "pin file has uncommitted changes"
fi

changed="$(PIN_FILE="${pin_file}" PIN_VERSION="${version}" PIN_DIGEST="${digest}" PIN_SOURCE_SHA="${source_sha}" python3 - <<'PY'
import os, re
from pathlib import Path

path = Path(os.environ["PIN_FILE"])
target_version = os.environ["PIN_VERSION"]
target_digest = os.environ["PIN_DIGEST"]
target_source = os.environ["PIN_SOURCE_SHA"]
text = path.read_text(encoding="utf-8")

patterns = {
    "digest": re.compile(r"^(\s*digest:\s*)(sha256:[0-9a-f]{64})(\s*)$", re.MULTILINE),
    "version": re.compile(r'^(\s*version:\s*)"([0-9]+\.[0-9]+\.[0-9]+)"(\s*)$', re.MULTILINE),
    "source": re.compile(r'^(\s*sourceRevision:\s*)"([0-9a-f]{40})"(\s*)$', re.MULTILINE),
}
for name, pattern in patterns.items():
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f"production pin failed: expected exactly one {name} field, found {len(matches)}")

current_digest = patterns["digest"].search(text).group(2)
current_version = patterns["version"].search(text).group(2)
current_source = patterns["source"].search(text).group(2)

def numeric(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))

if numeric(target_version) < numeric(current_version):
    raise SystemExit(f"production pin failed: refusing version downgrade {current_version} -> {target_version}")
if target_version == current_version:
    if current_digest != target_digest or current_source != target_source:
        raise SystemExit("production pin failed: version is already bound to a different digest or source revision")
    print("false")
    raise SystemExit(0)

text = patterns["digest"].sub(lambda m: f"{m.group(1)}{target_digest}{m.group(3)}", text)
text = patterns["version"].sub(lambda m: f'{m.group(1)}"{target_version}"{m.group(3)}', text)
text = patterns["source"].sub(lambda m: f'{m.group(1)}"{target_source}"{m.group(3)}', text)
path.write_text(text, encoding="utf-8")
print("true")
PY
)"

output="${GITHUB_OUTPUT:-/dev/stdout}"
{
  printf 'changed=%s\n' "${changed}"
  printf 'version=%s\n' "${version}"
  printf 'digest=%s\n' "${digest}"
  printf 'source_sha=%s\n' "${source_sha}"
  printf 'expected_parent=%s\n' "${expected_parent}"
  printf 'pin_file=%s\n' "${pin_file}"
} >>"${output}"
