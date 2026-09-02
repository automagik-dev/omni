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
deploy_readme = (root / "deploy/README.md").read_text(encoding="utf-8")
claude_reference = (root / ".claude/CLAUDE.md").read_text(encoding="utf-8")
upgrade_runbook = (root / "docs/deployment/upgrade-2.260718.1-to-2.260830.2.md").read_text(encoding="utf-8")
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
require(image, r"name:\s*Checkout immutable candidate source[\s\S]{0,500}path:\s*release-candidate", "immutable OCI verification has no separate candidate checkout")
require(image, r"--source-dir\s+\"\$\{GITHUB_WORKSPACE\}/release-candidate\"", "immutable OCI verification does not use the candidate checkout")
require(image, r"gh attestation verify\s+\"oci://\$\{IMAGE\}@\$\{CANDIDATE_DIGEST\}\"", "exact OCI digest provenance is not verified")
require(image, r"--source-digest\s+\"\$\{CANDIDATE_SHA\}\"", "OCI provenance is not bound to b8c1bf20")
require(image, r"--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-build\.yml\"", "OCI signer workflow identity is not constrained to the candidate minter")
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

# image-build.yml is the only public builder and the stable orchestrator: it
# mints one immutable candidate at an exact v* tag on explicit dispatch and
# never carries the retired push-to-main publication or the public pin.
image_build = workflows.get("image-build.yml")
if image_build is None:
    errors.append("dispatch-only candidate minting workflow image-build.yml is missing")
