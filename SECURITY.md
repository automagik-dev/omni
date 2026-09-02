# Security Policy — @automagik/omni

## Reporting a Vulnerability

Use GitHub Security Advisories for private vulnerability reports:
`https://github.com/automagik-dev/omni/security/advisories/new`.
Include a description of the issue and steps to reproduce. We will
acknowledge within 2 business days and target a fix window proportional to
severity. Do NOT file public issues for security-sensitive reports.

## Release Signing — Pinned Identity (cosign keyless)

`@automagik/omni` release tarballs are signed with **cosign keyless OIDC**
via GitHub Actions. There is no long-lived signing key — the pin is the
three-value tuple below, witnessed across four channels in this repo. Any
single-channel edit is rejected at PR-merge time by the
`signing-identity-pin` workflow.

### Canonical Pin

```
certificate-identity-regexp: ^https://github.com/automagik-dev/omni/.github/workflows/sign-attest.yml@refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$
certificate-oidc-issuer:     https://token.actions.githubusercontent.com
provenance source-uri:       github.com/automagik-dev/omni
```

### Channels (all four MUST agree byte-for-byte)

1. **`SECURITY.md`** — this file, repo root
2. **`.well-known/security.txt`** — RFC 9116 mirror at `/.well-known/security.txt` on the project site
3. **`.github/ISSUE_TEMPLATE/signing-key-fingerprint.md`** — out-of-band issue template
4. **`.github/cosign.pub`** — NO-KEY sentinel (no public key — keyless contract)

### Verification (operators)

```bash
# Sigstore bundle (cosign keyless)
cosign verify-blob \
  --bundle omni-<version>-<platform>.tar.gz.bundle \
  --certificate-identity 'https://github.com/automagik-dev/omni/.github/workflows/sign-attest.yml@refs/tags/v<version>' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  omni-<version>-<platform>.tar.gz

# GitHub-native build provenance — offline, from the shipped bundle asset.
# Add `--source-digest <commit>` to bind it to the exact release commit
# (`git rev-parse v<version>^{commit}`).
gh attestation verify omni-<version>-<platform>.tar.gz \
  --bundle omni-<version>-<platform>.tar.gz.provenance.json \
  --repo automagik-dev/omni \
  --signer-workflow automagik-dev/omni/.github/workflows/sign-attest.yml

# GitHub Attestations API — online lookup by tarball digest
gh attestation verify omni-<version>-<platform>.tar.gz --owner automagik-dev
```

Every release ships three assets per platform: the tarball, the cosign
keyless Sigstore bundle (`.bundle`), and the GitHub-native build-provenance
attestation (`.provenance.json`). The `.provenance.json` file is the Sigstore
bundle written by `actions/attest-build-provenance` in `sign-attest.yml` — a
DSSE-wrapped in-toto statement whose only subject is the tarball's SHA-256 —
so `gh attestation verify --bundle` proves the provenance without contacting
the GitHub Attestations API. The same attestation is also registered in that
API for the online form above. The workflow attests each tarball in-repo with
the SHA-pinned action rather than a remote reusable workflow: the repository
requires every action to be pinned to a full-length commit SHA, and a remote
reusable workflow's nested action refs are outside that control.

### Consumer Trust

`pgserve verify --slug omni` (pgserve v3+) verifies omni release tarballs
against this exact certificate identity. Downstream trust lists anchor on
this regex literally — renaming the `sign-attest.yml` workflow file breaks
the trust loop.

### Rotation

Rotating the signing identity (workflow rename, repo rename, OIDC issuer
change, source-URI rebind) requires:

1. Two project maintainers landing a single PR that updates all four
   witnesses AND `scripts/check-fingerprint-pinning.sh`.
2. A new `.github/ISSUE_TEMPLATE/signing-key-fingerprint.md` filing dated
   `SIGNING_CERT_IDENTITY_YYYYMMDD` that supersedes the previous pin.
3. Coordination with downstream consumers (notably pgserve's trust-list)
   to land the matching regex update in lockstep.

Any drift in fewer than all four channels is treated as a compromise —
operators should stop using the latest release until the four channels
re-converge.
