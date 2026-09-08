#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-release-assets.py"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
VERSION=2.260830.2
PLATFORMS=(linux-x64-glibc linux-x64-musl linux-arm64 darwin-arm64)

# Build a dist/ tree shaped like sign-attest.yml's upload: tarball + cosign
# bundle + GitHub-native provenance bundle (a Sigstore bundle JSON whose DSSE
# payload is an in-toto statement naming the tarball digest as its subject).
# Optional args: subject-digest override, provenance-file body override.
make_dist() {
  local dir="$1" subject_override="${2:-}" body_override="${3:-}"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  local platform
  for platform in "${PLATFORMS[@]}"; do
    printf 'omni-%s-%s.tar.gz\n' "${VERSION}" "${platform}" > "${dir}/omni-${VERSION}-${platform}.tar.gz"
    printf 'cosign-bundle\n' > "${dir}/omni-${VERSION}-${platform}.tar.gz.bundle"
  done
  python3 - "${dir}" "${VERSION}" "${subject_override}" "${body_override}" "${PLATFORMS[@]}" <<'PY'
import base64, hashlib, json, pathlib, sys
dist, version, subject_override, body_override = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
for platform in sys.argv[5:]:
    tarball = dist / f"omni-{version}-{platform}.tar.gz"
    digest = subject_override or hashlib.sha256(tarball.read_bytes()).hexdigest()
    statement = {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{"name": tarball.name, "digest": {"sha256": digest}}],
        "predicateType": "https://example.invalid/build-provenance",
        "predicate": {},
    }
    bundle = {
        "mediaType": "application/vnd.dev.sigstore.bundle.v0.3+json",
        "verificationMaterial": {"certificate": {"rawBytes": "MIIB"}, "tlogEntries": []},
        "dsseEnvelope": {
            "payload": base64.b64encode(json.dumps(statement).encode()).decode(),
            "payloadType": "application/vnd.in-toto+json",
            "signatures": [{"sig": "c2ln"}],
        },
    }
    body = body_override if body_override else json.dumps(bundle) + "\n"
    (dist / f"{tarball.name}.provenance.json").write_text(body, encoding="utf-8")
PY
}

make_release_json() {
  python3 - "$1" "$2" <<'PY'
import hashlib, json, pathlib, sys
dist = pathlib.Path(sys.argv[1])
assets = []
for path in sorted(dist.iterdir()):
    assets.append({"name": path.name, "digest": "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()})
json.dump({"draft": False, "prerelease": False, "assets": assets}, open(sys.argv[2], "w", encoding="utf-8"))
PY
}

make_dist "${work}/dist"
make_release_json "${work}/dist" "${work}/release.json"
"${SCRIPT}" --version "${VERSION}" --release-json "${work}/release.json" --dist "${work}/dist"

python3 - "${work}/release.json" "${work}/bad.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
data["assets"][0]["digest"] = "sha256:" + "0" * 64
json.dump(data, open(sys.argv[2], "w", encoding="utf-8"))
PY
if "${SCRIPT}" --version "${VERSION}" --release-json "${work}/bad.json" --dist "${work}/dist"; then
  fail "mismatched public asset digest was accepted"
fi

python3 - "${work}/release.json" "${work}/missing.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
data["assets"].pop()
json.dump(data, open(sys.argv[2], "w", encoding="utf-8"))
PY
if "${SCRIPT}" --version "${VERSION}" --release-json "${work}/missing.json" --dist "${work}/dist"; then
  fail "incomplete public asset inventory was accepted"
fi

# The retired SLSA-generator layout (.intoto.jsonl) is not the signed contract.
make_dist "${work}/legacy"
for platform in "${PLATFORMS[@]}"; do
  mv "${work}/legacy/omni-${VERSION}-${platform}.tar.gz.provenance.json" \
     "${work}/legacy/omni-${VERSION}-${platform}.tar.gz.intoto.jsonl"
done
make_release_json "${work}/legacy" "${work}/legacy.json"
if "${SCRIPT}" --version "${VERSION}" --release-json "${work}/legacy.json" --dist "${work}/legacy"; then
  fail "retired .intoto.jsonl provenance inventory was accepted"
fi

# A provenance asset that is not a Sigstore bundle (no DSSE envelope) is
# rejected even when its bytes match the public release digest.
make_dist "${work}/plain" "" '{"verificationMaterial":{},"note":"not a bundle"}'
make_release_json "${work}/plain" "${work}/plain.json"
if "${SCRIPT}" --version "${VERSION}" --release-json "${work}/plain.json" --dist "${work}/plain"; then
  fail "provenance asset without an in-toto DSSE envelope was accepted"
fi

# A well-formed bundle attesting some other artifact's digest is rejected.
make_dist "${work}/foreign" "$(printf 'f%.0s' {1..64})"
make_release_json "${work}/foreign" "${work}/foreign.json"
if "${SCRIPT}" --version "${VERSION}" --release-json "${work}/foreign.json" --dist "${work}/foreign"; then
  fail "provenance bundle for a different subject digest was accepted"
fi

printf 'PASS: immutable public GitHub release asset contract\n'
