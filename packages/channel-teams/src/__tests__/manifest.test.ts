/**
 * Tests for buildTeamsManifest — verifies the generated app manifest is
 * uploadable to Teams Admin Center (right schema URL, scopes, bot ID, and
 * the 30/80-char clamps Microsoft enforces on `name.short` / `description.short`).
 */

import { describe, expect, it } from 'bun:test';

import { TEAMS_BOT_SCOPES, TEAMS_MANIFEST_VERSION, TEAMS_PERMISSIONS, buildTeamsManifest } from '../manifest';

const sampleBotId = '00000000-0000-4000-8000-000000000001';

describe('buildTeamsManifest', () => {
  it('targets the documented manifest schema version', () => {
    const manifest = buildTeamsManifest({ botId: sampleBotId });
    expect(manifest.manifestVersion).toBe(TEAMS_MANIFEST_VERSION);
    expect(manifest.$schema).toContain(`v${TEAMS_MANIFEST_VERSION}`);
  });

  it('uses the bot id for both `id` and the bots[].botId entries by default', () => {
    const manifest = buildTeamsManifest({ botId: sampleBotId });
    expect(manifest.id).toBe(sampleBotId);
    expect(manifest.bots?.[0]?.botId).toBe(sampleBotId);
  });

  it('declares all default scopes', () => {
    const manifest = buildTeamsManifest({ botId: sampleBotId });
    expect(manifest.bots?.[0]?.scopes).toEqual([...TEAMS_BOT_SCOPES]);
  });

  it('opts in to file uploads and out of notification-only', () => {
    const manifest = buildTeamsManifest({ botId: sampleBotId });
    expect(manifest.bots?.[0]?.supportsFiles).toBe(true);
    expect(manifest.bots?.[0]?.isNotificationOnly).toBe(false);
  });

  it('clamps name.short and description.short to Teams limits', () => {
    const longName = 'A'.repeat(50);
    const longDesc = 'B'.repeat(200);

    const manifest = buildTeamsManifest({
      botId: sampleBotId,
      appName: longName,
      description: longDesc,
    });

    expect(manifest.name.short.length).toBeLessThanOrEqual(30);
    expect(manifest.name.full).toBe(longName);
    expect(manifest.description.short.length).toBeLessThanOrEqual(80);
    expect(manifest.description.full).toBe(longDesc);
  });

  it('exposes the documented permission set', () => {
    const manifest = buildTeamsManifest({ botId: sampleBotId });
    expect(manifest.permissions).toEqual([...TEAMS_PERMISSIONS]);
  });

  it('respects operator overrides for branding fields', () => {
    const manifest = buildTeamsManifest({
      botId: sampleBotId,
      appId: 'package-app-id',
      appName: 'Acme Bot',
      description: 'Acme support helper',
      developerName: 'Acme Inc.',
      websiteUrl: 'https://acme.test',
      privacyUrl: 'https://acme.test/privacy',
      termsOfUseUrl: 'https://acme.test/terms',
      iconColor: 'acme-color.png',
      iconOutline: 'acme-outline.png',
      accentColor: '#FF0066',
      validDomains: ['acme.test'],
      packageName: 'com.acme.omni-teams',
      version: '2.5.0',
    });

    expect(manifest.id).toBe('package-app-id');
    expect(manifest.bots?.[0]?.botId).toBe(sampleBotId);
    expect(manifest.developer.name).toBe('Acme Inc.');
    expect(manifest.developer.websiteUrl).toBe('https://acme.test');
    expect(manifest.developer.privacyUrl).toBe('https://acme.test/privacy');
    expect(manifest.developer.termsOfUseUrl).toBe('https://acme.test/terms');
    expect(manifest.icons.color).toBe('acme-color.png');
    expect(manifest.icons.outline).toBe('acme-outline.png');
    expect(manifest.accentColor).toBe('#FF0066');
    expect(manifest.validDomains).toEqual(['acme.test']);
    expect(manifest.packageName).toBe('com.acme.omni-teams');
    expect(manifest.version).toBe('2.5.0');
  });
});
