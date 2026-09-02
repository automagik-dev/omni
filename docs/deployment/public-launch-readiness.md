# Public launch readiness

This change preserves the release candidate already published as
`v2.260902.5` and turns the public main-branch path into verification only.
Production deployment authority and the canonical production digest are not
owned by this public repository.

## Immutable candidate

- Source commit: `ac415b97fe2a5657f7d3203bb0394eb365a97274`
- Version tag: `v2.260902.5` (the tag resolves to the source commit above)
- OCI index: `ghcr.io/automagik-dev/omni-api@sha256:aafa65b3f0f96381365a955444dd7f815ab461f09c5ce1fb1f735a1be85e565d`
- Public release timestamp: `2026-09-02T21:48:41Z`
- Protected image build inputs: `deploy/Dockerfile`,
  `deploy/Dockerfile.dockerignore`, root `package.json`, `bun.lock`,
  `packages/**`, and `apps/**` (the list in
  `scripts/release/verify-promotion-candidate.sh` is authoritative)

The promotion workflow has read-only permissions. It rejects a non-main or
stale invocation, a moved tag or digest, missing platforms, invalid GitHub
provenance, invalid signed release assets, non-exact npm state, or any protected
build-input difference between the candidate and the final main tree. It has no
build, tag, release, alias, repository-write, cloud, Helm, kubectl, or Argo
operation.

## Candidate minting

The read-only promotion above verifies a candidate; it cannot create one. New
candidates are minted by the dispatch-only `.github/workflows/image-build.yml`
("Mint Release Candidate"), which is also the orchestrator identity that the
stable Release (`release.yml` `authorize`), `release-publish.yml`, and the
stable npm publisher (`version.yml` `publish-stable`) require: each of them
verifies an in-progress `image-build.yml` run bound to the candidate SHA and an
OCI attestation signed by `image-build.yml`.

1. An operator cuts a candidate tag:
   `gh workflow run version.yml --ref dev -f candidate=true`. This bumps the
   version and cuts `vX` on `dev`, but skips both the npm `next` publish and
   the `release.yml` dev-prerelease dispatch so the tag stays reserved for
   `image-build.yml`. npm trusted publishing (OIDC) can only `npm publish`,
   never move a dist-tag, so the version must stay unpublished until the
   mint's stable step runs `npm publish --tag latest` through OIDC.
   Merged-PR bumps (and dispatches without `candidate=true`) publish npm
   `next` and a dev prerelease at their tag and are never mintable: a tag's
   channel classification is immutable
   (`verify-release-state.py --phase existing`), so `finalize` refuses a tag
   that already carries a public prerelease with
   `a dev prerelease already exists at vX; this tag cannot become stable`.
2. An operator dispatches the mint at that exact tag:
   `gh workflow run image-build.yml --ref refs/tags/vX -f version=X`.
   `build-push` refuses any non-dispatch entry, a ref other than
   `refs/tags/vX`, a tag that does not resolve to the dispatched SHA, a
   package/chart version that differs from `X`, or an already-published
   `ghcr.io/automagik-dev/omni-api:vX` alias; then it builds the
   `linux/amd64,linux/arm64` OCI index, pushes only the `vX` alias, and
   registers GitHub provenance. `finalize` independently re-verifies the digest,
   platforms, and signer identity, requires the active immutable `v*` tag
   ruleset, waits until no `release.yml` run at the tag is queued or in
   progress, refuses a dev prerelease at the tag, dispatches `release.yml`
   (`channel=stable`) and `version.yml` (`stable_publish_only=true`) at the
   same tag, and waits for both. It never creates or moves a tag, pushes a
   branch, or writes a production pin.
3. The run prints `CANDIDATE_VERSION=`, `CANDIDATE_SHA=`, `CANDIDATE_DIGEST=`,
   and `RELEASE_PUBLISHED_AT=`. A reviewed commit copies those values into
   `image-publish.yml`, `.well-known/latest.json` and `.well-known/dev.json`,
   `deploy/helm/omni/values.yaml` `image.tag`, the contract test pins
   (`scripts/release/release-workflow-contract.test.sh`), and the upgrade
   runbook/rehearsal.
4. The `dev` → `main` promotion PR carries that commit; on merge,
   `image-publish.yml` verifies the pinned candidate read-only.

Stranded mint recovery: if `finalize` fails after `build-push` succeeded (the
ruleset check, a run-resolution timeout, a concurrent dispatch, or a failed
`release.yml` run), a fresh `image-build.yml` dispatch is refused by design
because the `vX` alias now exists. Recover with "Re-run failed jobs" on the
SAME run: it keeps `GITHUB_RUN_ID` (the `orchestrator_run_id` the stable
publishers re-verify), the `build-push` outputs, and the `in_progress` state
those publishers require.

