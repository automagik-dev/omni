/**
 * `omni instances create|update` must never echo a raw secret (#1139), and the
 * Slack user token can come from argv, an env var, or stdin.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { __testables } from '../instances';

const { maskSecret, maskSecretFields, resolveSlackUserToken } = __testables;

// Assembled at runtime so secret scanners don't flag this fake fixture.
const XOXP = ['xoxp', 'fake', 'test', 'token', 'value', '9bdc'].join('-');
const ENV_VAR = 'OMNI_TEST_SLACK_USER_TOKEN';

afterEach(() => {
  Reflect.deleteProperty(process.env, ENV_VAR);
});

describe('maskSecretFields', () => {
  test('masks every secret field and leaves no raw token in the output', () => {
    const body = {
      slackUserToken: XOXP,
      slackBotToken: ['xoxb', 'fake', 'bot', 'token', 'value'].join('-'),
      slackAppToken: ['xapp', 'fake', 'app', 'token', 'value'].join('-'),
      twilioAuthToken: '0123456789abcdef0123456789abcdef',
      gupshupAuthToken: 'sk_gupshup_0123456789',
      metaAccessToken: 'EAAG0123456789abcdefghijk',
      telegramBotToken: 'fake-telegram-bot-token-value',
      slackAuthMode: 'user',
    };
    const out = JSON.stringify(maskSecretFields(body));
    for (const [key, value] of Object.entries(body)) {
      if (key !== 'slackAuthMode') expect(out).not.toContain(value);
    }
    expect(maskSecretFields(body).slackUserToken).toBe('xoxp-****9bdc');
    expect(maskSecretFields(body).slackAuthMode).toBe('user');
  });

  test('keeps "null" clears and short secrets fully hidden', () => {
    expect(maskSecretFields({ slackUserToken: null }).slackUserToken).toBeNull();
    expect(maskSecret('short')).toBe('****');
  });
});

describe('resolveSlackUserToken', () => {
  test('undefined when no source given', async () => {
    expect(await resolveSlackUserToken({})).toBeUndefined();
  });

  test('reads argv, env, and stdin (trailing newline stripped)', async () => {
    expect(await resolveSlackUserToken({ slackUserToken: XOXP })).toBe(XOXP);
    process.env[ENV_VAR] = XOXP;
    expect(await resolveSlackUserToken({ slackUserTokenEnv: ENV_VAR })).toBe(XOXP);
    expect(await resolveSlackUserToken({ slackUserTokenStdin: true }, async () => `${XOXP}\n`)).toBe(XOXP);
  });

  test('rejects multiple sources, unset env, and empty stdin', async () => {
    await expect(resolveSlackUserToken({ slackUserToken: XOXP, slackUserTokenStdin: true })).rejects.toThrow(
      'Use only one of',
    );
    await expect(resolveSlackUserToken({ slackUserTokenEnv: ENV_VAR })).rejects.toThrow('not set or empty');
    await expect(resolveSlackUserToken({ slackUserTokenStdin: true }, async () => '\n')).rejects.toThrow('stdin');
  });
});
