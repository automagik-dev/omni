/**
 * Regression for issue #1039: every `POST /messages/send/*` route must be in
 * SCOPE_MAP. The enforcer is deny-by-default, so an unmapped route is a 403
 * for every non-wildcard key regardless of the scopes it holds.
 */
import { describe, expect, it } from 'bun:test';
import { messagesRoutes } from '../../routes/v2/messages';
import { SCOPE_MAP } from '../scopes';

describe('SCOPE_MAP covers /messages/send/*', () => {
  it('maps every registered send route to messages:send', () => {
    const sendRoutes = messagesRoutes.routes
      .filter((r) => r.method === 'POST' && r.path.startsWith('/send'))
      .map((r) => `POST /messages${r.path}`);
    expect(sendRoutes).toContain('POST /messages/send/handoff');
    expect(sendRoutes).toContain('POST /messages/send/close-contact');
    for (const key of sendRoutes) expect(SCOPE_MAP[key]).toBe('messages:send');
  });
});