Both `image-build.yml` jobs run in the `release` environment. The `release`
environment must be configured with required reviewers before the first mint,
and its deployment tag policy must allow `v*` tags (both jobs are dispatched
on a tag ref). The active `v*` tag ruleset must keep its `update` and
`deletion` rules with no bypass actors; do not add a `creation` rule, because
`scripts/release/verify-tag-ruleset.py` rejects bypass actors and
`version.yml` must still be able to push the candidate tag. Until the
environment is protected, any write collaborator who can dispatch the
workflow can publish a stable release and move npm `latest`.

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
| Helm test duplicated release values | Superseded by the ownership correction: the test binds the chart's default `image.tag` to the verified public candidate in `.well-known/latest.json` (decoupled from `Chart.appVersion`, which is stamped on every dev bump although no image is built until an operator dispatches `image-build.yml` at that tag), supplies a generic valid digest, and asserts that no public production pin exists. |
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

## FIX-FIRST supply-chain remediation

The independent final-head review of `0db5804e93b97afc67be570a40a37b631d71ee8b`
identified four additional blockers. They are closed as follows:

- The final `main` checkout remains the root control tree, while
  `image-publish.yml` creates a second `release-candidate` checkout pinned to
  the candidate SHA (`ac415b97fe2a5657f7d3203bb0394eb365a97274` for
  `v2.260902.5`; `b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031` when this
  remediation landed for `v2.260830.2`). The root-owned OCI verifier now
  requires an explicit source directory and changes into that historical
  checkout before checking `HEAD`, the immutable tag, package/chart versions,
  and the registry alias. Its integration fixture executes final control code
  from a different Git checkout and failed with usage status 2 before the new
  source-context contract was implemented.
- Release notes now derive their tag exclusively from the version emitted by
  the signing workflow after publication completes. A dispatch-supplied version
  must be numeric and exactly equal that signed/published version. No GitHub
  expression is interpolated into shell source anywhere in the workflow set;
  values cross the shell boundary only through step environments. The policy
  fixture covers inline, literal, folded, chomping, direct-input, step-output,
  and job-output expressions.
- Every action and reusable-workflow reference in every `.yml` or `.yaml`
  workflow is audited for a 40-character commit pin. Commitlint now uses
  [`actions/checkout` v4.3.1 at `34e1148…`](https://github.com/actions/checkout/commit/34e114876b0b11c390a56381ad16ebd13914f8d5)
  and the peeled
  [`wagoid/commitlint-github-action` v6.2.1 commit `b948419…`](https://github.com/wagoid/commitlint-github-action/commit/b948419dd99f3fd78a6548d48f94e3df7f6bf3ed).
- Every workflow declares explicit top-level permissions; write grants are
  job-local. Checkout credentials are not persisted. The three reusable calls
  no longer use `secrets: inherit`, and called workflows use the scoped
  `github.token` for artifact access instead of requesting inherited secrets.

The TDD policy and integration changes were run before workflow implementation:
the candidate-context fixture failed because `--source-dir` was absent, the
workflow contract failed because no candidate checkout existed, and the
repository-wide policy rejected the transitive release output, both mutable
Commitlint refs, missing permissions, inherited secrets, and every other shell
expression exposed by expanding the audit to all workflows.

### Zizmor classification

Zizmor `1.29.0` reports zero high, medium, or low findings. Its sole remaining
result is the informational `use-trusted-publishing` recommendation for the
manual SDK publish. The workflow documents that the SDK package does not yet
have an npm trusted-publisher entry and therefore keeps its existing narrowly
scoped `NPM_TOKEN` path; npm's
[`Trusted publishing` documentation](https://docs.npmjs.com/trusted-publishers/)
confirms that an npm-side workflow trust relationship must be configured before
OIDC publication can authenticate. Creating that external setting is outside
this repository-only, no-settings run, so the informational migration note is
classified as a future operational hardening item rather than an unresolved
repository finding.

## Validation evidence

The final worktree passed the following local, non-mutating gates:

- `git diff --check` — clean except for the intentional trailing-whitespace
  fixture inside `scripts/release/stable-release-order.test.sh` (the
  `run: |  ` block-scalar case of the run-expression matcher self-test), which
  is exempt by design
- `bun scripts/verify-versions.ts` — every tracked version field agrees with
  `packages/cli/package.json`. The value itself follows each dev bump (it was
  `2.260830.2` when this document was written and is `2.260902.5` at the
  2026-09-02 candidate revision), so it is not a fixed claim of this
  document; the immutable candidate above is `v2.260902.5`
- every `scripts/release/*.test.sh`
- `scripts/ci/test-helm-image-digest.sh` with Helm `v3.16.4` pinned to the
  repository's CI checksum
- actionlint `1.7.7` against every `.github/workflows/*.yml`
- zizmor `1.29.0` against the complete workflow directory (one informational
  SDK trusted-publishing migration note; zero low/medium/high findings)
- `bun run typecheck`
- `bunx biome check .`
- `bunx knip`
- `bun run build`

The build gate's generated rewrite was discarded. A final Git comparison
confirms that every protected image build input is byte-identical to
`ac415b97fe2a5657f7d3203bb0394eb365a97274`, and the legacy HML runtime paths
are byte-identical to the merged baseline.
