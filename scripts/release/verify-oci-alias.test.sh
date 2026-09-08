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
# The caller may pin the exact alias the verifier must inspect.
[[ -z "${MOCK_EXPECT_REF:-}" || "$*" == *" ${MOCK_EXPECT_REF} "* ]]
printf '%s\n' "${MOCK_DIGEST}"
SH
chmod +x "${work}/docker"
expected=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
other=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
image=ghcr.io/example/omni-api

PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" MOCK_EXPECT_REF="${image}:v1.2.3" \
  "${SCRIPT}" --image "${image}" --version 1.2.3 --expected-digest "${expected}"
if PATH="${work}:${PATH}" MOCK_DIGEST="${other}" \
  "${SCRIPT}" --image "${image}" --version 1.2.3 --expected-digest "${expected}"; then
  echo 'FAIL: mismatched OCI alias was accepted' >&2; exit 1
fi
if PATH="${work}:${PATH}" MOCK_DIGEST=garbage \
  "${SCRIPT}" --image "${image}" --version 1.2.3 --expected-digest "${expected}"; then
  echo 'FAIL: malformed OCI alias digest was accepted' >&2; exit 1
fi

# Dev channel aliases are named verbatim through --tag and inspected as such.
PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" MOCK_EXPECT_REF="${image}:dev-0123456789ab" \
  "${SCRIPT}" --image "${image}" --tag dev-0123456789ab --expected-digest "${expected}"
PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" MOCK_EXPECT_REF="${image}:dev" \
  "${SCRIPT}" --image "${image}" --tag dev --expected-digest "${expected}"
if PATH="${work}:${PATH}" MOCK_DIGEST="${other}" \
  "${SCRIPT}" --image "${image}" --tag dev-0123456789ab --expected-digest "${expected}"; then
  echo 'FAIL: mismatched dev OCI alias was accepted' >&2; exit 1
fi
if PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" \
  "${SCRIPT}" --image "${image}" --tag v1.2.3 --expected-digest "${expected}"; then
  echo 'FAIL: a candidate alias was accepted through --tag' >&2; exit 1
fi
if PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" \
  "${SCRIPT}" --image "${image}" --tag 'dev/../latest' --expected-digest "${expected}"; then
  echo 'FAIL: malformed tag was accepted' >&2; exit 1
fi
if PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" \
  "${SCRIPT}" --image "${image}" --version 1.2.3 --tag dev --expected-digest "${expected}"; then
  echo 'FAIL: --version and --tag were accepted together' >&2; exit 1
fi
if PATH="${work}:${PATH}" MOCK_DIGEST="${expected}" \
  "${SCRIPT}" --image "${image}" --expected-digest "${expected}"; then
  echo 'FAIL: an alias-less invocation was accepted' >&2; exit 1
fi
printf 'PASS: OCI version and dev alias read-back contract\n'
