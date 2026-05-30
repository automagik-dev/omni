import { describe, expect, it } from 'bun:test';
import { isFirstPartyInstanceSender } from '../plugins/agent-dispatcher';

describe('isFirstPartyInstanceSender', () => {
  it('detects cross-owned WhatsApp sender by resolvedSenderPhone', () => {
    const result = isFirstPartyInstanceSender(
      {
        from: '54958418317348@lid',
        rawPayload: {
          resolvedSenderPhone: '5512982298888',
          resolvedPhoneJid: '5512982298888@s.whatsapp.net',
          key: {
            remoteJid: '54958418317348@lid',
            remoteJidAlt: '5512982298888@s.whatsapp.net',
          },
        },
      },
      '5511986780008:12@s.whatsapp.net',
      ['5511986780008:12@s.whatsapp.net', '5512982298888:43@s.whatsapp.net'],
    );

    expect(result).toBe(true);
  });

  it('does not treat normal external contacts as first-party', () => {
    const result = isFirstPartyInstanceSender(
      {
        from: '5511999999999@s.whatsapp.net',
        rawPayload: { resolvedSenderPhone: '5511999999999' },
      },
      '5511986780008:12@s.whatsapp.net',
      ['5511986780008:12@s.whatsapp.net', '5512982298888:43@s.whatsapp.net'],
    );

    expect(result).toBe(false);
  });

  it('does not reintroduce the old same-owner self-filter for current owner messages', () => {
    const result = isFirstPartyInstanceSender(
      {
        from: '5511986780008@s.whatsapp.net',
        rawPayload: { resolvedSenderPhone: '5511986780008' },
      },
      '5511986780008:12@s.whatsapp.net',
      ['5511986780008:12@s.whatsapp.net', '5512982298888:43@s.whatsapp.net'],
    );

    expect(result).toBe(false);
  });
});
