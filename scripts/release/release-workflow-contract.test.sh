#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/image-publish.yml"
CI_WORKFLOW="${ROOT}/.github/workflows/ci.yml"
SOURCE_CONTRACT="${ROOT}/scripts/release/verify-release-source.sh"
REMOTE_TAG_CONTRACT="${ROOT}/scripts/release/verify-remote-tag.sh"

python3 - "${WORKFLOW}" "${CI_WORKFLOW}" "${SOURCE_CONTRACT}" "${REMOTE_TAG_CONTRACT}" <<'PY'
import re, sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
ci = Path(sys.argv[2]).read_text(encoding="utf-8")
source_contract = Path(sys.argv[3]).read_text(encoding="utf-8")
remote_tag_contract = Path(sys.argv[4]).read_text(encoding="utf-8")
errors: list[str] = []

def require(pattern: str, message: str) -> None:
    if re.search(pattern, text, flags=re.MULTILINE) is None:
        errors.append(message)

def forbid(pattern: str, message: str) -> None:
    if re.search(pattern, text, flags=re.MULTILINE | re.IGNORECASE) is not None:
        errors.append(message)

require(r"^\s+repair_release:\s*$", "workflow_dispatch must expose repair_release")
require(r"^\s+expected_version:\s*$", "repair must require an expected version")
require(r"^\s+expected_sha:\s*$", "repair must require an expected source SHA")
require(r"^\s+expected_existing_digest:\s*$", "repair must accept an idempotent existing digest")
require(r"manual dispatches must set repair_release=true", "a non-repair manual dispatch can move immutable version tags")
require(r"^\s+cancel-in-progress:\s+false\s*$", "release/image publication must never cancel in progress")
require(r"verify-oci-release\.sh", "immutable release preflight is not wired")
require(r"ref:\s*\$\{\{\s*github\.workflow_sha\s*\}\}[\s\S]{0,500}if:\s*\$\{\{\s*inputs\.repair_release\s*\}\}[\s\S]{0,300}ref:\s*\$\{\{\s*inputs\.expected_sha\s*\}\}[\s\S]{0,200}path:\s*\.release-source", "repair does not keep hardened workflow helpers separate from the historical source checkout")
require(r"\$\{GITHUB_WORKSPACE\}/scripts/release/verify-oci-release\.sh", "repair preflight can execute a helper from the historical source tree")
require(r"classify-changes", "pin-only change classifier is missing")
require(r"build_required", "build jobs are not gated by classified changes")
require(r"pin_only", "pin-only commits are not explicitly classified")
require(r"^\s+outputs:\s*$[\s\S]{0,500}^\s+digest:", "image digest is not exported as a job output")
require(r"^\s+DIGEST:\s+\$\{\{\s*needs\.build-push\.outputs\.digest\s*\|\|\s*needs\.classify-changes\.outputs\.existing_digest\s*\}\}", "verification job does not select the built or explicitly approved digest")
require(r"needs\.classify-changes\.outputs\.existing_digest", "idempotent repair cannot reuse its explicitly approved existing digest")
require(r"github\.event_name == 'workflow_dispatch'[\s\S]{0,300}inputs\.repair_release", "repair dispatch cannot recover stable finalization after an earlier release failure")
require(r"gh attestation verify\s+\"oci://\$\{IMAGE\}@\$\{DIGEST\}\"", "pin path does not verify provenance for the exact digest")
require(r"--source-digest\s+\"\$\{SOURCE_SHA\}\"", "attestation is not cryptographically bound to the verified source commit")
require(r"--signer-workflow\s+\"\$\{GITHUB_REPOSITORY\}/\.github/workflows/image-publish\.yml\"", "attestation signer workflow is not constrained")
require(r"pin-production-image\.sh", "verified digest is not written through the narrow pin script")
require(r"for attempt in 1 2 3", "pin push has no bounded three-attempt CAS retry")
require(r"git fetch origin main", "pin path does not re-fetch authoritative main")
if "git diff --name-only" not in source_contract:
    errors.append("finalization does not inspect drift after the verified source")
