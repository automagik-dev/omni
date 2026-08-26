#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RELEASE_COMPONENTS = [
  'npm:@automagik/omni',
  'helm:omni',
  'archive:linux-x64-glibc',
  'archive:linux-x64-musl',
  'archive:linux-arm64',
  'archive:darwin-arm64',
  'oci:omni-api',
  'oci:autopg',
  'oci:omni-admin-ui',
] as const;

export type ReleaseChannel = 'dev' | 'stable';
export type ReleaseMode = 'build' | 'promote';
export interface ReleaseBoundary {
  version: string;
  channel: ReleaseChannel;
  mode: ReleaseMode;
  sourceTag: string;
  sourceSha: string;
  tagCommitSha: string;
  authorizationSha: string;
  sourceTree: string;
  authorizationTree: string;
  recovery?: boolean;
  recoveryEnvironment?: string;
}

const VERSION_PATTERN = /^2\.\d{6}\.[1-9]\d*$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function validateReleaseBoundary(boundary: ReleaseBoundary): string[] {
  const errors: string[] = [];
  if (!VERSION_PATTERN.test(boundary.version)) errors.push('version must be a dated Omni version');
  if (boundary.sourceTag !== `v${boundary.version}`) errors.push('source tag must exactly match version');
  for (const [name, value] of [
    ['source SHA', boundary.sourceSha],
    ['tag commit SHA', boundary.tagCommitSha],
    ['authorization SHA', boundary.authorizationSha],
    ['source tree', boundary.sourceTree],
    ['authorization tree', boundary.authorizationTree],
  ] as const) {
    if (!SHA_PATTERN.test(value)) errors.push(`${name} must be a full lowercase SHA`);
  }
  if (boundary.tagCommitSha !== boundary.sourceSha) errors.push('tag must resolve to recorded source SHA');
  if (
    (boundary.mode === 'build' && boundary.channel !== 'dev') ||
    (boundary.mode === 'promote' && boundary.channel !== 'stable')
  ) {
    errors.push('mode and channel do not form a supported transition');
  }
  if (boundary.mode === 'promote' && boundary.sourceTree !== boundary.authorizationTree) {
    errors.push('promotion tree must exactly equal source tag tree');
  }
  if (boundary.recovery && boundary.recoveryEnvironment !== 'release-recovery') {
    errors.push('manual recovery requires the release-recovery environment');
  }
  return errors;
}

type Workflow = Record<string, any>;
export type WorkflowSourceOverrides = Partial<Record<string, string>>;
const paths = [
  '.github/workflows/version.yml',
  '.github/workflows/release.yml',
  '.github/workflows/build-tarballs.yml',
  '.github/workflows/sign-attest.yml',
  '.github/workflows/release-publish.yml',
] as const;

function parseWorkflow(path: string, source: string, errors: string[]): Workflow {
  try {
    const parsed = Bun.YAML.parse(source);
    if (!parsed || typeof parsed !== 'object') throw new Error('document is not a mapping');
    return parsed as Workflow;
  } catch (error) {
    errors.push(`${path}: invalid YAML: ${String(error)}`);
    return {};
  }
}

