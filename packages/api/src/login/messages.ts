/**
 * What Omni writes in the owner's chat with themself, in WhatsApp's own formatting
 * (*bold*, _italic_). A code sits alone on its line, so a long press copies only the code.
 */

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function loginCodeMessage(code: string, minutes: number): string {
  return [
    '🐙 *Your Omni sign-in code*',
    '',
    code,
    '',
    `_Good for ${minutes} minutes. Didn't ask for it? Ignore this message._`,
  ].join('\n');
}

/** `device` names what signed in, as DEVICE_CLIENTS does ("the Omni desktop app"). */
export function deviceApprovedMessage(device: string, request?: { ip: string | null; at: number }): string {
  const asked = [
    request?.ip ? `from ${request.ip}` : '',
    request ? `at ${new Date(request.at).toISOString().slice(11, 16)} UTC` : '',
  ].filter(Boolean);
  return [
    '🐙 *New device signed in*',
    '',
    `${sentence(device)} is now connected to your Omni.`,
    ...(asked.length ? [`_It asked ${asked.join(' ')}._`] : []),
    '',
    '*Not you?* In Omni, open *Keys* and revoke its _device:_ key.',
  ].join('\n');
}
