#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "${ROOT}" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
workflows = {
    path.name: path.read_text(encoding="utf-8")
    for path in sorted((root / ".github/workflows").glob("*.yml"))
}
image = workflows["image-publish.yml"]
release = workflows["release.yml"]
release_publish = workflows["release-publish.yml"]
ci = workflows["ci.yml"]
all_workflows = "\n".join(workflows.values())
errors: list[str] = []


def require(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text, flags=re.MULTILINE | re.DOTALL) is None:
        errors.append(message)


def forbid(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text, flags=re.MULTILINE | re.DOTALL | re.IGNORECASE) is not None:
        errors.append(message)


require(image, r"branches:\s*\[main\]", "promotion verification is not bound to main")
require(image, r"timeout-minutes:\s*[0-9]+", "promotion verification has no finite job timeout")
for exact in (
    "2.260830.2",
    "b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031",
    "sha256:dba9b81cead5efacf9303ab75487a762fa100992dc2bb52741524a7a036b2da8",
):
    if exact not in image:
        errors.append(f"promotion workflow does not pin existing candidate identity {exact}")
require(image, r"verify-promotion-candidate\.sh", "final image build inputs are not compared to the candidate")
require(image, r"verify-oci-release\.sh", "existing immutable OCI alias is not checked")
require(image, r"gh attestation verify\s+\"oci://\$\{IMAGE\}@\$\{CANDIDATE_DIGEST\}\"", "exact OCI digest provenance is not verified")
require(image, r"--source-digest\s+\"\$\{CANDIDATE_SHA\}\"", "OCI provenance is not bound to b8c1bf20")
require(image, r"--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-publish\.yml\"", "OCI signer workflow identity is not constrained")
require(image, r"verify-release-assets\.py", "existing public release asset inventory is not verified read-only")
require(image, r"cosign verify-blob", "existing release bundle signatures are not verified")
require(image, r"slsa-verifier verify-artifact", "existing release SLSA provenance is not verified")

for pattern, message in (
    (r"docker/build-push-action", "promotion workflow can rebuild the candidate"),
    (r"(?:packages|contents|actions|attestations|id-token):\s*write", "promotion workflow grants mutation permissions"),
    (r"\bgh\s+workflow\s+run\b", "promotion workflow dispatches a mutating publisher"),
    (r"\bgh\s+release\s+(?:create|edit|upload|delete)\b", "promotion workflow can republish a release"),
    (r"\bnpm\s+(?:publish|dist-tag)\b", "promotion workflow can publish or move an npm alias"),
    (r"\bgit\s+push\b", "promotion workflow can move a Git ref"),
    (r"\bgh\s+api\b[^\n]*(?:--method|-X)\s+(?:POST|PATCH|PUT|DELETE)", "promotion workflow performs a mutating API call"),
    (r"imagetools\s+create", "promotion workflow can create or retag an OCI manifest"),
    (r"\b(?:kubectl|helm\s+(?:upgrade|install)|docker\s+service\s+update|aws\s+)", "promotion workflow can mutate production infrastructure"),
):
    forbid(image, pattern, message)

if re.search(r"\bhomolog\b", all_workflows, flags=re.IGNORECASE):
    errors.append("active workflows still encode a homolog branch or channel")

for workflow_name in ("image-publish.yml", "release-publish.yml"):
    workflow = workflows[workflow_name]
    forbid(workflow, r"\bgit\s+push\b[^\n]*\bmain\b|\bgit\s+push\s+origin\s+HEAD:main", f"{workflow_name} remains a direct-main writer")
    forbid(workflow, r"VERSION_BUMP_PAT", f"{workflow_name} still requests the direct-main writer credential")

forbid(release_publish, r"\.well-known/|MANIFEST_FILES|release-manifest", "release publication still owns public channel metadata")
forbid(all_workflows, r"values-prod-gitops\.yaml|pin-production-image\.sh", "a workflow still treats the public repo as production pin authority")
if (root / "deploy/helm/omni/values-prod-gitops.yaml").exists():
    errors.append("public canonical production pin still exists")
if (root / "scripts/release/pin-production-image.sh").exists():
    errors.append("obsolete production-pin writer helper still exists")

require(release, r"authorize:[\s\S]{0,200}timeout-minutes:\s*[0-9]+", "release authorization has no finite timeout")
require(release, r"bare tag pushes do not release", "release workflow still misstates bare-tag authorization")

latest = json.loads((root / ".well-known/latest.json").read_text(encoding="utf-8"))
dev = json.loads((root / ".well-known/dev.json").read_text(encoding="utf-8"))
for channel, document in (("stable", latest), ("dev", dev)):
    if document.get("channel") != channel:
        errors.append(f"{channel} public manifest has the wrong channel")
    if document.get("version") != "2.260830.2":
        errors.append(f"{channel} public manifest is not reconciled to v2.260830.2")
    if document.get("released_at") != "2026-08-30T21:45:27Z":
        errors.append(f"{channel} public manifest does not use the authoritative release timestamp")
    if not str(document.get("tarball_base", "")).endswith("/releases/download/v2.260830.2"):
        errors.append(f"{channel} public manifest has the wrong immutable tarball base")
if (root / ".well-known/homolog.json").exists():
    errors.append("retired homolog public channel metadata still exists")

for gate in (
    "release-workflow-contract.test.sh",
    "stable-release-order.test.sh",
    "verify-promotion-candidate.test.sh",
    "verify-oci-release.test.sh",
    "verify-release-source.test.sh",
    "verify-release-assets.test.sh",
    "verify-orchestrator-run.test.sh",
    "verify-npm-stable-state.test.sh",
    "verify-npm-artifact.test.sh",
    "reconcile-npm-stable.test.sh",
    "verify-remote-tag.test.sh",
    "verify-tag-ruleset.test.sh",
    "verify-oci-alias.test.sh",
    "authorize-release-entry.test.sh",
    "verify-version-only-diff.test.sh",
    "verify-release-state.test.sh",
    "test-helm-image-digest.sh",
):
    if gate not in ci:
        errors.append(f"protected CI does not invoke {gate}")
require(ci, r"actionlint[^\n]*\.github/workflows/\*\.yml", "protected CI does not actionlint every workflow")

if errors:
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    raise SystemExit(1)
print("PASS: read-only public promotion and PR-owned metadata contract")
PY
