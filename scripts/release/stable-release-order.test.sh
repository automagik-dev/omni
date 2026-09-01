#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "${ROOT}/.github/workflows/version.yml" "${ROOT}/.github/workflows/image-publish.yml" "${ROOT}/.github/workflows/release.yml" "${ROOT}/.github/workflows/release-publish.yml" "${ROOT}/.github/workflows/build-tarballs.yml" "${ROOT}/.github/workflows/sign-attest.yml" "${ROOT}/scripts/release/verify-release-source.sh" "${ROOT}/.github/workflows/signing-identity-pin.yml" <<'PY'
import re, sys
from pathlib import Path
version = Path(sys.argv[1]).read_text(encoding="utf-8")
image = Path(sys.argv[2]).read_text(encoding="utf-8")
release = Path(sys.argv[3]).read_text(encoding="utf-8")
release_publish = Path(sys.argv[4]).read_text(encoding="utf-8")
build_tarballs = Path(sys.argv[5]).read_text(encoding="utf-8")
sign_attest = Path(sys.argv[6]).read_text(encoding="utf-8")
source_contract = Path(sys.argv[7]).read_text(encoding="utf-8")
signing_identity_pin = Path(sys.argv[8]).read_text(encoding="utf-8")
errors=[]

def require(text, pattern, message):
    if re.search(pattern, text, flags=re.MULTILINE | re.DOTALL) is None: errors.append(message)

def forbid(text, pattern, message):
    if re.search(pattern, text, flags=re.MULTILINE | re.DOTALL) is not None: errors.append(message)

def forbid_inputs_in_run(text, workflow_name):
    lines = text.splitlines()
    run_indent = None
    for line in lines:
        match = re.match(r"^(\s*)run:\s*\|\s*$", line)
        if match:
            run_indent = len(match.group(1))
            continue
        if run_indent is None:
            continue
        if line.strip() and len(line) - len(line.lstrip()) <= run_indent:
            run_indent = None
            continue
        if "${{ inputs." in line:
            errors.append(f"{workflow_name} interpolates an input directly inside a shell run block")
            run_indent = None

