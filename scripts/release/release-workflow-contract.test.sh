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
sign_attest = workflows["sign-attest.yml"]
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


def indentation(line: str) -> int:
    return len(line) - len(line.lstrip())


def permissions_at(lines: list[str], indent: int) -> dict[str, str] | None:
    prefix = " " * indent
    for index, line in enumerate(lines):
        if not line.startswith(f"{prefix}permissions:") or indentation(line) != indent:
            continue
        value = line.split(":", 1)[1].split("#", 1)[0].strip()
        if value == "{}":
            return {}
        if value in ("read-all", "write-all"):
            return {"*": value.removesuffix("-all")}
        permissions: dict[str, str] = {}
        for nested in lines[index + 1 :]:
            if not nested.strip() or nested.lstrip().startswith("#"):
                continue
            nested_indent = indentation(nested)
            if nested_indent <= indent:
                break
            match = re.match(r"^\s*([a-z-]+):\s*(read|write|none)(?:\s+#.*)?$", nested)
            if nested_indent == indent + 2 and match:
                permissions[match.group(1)] = match.group(2)
        return permissions
    return None


def job_blocks(text: str) -> dict[str, list[str]]:
    lines = text.splitlines()
    jobs_index = next(
        (index for index, line in enumerate(lines) if line == "jobs:"),
        None,
    )
    if jobs_index is None:
        return {}
    blocks: dict[str, list[str]] = {}
    current_name: str | None = None
    current_lines: list[str] = []
    for line in lines[jobs_index + 1 :]:
        if line.strip() and not line.lstrip().startswith("#") and indentation(line) == 0:
            break
        header = re.match(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$", line)
        if header:
            if current_name is not None:
                blocks[current_name] = current_lines
            current_name = header.group(1)
            current_lines = [line]
        elif current_name is not None:
            current_lines.append(line)
    if current_name is not None:
        blocks[current_name] = current_lines
    return blocks


def effective_job_permissions(text: str) -> dict[str, dict[str, str]]:
    lines = text.splitlines()
    workflow_permissions = permissions_at(lines, 0)
    if workflow_permissions is None:
        workflow_permissions = {}
    effective: dict[str, dict[str, str]] = {}
    for job_name, block in job_blocks(text).items():
        job_permissions = permissions_at(block, 4)
        effective[job_name] = (
            workflow_permissions.copy()
            if job_permissions is None
            else job_permissions
        )
    return effective


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
require(
    image,
    r'gh attestation verify "\$\{tarball\}" \\\n\s+--bundle "\$\{tarball\}\.provenance\.json" \\\n\s+--repo "\$\{GITHUB_REPOSITORY\}" \\\n\s+--source-digest "\$\{CANDIDATE_SHA\}" \\\n\s+--signer-workflow "\$\{GITHUB_REPOSITORY\}/\.github/workflows/sign-attest\.yml"',
    "existing release provenance bundles are not verified offline against the candidate source and signer",
)

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
    require(image_build, r"^\s+tags: \|\n\s+\$\{\{ env\.IMAGE \}\}:v\$\{\{ inputs\.version \}\}\n(?:\s+#[^\n]*\n)*\s+provenance: true", "candidate minting pushes a tag other than the exact v<version> alias")
    # The GHA BuildKit cache is mutable and shared by scope; layers imported
    # from it would shape an immutable candidate outside its attested source.
    forbid(image_build, r"cache-(?:from|to):|type=gha", "candidate minting imports or exports a mutable BuildKit cache")
    require(image_build, r"docker buildx imagetools inspect --raw \"\$\{IMAGE\}@\$\{DIGEST\}\"[\s\S]{0,300}json\.load\([\s\S]{0,400}application/vnd\.oci\.image\.index\.v1\+json[\s\S]{0,600}\{\"linux/amd64\", \"linux/arm64\"\}", "candidate minting does not verify the raw OCI index media type and platforms as JSON")
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
    require(
        image_build,
        r'gh attestation verify "\$\{tarball\}" \\\n\s+--bundle "\$\{tarball\}\.provenance\.json" \\\n\s+--repo "\$\{GITHUB_REPOSITORY\}" \\\n\s+--source-digest "\$\{SOURCE_SHA\}" \\\n\s+--signer-workflow "\$\{GITHUB_REPOSITORY\}/\.github/workflows/sign-attest\.yml"',
        "candidate minting does not verify existing release provenance bundles offline against its own source",
    )
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
        (r"contents:\s*write", "candidate minting grants a Git-writing token"),
        (r"secrets\.", "candidate minting reads a repository secret instead of github.token"),
        (r"persist-credentials:\s*true", "candidate minting persists checkout credentials"),
    ):
        forbid(image_build, pattern, message)
    # Exact per-job grants: the builder may write packages and attestations
    # under OIDC; the orchestrator may only dispatch. Nothing else, ever.
    expected_image_build_permissions = {
        "build-push": {"contents": "read", "packages": "write", "id-token": "write", "attestations": "write"},
        "finalize": {"contents": "read", "packages": "read", "attestations": "read", "actions": "write"},
    }
    image_build_permissions = effective_job_permissions(image_build)
    if set(image_build_permissions) != set(expected_image_build_permissions):
        errors.append(f"candidate minting job set changed: {sorted(image_build_permissions)}")
    for job_name, expected in expected_image_build_permissions.items():
        actual = image_build_permissions.get(job_name)
        if actual != expected:
            errors.append(f"candidate minting job {job_name} permissions are {actual}, expected exactly {expected}")
    image_build_jobs = job_blocks(image_build)
    for job_name in expected_image_build_permissions:
        block = "\n".join(image_build_jobs.get(job_name, []))
        require(block, r"^    environment:\s*release\s*$", f"candidate minting job {job_name} does not run in the release environment")
    # A dev prerelease at the tag pins its channel classification forever;
    # finalize must wait for any in-flight release.yml run before reading the
    # release state, then refuse the prerelease with the recovery command.
    require(
        image_build,
        r"gh run list[^\n]*\\\n\s+--workflow release\.yml --branch \"\$\{tag\}\"[\s\S]{0,400}"
        r"select\(\.status == \"queued\" or \.status == \"in_progress\"[\s\S]{0,600}sleep 30",
        "candidate minting does not wait for queued or in-progress release.yml runs at the tag before reading the release state",
    )
    require(
        image_build,
        r"a dev prerelease already exists at v\$\{VERSION\}; this tag cannot become stable — cut a fresh candidate with \\`gh workflow run version\.yml --ref dev -f candidate=true\\`",
        "candidate minting does not refuse a tag that already carries a public dev prerelease",
    )
    for other in ("release.yml", "release-publish.yml", "version.yml"):
        require(workflows[other], r"--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-build\.yml\"", f"{other} does not bind the OCI signer to the candidate minter")
        require(workflows[other], r"verify-orchestrator-run\.py[\s\S]{0,300}--expected-workflow \.github/workflows/image-build\.yml\s*\\\n\s+--allowed-event workflow_dispatch", f"{other} does not require an in-progress dispatch-only image-build orchestrator run")
    forbid(all_workflows, r"--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-publish\.yml\"", "a workflow still treats the read-only promotion verifier as the OCI signer")

