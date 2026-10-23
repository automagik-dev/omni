/**
 * What human login needs that nobody has to set (wish: omni-labs-distribution): resolved
 * once at boot, before the app is built (index.ts), so the rest of login reads it as config.
 *
 *   secret     OMNI_AUTH_SECRET, else one this API generated at first boot and keeps in
 *              the `login.auth_secret` setting. The database, not a file: every replica
 *              reads the same row, and a container that loses its disk keeps its sessions
 *              and its claim link.
 *   publicUrl  the `server.public_url` setting, when OMNI_PUBLIC_URL is unset.
 */

import { randomBytes } from 'node:crypto';
import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { SettingsService } from '../services/settings';
import { type LoginDefaults, loginWanted } from './config';

const log = createLogger('login');

export const AUTH_SECRET_SETTING = 'login.auth_secret';
const PUBLIC_URL_SETTING = 'server.public_url';

export async function resolveLoginDefaults(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
  settings: Pick<SettingsService, 'ensureGeneratedSecret' | 'getString'> = new SettingsService(db),
): Promise<LoginDefaults> {
  if (!loginWanted(env)) return {};
  const defaults: LoginDefaults = {};
  if (!env.OMNI_AUTH_SECRET?.trim()) {
    try {
      defaults.secret = await settings.ensureGeneratedSecret(AUTH_SECRET_SETTING, () =>
        randomBytes(32).toString('base64url'),
      );
    } catch (error) {
      log.error('Could not keep a login secret; human login stays off', { error: String(error) });
    }
  }
  if (!env.OMNI_PUBLIC_URL?.trim()) {
    const stored = await settings.getString(PUBLIC_URL_SETTING).catch(() => undefined);
    if (stored?.trim()) defaults.publicUrl = stored.trim();
  }
  return defaults;
}
