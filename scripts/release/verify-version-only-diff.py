#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise SystemExit(f"version-only diff verification failed: {message}")


def git_bytes(*args: str) -> bytes:
    result = subprocess.run(("git", *args), check=False, capture_output=True)
    if result.returncode != 0:
        fail(f"git {' '.join(args)} failed")
    return result.stdout


parser = argparse.ArgumentParser()
parser.add_argument("--parent", required=True)
parser.add_argument("--source", required=True)
parser.add_argument("--expected-version", required=True)
args = parser.parse_args()
if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.expected_version) is None:
    fail("expected version is invalid")

expected_paths = {
    "package.json",
    "bun.lock",
    "apps/ui/package.json",
    "deploy/helm/omni/Chart.yaml",
    ".claude-plugin/marketplace.json",
    "plugins/omni/.claude-plugin/plugin.json",
    *{
        f"packages/{name}/package.json"
        for name in (
            "api", "channel-a2a", "channel-discord", "channel-gupshup",
            "channel-hermes", "channel-internal", "channel-sdk", "channel-slack",
            "channel-telegram", "channel-twilio-whatsapp", "channel-whatsapp",
            "channel-whatsapp-business", "cli", "core", "db", "media-processing",
            "plugin-openclaw", "sdk", "voice-client",
        )
    },
}

try:
    parent_package = json.loads(git_bytes("show", f"{args.parent}:package.json"))
    source_package = json.loads(git_bytes("show", f"{args.source}:package.json"))
except (json.JSONDecodeError, UnicodeDecodeError) as exc:
    fail(f"root package metadata is invalid: {exc}")
old_version = parent_package.get("version")
new_version = source_package.get("version")
if not isinstance(old_version, str) or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", old_version) is None:
    fail("parent version is invalid")
if new_version != args.expected_version or old_version == new_version:
    fail("source version does not match the expected version transition")

status_lines = git_bytes("diff", "--name-status", "--no-renames", args.parent, args.source).decode().splitlines()
changed_paths: set[str] = set()
for line in status_lines:
    parts = line.split("\t")
    if len(parts) != 2 or parts[0] != "M":
        fail(f"version transition contains a non-modification entry: {line}")
    changed_paths.add(parts[1])
extra = sorted(changed_paths - expected_paths)
required = {"package.json", "packages/cli/package.json"}
missing_required = sorted(required - changed_paths)
if extra or missing_required:
    fail(f"version path inventory mismatch; missing_required={missing_required}, extra={extra}")

old = old_version.encode()
new = new_version.encode()
for path in sorted(changed_paths):
    before = git_bytes("show", f"{args.parent}:{path}")
    after = git_bytes("show", f"{args.source}:{path}")
    if new not in after:
        fail(f"expected version is absent from {path}")
    if after.replace(new, old) != before:
        fail(f"{path} changes content other than exact version substitutions")

print("version_only_diff_verified=true")