function requireValue(errors: string[], path: string, actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${path}: ${label} must be ${JSON.stringify(expected)}`);
  }
}

function jobStep(job: any, name: string): any | undefined {
  return job?.steps?.find((step: any) => step?.name === name);
}

function requireRunMarkers(
  errors: string[],
  path: string,
  job: any,
  stepName: string,
  markers: string[],
) {
  const step = jobStep(job, stepName);
  if (!step || typeof step.run !== 'string') {
    errors.push(`${path}: job step ${JSON.stringify(stepName)} must exist with a run script`);
    return;
  }
  for (const marker of markers) {
    if (!step.run.includes(marker)) {
      errors.push(`${path}: step ${JSON.stringify(stepName)} is missing ${JSON.stringify(marker)}`);
    }
  }
}

export function verifyWorkflowContracts(
  root = join(import.meta.dir, '..'),
  overrides: WorkflowSourceOverrides = {},
): string[] {
  const errors: string[] = [];
  const docs = Object.fromEntries(
    paths.map((path) => {
      const source = overrides[path] ?? readFileSync(join(root, path), 'utf8');
      return [path, parseWorkflow(path, source, errors)];
    }),
  ) as Record<(typeof paths)[number], Workflow>;

  const versionPath = '.github/workflows/version.yml';
  const version = docs[versionPath];
  requireValue(errors, versionPath, version.on?.pull_request?.types, ['closed'], 'pull-request event types');
  requireValue(errors, versionPath, version.on?.pull_request?.branches, ['dev', 'main'], 'promotion branches');
  requireValue(errors, versionPath, version.concurrency?.['cancel-in-progress'], false, 'concurrency cancellation');
  requireValue(
    errors,
    versionPath,
    version.jobs?.['dev-version']?.needs,
    'tag-policy-preflight',
    'dev version policy preflight dependency',
  );
  requireRunMarkers(
    errors,
    versionPath,
    version.jobs?.['tag-policy-preflight'],
    'Require policy-read credential and immutable v-tag ruleset',
    [
      'RELEASE_POLICY_READ_TOKEN',
      'Administration:read',
      '.conditions.ref_name.exclude',
      'has("bypass_actors")',
      '.actor_id != 1',
      'length == 1',
      'index("deletion")',
      'index("update")',
    ],
  );
  requireValue(
    errors,
    versionPath,
    jobStep(version.jobs?.['tag-policy-preflight'], 'Require policy-read credential and immutable v-tag ruleset')?.env
      ?.GH_TOKEN,
    '${{ secrets.RELEASE_POLICY_READ_TOKEN }}',
    'tag policy credential',
  );
  const stable = version.jobs?.['stable-promotion'];
  for (const marker of ["base.ref == 'main'", "head.ref == 'dev'", 'head.repo.full_name == github.repository']) {
    if (!String(stable?.if).includes(marker)) errors.push(`${versionPath}: stable-promotion if is missing ${marker}`);
  }
  requireRunMarkers(errors, versionPath, version.jobs?.['dev-version'], 'Commit, tag, and atomically publish the source', [
    'git push --atomic',
  ]);

  const releasePath = '.github/workflows/release.yml';
  const release = docs[releasePath];
  requireValue(errors, releasePath, release.on?.push?.tags, ['v*'], 'immutable tag trigger');
  if (!release.on?.workflow_call || !release.on?.workflow_dispatch) {
    errors.push(`${releasePath}: workflow_call and workflow_dispatch triggers are required`);
  }
  for (const input of ['version', 'channel', 'source_tag', 'source_sha', 'authorization_event', 'authorization_sha', 'mode']) {
    if (release.on?.workflow_dispatch?.inputs?.[input]?.required !== true) {
      errors.push(`${releasePath}: recovery input ${input} must be required`);
    }
  }
  const recovery = release.jobs?.['recovery-context'];
  requireValue(errors, releasePath, recovery?.environment, 'release-recovery', 'recovery environment');
  requireValue(errors, releasePath, recovery?.needs, 'recovery-policy', 'recovery preflight dependency');
  requireValue(errors, releasePath, release.jobs?.['recovery-policy']?.permissions?.actions, 'read', 'recovery actions permission');
  requireRunMarkers(errors, releasePath, release.jobs?.['recovery-policy'], 'Fail closed unless release-recovery is protected', [
    'environments/release-recovery',
    'required_reviewers',
    'prevent_self_review == true',
    'custom_branch_policies',
    'deployment-branch-policies',
    '.type == "tag" and (.name == $tag or .name == "v*")',
  ]);
  requireRunMarkers(errors, releasePath, release.jobs?.['repository-policy'], 'Fail closed unless active v-tag ruleset blocks mutation', [
    'repos/${GITHUB_REPOSITORY}/rulesets',
    '.target == "tag"',
    '.enforcement == "active"',
    '.conditions.ref_name.include',
    '.conditions.ref_name.exclude',
    'has("bypass_actors")',
    'RELEASE_POLICY_READ_TOKEN',
    'index("deletion")',
    'index("update")',
    'OrganizationAdmin',
    'length == 1',
  ]);
  requireValue(
    errors,
    releasePath,
    jobStep(release.jobs?.['repository-policy'], 'Fail closed unless active v-tag ruleset blocks mutation')?.env?.GH_TOKEN,
    '${{ secrets.RELEASE_POLICY_READ_TOKEN }}',
    'release policy credential',
  );
  const verifyNeeds = release.jobs?.verify?.needs;
  if (!Array.isArray(verifyNeeds) || !verifyNeeds.includes('repository-policy')) {
    errors.push(`${releasePath}: verify must need repository-policy`);
  }
  requireRunMarkers(errors, releasePath, release.jobs?.verify, 'Load and validate immutable release metadata', [
    '.expected_components == [',
    'aggregate_digest',
    "jq -cS 'del(.aggregate_digest)'",
    'EXPECTED_ARCHIVES',
    'GitHub release asset inventory is not exact',
    'sha256sum --check --strict',
    'dist.attestations.provenance.url',
    'cosign verify-blob',
    'slsa-verifier verify-artifact',
    'gh attestation verify',
    'cosign verify-attestation',
    '"oci://${IDENTITY}@${DIGEST}"',
    '--source-tag "${SOURCE_TAG}"',
    '--source-ref "refs/tags/${SOURCE_TAG}"',
    'npm audit signatures',
    'npm provenance is not bound to the expected repository, tag, and source SHA',
    '.version == $version',
    '.source_sha == $sha',
    '.immutable_digests.images.components | keys | sort',
    '.attestation.digest == .digest',
    '.attestation.source_sha == $sha',
    'image-publish.yml@refs/tags/',
  ]);
  requireRunMarkers(errors, releasePath, release.jobs?.metadata, 'Validate component interfaces and aggregate', [
    'EXPECTED_COMPONENTS',
    'AGGREGATE_DIGEST="sha256:',
    'aggregate_digest',
    '.attestation.source_sha',
    '.attestation.workflow',
  ]);
  requireValue(errors, releasePath, release.jobs?.metadata?.permissions?.['id-token'], 'write', 'metadata OIDC permission');
  requireValue(errors, releasePath, release.jobs?.metadata?.permissions?.attestations, 'write', 'metadata attestation permission');
  requireRunMarkers(errors, releasePath, release.jobs?.metadata, 'Sign immutable release metadata', [
    'cosign sign-blob',
    'release-metadata.json.bundle',
  ]);
  requireValue(
    errors,
    releasePath,
    release.jobs?.build?.with?.recovery,
    "${{ needs.context.outputs.recovery == 'true' }}",
    'tarball recovery forwarding',
  );
  requireValue(
    errors,
    releasePath,
    release.jobs?.['sign-attest']?.with?.recovery,
    "${{ needs.context.outputs.recovery == 'true' }}",
    'signing recovery forwarding',
  );
  for (const pointerJob of ['npm-advance-dev', 'images-promote-dev']) {
    const needs = release.jobs?.[pointerJob]?.needs;
    if (!Array.isArray(needs) || !needs.includes('metadata') || !needs.includes('publish-build')) {
      errors.push(`${releasePath}: ${pointerJob} must wait for aggregate verification and public GitHub assets`);
    }
  }
  const publishBuildNeeds = release.jobs?.['publish-build']?.needs;
  if (
    !Array.isArray(publishBuildNeeds) ||
    publishBuildNeeds.includes('npm-advance-dev') ||
    publishBuildNeeds.includes('images-promote-dev')
  ) {
    errors.push(`${releasePath}: publish-build must not wait on pointer movement`);
  }

  const buildPath = '.github/workflows/build-tarballs.yml';
  const build = docs[buildPath];
  requireValue(errors, buildPath, build.on?.workflow_call?.inputs?.recovery?.required, true, 'recovery input');
  if (jobStep(build.jobs?.build, 'Recover existing immutable tarball')) {
    errors.push(`${buildPath}: recovery must rebuild candidates locally instead of trusting release bytes`);
  }

  const signPath = '.github/workflows/sign-attest.yml';
  const sign = docs[signPath];
  requireValue(errors, signPath, sign.on?.workflow_call?.inputs?.recovery?.required, true, 'recovery input');
  if (jobStep(sign.jobs?.sign, 'Recover existing signed candidate bytes')) {
    errors.push(`${signPath}: recovery must regenerate signatures/provenance locally`);
  }

  const publishPath = '.github/workflows/release-publish.yml';
  const publish = docs[publishPath];
  const steps = publish.jobs?.publish?.steps ?? [];
  const names = steps.map((step: any) => step?.name);
  const devRelease = names.indexOf('Publish verified dev release before exposing pointers');
  const trustedMetadata = names.indexOf('Upload trusted metadata before candidate bytes');
  const candidateBytes = names.indexOf('Upload only missing candidate bytes; compare recorded digests');
  const devManifest = names.indexOf('Advance verified dev manifest on main');
  const stableRelease = names.indexOf('Advance GitHub stable pointer without new artifacts');
  const stableManifest = names.indexOf('Atomically synchronize stable manifest across main and dev');
  if (!(devRelease >= 0 && devManifest > devRelease)) errors.push(`${publishPath}: dev release must precede dev manifest`);
  if (!(trustedMetadata >= 0 && candidateBytes > trustedMetadata)) {
    errors.push(`${publishPath}: trusted signed metadata must be uploaded before candidate bytes`);
  }
  if (!(stableRelease >= 0 && stableManifest > stableRelease)) {
    errors.push(`${publishPath}: stable release must precede stable manifest`);
  }
  requireRunMarkers(errors, publishPath, publish.jobs?.publish, 'Advance verified dev manifest on main', [
    'jq -cS',
    'Refusing provenance-changing overwrite',
    'sort -V',
    'refusing to move dev manifest backwards',
  ]);
  requireRunMarkers(errors, publishPath, publish.jobs?.publish, 'Stage and validate candidate inventory', [
    "jq -cS 'del(.aggregate_digest)'",
    'sha256sum --check --strict',
    '.immutable_digests.archives',
    '.immutable_digests.helm.digest',
    'release-metadata.json.bundle',
    'cosign verify-blob',
    'gh attestation verify',
    'yq -r .appVersion',
  ]);
  requireRunMarkers(errors, publishPath, publish.jobs?.publish, 'Create dev prerelease or verify existing provenance', [
    'release-metadata.json.bundle',
    'cosign verify-blob',
    'gh attestation verify',
    'candidate bytes without valid trusted metadata',
  ]);
  requireRunMarkers(errors, publishPath, publish.jobs?.publish, 'Atomically synchronize stable manifest across main and dev', [
    'jq -cS',
    'Refusing provenance-changing overwrite',
    'sort -V',
    'refusing to move stable manifest backwards',
    'git push --atomic',
  ]);

  return errors;
}

if (import.meta.main) {
  const errors = verifyWorkflowContracts();
  if (errors.length) {
    console.error('Release workflow contract verification failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Release workflow contracts verified (${paths.length} workflows, ${RELEASE_COMPONENTS.length} immutable components).`);
}
