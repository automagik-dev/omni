/**
 * What the Kapso routes share (#1676): the deployment's Kapso project from settings, the
 * multitenancy refusal, and turning a Kapso refusal into a plain reply.
 *
 * The key is install-wide, so with multitenancy on every Kapso route refuses: one tenant must
 * never set or use a key that lists or connects another tenant's numbers.
 */

import { DEFAULT_KAPSO_API_BASE_URL, KapsoApiError, type KapsoOptions } from '@omni/channel-whatsapp-business';
import { KAPSO_SETTINGS } from '../constants/kapso';
import { isMultitenancyEnabled } from '../tenancy/feature-flag';

export type KapsoRefusal = {
  status: 400 | 404 | 409 | 502;
  payload: { error: { code: string; message: string } };
};

const refusal = (status: KapsoRefusal['status'], code: string, message: string): KapsoRefusal => ({
  status,
  payload: { error: { code, message } },
});

export const KAPSO_MULTITENANCY = refusal(
  409,
  'KAPSO_NOT_AVAILABLE',
  'Connecting through Kapso is not available with multitenancy: its key would be shared by every tenant.',
);
export const KAPSO_NOT_CONFIGURED = refusal(
  409,
  'KAPSO_NOT_CONFIGURED',
  'This Omni has no Kapso project key yet. Save one first.',
);
export const PUBLIC_URL_MISSING = refusal(
  409,
  'PUBLIC_URL_MISSING',
  'Omni has no public address (server.public_url or OMNI_PUBLIC_URL, https), so Kapso cannot send it messages. Nothing was created.',
);

/** The refusal every Kapso route answers with multitenancy on; null otherwise. */
export function kapsoUnavailable(): KapsoRefusal | null {
  return isMultitenancyEnabled() ? KAPSO_MULTITENANCY : null;
}

interface SettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

/** The Kapso project origin, settings row first, then env, then Kapso's own. */
export async function resolveKapsoBaseUrl(settings: SettingsReader): Promise<string> {
  const { key, env } = KAPSO_SETTINGS.apiBaseUrl;
  const raw = (await settings.getString(key, env))?.trim();
  return raw || DEFAULT_KAPSO_API_BASE_URL;
}

/** The deployment's Kapso project, or null when no key is saved or set in the env. */
export async function resolveKapso(settings: SettingsReader): Promise<KapsoOptions | null> {
  const { key, env } = KAPSO_SETTINGS.apiKey;
  const apiKey = (await settings.getSecret(key, env))?.trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: await resolveKapsoBaseUrl(settings) };
}

/** A Kapso refusal as a reply: its own words, with 401 as a key problem. */
export function kapsoErrorReply(error: unknown): KapsoRefusal | null {
  if (!(error instanceof KapsoApiError)) return null;
  return refusal(502, error.status === 401 ? 'KAPSO_KEY_REFUSED' : 'KAPSO_ERROR', error.message);
}
