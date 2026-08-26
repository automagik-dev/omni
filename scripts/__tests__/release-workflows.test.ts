import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ReleaseBoundary, validateReleaseBoundary, verifyWorkflowContracts } from '../verify-release-workflows';

const sourceSha = '1'.repeat(40);
const authorizationSha = '2'.repeat(40);
const tree = '3'.repeat(40);

function fixture(overrides: Partial<ReleaseBoundary> = {}): ReleaseBoundary {
  return {
    version: '2.260730.1',
    channel: 'dev',
    mode: 'build',
    sourceTag: 'v2.260730.1',
    sourceSha,
    tagCommitSha: sourceSha,
    authorizationSha,
    sourceTree: tree,
    authorizationTree: '4'.repeat(40),
    ...overrides,
  };
}

describe('release state boundary', () => {
  test('accepts one immutable dev version commit', () => {
    expect(validateReleaseBoundary(fixture())).toEqual([]);
  });

  for (const strategy of ['merge', 'squash', 'rebase']) {
    test(`accepts ${strategy} promotion when the resulting tree is exact`, () => {
      expect(
        validateReleaseBoundary(
          fixture({
            channel: 'stable',
            mode: 'promote',
            authorizationSha: strategy === 'merge' ? sourceSha : authorizationSha,
            authorizationTree: tree,
          }),
        ),
      ).toEqual([]);
    });
  }

  test('accepts an explicit protected manual recovery tuple', () => {
    expect(
      validateReleaseBoundary(
        fixture({
          recovery: true,
          recoveryEnvironment: 'release-recovery',
        }),
      ),
    ).toEqual([]);
  });

  test('rejects a mutable or mismatched tag ref', () => {
    expect(
      validateReleaseBoundary(
        fixture({
          sourceTag: 'dev',
          tagCommitSha: '5'.repeat(40),
        }),
      ),
    ).toContain('tag must resolve to recorded source SHA');
  });

  test('rejects promotion with a different tree', () => {
    expect(
      validateReleaseBoundary(
        fixture({
          channel: 'stable',
          mode: 'promote',
          authorizationTree: '6'.repeat(40),
        }),
      ),
    ).toContain('promotion tree must exactly equal source tag tree');
  });

  test('rejects recovery outside the protected environment', () => {
    expect(
      validateReleaseBoundary(
        fixture({
          recovery: true,
          recoveryEnvironment: 'production',
        }),
      ),
    ).toContain('manual recovery requires the release-recovery environment');
  });
});

test('workflow YAML carries the modeled invariants', () => {
  expect(verifyWorkflowContracts()).toEqual([]);
});

const root = join(import.meta.dir, '../..');
function mutate(path: string, from: string, to: string) {
  const source = readFileSync(join(root, path), 'utf8');
  expect(source.includes(from)).toBe(true);
  return verifyWorkflowContracts(root, { [path]: source.replace(from, to) });
}

