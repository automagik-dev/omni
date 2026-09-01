#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${ROOT}/deploy/helm/omni"
HELM_BIN="${HELM_BIN:-helm}"
VALID_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
APP_VERSION="$(python3 - "${CHART}/Chart.yaml" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'^appVersion:\s*"([^"\n]+)"\s*$', text, flags=re.MULTILINE)
if match is None:
    raise SystemExit("Chart.appVersion is missing")
print(match.group(1))
PY
)"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

render() {
  "${HELM_BIN}" template omni "${CHART}" "$@"
}

assert_count() {
  local expected="$1" pattern="$2" file="$3" actual
  actual="$(python3 - "$pattern" "$file" <<'PY'
import re, sys
pattern, path = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    print(len(re.findall(pattern, handle.read(), flags=re.MULTILINE)))
PY
)"
  [[ "${actual}" == "${expected}" ]] || fail "expected ${expected} matches for ${pattern}, found ${actual}"
}

[[ ! -e "${CHART}/values-prod-gitops.yaml" ]] || \
  fail "public chart still carries a canonical production digest pin"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

render >"${work}/default.yaml"
assert_count 1 "image: \"ghcr\\.io/automagik-dev/omni-api:v${APP_VERSION}\"" "${work}/default.yaml"

render --set-string "image.digest=${VALID_DIGEST}" >"${work}/digest.yaml"
assert_count 1 "image: \"ghcr\\.io/automagik-dev/omni-api@${VALID_DIGEST}\"" "${work}/digest.yaml"
assert_count 0 'image: "ghcr\.io/automagik-dev/omni-api:' "${work}/digest.yaml"

for invalid in \
  'sha256:ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789' \
  'sha256:abc123' \
  'sha512:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'c4ede7c3a0f8768a1307e5534c00f163b12eb89ba8d882e75a5cafaae16cd414'; do
  if render --set-string "image.digest=${invalid}" >"${work}/invalid.yaml" 2>"${work}/invalid.err"; then
    fail "invalid digest rendered successfully: ${invalid}"
  fi
  python3 - "${work}/invalid.err" <<'PY' || fail "invalid digest did not report a useful error"
import sys
text = open(sys.argv[1], encoding="utf-8").read().lower()
raise SystemExit(0 if "sha256" in text and "digest" in text else 1)
PY
done

render \
  -f "${CHART}/values-prod.yaml" \
  -f "${CHART}/values-prod-alb.yaml" \
  --set-string "image.digest=${VALID_DIGEST}" \
  --set-string ingress.host=omni.khal.ai \
  --set-string 'ingress.annotations.alb\.ingress\.kubernetes\.io/certificate-arn=arn:aws:acm:sa-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000' \
  --set-string 'serviceAccount.annotations.eks\.amazonaws\.com/role-arn=arn:aws:iam::000000000000:role/omni-media' \
  >"${work}/prod.yaml"

assert_count 1 "image: \"ghcr\\.io/automagik-dev/omni-api@${VALID_DIGEST}\"" "${work}/prod.yaml"
assert_count 1 '^kind: HorizontalPodAutoscaler$' "${work}/prod.yaml"
assert_count 1 '^  minReplicas: 2$' "${work}/prod.yaml"
assert_count 1 '^  maxReplicas: 2$' "${work}/prod.yaml"
assert_count 1 '^kind: PodDisruptionBudget$' "${work}/prod.yaml"
assert_count 0 '^kind: (Deployment|StatefulSet)\nmetadata:\n  name: .*admin' "${work}/prod.yaml"
assert_count 0 '^kind: Deployment\nmetadata:\n  name: .*autopg' "${work}/prod.yaml"
assert_count 0 '^kind: StatefulSet\nmetadata:\n  name: .*minio' "${work}/prod.yaml"
assert_count 1 '^                  name: omni-db$' "${work}/prod.yaml"
assert_count 1 '^              mountPath: /etc/omni/db-tls$' "${work}/prod.yaml"
assert_count 1 '^    eks\.amazonaws\.com/role-arn: arn:aws:iam::000000000000:role/omni-media$' "${work}/prod.yaml"
assert_count 0 'OMNI_MEDIA_S3_ACCESS_KEY' "${work}/prod.yaml"
assert_count 1 '^kind: StatefulSet\nmetadata:\n  name: omni-nats$' "${work}/prod.yaml"
assert_count 1 '^  volumeClaimTemplates:$' "${work}/prod.yaml"
assert_count 1 '^        storageClassName: "gp3"$' "${work}/prod.yaml"
assert_count 1 '^            storage: "8Gi"$' "${work}/prod.yaml"

printf 'PASS: generic Helm digest rendering contract\n'
