/**
 * Deployment-wide Slack app credentials (wish: slack-personal-oauth).
 *
 * One Slack app per Omni deployment drives the one-click OAuth install. Its
 * credentials are install-wide settings with env fallbacks, read through
 * `SettingsService.getString` / `getSecret` (the PR #1225 precedent). Whether
 * a value is sealed at rest and masked by `GET /settings` is decided by the
 * `DEFAULT_SETTINGS` registry in `services/settings.ts`, never by the caller,
 * so every key listed here is registered there: the three secrets as
 * `valueType: 'secret', isSecret: true`, the two identifiers in the clear.
 */
export const SLACK_APP_SETTINGS = {
  clientId: { key: 'slack.app.client_id', env: 'SLACK_CLIENT_ID' },
  clientSecret: { key: 'slack.app.client_secret', env: 'SLACK_CLIENT_SECRET' },
  signingSecret: { key: 'slack.app.signing_secret', env: 'SLACK_SIGNING_SECRET' },
  appToken: { key: 'slack.app.app_token', env: 'SLACK_APP_TOKEN' },
  /** General server setting (not Slack-specific): the public origin of this deployment. */
  publicUrl: { key: 'server.public_url', env: 'OMNI_PUBLIC_URL' },
} as const;

/**
 * Path Slack redirects the browser to after the user authorizes, appended to
 * `server.public_url`. Slack requires the full redirect URL to be HTTPS and
 * listed in the app manifest (`oauth_config.redirect_urls`).
 */
export const SLACK_OAUTH_CALLBACK_PATH = '/api/v2/slack/oauth/callback' as const;