forbid(version, r"workflow_run:[\s\S]{0,250}branches:\s*\[[^\]]*main", "version workflow still fires a post-main bump")
require(version, r"pull_request:\s*\n\s*types:\s*\[closed\]\s*\n\s*branches:\s*\[dev\]", "homolog versioning must have one canonical workflow_run entry point")
forbid(version, r"group:[^\n]*github\.event_name", "equivalent version events can run in separate concurrency groups")
forbid(version, r"main\)\s*[\s\S]{0,250}checkout_ref=dev", "stable main path still creates a release from dev")
require(image, r"infra_only", "release-infrastructure-only merges are not classified away from image publication")
require(image, r"version tag .*already exists|already published", "main does not fail closed when its version tag already exists")
require(image, r"Finalize stable Git tag and release", "stable release is not finalized by the verified image pipeline")
require(image, r"gh attestation verify[\s\S]{0,5000}refs/tags/v\$\{VERSION\}", "stable tag can be created before exact OCI provenance verification")
require(image, r"gh workflow run release\.yml[\s\S]{0,300}channel=stable|--field channel=stable", "verified main artifact does not dispatch the stable release channel")
require(image, r"gh run watch[\s\S]{0,1500}gh workflow run version\.yml[\s\S]{0,500}stable_publish_only=true", "stable npm publication is not sequenced after successful release finalization")
require(source_contract, r"git merge-base --is-ancestor", "stable source is not required to be reachable from main")
require(version, r"stable_publish_only:", "version workflow has no trusted-publisher stable-only entry point")
require(version, r"Publish verified stable npm package", "stable npm package is not published by the trusted version workflow")
require(image, r"gh workflow run version\.yml[\s\S]{0,300}--ref main", "stable npm recovery dispatches the historical tag workflow instead of hardened main")
forbid(image, r"npm_action[^\n]*none[\s\S]{0,800}gh workflow run version\.yml", "an apparently exact npm tag bypasses package byte/signature verification")
require(version, r"Publish verified stable npm package[\s\S]{0,2500}ref:\s*\$\{\{\s*github\.workflow_sha\s*\}\}[\s\S]{0,2500}ref:\s*\$\{\{\s*inputs\.expected_sha\s*\}\}[\s\S]{0,200}path:\s*\.stable-source", "stable npm publication does not separate hardened control code from the immutable source checkout")
require(version, r"Authorize verified stable orchestration[\s\S]{0,2500}actions/runs/\$\{ORCHESTRATOR_RUN_ID\}", "stable npm authorization is not bound to the exact image-publish run")
require(version, r"reconcile-npm-stable\.sh", "stable npm publication does not use the behavior-tested publish/repair/readback reconciler")
require(version, r"NPM_RECOVERY_TOKEN:[^\n]*secrets\.NPM_TOKEN", "latest dist-tag recovery is not protected by the repository npm credential")
require(image, r"orchestrator_control_sha=\"\$\{GITHUB_SHA\}\"", "stable npm repair does not pass the exact current control revision separately")
require(version, r"--source-sha\s+\"\$\{ORCHESTRATOR_CONTROL_SHA\}\"[\s\S]{0,300}--source-digest\s+\"\$\{EXPECTED_SHA\}\"", "stable npm authorization conflates orchestrator control SHA with release source SHA")
require(release, r"Authorize release channel", "release workflow has no stable-channel authorization gate")
require(release, r"actions/runs/\$\{ORCHESTRATOR_RUN_ID\}", "stable release authorization does not inspect the exact image-publish run")
require(release, r"--source-digest\s+\"\$\{EXPECTED_SHA\}\"[\s\S]{0,300}--signer-workflow", "stable release authorization does not independently bind OCI provenance to source and signer")
require(release_publish, r"authorize-release-entry\.py", "direct release-publish dispatch can reach the stable channel")
require(release_publish, r"--draft=false --prerelease=false --latest", "idempotent recovery does not force an existing stable release to public stable state")
require(release_publish, r"gh release create[\s\S]{0,300}--verify-tag", "release publication can create an unverified tag implicitly")
require(release_publish, r"gh release create[\s\S]{0,300}--verify-tag[\s\S]{0,200}--draft", "a new release is exposed before its signed asset inventory is complete")
require(release_publish, r"isDraft,isPrerelease", "release publication does not verify its final public/prerelease state")
require(release_publish, r"verify-release-state\.py[\s\S]{0,200}--phase existing", "existing public release channel classification is mutable")
require(release_publish, r"ASSET_COUNT.*-ne 12", "release publication does not fail closed on an incomplete signed asset set")
require(release_publish, r"ASSET_COUNT[\s\S]{0,1000}--draft=false --prerelease=false --latest", "stable release is promoted before signed assets are verified")
state_check = release_publish.find("--json isDraft,isPrerelease")
asset_upload = release_publish.find("gh release upload")
if state_check < 0 or asset_upload < 0 or state_check > asset_upload:
    errors.append("existing release state is not validated before any asset upload")
promotion = release_publish.find("--draft=false", asset_upload)
uploaded_asset_verify = release_publish.find("verify-release-assets.py", asset_upload)
if promotion < 0 or uploaded_asset_verify < 0 or uploaded_asset_verify > promotion:
    errors.append("newly uploaded release assets are not read back by name and digest before public promotion")
