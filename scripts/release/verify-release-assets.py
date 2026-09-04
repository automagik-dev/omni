#!/usr/bin/env python3
import argparse
import base64
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
    for suffix in ("", ".bundle", ".provenance.json")
}
assets = release["assets"]
names = [asset.get("name") for asset in assets if isinstance(asset, dict)]
if len(assets) != 12 or len(names) != 12 or set(names) != expected:
    fail("public release inventory does not match the exact signed 12-asset contract")
local_digests: dict[str, str] = {}
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
    local_digests[name] = local_digest


def verify_provenance_bundle(name: str) -> None:
    """The .provenance.json asset is the Sigstore bundle written by
    actions/attest-build-provenance (`bundle-path`): one JSON object holding
    `verificationMaterial` plus a DSSE envelope whose in-toto statement names
    the tarball digest as its only subject. Signature and identity are checked
    by `gh attestation verify --bundle`; this binds the file to the tarball
    bytes that were just digest-verified, so a bundle for another artifact or a
    non-bundle file cannot ride along as a release asset."""
    tarball_name = name.removesuffix(".provenance.json")
    tarball_digest = local_digests.get(tarball_name)
    if tarball_digest is None:
        fail(f"provenance bundle has no verified tarball: {name}")
    try:
        bundle = json.loads((dist / name).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail(f"provenance bundle is not a single JSON document: {name}: {exc}")
    if not isinstance(bundle, dict) or not isinstance(bundle.get("verificationMaterial"), dict):
        fail(f"provenance bundle has no verificationMaterial: {name}")
    envelope = bundle.get("dsseEnvelope")
    if not isinstance(envelope, dict) or envelope.get("payloadType") != "application/vnd.in-toto+json":
        fail(f"provenance bundle has no in-toto DSSE envelope: {name}")
    try:
        statement = json.loads(base64.b64decode(envelope.get("payload") or "", validate=True))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        fail(f"provenance bundle payload is not an in-toto statement: {name}")
    subjects = statement.get("subject") if isinstance(statement, dict) else None
    if not isinstance(subjects, list) or len(subjects) != 1 or not isinstance(subjects[0], dict):
        fail(f"provenance statement does not name exactly one subject: {name}")
    subject_digest = subjects[0].get("digest")
    if not isinstance(subject_digest, dict) or "sha256:" + str(subject_digest.get("sha256")) != tarball_digest:
        fail(f"provenance statement subject does not match the tarball digest: {name}")


for name in sorted(local_digests):
    if name.endswith(".provenance.json"):
        verify_provenance_bundle(name)

print("release_assets_verified=true")