if "non-infrastructure main drift" not in source_contract:
    errors.append("non-infrastructure main drift is not rejected before finalization")
if ".well-known/*.json" not in source_contract:
    errors.append("release-owned channel manifest commits are not allowed through the final pin CAS")
require(r"VERSION_BUMP_PAT", "pin path does not use the existing narrow release writer")
forbid(r"VERSION_BUMP_PAT\s*\|\|\s*github\.token", "production pin silently falls back to a non-recursive GITHUB_TOKEN push")
require(r"Require protected release writer credential", "production pin does not fail closed before a push when VERSION_BUMP_PAT is absent")
forbid(r"git commit[^\n]*\[skip ci\]", "production pin suppresses protected CI instead of relying on the pin-only classifier")
require(r"fetch-tags:\s*true", "main classification does not fetch remote release tags before registry publication")
require(r"verify-remote-tag\.sh", "image publication does not re-check the remote version tag immediately before the registry write")
if "git ls-remote --exit-code --tags" not in remote_tag_contract:
    errors.append("remote tag contract does not inspect the authoritative remote independently of the checkout")
require(r"orchestrator_run_id", "stable release handoff is not bound to the image-publish run id")
require(r"\.github/workflows/image-publish\.yml", "stable authorization is not constrained to the image-publish workflow")
require(r"verify-release-source\.sh", "release source topology is not checked by the tested helper")
require(r"--allow-detached-repair", "the stranded version-only release repair topology is not handled explicitly")
forbid(r"ref:\s*\$\{\{\s*inputs\.repair_release\s*&&\s*inputs\.expected_sha", "a release job replaces hardened workflow code with the historical repair tree")
require(r"repos/\$\{GITHUB_REPOSITORY\}/rulesets", "stable finalization does not fail closed when v* tag update/deletion protection is absent")
require(r"\bupdate\b[\s\S]{0,500}\bdeletion\b|\bdeletion\b[\s\S]{0,500}\bupdate\b", "stable finalization does not require both tag update and deletion rules")
require(r"verify-tag-ruleset\.py", "tag ruleset validation does not account for exclusions and bypass actors")
require(r"verify-oci-alias\.sh", "published OCI version alias is not read back against the exact build digest")
require(r"classify-image-change\.sh", "push classification does not use a tested full-range helper")
require(r"GITHUB_EVENT_BEFORE", "push classification is not anchored to github.event.before")
require(r"orchestrator_control_sha", "stable npm handoff does not separate the orchestrator control revision from the release source SHA")
require(r"cosign verify-blob[\s\S]{0,800}slsa-verifier verify-artifact", "existing release bundles and SLSA provenance are not cryptographically verified")
if re.search(r"^permissions:\s*$[\s\S]{0,300}^\s+(packages|id-token|attestations):\s+write", text, flags=re.MULTILINE):
    errors.append("image workflow grants publication credentials globally instead of per build job")
for action_ref in re.findall(r"^\s*-?\s*uses:\s*([^\s#]+)", ci, flags=re.MULTILINE):
    if action_ref.startswith("./"):
        continue
    if re.fullmatch(r"[^@]+@[0-9a-f]{40}", action_ref) is None:
        errors.append(f"protected CI uses mutable action reference {action_ref}")
for gate in (
    "release-workflow-contract.test.sh",
    "stable-release-order.test.sh",
    "pin-production-image.test.sh",
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
    "classify-image-change.test.sh",
    "authorize-release-entry.test.sh",
    "verify-version-only-diff.test.sh",
    "verify-release-state.test.sh",
    "test-helm-image-digest.sh",
    "actionlint",
):
    if gate not in ci:
        errors.append(f"protected CI does not invoke {gate}")
forbid(r"git\s+push[^\n]*(--force|-f(?:\s|$))", "workflow contains a force push")
forbid(r"github\.event\.inputs\.platforms", "a repair caller can publish an incomplete platform set")
forbid(r"\b(?:kubectl|helm\s+(?:upgrade|install)|docker\s+service\s+update)\b", "workflow contains a direct production mutation")

if errors:
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    raise SystemExit(1)
print("PASS: publish → verify → pin workflow contract")
PY
