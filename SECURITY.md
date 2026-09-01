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

# SLSA L3 provenance
slsa-verifier verify-artifact omni-<version>-<platform>.tar.gz \
  --provenance-path omni-<version>-<platform>.tar.gz.intoto.jsonl \
  --source-uri github.com/automagik-dev/omni

# GitHub Attestations API
gh attestation verify omni-<version>-<platform>.tar.gz --owner automagik-dev
```

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