require(release_publish, r"public release assets already match|verify existing public release assets", "public release recovery does not verify immutable asset identity")
require(release_publish, r"remote tag.*before publication|tag target before publication", "release publication does not read back the remote tag before mutation")
require(release_publish, r"remote tag.*after publication|tag target after publication", "release publication does not read back the remote tag after mutation")
require(build_tarballs, r"version override does not match packages/cli/package\.json", "manual tarball recovery can relabel a different source version")
require(build_tarballs, r"PACKAGE_VERSION.*=~.*\^\[0-9\]", "tarball builder does not constrain source package versions before shell reuse")
require(sign_attest, r"VERSION.*=~.*\^\[0-9\]", "signing workflow does not constrain artifact versions before shell reuse")
require(release_publish, r"VERSION.*=~.*\^\[0-9\]", "release workflow does not constrain artifact versions before shell reuse")
require(sign_attest, r"Authorize manual recovery source run[\s\S]{0,1200}expected-workflow \.github/workflows/build-tarballs\.yml", "manual signing recovery is not bound to an exact successful build workflow run")
require(release_publish, r"expected-workflow \.github/workflows/sign-attest\.yml", "manual release recovery is not bound to an exact successful signing workflow run")
require(release_publish, r"authorize-release-entry\.py", "release publication does not behaviorally distinguish reusable orchestration from direct recovery")
require(release_publish, r"workflow_call:[\s\S]{0,1000}orchestrated:", "release publication has no workflow_call-only orchestration marker")
require(release, r"orchestrated:\s*true", "release orchestrator does not identify its reusable publish call")
forbid_inputs_in_run(build_tarballs, "build-tarballs.yml")
forbid_inputs_in_run(sign_attest, "sign-attest.yml")
forbid_inputs_in_run(release_publish, "release-publish.yml")
forbid_inputs_in_run(release, "release.yml")
forbid(release_publish, r"warning::expected 12", "incomplete signed release assets are only a warning")
require(release_publish, r"for attempt in 1 2 3", "release manifest push has no bounded CAS retry")
require(release_publish, r"VERSION_BUMP_PAT", "release manifest CAS does not use the protected-branch writer credential")
for workflow_name, workflow in (("image-publish.yml", image), ("release-publish.yml", release_publish), ("version.yml", version)):
    forbid(workflow, r"VERSION_BUMP_PAT\s*\|\|\s*github\.token", f"{workflow_name} silently falls back to a non-recursive GITHUB_TOKEN branch push")
require(release_publish, r"Require protected release writer credential", "release manifest write does not fail closed when VERSION_BUMP_PAT is absent")
require(version, r"Require protected version writer credential", "version branch write does not fail closed when VERSION_BUMP_PAT is absent")
require(release_publish, r"git show -s --format=%ct \"v\$\{VERSION\}\^\{commit\}\"", "release manifest timestamp is not deterministic from the immutable tag")
forbid(release_publish, r"git push origin main\s*\|\|", "release manifest push failure is swallowed as success")
forbid(release, r"GH_TOKEN:\s*\$\{\{\s*secrets\.RELEASE_PLEASE_TOKEN\s*\|\|\s*secrets\.GITHUB_TOKEN\s*\}\}", "release notes still prefer the stale broad token")
require(release, r"GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}", "release notes do not use the job-scoped GitHub token")
forbid(release, r"\n  publish:[\s\S]{0,500}\n      id-token:\s*write", "release publish job grants an unused OIDC token")

for workflow_name, workflow in (
    ("version.yml", version),
    ("image-publish.yml", image),
    ("release.yml", release),
    ("release-publish.yml", release_publish),
    ("build-tarballs.yml", build_tarballs),
    ("sign-attest.yml", sign_attest),
    ("signing-identity-pin.yml", signing_identity_pin),
):
    for match in re.finditer(r"^\s*-?\s*uses:\s*([^\s#]+)", workflow, flags=re.MULTILINE):
        ref = match.group(1)
        if ref.startswith("./"):
            continue
        if re.fullmatch(r"[^@]+@[0-9a-f]{40}", ref) is None:
            errors.append(f"{workflow_name} contains mutable action or reusable-workflow ref {ref}")

if errors:
    for error in errors: print(f"FAIL: {error}", file=sys.stderr)
    raise SystemExit(1)
print("PASS: stable release ordering contract")
PY
