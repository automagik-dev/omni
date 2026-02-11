# Wish: CLI — Add `wss://` TLS/Cert Error Hints for Provider Tests

**Status:** DRAFT
**Beads:** omni-vq7
**Slug:** `provider-cli-wss-tls-hints`
**Created:** 2026-02-10

---

## Summary

Improve CLI diagnostics for OpenClaw (and any future WS providers) by adding explicit hints for TLS/certificate failures when using `wss://`.

---

## Problem

Users testing a `wss://` gateway can hit:
- `DEPTH_ZERO_SELF_SIGNED_CERT`
- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
- `ERR_TLS_CERT_ALTNAME_INVALID`

Today the CLI provider test prints generic connection errors but does not give a targeted hint for cert issues.

---

## Acceptance Criteria

- [ ] `omni providers test <id>` detects TLS/cert error strings and prints a specific hint
- [ ] Hint suggests verifying cert chain, SAN/hostname, or using trusted certs in dev
- [ ] Covered by a small unit test for error-to-hint mapping

---

## Notes

Identified during independent OpenClaw provider review.
