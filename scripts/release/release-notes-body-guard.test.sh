#!/usr/bin/env bash
# Stubbed run of release.yml "Update release body with changelog": a rejected body (for example
# GitHub's HTTP 422 "body is too long") must warn and exit 0, never fail the release.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 - "${ROOT}" <<'PY'
import os
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1])
STEP = "      - name: Update release body with changelog"
lines = (root / ".github/workflows/release.yml").read_text(encoding="utf-8").splitlines()
errors: list[str] = []


def step_run_block() -> tuple[str, list[str]]:
    start = lines.index(STEP)
    step_indent = len(STEP) - len(STEP.lstrip())
    step: list[str] = []
    for line in lines[start + 1 :]:
        if line.strip() and len(line) - len(line.lstrip()) <= step_indent:
            break
        step.append(line)
    run_at = next(i for i, line in enumerate(step) if line.strip() == "run: |")
    run_indent = len(step[run_at]) - len(step[run_at].lstrip())
    body: list[str] = []
    for line in step[run_at + 1 :]:
        if line.strip() and len(line) - len(line.lstrip()) <= run_indent:
            break
        body.append(line)
    body_indent = min(len(line) - len(line.lstrip()) for line in body if line.strip())
    return "\n".join(line[body_indent:] for line in body) + "\n", step[:run_at]


script, step_head = step_run_block()
if not any(line.strip() == "NOTES_FILE: /tmp/release-notes.md" for line in step_head):
    errors.append("the edit step no longer reads the generator output through NOTES_FILE=/tmp/release-notes.md")
if "continue-on-error" in "\n".join(step_head):
    errors.append("the edit step must handle the failure itself, not paint the step red with continue-on-error")

FAKE_GH = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${FAKE_GH_CALLS}"
case "${FAKE_GH_MODE}" in
  reject)
    echo 'HTTP 422: Validation Failed (https://api.github.com/repos/o/r/releases/1)' >&2
    echo 'body is too long (maximum is 125000 characters)' >&2
    exit 1
    ;;
  ok) exit 0 ;;
esac
exit 2
"""


def run_case(mode: str, notes: str) -> tuple[subprocess.CompletedProcess[str], list[str], Path]:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "bin").mkdir()
        gh = work / "bin/gh"
        gh.write_text(FAKE_GH, encoding="utf-8")
        gh.chmod(0o755)
        step = work / "step.sh"
        step.write_text(script, encoding="utf-8")
        notes_file = work / "release-notes.md"
        notes_file.write_text(notes, encoding="utf-8")
        calls = work / "gh-calls"
        calls.touch()
        env = {
            "PATH": f"{work / 'bin'}:{os.environ['PATH']}",
            "GH_TOKEN": "test-token",
            "RELEASE_TAG": "v9.9.9",
            "NOTES_FILE": str(notes_file),
            "FAKE_GH_MODE": mode,
            "FAKE_GH_CALLS": str(calls),
        }
        # GitHub Actions runs `shell: bash` steps as `bash --noprofile --norc -eo pipefail {0}`.
        result = subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(step)],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        recorded = calls.read_text(encoding="utf-8").splitlines()
        return result, recorded, notes_file


def check(name: str, condition: bool, detail: str) -> None:
    if not condition:
        errors.append(f"{name}: {detail}")


result, calls, notes_file = run_case("reject", "## notes\n")
check("422", result.returncode == 0, f"step exited {result.returncode}: {result.stdout}{result.stderr}")
warnings = [line for line in result.stdout.splitlines() if line.startswith("::warning::")]
check("422", len(warnings) == 1, f"expected one ::warning:: line, got {warnings!r}")
check(
    "422",
    bool(warnings) and "gh release edit failed for v9.9.9 (exit 1)" in warnings[0]
    and "HTTP 422: Validation Failed" in warnings[0]
    and "body is too long (maximum is 125000 characters)" in warnings[0],
    f"warning does not carry the reason on one line: {warnings!r}",
)
check("422", "Updated release body" not in result.stdout, "claimed success after a rejected edit")
check("422", len(calls) == 1 and calls[0].startswith("release edit v9.9.9 --notes-file "), f"gh calls: {calls!r}")

result, calls, notes_file = run_case("ok", "## notes\n")
check("ok", result.returncode == 0, f"step exited {result.returncode}: {result.stderr}")
check("ok", "Updated release body for v9.9.9" in result.stdout, f"stdout: {result.stdout!r}")
check("ok", "::warning::" not in result.stdout, f"unexpected warning: {result.stdout!r}")
check("ok", calls == [f"release edit v9.9.9 --notes-file {notes_file}"], f"gh calls: {calls!r}")

result, calls, _ = run_case("ok", "")
check("empty", result.returncode == 0, f"step exited {result.returncode}: {result.stderr}")
check("empty", "produced empty notes; leaving the placeholder body in place" in result.stdout, f"stdout: {result.stdout!r}")
check("empty", calls == [], f"gh was called for empty notes: {calls!r}")

if errors:
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    sys.exit(1)
print("release notes body guard: 3 cases passed")
PY
