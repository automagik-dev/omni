#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "${ROOT}" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
workflow_dir = root / ".github/workflows"
workflow_paths = sorted({*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml")})
workflows = {path.name: path.read_text(encoding="utf-8") for path in workflow_paths}
version = workflows["version.yml"]
image = workflows["image-publish.yml"]
release = workflows["release.yml"]
release_publish = workflows["release-publish.yml"]
source_contract = (root / "scripts/release/verify-promotion-candidate.sh")
source_text = source_contract.read_text(encoding="utf-8") if source_contract.exists() else ""
errors: list[str] = []


def require(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text, flags=re.MULTILINE | re.DOTALL) is None:
        errors.append(message)


def forbid(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text, flags=re.MULTILINE | re.DOTALL) is not None:
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


def permission_level(permissions: dict[str, str], scope: str) -> str:
    return permissions.get(scope, permissions.get("*", "none"))


def expressions_in_run(text: str) -> list[int]:
    findings: list[int] = []
    block_indent: int | None = None
    for number, line in enumerate(text.splitlines(), start=1):
        header = re.match(r"^(\s*)(?:-\s*)?run:\s*(.*)$", line)
        if header:
            indent = len(header.group(1))
            value = header.group(2)
            if re.fullmatch(r"[|>](?:[+-][1-9]?|[1-9][+-]?)?", value):
                block_indent = indent
            else:
                block_indent = None
                if "${{" in value:
                    findings.append(number)
            continue
        if block_indent is None:
            continue
        indent = len(line) - len(line.lstrip())
        if line.strip() and indent <= block_indent:
            block_indent = None
            continue
        if "${{" in line:
            findings.append(number)
    return findings


matcher_fixture = """steps:
  - run: echo ${{ inputs.inline }}
  - run: |-
      echo ${{ inputs.literal_strip }}
  - run: >
      echo ${{ inputs.folded }}
  - run: >-
      echo ${{ inputs.folded_strip }}
  - run: |+
      echo ${{ inputs.literal_keep }}
  - run: |2-
      echo ${{ inputs.indented_strip }}
  - run: |
      echo ${{ steps.pkg.outputs.tag }}
  - run: >
      echo ${{ needs.publish.outputs.version }}
"""
if len(expressions_in_run(matcher_fixture)) != 8:
    errors.append("run-expression matcher does not cover direct or transitive expressions in every YAML scalar form")

permission_fixture = """permissions:
  actions: read
  contents: read
jobs:
  inherits:
    runs-on: ubuntu-latest
  overrides:
    runs-on: ubuntu-latest
    permissions:
      contents: read
"""
fixture_permissions = effective_job_permissions(permission_fixture)
if permission_level(fixture_permissions["inherits"], "actions") != "read":
    errors.append("effective-permission matcher does not inherit workflow permissions")
if permission_level(fixture_permissions["overrides"], "actions") != "none":
    errors.append("effective-permission matcher does not model job maps as full overrides")

concurrency_match = re.search(
    r"^concurrency:\n  group:\s*(?P<group>[^\n]+)",
    release_publish,
    flags=re.MULTILINE,
)
if concurrency_match is None:
    errors.append("release publication has no concurrency group")
else:
    concurrency_template = concurrency_match.group("group").strip()
    expected_template = "release-publish-${{ inputs.version }}"
    if concurrency_template != expected_template:
        errors.append("release publication concurrency is not keyed only by semantic version")
    else:
        def render_group(version_value: str, ref_value: str) -> str:
            return concurrency_template.replace(
                "${{ inputs.version }}", version_value
            ).replace("${{ github.ref }}", ref_value)

        tag_group = render_group("2.260830.2", "refs/tags/v2.260830.2")
        branch_group = render_group("2.260830.2", "refs/heads/dev")
        next_group = render_group("2.260830.3", "refs/tags/v2.260830.3")
        if tag_group != branch_group:
            errors.append("same-version stable and recovery publications do not serialize across refs")
        if tag_group == next_group:
            errors.append("different release versions share a concurrency group")

for name, workflow in workflows.items():
    for line in expressions_in_run(workflow):
        errors.append(f"{name}:{line} interpolates a GitHub expression directly inside a shell run value")

    if re.search(r"^permissions:\s*(?:\{\s*\})?\s*$", workflow, flags=re.MULTILINE) is None:
        errors.append(f"{name} does not declare explicit top-level token permissions")
    if re.search(r"^\s*secrets:\s*inherit\s*$", workflow, flags=re.MULTILINE):
        errors.append(f"{name} unconditionally inherits repository secrets")
    if "secrets.GITHUB_TOKEN" in workflow:
        errors.append(f"{name} uses secrets.GITHUB_TOKEN instead of the scoped github.token")

    effective_permissions = effective_job_permissions(workflow)
    for job_name, block in job_blocks(workflow).items():
        job = "\n".join(block)
        api_backed_download = (
            "actions/download-artifact@" in job
            and re.search(r"^\s*run-id:\s*", job, flags=re.MULTILINE)
            and re.search(
                r"^\s*github-token:\s*\$\{\{\s*github\.token\s*\}\}",
                job,
                flags=re.MULTILINE,
            )
        )
        if not api_backed_download:
            continue
        effective = effective_permissions[job_name]
        actions = permission_level(effective, "actions")
        if actions != "read":
            errors.append(
                f"{name}:{job_name} uses an API-backed artifact download "
                f"without effective actions: read (got {actions})"
            )

candidate_check = image.find("verify-promotion-candidate.sh")
oci_check = image.find("verify-oci-release.sh")
provenance_check = image.find("gh attestation verify")
asset_check = image.find("verify-release-assets.py")
if min(candidate_check, oci_check, provenance_check, asset_check) < 0:
    errors.append("promotion verification stages are incomplete")
elif not candidate_check < oci_check < provenance_check < asset_check:
    errors.append("promotion does not verify final build inputs, OCI identity, provenance, then release assets in order")

for token, message in (
    ("docker/build-push-action", "promotion rebuilds an image"),
    ("gh workflow run", "promotion dispatches a publisher"),
    ("gh run watch", "promotion waits on a mutating downstream publisher"),
    ("pin-production-image.sh", "promotion writes a public production pin"),
    ("git push", "promotion moves a Git ref"),
):
    if token in image:
        errors.append(message)

for path in ("deploy/Dockerfile", "package.json", "bun.lock", "packages", "apps"):
    if path not in source_text:
        errors.append(f"candidate verifier does not protect {path}")
require(source_text, r"git merge-base --is-ancestor", "candidate source is not required to be an ancestor of the final main tree")
require(source_text, r"refs/tags/v\$\{version\}\^\{commit\}", "candidate verifier does not bind the immutable version tag")
require(image, r"name:\s*Checkout immutable candidate source[\s\S]{0,500}ref:\s*\$\{\{\s*env\.CANDIDATE_SHA\s*\}\}[\s\S]{0,200}path:\s*release-candidate", "promotion does not create a separate immutable candidate checkout")
require(image, r"verify-oci-release\.sh[\s\S]{0,300}--source-dir\s+\"\$\{GITHUB_WORKSPACE\}/release-candidate\"", "OCI verifier does not run against the separate candidate checkout")

require(release, r"authorize:[\s\S]{0,200}timeout-minutes:", "release authorization network calls have no timeout")
forbid(release, r"Bare tag pushes fall\s+through to stable", "release documentation still claims bare tags publish stable")
forbid(version, r"Channel selector is dev/homolog", "version workflow keeps the orphaned channel-selector comment")
if version.endswith("\n\n"):
    errors.append("version workflow has a trailing blank line")

for name, workflow in workflows.items():
    for match in re.finditer(r"^\s*-?\s*uses:\s*([^\s#]+)", workflow, flags=re.MULTILINE):
        ref = match.group(1)
        if ref.startswith("./"):
            continue
        if re.fullmatch(r"[^@]+@[0-9a-f]{40}", ref) is None:
            errors.append(f"{name} contains mutable action or reusable-workflow ref {ref}")

require(release_publish, r"verify-release-assets\.py", "release recovery does not verify immutable asset identity")
require(release_publish, r"--verify-tag", "release publication can create an implicit unverified tag")
forbid(release_publish, r"\.well-known/|git push origin HEAD:main", "release publication mutates PR-owned public metadata")

dispatch_match = re.search(
    r"^  workflow_dispatch:\n(?P<body>.*?)(?=^concurrency:)",
    release_publish,
    flags=re.MULTILINE | re.DOTALL,
)
if dispatch_match is None:
    errors.append("release publication has no recovery dispatch contract")
else:
    require(
        dispatch_match.group("body"),
        r"^      expected_sha:\n        description:[^\n]*\n        required:\s*true\n        type:\s*string$",
        "recovery dispatch does not require an explicit expected source SHA",
    )

entry_authorization_match = re.search(
    r"- name: Reject unverified stable publish(?P<body>.*?)(?=^      - name: Resolve upstream)",
    release_publish,
    flags=re.MULTILINE | re.DOTALL,
)
if entry_authorization_match is None:
    errors.append("release publication has no entry authorization step")
else:
    entry_authorization = entry_authorization_match.group("body")
    for pattern, message in (
        (r'--version\s+"\$\{VERSION\}"', "recovery authorization is not bound to the requested version"),
        (r'--source-ref\s+"\$\{GITHUB_REF\}"', "recovery authorization is not bound to the trigger ref"),
        (r'--source-sha\s+"\$\{GITHUB_SHA\}"', "recovery authorization is not bound to the trigger SHA"),
        (r'--expected-sha\s+"\$\{EXPECTED_SHA\}"', "recovery authorization does not require the operator-approved SHA"),
    ):
        require(entry_authorization, pattern, message)

forbid(
    release_publish,
    r'EXPECTED_SHA\s*=\s*"?\$\{tag_sha\}"?',
    "release publication substitutes a remote tag for an empty expected SHA",
)
publish_step_match = re.search(
    r"- name: Create or update GitHub Release with all 12 signed assets(?P<body>.*)$",
    release_publish,
    flags=re.DOTALL,
)
if publish_step_match is None:
    errors.append("release publication asset step is missing")
else:
    publish_step = publish_step_match.group("body")
    tag_read = publish_step.find('tag_sha=$(git rev-parse "refs/tags/v${VERSION}^{commit}")')
    recovery_guard = publish_step.find('if [[ -n "${RECOVERY_RUN_ID}" ]]; then')
    recovery_tag_binding = publish_step.find('[[ "${tag_sha}" == "${GITHUB_SHA}" ]]')
    recovery_expected_binding = publish_step.find('[[ "${tag_sha}" == "${EXPECTED_SHA}" ]]')
    orchestrated_guard = publish_step.find('elif [[ -n "${EXPECTED_SHA}" ]]; then')
    if min(
        tag_read,
        recovery_guard,
        recovery_tag_binding,
        recovery_expected_binding,
        orchestrated_guard,
    ) < 0 or not (
        tag_read
        < recovery_guard
        < recovery_tag_binding
        < recovery_expected_binding
        < orchestrated_guard
    ):
        errors.append("recovery publication does not bind the exact remote tag target to both verified source SHAs")

    draft_read = publish_step.find(
        'PRE_CLOBBER_DRAFT=$(gh release view "v${VERSION}" --repo "${GITHUB_REPOSITORY}" '
        "--json isDraft --jq '.isDraft')"
    )
    draft_guard = publish_step.find('[[ "${PRE_CLOBBER_DRAFT}" == "true" ]]')
    upload = publish_step.find('gh release upload "v${VERSION}"')
    clobber = publish_step.find("--clobber", upload)
    if min(draft_read, draft_guard, upload, clobber) < 0 or not (
        draft_read < draft_guard < upload < clobber
    ):
        errors.append("mutable draft assets are not re-read and fail-closed immediately before clobber")

require(release, r"PUBLISHED_VERSION:\s*\$\{\{\s*needs\.sign-attest\.outputs\.version\s*\}\}", "release notes are not bound to the signed artifact version")
require(release, r"\[\[\s+\"\$\{REQUESTED_VERSION\}\"\s+==\s+\"\$\{PUBLISHED_VERSION\}\"\s+\]\]", "requested release version is not compared with the signed artifact version")

if errors:
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    raise SystemExit(1)
print("PASS: workflow pins, effective permissions, shell-expression boundaries, and promotion ordering")
PY
