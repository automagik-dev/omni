/**
 * Deployment-wide Kapso settings (#1676).
 *
 * One Kapso project per Omni deployment: its key connects WhatsApp Business numbers through
 * Kapso by clicks (setup link, numbers, connect). Like `SLACK_APP_SETTINGS`, whether a value is
 * sealed at rest and masked by `GET /settings` is decided by the `DEFAULT_SETTINGS` registry in
 * `services/settings.ts`: the key is `valueType: 'secret', isSecret: true`; the base URL and the
 * Kapso customer id Omni hangs its setup links off are plain.
 */
export const KAPSO_SETTINGS = {
  apiKey: { key: 'kapso.api_key', env: 'KAPSO_API_KEY' },
  apiBaseUrl: { key: 'kapso.api_base_url', env: 'KAPSO_API_BASE_URL' },
  /** Remembered by Omni after it creates its Kapso customer; no env fallback. */
  customerId: { key: 'kapso.customer_id' },
} as const;