else:
    require(image_build, r"^on:\n  workflow_dispatch:\n    inputs:\n      version:", "candidate minting is not a dispatch-only workflow keyed by an exact version input")
    forbid(image_build, r"^  push:\s*$", "candidate minting can run on a branch or tag push")
    forbid(image_build, r"pull_request", "candidate minting can run on a pull request event")
    require(image_build, r"^permissions:\s*\{\s*\}\s*$", "candidate minting does not clear top-level token permissions")
    require(image_build, r"^concurrency:\n(?:  #[^\n]*\n)*  group: image-build-\$\{\{ inputs\.version \}\}\n  cancel-in-progress: false", "candidate minting does not serialize per candidate version without cancellation")
    require(image_build, r"timeout-minutes:\s*[0-9]+", "candidate minting has no finite job timeout")
    require(image_build, r"\[\[ \"\$\{GITHUB_EVENT_NAME\}\" == \"workflow_dispatch\" \]\]", "candidate minting does not reject non-dispatch entry")
    require(image_build, r"\[\[ \"\$\{GITHUB_REF\}\" == \"refs/tags/v\$\{VERSION\}\" \]\]", "candidate minting is not bound to the exact version tag ref")
    require(image_build, r"verify-remote-tag\.sh[\s\S]{0,120}--mode exact", "candidate minting does not bind the remote tag to the build source")
    require(image_build, r"verify-oci-release\.sh[\s\S]{0,200}--source-dir\s+\"\$\{GITHUB_WORKSPACE\}\"", "candidate minting does not run the immutable identity preflight on the checked-out source")
    require(image_build, r"grep -qx 'publish_required=true'", "candidate minting can rebuild an already published version alias")
    require(image_build, r"docker/build-push-action@[0-9a-f]{40}", "candidate minting does not build with the pinned build-push action")
    require(image_build, r"^\s+tags: \|\n\s+\$\{\{ env\.IMAGE \}\}:v\$\{\{ inputs\.version \}\}\n\s+cache-from:", "candidate minting pushes a tag other than the exact v<version> alias")
    require(image_build, r"platforms:\s*linux/amd64,linux/arm64", "candidate minting does not build both supported platforms")
    require(image_build, r"actions/attest-build-provenance@[0-9a-f]{40}[\s\S]{0,300}push-to-registry:\s*true", "candidate minting does not register GitHub provenance in the registry")
    require(image_build, r"verify-oci-alias\.sh", "candidate minting does not read back the published alias digest")
    require(image_build, r"gh attestation verify\s+\"oci://\$\{IMAGE\}@\$\{DIGEST\}\"[\s\S]{0,300}--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-build\.yml\"", "candidate minting does not independently verify its own OCI provenance identity")
    require(image_build, r"verify-tag-ruleset\.py", "candidate minting does not require the active immutable v* tag ruleset")
    require(image_build, r"gh workflow run release\.yml[\s\S]{0,400}--field channel=stable[\s\S]{0,300}--field orchestrator_run_id=\"\$\{GITHUB_RUN_ID\}\"", "candidate minting does not orchestrate the stable release against its own run")
    require(image_build, r"gh workflow run version\.yml[\s\S]{0,200}--ref \"refs/tags/v\$\{VERSION\}\"[\s\S]{0,100}--field stable_publish_only=true", "candidate minting does not orchestrate the stable npm publish at the candidate tag")
    require(image_build, r"gh run list[\s\S]{0,200}--event workflow_dispatch", "candidate minting resolves dispatched runs from gh workflow run stdout instead of the run list")
    forbid(image_build, r"\brelease_url=\$\(gh workflow run|\bnpm_url=\$\(gh workflow run", "candidate minting still parses gh workflow run stdout as a run id")
    require(image_build, r'--certificate-identity\s+"https://github\.com/\$\{GITHUB_REPOSITORY\}/\.github/workflows/sign-attest\.yml@refs/tags/v\$\{VERSION\}"', "candidate minting verifies existing release assets with a non-exact signer identity")
    forbid(image_build, r"--certificate-identity-regexp", "candidate minting accepts a regexp signer identity")
    require(image_build, r"echo \"CANDIDATE_VERSION=\$\{VERSION\}\"\n\s+echo \"CANDIDATE_SHA=\$\{SOURCE_SHA\}\"\n\s+echo \"CANDIDATE_DIGEST=\$\{DIGEST\}\"", "candidate minting does not print the exact promotion pin values")
    for pattern, message in (
        (r"values-prod-gitops|pin-production-image", "candidate minting still writes a public production pin"),
        (r"secrets:\s*inherit", "candidate minting inherits repository secrets"),
        (r"pull_request_target", "candidate minting uses pull_request_target"),
        (r"VERSION_BUMP_PAT", "candidate minting requests the direct-main writer credential"),
        (r"\bgit\s+push\b", "candidate minting can move a Git ref"),
        (r"\bgh\s+api\b[^\n]*(?:--method|-X)\s+(?:POST|PATCH|PUT|DELETE)", "candidate minting performs a mutating API call"),
        (r"\bgh\s+release\s+(?:create|edit|upload|delete)\b", "candidate minting publishes a release directly instead of through release.yml"),
        (r"\bnpm\s+(?:publish|dist-tag)\b", "candidate minting publishes npm directly instead of through version.yml"),
        (r"imagetools\s+create", "candidate minting can retag an OCI manifest"),
        (r"\b(?:kubectl|helm\s+(?:upgrade|install)|docker\s+service\s+update|aws\s+)", "candidate minting can mutate production infrastructure"),
        (r"ref:\s*main\b", "candidate minting checks out main instead of the dispatched tag source"),
    ):
        forbid(image_build, pattern, message)
    for other in ("release.yml", "release-publish.yml", "version.yml"):
        require(workflows[other], r"--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-build\.yml\"", f"{other} does not bind the OCI signer to the candidate minter")
        require(workflows[other], r"verify-orchestrator-run\.py[\s\S]{0,300}--expected-workflow \.github/workflows/image-build\.yml\s*\\\n\s+--allowed-event workflow_dispatch", f"{other} does not require an in-progress dispatch-only image-build orchestrator run")
    forbid(all_workflows, r"--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-publish\.yml\"", "a workflow still treats the read-only promotion verifier as the OCI signer")

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

