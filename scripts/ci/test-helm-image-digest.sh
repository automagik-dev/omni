#!/usr/bin/env bash
set -euo pipefail

# Helm image contract for the public chart.
#
# Static section (python3 only, no helm): the chart's default image.tag must be
# pinned to the verified public candidate in .well-known/latest.json and must
# NOT be derived from Chart.appVersion — appVersion is stamped on every dev bump
# (version.yml → scripts/sync-versions.ts) while no workflow in this public
# repository builds images, so v<appVersion> is not guaranteed to exist.
#
# Rendering section (needs helm — CI passes HELM_BIN): default render uses the
# pinned tag, image.digest wins and is validated, prod overlays render with a
# digest, and the prod overlay without a digest still resolves to the pin.
# Run with HELM_STATIC_ONLY=1 to stop after the static section on a machine
# without helm; the default is fail-closed when helm is missing.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${ROOT}/deploy/helm/omni"
HELM_BIN="${HELM_BIN:-helm}"
VALID_DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

# ---- static contract (no helm) ----------------------------------------------
PUBLIC_VERSION="$(python3 - "${ROOT}/.well-known/latest.json" <<'PY'
import json, re, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
version = str(doc.get("version", ""))
if doc.get("channel") != "stable" or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) is None:
    raise SystemExit(".well-known/latest.json is not a stable semantic-version manifest")
print(version)
PY
)" || fail "could not read the verified public candidate version from .well-known/latest.json"
EXPECTED_TAG="v${PUBLIC_VERSION}"
EXPECTED_TAG_RE="${EXPECTED_TAG//./\\.}"

APP_VERSION="$(python3 - "${CHART}/Chart.yaml" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'^appVersion:\s*"([^"\n]+)"\s*$', text, flags=re.MULTILINE)
if match is None:
    raise SystemExit("Chart.appVersion is missing")
print(match.group(1))
PY
)" || fail "could not read Chart.appVersion"
APP_VERSION_RE="${APP_VERSION//./\\.}"

# Top-level image.tag of a values file: prints the scalar, "<absent>" when the
# key is not set. Only the top-level `image:` block is inspected (adminUi.image
# and autopg.image are nested deeper and ignored).
image_tag_of() {
  python3 - "$1" <<'PY'
import sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
in_image = False
for line in lines:
    if line == "image:":
        in_image = True
        continue
    if not in_image:
        continue
    if line.strip() and not line.startswith(" "):
        break
    if line.startswith("  tag:"):
        value = line[len("  tag:"):].split("#", 1)[0].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        print(value)
        raise SystemExit(0)
print("<absent>")
PY
}

DEFAULT_TAG="$(image_tag_of "${CHART}/values.yaml")" || fail "could not parse values.yaml image.tag"
[[ "${DEFAULT_TAG}" != "<absent>" && -n "${DEFAULT_TAG}" ]] || \
  fail "values.yaml image.tag is unset, so the default image would track Chart.appVersion (${APP_VERSION}) instead of the verified public candidate"
[[ "${DEFAULT_TAG}" == "${EXPECTED_TAG}" ]] || \
  fail "values.yaml image.tag '${DEFAULT_TAG}' does not match the verified public candidate ${EXPECTED_TAG} from .well-known/latest.json"

# Realm overlays may hold a different published v-tag, but must never reset
# tag to "" — that silently re-couples the render to Chart.appVersion.
for overlay in values-prod.yaml values-homolog.yaml; do
  overlay_tag="$(image_tag_of "${CHART}/${overlay}")" || fail "could not parse ${overlay} image.tag"
  [[ "${overlay_tag}" == "<absent>" || -n "${overlay_tag}" ]] || \
    fail "${overlay} resets image.tag to \"\", which re-couples the image to Chart.appVersion"
done

[[ ! -e "${CHART}/values-prod-gitops.yaml" ]] || \
  fail "public chart still carries a canonical production digest pin"

printf 'PASS: static Helm default-tag contract (image.tag %s = .well-known/latest.json; Chart.appVersion %s is decoupled)\n' \
  "${EXPECTED_TAG}" "${APP_VERSION}"

# ---- rendering contract (needs helm) ----------------------------------------
if ! command -v "${HELM_BIN}" >/dev/null 2>&1; then
  if [[ "${HELM_STATIC_ONLY:-0}" == "1" ]]; then
    printf 'NOTE: helm not found (%s); rendering assertions skipped by HELM_STATIC_ONLY=1\n' "${HELM_BIN}"
    exit 0
  fi
  fail "helm binary '${HELM_BIN}' not found; the rendering assertions need helm (set HELM_BIN, or HELM_STATIC_ONLY=1 to run only the static contract)"
fi

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

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# Default render: the pinned public candidate, never v<Chart.appVersion>.
render >"${work}/default.yaml"
assert_count 1 "image: \"ghcr\\.io/automagik-dev/omni-api:${EXPECTED_TAG_RE}\"" "${work}/default.yaml"
if [[ "${APP_VERSION}" != "${PUBLIC_VERSION}" ]]; then
  assert_count 0 "image: \"ghcr\\.io/automagik-dev/omni-api:v${APP_VERSION_RE}\"" "${work}/default.yaml"
fi

# tag "" is the documented fallback to v<Chart.appVersion> — keep it explicit
# so a future change to the helper cannot silently alter the fallback.
render --set-string "image.tag=" >"${work}/fallback.yaml"
assert_count 1 "image: \"ghcr\\.io/automagik-dev/omni-api:v${APP_VERSION_RE}\"" "${work}/fallback.yaml"

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

# Prod overlay WITHOUT a digest must still resolve to the pinned public
# candidate — proves the overlay no longer resets tag "" back to appVersion.
render \
  -f "${CHART}/values-prod.yaml" \
  -f "${CHART}/values-prod-alb.yaml" \
  --set-string ingress.host=omni.khal.ai \
  --set-string 'ingress.annotations.alb\.ingress\.kubernetes\.io/certificate-arn=arn:aws:acm:sa-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000' \
  --set-string 'serviceAccount.annotations.eks\.amazonaws\.com/role-arn=arn:aws:iam::000000000000:role/omni-media' \
  >"${work}/prod-tag.yaml"
assert_count 1 "image: \"ghcr\\.io/automagik-dev/omni-api:${EXPECTED_TAG_RE}\"" "${work}/prod-tag.yaml"

printf 'PASS: generic Helm digest rendering contract\n'
