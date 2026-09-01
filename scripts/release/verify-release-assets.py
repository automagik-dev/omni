#!/usr/bin/env python3
import argparse
import hashlib
import json
import pathlib
import re
import sys
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise SystemExit(f"release asset verification failed: {message}")


parser = argparse.ArgumentParser()
parser.add_argument("--version", required=True)
parser.add_argument("--release-json", required=True)
parser.add_argument("--dist", required=True)
args = parser.parse_args()

if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.version) is None:
    fail("version is not a numeric dotted version")
release_path = pathlib.Path(args.release_json)
dist = pathlib.Path(args.dist)
if not release_path.is_file() or not dist.is_dir():
    fail("release JSON or dist directory is missing")
release: object
try:
    release = json.loads(release_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as exc:
    fail(f"invalid release JSON: {exc}")
if not isinstance(release, dict) or not isinstance(release.get("assets"), list):
    fail("release JSON has no asset array")

expected = {
    f"omni-{args.version}-{platform}.tar.gz{suffix}"
    for platform in ("linux-x64-glibc", "linux-x64-musl", "linux-arm64", "darwin-arm64")
    for suffix in ("", ".bundle", ".intoto.jsonl")
}
assets = release["assets"]
names = [asset.get("name") for asset in assets if isinstance(asset, dict)]
if len(assets) != 12 or len(names) != 12 or set(names) != expected:
    fail("public release inventory does not match the exact signed 12-asset contract")
for asset in assets:
    name = asset["name"]
    remote_digest = asset.get("digest") or ""
    path = dist / name
    if not path.is_file():
        fail(f"local signed asset is missing: {name}")
    local_digest = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    if re.fullmatch(r"sha256:[0-9a-f]{64}", remote_digest) is None:
        fail(f"public asset has no immutable sha256 digest: {name}")
    if remote_digest != local_digest:
        fail(f"public asset digest mismatch: {name}")

print("release_assets_verified=true")
