/**
 * #1120: the boot/reconnect path must forward Slack user-mode identity, or the
 * plugin defaults to authMode 'bot' and its "user mode needs a userToken" guard
 * never runs — the instance comes up silently acting as the bot.
 */
import { describe, expect, test } from 'bun:test';
import { buildInstanceConnectOptions } from '../instance-monitor';

describe('buildInstanceConnectOptions — slack auth mode (#1120)', () => {
  test('forwards authMode and userToken', () => {
    const options = buildInstanceConnectOptions({
      channel: 'slack',
      slackBotToken: 'xoxb-bot',
      slackUserToken: 'xoxp-user',
      slackAuthMode: 'user',
      slackAppToken: 'xapp-app',
    });
    expect(options).toMatchObject({ botToken: 'xoxb-bot', userToken: 'xoxp-user', authMode: 'user' });
  });

  test("forwards authMode 'user' even without a userToken so the plugin guard refuses to connect", () => {
    const options = buildInstanceConnectOptions({ channel: 'slack', slackBotToken: 'xoxb-bot', slackAuthMode: 'user' });
    expect(options.authMode).toBe('user');
    expect(options.userToken).toBeUndefined();
  });
});