# Tarball provenance is GitHub-native and produced in-repo. The repository
# requires every action to be pinned to a full-length commit SHA; the SLSA
# generator reusable workflow references its own helper actions by tag, so it
# fails that rule inside the callee where no caller pin can reach. The signing
# workflow attests each tarball with the pinned action, ships the bundle as
# <tarball>.provenance.json, self-verifies it offline, and never needs a
# Git-writing token.
forbid(
    all_workflows,
    r"slsa-framework/|slsa-verifier|\.intoto\.jsonl",
    "a workflow still depends on the SLSA generator, slsa-verifier, or the retired .intoto.jsonl asset",
)
require(
    sign_attest,
    r"actions/attest-build-provenance@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+subject-path:\s*dist/omni-\$\{\{ needs\.prepare\.outputs\.version \}\}-\$\{\{ matrix\.platform \}\}\.tar\.gz",
    "tarball signing does not attest each platform tarball with the pinned GitHub-native provenance action",
)
require(
    sign_attest,
    r"ATTEST_BUNDLE_PATH:\s*\$\{\{ steps\.attest\.outputs\.bundle-path \}\}",
    "tarball signing does not stage the attestation bundle from the action's bundle-path output",
)
require(
    sign_attest,
    r'gh attestation verify "\$\{TARBALL\}" \\\n\s+--bundle "\$\{TARBALL\}\.provenance\.json" \\\n\s+--repo "\$\{GITHUB_REPOSITORY\}" \\\n\s+--source-digest "\$\{GITHUB_SHA\}" \\\n\s+--signer-workflow "\$\{GITHUB_REPOSITORY\}/\.github/workflows/sign-attest\.yml"',
    "tarball signing does not self-verify the shipped provenance bundle offline against the release source and signer",
)
require(
    sign_attest,
    r'gh attestation verify "\$\{MUTATED\}" \\\n\s+--bundle "\$\{TARBALL\}\.provenance\.json"',
    "tarball signing tamper self-test does not require the provenance bundle to reject a mutated tarball",
)
require(
    sign_attest,
    r"\.tar\.gz\.bundle\n\s+dist/omni-\$\{\{ needs\.prepare\.outputs\.version \}\}-\$\{\{ matrix\.platform \}\}\.tar\.gz\.provenance\.json\n\s+retention-days",
    "tarball signing does not upload the provenance bundle beside the tarball and cosign bundle",
)
forbid(sign_attest, r"contents:\s*write", "tarball signing grants a Git-writing token")
release_sign_call = "\n".join(job_blocks(release).get("sign-attest", []))
require(release_sign_call, r"^\s+contents:\s*read", "release orchestration does not call tarball signing with a read-only contents token")
forbid(release_sign_call, r"contents:\s*write", "release orchestration still grants tarball signing a Git-writing token")
require(
    release_publish,
    r'for suffix in "" \.bundle \.provenance\.json; do',
    "release publication inventory does not expect the provenance bundle per platform",
)
require(
    release_publish,
    r'gh attestation verify "\$\{tarball\}" \\\n\s+--bundle "\$\{provenance\}" \\\n\s+--repo "\$\{REPOSITORY\}" \\\n\s+--source-digest "\$\{GITHUB_SHA\}" \\\n\s+--signer-workflow "\$\{REPOSITORY\}/\.github/workflows/sign-attest\.yml"',
    "release publication does not verify every provenance bundle offline against the release source before publishing",
)

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

# A candidate cut must not publish the dev prerelease that would make its tag
# unmintable; the merged-PR path never sets the flag and stays a dev cut.
require(
    version_workflow,
    r"^  workflow_dispatch:\n    inputs:\n      candidate:\n        description: '[^\n]*'\n        type: boolean\n        default: false\n",
    "the version workflow has no boolean candidate dispatch input",
)
require(
    version_workflow,
    r"- name: Dispatch release pipeline for the new tag\n(?:        [^\n]*\n)*?          CANDIDATE: \$\{\{ inputs\.candidate \}\}\n[\s\S]{0,600}"
    r"if \[\[ \"\$\{CANDIDATE\}\" == \"true\" \]\]; then\n\s+echo \"[^\n]*image-build\.yml[^\n]*\"\n\s+exit 0\n\s+fi\n[\s\S]{0,200}gh workflow run release\.yml",
    "the version workflow dispatches the dev prerelease even for a candidate cut",
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