describe('structural workflow mutations fail closed', () => {
  test('creating a version without the tag-policy preflight is rejected', () => {
    expect(
      mutate('.github/workflows/version.yml', 'needs: tag-policy-preflight', 'needs: []'),
    ).not.toEqual([]);
  });

  test('using the ordinary workflow token for ruleset admin details is rejected', () => {
    expect(
      mutate(
        '.github/workflows/version.yml',
        '${{ secrets.RELEASE_POLICY_READ_TOKEN }}',
        '${{ github.token }}',
      ),
    ).not.toEqual([]);
  });

  test('accepting omitted ruleset bypass actors is rejected', () => {
    expect(
      mutate('.github/workflows/version.yml', 'has("bypass_actors")', 'has("rules")'),
    ).not.toEqual([]);
  });

  test('removing tag ruleset exclusions validation is rejected', () => {
    expect(
      mutate('.github/workflows/version.yml', '.conditions.ref_name.exclude', '.conditions.ref_name.include'),
    ).not.toEqual([]);
  });

  test('disconnecting recovery from its API policy gate is rejected', () => {
    expect(mutate('.github/workflows/release.yml', 'needs: recovery-policy', 'needs: tag-context')).not.toEqual([]);
  });

  test('removing required recovery reviewers is rejected', () => {
    expect(mutate('.github/workflows/release.yml', 'required_reviewers', 'optional_reviewers')).not.toEqual([]);
  });

  test('allowing recovery self-approval is rejected', () => {
    expect(
      mutate('.github/workflows/release.yml', 'prevent_self_review == true', 'prevent_self_review != true'),
    ).not.toEqual([]);
  });

  test('removing recovery actions-read permission is rejected', () => {
    expect(
      mutate('.github/workflows/release.yml', '      actions: read\n    steps:', '      actions: none\n    steps:'),
    ).not.toEqual([]);
  });

  test('disconnecting immutable tag policy from verification is rejected', () => {
    expect(
      mutate('.github/workflows/release.yml', 'needs: [context, repository-policy]', 'needs: context'),
    ).not.toEqual([]);
  });

  test('weakening tag deletion protection is rejected', () => {
    expect(mutate('.github/workflows/release.yml', 'index("deletion")', 'index("creation")')).not.toEqual([]);
  });

  test('removing aggregate cryptographic binding is rejected', () => {
    expect(mutate('.github/workflows/release.yml', 'AGGREGATE_DIGEST=', 'UNBOUND_DIGEST=')).not.toEqual([]);
  });

  test('removing nested image attestation validation is rejected', () => {
    expect(
      mutate('.github/workflows/release.yml', '.attestation.digest == .digest', '.digest == .digest'),
    ).not.toEqual([]);
  });

  test('allowing an image attestation from another source SHA is rejected', () => {
    expect(
      mutate('.github/workflows/release.yml', '.attestation.source_sha == $sha', '.attestation.source_sha != $sha'),
    ).not.toEqual([]);
  });

  test('removing exact SLSA source tag verification is rejected', () => {
    expect(
      mutate('.github/workflows/release.yml', '--source-tag "${SOURCE_TAG}"', '--source-branch dev'),
    ).not.toEqual([]);
  });

  test('removing npm provenance source binding is rejected', () => {
    expect(
      mutate(
        '.github/workflows/release.yml',
        'npm provenance is not bound to the expected repository, tag, and source SHA',
        'npm provenance URL exists',
      ),
    ).not.toEqual([]);
  });

  test('reordering dev exposure before release publication is rejected', () => {
    const path = '.github/workflows/release-publish.yml';
    const source = readFileSync(join(root, path), 'utf8');
    const published = 'Publish verified dev release before exposing pointers';
    const pointer = 'Advance verified dev manifest on main';
    expect(source.indexOf(published)).toBeLessThan(source.indexOf(pointer));
    const mutated = source.replace(published, 'TEMP').replace(pointer, published).replace('TEMP', pointer);
    expect(verifyWorkflowContracts(root, { [path]: mutated })).not.toEqual([]);
  });

  test('reintroducing unsigned recovery byte reuse is rejected', () => {
    const path = '.github/workflows/build-tarballs.yml';
    const source = readFileSync(join(root, path), 'utf8');
    const injected = source.replace(
      '      - name: Setup Bun',
      '      - name: Recover existing immutable tarball\n        run: gh release download "$SOURCE_TAG"\n\n      - name: Setup Bun',
    );
    expect(
      verifyWorkflowContracts(root, { [path]: injected }),
    ).not.toEqual([]);
  });

  test('uploading candidate bytes before trusted metadata is rejected', () => {
    const path = '.github/workflows/release-publish.yml';
    const source = readFileSync(join(root, path), 'utf8');
    const trusted = 'Upload trusted metadata before candidate bytes';
    const candidates = 'Upload only missing candidate bytes; compare recorded digests';
    const mutated = source.replace(trusted, 'TEMP').replace(candidates, trusted).replace('TEMP', candidates);
    expect(verifyWorkflowContracts(root, { [path]: mutated })).not.toEqual([]);
  });

  test('removing stable monotonic pointer protection is rejected', () => {
    expect(
      mutate(
        '.github/workflows/release-publish.yml',
        'refusing to move stable manifest backwards',
        'moving stable manifest backwards',
      ),
    ).not.toEqual([]);
  });
});
