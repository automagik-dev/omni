# Public launch readiness

This change preserves the release candidate already published as
`v2.260830.2` and turns the public main-branch path into verification only.
Production deployment authority and the canonical production digest are not
owned by this public repository.

## Immutable candidate

- Source commit: `b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031`
- Version tag: `v2.260830.2` (the tag resolves to the source commit above)
- OCI index: `ghcr.io/automagik-dev/omni-api@sha256:dba9b81cead5efacf9303ab75487a762fa100992dc2bb52741524a7a036b2da8`
- Public release timestamp: `2026-08-30T21:45:27Z`
- Protected image build inputs: `deploy/Dockerfile`, root `package.json`,
  `bun.lock`, `packages/**`, and `apps/**`

The promotion workflow has read-only permissions. It rejects a non-main or
stale invocation, a moved tag or digest, missing platforms, invalid GitHub
provenance, invalid signed release assets, non-exact npm state, or any protected
build-input difference between the candidate and the final main tree. It has no
build, tag, release, alias, repository-write, cloud, Helm, kubectl, or Argo
operation.

## Public repository ownership

The generic Helm `image.digest` renderer remains available, but the public
production pin and its writer were removed. `latest.json` and `dev.json` are
reconciled to the already-public release in the reviewed dev-to-main change;
the retired third channel pointer is removed, and release automation no longer
commits channel metadata after merge. Existing legacy runtime overlays are not
changed.

## PR #939 final-head review disposition

CodeRabbit reviewed `1ca278744fc3d389405819c594c1283895d43de5`; the PR's
final head was `b4dd27cb0e4513017de0ad69ece2a4ab03449f22`.

| Finding | Disposition and evidence |
| --- | --- |
| Image jobs lacked timeouts | Fixed/superseded: the build/classification jobs no longer exist; the single read-only verification job has `timeout-minutes: 30`. |
| `gh workflow run` stdout was parsed as a run ID | Fixed by removal: the promotion workflow contains no dispatch or `gh run watch`; it verifies existing state directly. |
| Release authorization lacked a timeout | Fixed with a finite job timeout. |
| Bare-tag comment incorrectly claimed stable fallback | Fixed: the workflow states that stable requires authorized dispatch and bare tags do not release. |
| Version channel-selector comment was orphaned | Fixed by removing the stale comment and third-channel selector. |
| Version workflow had a trailing blank line | Fixed; the file ends after its final content plus one newline. |
| Helm test duplicated release values | Superseded by the ownership correction: the test derives `Chart.appVersion`, supplies a generic valid digest, and asserts that no public production pin exists. |
| Orchestrated release plus recovery run ID lacked coverage | Fixed with a negative regression test. |
| Pin test did not set `GITHUB_OUTPUT` | Disproved at final head: `b4dd27cb` deliberately unsets runner-inherited `GITHUB_OUTPUT`, and the helper falls back to `/dev/stdout`. Extracting `scripts/release/pin-production-image{,.test}.sh` with `git archive b4dd27cb0e4513017de0ad69ece2a4ab03449f22` and running the extracted test returns exactly `PASS: race-safe production digest pin contract`. The obsolete pin and test are removed by this ownership change. |
| npm post-publish readback had no retry | Fixed with bounded retries and backoff that tolerate transient registry 404/stale reads. |
| npm downloads lacked curl bounds | Fixed with connection/total timeouts and three retries for tarball, key, and packument reads. |
| npm provenance ran only after publish | Fixed: attestation and SLSA checks run for `publish`, `repair_latest`, and `none`. |
| Shell-input contract missed YAML run forms | Fixed: the test covers inline, literal, folded, and chomping block scalars; workflows pass inputs through typed environment variables. |
| npm signing-key expiry ignored publication time | Fixed: the verifier reads the packument publication timestamp, rejects keys expired before publication, and accepts keys valid at publication time. |
| npm `latest` could move backward | Fixed: a newer `latest` is rejected with version ordering; only an older alias is repairable. |
| Detached root/merge source failed without a diagnostic | Fixed: detached repair requires exactly one parent and reports a clear source-parent error. |

All changed regression tests were first run against the merged PR baseline and
failed for the intended missing contract before the implementation was applied.

## Validation evidence

The final worktree passed the following local, non-mutating gates:

- `git diff --check`
- `bun scripts/verify-versions.ts` (24/24 versions match `2.260830.2`)
- every `scripts/release/*.test.sh`
- `scripts/ci/test-helm-image-digest.sh` with Helm `v3.16.4` pinned to the
  repository's CI checksum
- actionlint `1.7.7` against every `.github/workflows/*.yml`
- `bun run typecheck`
- `bunx biome check .`
- `bunx knip`
- `bun run build`

The build gate's generated rewrite was discarded. A final Git comparison
confirms that every protected image build input is byte-identical to
`b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031`, and the legacy HML runtime paths
are byte-identical to the merged baseline.