for name, document in (
    ("deploy/README.md", deploy_readme),
    (".claude/CLAUDE.md", claude_reference),
):
    require(document, r"direct `dev` → `main`", f"{name} does not state the direct dev-to-main public topology")
    require(document, r"`main`[^\n]*verification-only", f"{name} does not identify main as verification-only")
    require(document, r"HML[\s\S]{0,160}legacy/reference-only", f"{name} does not identify HML as legacy/reference-only")
    require(document, r"`hml\.omni\.khal\.ai` is the legacy HML endpoint", f"{name} does not name the literal legacy HML endpoint")
    require(document, r"This change neither mutates nor cleans it up", f"{name} does not preserve the legacy HML endpoint verbatim")
    require(document, r"Production\s+authority[\s\S]{0,160}separate/private", f"{name} does not identify separate/private production authority")

for pattern, message in (
    (r"\bhomolog branch\b", "documentation still describes a homolog branch"),
    (r"`:homolog` tag", "documentation still describes a homolog image tag"),
    (r"\btwo-hop\b", "documentation still describes a two-hop promotion"),
    (r"\bdormant\b[^\n]*\bworkflows?\b", "documentation still describes dormant workflow plumbing"),
    (r"v-tags published on merge to `main`", "documentation still says main publishes version tags"),
    (r"`main` is production", "documentation still identifies main as production authority"),
    (r"`main` merge triggers release-please", "documentation still says main merge publishes a release"),
):
    forbid(f"{deploy_readme}\n{claude_reference}", pattern, message)

forbid(deploy_readme, r"make -C deploy deploy REALM=homolog", "deployment guide still instructs an HML deployment")
forbid(deploy_readme, r"helm upgrade --install omni[^`]*values-homolog", "deployment guide still instructs an HML co-tenant deployment")

require(
    upgrade_runbook,
    r"--set-string 'image\.digest=sha256:<64-lowercase-hex>'",
    "upgrade runbook does not prescribe the chart's supported image.digest field",
)
require(
    upgrade_runbook,
    r"image\.digest must be a lowercase sha256 digest \(sha256 followed by 64 hexadecimal characters\)",
    "upgrade runbook does not quote the exact invalid-digest renderer failure",
)
require(
    upgrade_runbook,
    r"Refuse the render unless[\s\S]{0,100}exactly[\s\S]{0,100}"
    r"`ghcr\.io/automagik-dev/omni-api@sha256:<64-lowercase-hex>`[\s\S]{0,100}tag-only API image",
    "upgrade runbook does not state the exact rendered-digest refusal contract",
)
require(
    upgrade_runbook,
    r"does not pin a public production digest or grant public production deployment authority",
    "upgrade runbook claims or omits the boundary around public production authority",
)
forbid(
    upgrade_runbook,
    r"set the repository to\s*`ghcr\.io/automagik-dev/omni-api@sha256`[^\n]*tag to the bare 64-hex digest",
    "upgrade runbook still prescribes the pre-image.digest repository/tag workaround",
)

version_workflow = workflows["version.yml"]
forbid(
    version_workflow,
    r"^concurrency:",
    "the version workflow still takes one workflow-level concurrency group for both its writer and its read-only publisher",
)
forbid(
    version_workflow,
    r"^\s*group:[^\n]*(?:github\.ref_name|github\.event\.pull_request\.base\.ref)",
    "version concurrency is keyed by the trigger ref instead of the branch the job writes",
)
require(
    version_workflow,
    r"^  auto-version:\n    name: Auto Version\n(?:    #[^\n]*\n)*"
    r"    concurrency:\n      group: version-dev\n      cancel-in-progress: false\n",
    "the dev version writer does not serialize every trigger under one constant version-dev group",
)
require(
    version_workflow,
    # Only 4-space-indented or blank lines, so this cannot reach past
    # publish-stable into a job appended after it.
    r"^  publish-stable:\n(?:(?:    [^\n]*)?\n)*?"
    r"    concurrency:\n      group: version-stable-publish-\$\{\{ inputs\.expected_version \}\}\n",
    "the read-only stable publisher shares the dev writer's concurrency group",
)

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
print("PASS: read-only public promotion, docs topology, and PR-owned metadata contract")
PY
