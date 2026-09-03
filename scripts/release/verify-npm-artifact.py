#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import pathlib
import re
import subprocess
import tarfile
import tempfile
from datetime import datetime
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise SystemExit(f"npm artifact verification failed: {message}")


def package_files(path: pathlib.Path) -> dict[str, tuple[int, bytes]]:
    result: dict[str, tuple[int, bytes]] = {}
    try:
        archive = tarfile.open(path, mode="r:gz")
    except (OSError, tarfile.TarError) as exc:
        fail(f"invalid npm tarball {path}: {exc}")
    with archive:
        for member in archive.getmembers():
            pure = pathlib.PurePosixPath(member.name)
            if pure.is_absolute() or ".." in pure.parts or not pure.parts or pure.parts[0] != "package":
                fail(f"unsafe npm tar member {member.name}")
            if member.isdir():
                continue
            if not member.isfile():
                fail(f"unsupported npm tar member type for {member.name}")
            handle = archive.extractfile(member)
            if handle is None:
                fail(f"could not read npm tar member {member.name}")
            relative = str(pathlib.PurePosixPath(*pure.parts[1:]))
            if not relative or relative in result:
                fail(f"duplicate or empty npm package member {member.name}")
            data = handle.read()
            if relative in {"dist/index.js", "dist/server/index.js"}:
                # Bun embeds the ephemeral checkout prefix in bundled CommonJS
                # __filename/__dirname constants. Normalize only that prefix;
                # every path after node_modules/.bun and every other byte must
                # remain exact.
                data = re.sub(
                    rb'(?<=")/[^"\r\n]*/node_modules/\.bun/',
                    b"<BUILD_ROOT>/node_modules/.bun/",
                    data,
                )
            result[relative] = (member.mode & 0o777, data)
    if not result:
        fail("npm tarball has no package files")
    return result


parser = argparse.ArgumentParser()
parser.add_argument("--expected-tarball", required=True)
parser.add_argument("--registry-tarball", required=True)
parser.add_argument("--dist-json", required=True)
parser.add_argument("--keys-json", required=True)
parser.add_argument("--packument-json", required=True)
parser.add_argument("--package", required=True)
parser.add_argument("--version", required=True)
args = parser.parse_args()
expected_tarball = pathlib.Path(args.expected_tarball)
registry_tarball = pathlib.Path(args.registry_tarball)
dist_path = pathlib.Path(args.dist_json)
keys_path = pathlib.Path(args.keys_json)
packument_path = pathlib.Path(args.packument_json)
if (
    not expected_tarball.is_file()
    or not registry_tarball.is_file()
    or not dist_path.is_file()
    or not keys_path.is_file()
    or not packument_path.is_file()
):
    fail("expected tarball, registry tarball, dist JSON, registry keys JSON, or packument JSON is missing")
if re.fullmatch(r"@[a-z0-9._-]+/[a-z0-9._-]+", args.package) is None:
    fail("package name is invalid")
if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.version) is None:
    fail("package version is invalid")
try:
    dist = json.loads(dist_path.read_text(encoding="utf-8"))
    keys_document = json.loads(keys_path.read_text(encoding="utf-8"))
    packument = json.loads(packument_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as exc:
    fail(f"invalid registry metadata JSON: {exc}")
if not isinstance(dist, dict):
    fail("registry dist metadata is not an object")
if not isinstance(keys_document, dict) or not isinstance(keys_document.get("keys"), list):
    fail("registry signing keys metadata is malformed")
if not isinstance(packument, dict) or not isinstance(packument.get("time"), dict):
    fail("registry packument publication metadata is malformed")


def timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        fail(f"{label} timestamp is missing")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail(f"{label} timestamp is invalid")
    if parsed.tzinfo is None:
        fail(f"{label} timestamp has no timezone")
    return parsed


publication_time = timestamp(packument["time"].get(args.version), "package publication")
registry_data = registry_tarball.read_bytes()
expected_integrity = "sha512-" + base64.b64encode(hashlib.sha512(registry_data).digest()).decode()
expected_shasum = hashlib.sha1(registry_data).hexdigest()
if dist.get("integrity") != expected_integrity:
    fail("downloaded registry artifact does not match registry integrity")
if dist.get("shasum") != expected_shasum:
    fail("downloaded registry artifact does not match registry shasum")
signatures = dist.get("signatures")
if not isinstance(signatures, list) or not signatures:
    fail("registry metadata has no package signature")
for signature in signatures:
    if not isinstance(signature, dict):
        fail("registry package signature is malformed")
    if re.fullmatch(r"SHA256:[A-Za-z0-9+/=]+", str(signature.get("keyid", ""))) is None:
        fail("registry package signature key ID is malformed")
    if not isinstance(signature.get("sig"), str) or not signature["sig"]:
        fail("registry package signature value is missing")
keys = {
    key.get("keyid"): key
    for key in keys_document["keys"]
    if isinstance(key, dict) and isinstance(key.get("keyid"), str)
}
payload = f"{args.package}@{args.version}:{expected_integrity}".encode()
signature_verified = False
expired_before_publication = False
for signature in signatures:
    key = keys.get(signature["keyid"])
    if not isinstance(key, dict):
        continue
    if key.get("keytype") != "ecdsa-sha2-nistp256" or key.get("scheme") != "ecdsa-sha2-nistp256":
        continue
    expires = key.get("expires")
    if expires is not None:
        expiry_time = timestamp(expires, f"signing key {signature['keyid']} expiry")
        if expiry_time < publication_time:
            expired_before_publication = True
            continue
    try:
        public_der = base64.b64decode(str(key.get("key", "")), validate=True)
        signature_der = base64.b64decode(signature["sig"], validate=True)
    except ValueError:
        continue
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = pathlib.Path(temp_dir)
        (temp / "key.der").write_bytes(public_der)
        (temp / "signature.der").write_bytes(signature_der)
        convert = subprocess.run(
            ("openssl", "pkey", "-pubin", "-inform", "DER", "-in", str(temp / "key.der"), "-out", str(temp / "key.pem")),
            check=False,
            capture_output=True,
        )
        if convert.returncode != 0:
            continue
        verify = subprocess.run(
            ("openssl", "dgst", "-sha256", "-verify", str(temp / "key.pem"), "-signature", str(temp / "signature.der")),
            input=payload,
            check=False,
            capture_output=True,
        )
        if verify.returncode == 0:
            signature_verified = True
            break
if not signature_verified:
    if expired_before_publication:
        fail("registry signing key expired before package publication")
    fail("registry package signature did not verify against an authoritative npm key")
if package_files(expected_tarball) != package_files(registry_tarball):
    fail("registry package contents differ from the exact locally built source package")
print("npm_artifact_verified=true")
