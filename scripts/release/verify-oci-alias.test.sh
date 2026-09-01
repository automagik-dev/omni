#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-oci-alias.sh"
work=$(mktemp -d)
trap 'rm -rf "${work}"' EXIT
cat >"${work}/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == *'imagetools inspect'* ]]
printf '%s\n' "${MOCK_DIGEST}"
SH
chmod +x "${work}/docker"
expected=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" "${SCRIPT}" --image ghcr.io/example/omni-api --version 1.2.3 --expected-digest "${expected}"
if PATH="${work}:${PATH}" MOCK_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  "${SCRIPT}" --image ghcr.io/example/omni-api --version 1.2.3 --expected-digest "${expected}"; then
  echo 'FAIL: mismatched OCI alias was accepted' >&2; exit 1
fi
if PATH="${work}:${PATH}" MOCK_DIGEST=garbage \
  "${SCRIPT}" --image ghcr.io/example/omni-api --version 1.2.3 --expected-digest "${expected}"; then
  echo 'FAIL: malformed OCI alias digest was accepted' >&2; exit 1
fi
printf 'PASS: OCI version alias read-back contract\n'
