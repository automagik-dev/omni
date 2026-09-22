/**
 * `POST /messages/media/download` fetches a stored Slack file on demand. It
 * authenticates with the token the media processor picks
 * (`selectSlackDownloadToken`), so a user-mode row from a one-click install —
 * which holds the person's token and no bot token — downloads as the person
 * rather than unauthenticated.
 *
 * The stored mediaUrl is tenant-controlled, and the first request of a
 * download carries the Authorization header to whatever host it names, so the
 * token is attached only for Slack's own hosts.
 */
import { describe, expect, test } from 'bun:test';
import { __test__ } from '../messages';

const { buildMediaDownloadFetchOptions } = __test__;

const SLACK_FILE_URL = 'https://files.slack.com/files-pri/T0123-F0123/download/photo.png';

function authorizationOf(options: ReturnType<typeof buildMediaDownloadFetchOptions>): string | undefined {
  return (options?.headers as Record<string, string> | undefined)?.Authorization;
}

const botlessUserRow = { channel: 'slack', slackAuthMode: 'user', slackUserToken: 'xoxp-test', slackBotToken: null };
const botRow = { channel: 'slack', slackAuthMode: 'bot', slackUserToken: 'xoxp-test', slackBotToken: 'xoxb-test' };

describe('buildMediaDownloadFetchOptions — Slack download token', () => {
  test('a bot-less user-mode row downloads as the user', () => {
    const options = buildMediaDownloadFetchOptions(botlessUserRow, SLACK_FILE_URL);
    expect(authorizationOf(options)).toBe('Bearer xoxp-test');
    expect(options?.preserveAuthRedirectHostSuffixes).toEqual(['slack.com']);
  });

  test('a bot-mode row keeps the bot token', () => {
    expect(authorizationOf(buildMediaDownloadFetchOptions(botRow, SLACK_FILE_URL))).toBe('Bearer xoxb-test');
  });

  test('slack.com and its subdomains get the token', () => {
    for (const mediaUrl of ['https://slack.com/files-pri/photo.png', SLACK_FILE_URL, 'https://FILES.Slack.COM/x.png']) {
      expect(authorizationOf(buildMediaDownloadFetchOptions(botlessUserRow, mediaUrl))).toBe('Bearer xoxp-test');
      expect(authorizationOf(buildMediaDownloadFetchOptions(botRow, mediaUrl))).toBe('Bearer xoxb-test');
    }
  });

  test('any other host, look-alikes included, gets no Authorization header', () => {
    const offSlack = [
      'https://slack.com.evil.test/files-pri/photo.png',
      'https://evilslack.com/files-pri/photo.png',
      'https://evil.test/photo.png',
      'https://slack.com@evil.test/photo.png',
      'http://files.slack.com/files-pri/photo.png',
      'not a url',
    ];
    for (const mediaUrl of offSlack) {
      expect(buildMediaDownloadFetchOptions(botlessUserRow, mediaUrl)).toBeUndefined();
      expect(buildMediaDownloadFetchOptions(botRow, mediaUrl)).toBeUndefined();
    }
  });

  test('a row with no token, or another channel, sends no Authorization header', () => {
    expect(buildMediaDownloadFetchOptions({ channel: 'slack', slackAuthMode: 'user' }, SLACK_FILE_URL)).toBeUndefined();
    expect(
      buildMediaDownloadFetchOptions({ channel: 'telegram', slackBotToken: 'xoxb-test' }, SLACK_FILE_URL),
    ).toBeUndefined();
  });
});
