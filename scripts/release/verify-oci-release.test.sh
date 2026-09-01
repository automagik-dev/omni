#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-oci-release.sh"
VERSION="2.260830.2"
DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OTHER_DIGEST="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
repo="${work}/repo"
mkdir -p "${repo}/packages/cli" "${repo}/deploy/helm/omni" "${work}/bin"
printf '{"version":"%s"}\n' "${VERSION}" >"${repo}/packages/cli/package.json"
printf 'apiVersion: v2\nname: omni\nversion: 0.1.0\nappVersion: "%s"\n' "${VERSION}" >"${repo}/deploy/helm/omni/Chart.yaml"
(
  cd "${repo}"
  git init -q
  git config user.name test
  git config user.email test@example.com
  git add .
  git commit -qm "fixture"
  git tag "v${VERSION}"
)
SHA="$(git -C "${repo}" rev-parse HEAD)"
[[ ! -e "${repo}/scripts/release/verify-oci-release.sh" ]] || \
  fail "historical-source fixture unexpectedly contains hardened control helpers"

cat >"${work}/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${MOCK_REGISTRY_MODE:-absent}" in
  absent)
    printf 'manifest unknown: not found\n' >&2
    exit 1
    ;;
  existing)
    printf 'Name: ghcr.io/automagik-dev/omni-api:v2.260830.2\nMediaType: application/vnd.oci.image.index.v1+json\nDigest: %s\n' "${MOCK_REGISTRY_DIGEST}"
    ;;
  *)
    exit 2
    ;;
esac
SH
chmod +x "${work}/bin/docker"

run_verify() {
  (
    # The script writes step outputs when GitHub Actions exports GITHUB_OUTPUT.
    # This fixture intentionally captures stdout, so isolate that contract from
    # the runner-provided environment.
    unset GITHUB_OUTPUT
    cd "${repo}"
    PATH="${work}/bin:${PATH}" "${SCRIPT}" \
      --ref "refs/tags/v${VERSION}" \
      --expected-version "${VERSION}" \
      --expected-sha "${SHA}" \
      --image ghcr.io/automagik-dev/omni-api \
      "$@"
  )
}

MOCK_REGISTRY_MODE=absent run_verify >"${work}/absent.out"
python3 - "${work}/absent.out" <<'PY' || fail "missing image did not request publication"
import sys
text = open(sys.argv[1], encoding="utf-8").read()
raise SystemExit(0 if "publish_required=true" in text and "source_sha=" in text else 1)
PY

MOCK_REGISTRY_MODE=existing MOCK_REGISTRY_DIGEST="${DIGEST}" \
  run_verify --expected-existing-digest "${DIGEST}" >"${work}/same.out"
python3 - "${work}/same.out" <<'PY' || fail "matching existing digest was not idempotent"
import sys
text = open(sys.argv[1], encoding="utf-8").read()
raise SystemExit(0 if "publish_required=false" in text else 1)
PY

if MOCK_REGISTRY_MODE=existing MOCK_REGISTRY_DIGEST="${OTHER_DIGEST}" \
  run_verify --expected-existing-digest "${DIGEST}" >"${work}/mismatch.out" 2>"${work}/mismatch.err"; then
  fail "mismatched existing digest was accepted"
fi

if MOCK_REGISTRY_MODE=existing MOCK_REGISTRY_DIGEST="${DIGEST}" \
  run_verify >"${work}/unapproved.out" 2>"${work}/unapproved.err"; then
  fail "existing digest without an explicit expectation was accepted"
fi

if (
  cd "${repo}"
  PATH="${work}/bin:${PATH}" MOCK_REGISTRY_MODE=absent "${SCRIPT}" \
    --ref "refs/tags/v9.9.9" \
    --expected-version "${VERSION}" \
    --expected-sha "${SHA}" \
    --image ghcr.io/automagik-dev/omni-api
) >"${work}/wrong-ref.out" 2>"${work}/wrong-ref.err"; then
  fail "wrong release ref was accepted"
fi

printf '{"version":"9.9.9"}\n' >"${repo}/packages/cli/package.json"
if MOCK_REGISTRY_MODE=absent run_verify >"${work}/wrong-version.out" 2>"${work}/wrong-version.err"; then
  fail "package version drift was accepted"
fi

printf 'PASS: immutable OCI release preflight contract\n'
