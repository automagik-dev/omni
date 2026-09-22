/**
 * Inbound Slack attachments 403'd in `authMode: 'user'`.
 *
 * A member posted a screenshot in a channel and the media-processor logged
 * `Failed to download media: 403` for the files.slack.com `url_private` URL:
 * the download authenticated as the bot, and in user mode the bot user need
 * not be a member of that channel. The token the instance was actually
 * installed with — the xoxp user token — is the one that can read the file.
 *
 * These cases pin the selection seam itself (`buildFetchOptions`), so a
 * regression that quietly reverts to the bot token in user mode fails here.
 */
import { describe, expect, test } from 'bun:test';
import { type MediaProcessorContext, __test__ } from '../media-processor';

const { buildFetchOptions } = __test__;

/** An inbound Slack `url_private_download`, the URL these rows download. */
const SLACK_FILE_URL = 'https://files.slack.com/files-pri/T0123-F0123/download/photo.png';

/** A ctx whose only reachable dependency is the instance lookup. */
function ctxReturning(instance: Record<string, unknown>): MediaProcessorContext {
  return {
    services: { instances: { getById: async () => instance } },
  } as unknown as MediaProcessorContext;
}

function authorizationOf(options: RequestInit | undefined): string | undefined {
  return (options?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('buildFetchOptions — Slack download token selection', () => {
  test('user mode with a stored user token downloads as the user', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackAuthMode: 'user', slackUserToken: 'xoxp-test', slackBotToken: 'xoxb-test' }),
      'instance-1',
      SLACK_FILE_URL,
      'slack',
    );
    expect(authorizationOf(options)).toBe('Bearer xoxp-test');
  });

  test('a bot-less user-mode row from a one-click install downloads as the user', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackAuthMode: 'user', slackUserToken: 'xoxp-test', slackBotToken: null }),
      'instance-1',
      SLACK_FILE_URL,
      'slack',
    );
    expect(authorizationOf(options)).toBe('Bearer xoxp-test');
  });

  test('user mode with no stored user token keeps the bot token', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackAuthMode: 'user', slackUserToken: null, slackBotToken: 'xoxb-test' }),
      'instance-1',
      SLACK_FILE_URL,
      'slack',
    );
    expect(authorizationOf(options)).toBe('Bearer xoxb-test');
  });

  test('user mode with an empty user token keeps the bot token', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackAuthMode: 'user', slackUserToken: '', slackBotToken: 'xoxb-test' }),
      'instance-1',
      SLACK_FILE_URL,
      'slack',
    );
    expect(authorizationOf(options)).toBe('Bearer xoxb-test');
  });

  test('bot mode is untouched — still the bot token even when a user token exists', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackAuthMode: 'bot', slackUserToken: 'xoxp-test', slackBotToken: 'xoxb-test' }),
      'instance-1',
      SLACK_FILE_URL,
      'slack',
    );
    expect(authorizationOf(options)).toBe('Bearer xoxb-test');
  });

  test('an absent auth mode is untouched — still the bot token', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackBotToken: 'xoxb-test' }),
      'instance-1',
      SLACK_FILE_URL,
      'slack',
    );
    expect(authorizationOf(options)).toBe('Bearer xoxb-test');
  });

  test('a row with no token at all downloads unauthenticated, as before', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackAuthMode: 'user' }),
      'instance-1',
      SLACK_FILE_URL,
      'slack',
    );
    expect(options).toBeUndefined();
  });

  test('non-Slack channels never get an Authorization header', async () => {
    const options = await buildFetchOptions(
      ctxReturning({ slackAuthMode: 'user', slackUserToken: 'xoxp-test', slackBotToken: 'xoxb-test' }),
      'instance-1',
      SLACK_FILE_URL,
      'whatsapp-baileys',
    );
    expect(options).toBeUndefined();
  });

  test('a URL off the slack.com hosts never gets either token', async () => {
    const userRow = ctxReturning({ slackAuthMode: 'user', slackUserToken: 'xoxp-test', slackBotToken: 'xoxb-test' });
    const botRow = ctxReturning({ slackAuthMode: 'bot', slackBotToken: 'xoxb-test' });
    const offSlack = [
      'https://slack.com.evil.test/files-pri/photo.png',
      'https://evilslack.com/files-pri/photo.png',
      'https://evil.test/photo.png',
      'https://slack.com@evil.test/photo.png',
      'http://files.slack.com/files-pri/photo.png',
      'not a url',
    ];
    for (const mediaUrl of offSlack) {
      expect(await buildFetchOptions(userRow, 'instance-1', mediaUrl, 'slack')).toBeUndefined();
      expect(await buildFetchOptions(botRow, 'instance-1', mediaUrl, 'slack')).toBeUndefined();
    }
    const apex = await buildFetchOptions(botRow, 'instance-1', 'https://slack.com/files-pri/photo.png', 'slack');
    expect(authorizationOf(apex)).toBe('Bearer xoxb-test');
  });

  test('a failed instance lookup falls back to an unauthenticated download', async () => {
    const ctx = {
      services: {
        instances: {
          getById: async () => {
            throw new Error('instance lookup failed');
          },
        },
      },
    } as unknown as MediaProcessorContext;
    expect(await buildFetchOptions(ctx, 'instance-1', SLACK_FILE_URL, 'slack')).toBeUndefined();
  });
});
