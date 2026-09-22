/**
 * `POST /messages/media/download` fetches a stored Slack file on demand. It
 * authenticates with the token the media processor picks
 * (`selectSlackDownloadToken`), so a user-mode row from a one-click install —
 * which holds the person's token and no bot token — downloads as the person
 * rather than unauthenticated.
 */
import { describe, expect, test } from 'bun:test';
import { __test__ } from '../messages';

const { buildMediaDownloadFetchOptions } = __test__;

function authorizationOf(options: ReturnType<typeof buildMediaDownloadFetchOptions>): string | undefined {
  return (options?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('buildMediaDownloadFetchOptions — Slack download token', () => {
  test('a bot-less user-mode row downloads as the user', () => {
    const options = buildMediaDownloadFetchOptions({
      channel: 'slack',
      slackAuthMode: 'user',
      slackUserToken: 'xoxp-test',
      slackBotToken: null,
    });
    expect(authorizationOf(options)).toBe('Bearer xoxp-test');
    expect(options?.preserveAuthRedirectHostSuffixes).toEqual(['slack.com']);
  });

  test('a bot-mode row keeps the bot token', () => {
    const options = buildMediaDownloadFetchOptions({
      channel: 'slack',
      slackAuthMode: 'bot',
      slackUserToken: 'xoxp-test',
      slackBotToken: 'xoxb-test',
    });
    expect(authorizationOf(options)).toBe('Bearer xoxb-test');
  });

  test('a row with no token, or another channel, sends no Authorization header', () => {
    expect(buildMediaDownloadFetchOptions({ channel: 'slack', slackAuthMode: 'user' })).toBeUndefined();
    expect(buildMediaDownloadFetchOptions({ channel: 'telegram', slackBotToken: 'xoxb-test' })).toBeUndefined();
  });
});
