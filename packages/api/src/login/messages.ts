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

/** `device` names what signed in, as DEVICE_CLIENTS does ("the Automagik app"). */
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

/** The answer to "connect": a link alone on its line, so WhatsApp makes it one tap. */
export function connectLinkMessage(url: string, minutes: number): string {
  return [
    '🐙 *Connect a device to your Omni*',
    '',
    'Open this on the computer you want to connect:',
    url,
    '',
    `_Works once, for ${minutes} minutes. Didn't ask for it? Ignore this message._`,
  ].join('\n');
}

/** The owner's yes for an update an app or key asked for: the reply sits alone on its line. */
export function updateConfirmMessage(from: string, to: string, code: string, minutes: number): string {
  return [
    '🐙 *Update your Omni?*',
    '',
    `Something connected to your Omni asked to update it from ${from} to ${to}. To go ahead, reply:`,
    `update ${code}`,
    '',
    `_Works once, for ${minutes} minutes. Didn't ask for it? Ignore this message and nothing changes._`,
  ].join('\n');
}

export function updateStartedMessage(from: string, to: string): string {
  return `🐙 Updating Omni from ${from} to ${to}. It restarts on its own; I'll tell you here when it's back.`;
}

export function updateCodeWrongMessage(cancelled: boolean): string {
  return cancelled
    ? '🐙 Too many wrong update codes, so I cancelled the update. Ask for it again from the app.'
    : "🐙 That update code doesn't match. Check it and reply again.";
}

export function updateFinishedMessage(to: string, running: string, ok: boolean): string {
  return ok ? `🐙 *Omni updated to ${to}.*` : `🐙 The update to ${to} did not complete; Omni is still on ${running}.`;
}

/** The answer to "connect" when this Omni has no fixed address to put in a link. */
export function connectNeedsAddressMessage(): string {
  return [
    "🐙 I can't send you a link: I don't know the address you reach me on.",
    '',
    'Run `omni connect` on the server for a link, or set OMNI_PUBLIC_URL (or the server.public_url setting) and text *connect* again.',
  ].join('\n');
}

export function connectTooSoonMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `🐙 That's a lot of connect links. Wait ${minutes} minute${minutes === 1 ? '' : 's'} and text *connect* again.`;
}
