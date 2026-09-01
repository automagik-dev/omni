#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "${ROOT}" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
paths = {
    name: root / ".github/workflows" / name
    for name in (
        "version.yml",
        "image-publish.yml",
        "release.yml",
        "release-publish.yml",
        "build-tarballs.yml",
        "sign-attest.yml",
        "signing-identity-pin.yml",
    )
}
workflows = {name: path.read_text(encoding="utf-8") for name, path in paths.items()}
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


def inputs_in_run(text: str) -> list[int]:
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
                if "${{ inputs." in value:
                    findings.append(number)
            continue
        if block_indent is None:
            continue
        indent = len(line) - len(line.lstrip())
        if line.strip() and indent <= block_indent:
            block_indent = None
            continue
        if "${{ inputs." in line:
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
"""
if len(inputs_in_run(matcher_fixture)) != 6:
    errors.append("run-input matcher does not cover inline, literal, folded, or chomping YAML forms")
for name, workflow in workflows.items():
    for line in inputs_in_run(workflow):
        errors.append(f"{name}:{line} interpolates an input directly inside a shell run value")

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

if errors:
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    raise SystemExit(1)
print("PASS: promotion-only verification ordering contract")
PY
