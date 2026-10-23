/**
 * The operator's way in: omni claim, omni approve <code>, and `omni connect` with no
 * arguments (commands/connect.ts). They call /api/v2/owner with this CLI's key, which
 * must hold auth:admin (the primary key does). Whoever runs the server owns it: on an
 * unclaimed Omni, approve and connect claim it first and say so. No WhatsApp needed.
 */

import { Command } from 'commander';
import qrcode from 'qrcode-terminal';
import { exitNotAuthenticated } from '../client.js';
import { hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';

const DEFAULT_API_URL = 'http://localhost:8882';

type OwnerReply = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string };

/** POST to /api/v2/owner/<path> as this CLI's key. */
export async function ownerRequest(
  path: 'claim' | 'approve' | 'connect',
  body: Record<string, unknown> = {},
  fetcher: typeof fetch = fetch,
): Promise<OwnerReply> {
  if (!hasAuth()) exitNotAuthenticated();
  const config = loadConfig();
  const response = await fetcher(`${config.apiUrl ?? DEFAULT_API_URL}/api/v2/owner/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey ?? '' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    error?: { message?: string };
  } | null;
  if (response.ok) return { ok: true, data: json?.data ?? {} };
  const message =
    response.status === 403
      ? "This CLI's key can't do that: it needs auth:admin (the primary key has it)."
      : response.status === 404 && path !== 'approve'
        ? 'This Omni is too old for omni claim / approve / connect. Update it first: omni update'
        : (json?.error?.message ?? `The Omni answered ${response.status}`);
  return { ok: false, status: response.status, message };
}

const claimedLine =
  'This Omni had no owner, so it is yours now: you run it. Link WhatsApp later to approve from your phone.';

export function createClaimCommand(): Command {
  return new Command('claim').description('Make this Omni yours (no WhatsApp needed)').action(async () => {
    const reply = await ownerRequest('claim');
    if (!reply.ok) return output.error(reply.message);
    if (output.getCurrentFormat() === 'json') return output.data(reply.data);
    if (reply.data.claimed) output.success('This Omni is yours now.');
    else output.info('This Omni already has an owner.');
    if (!reply.data.whatsapp)
      output.tip('Approve devices with: omni approve <code>. Or link WhatsApp from the claim link in the server log.');
  });
}

export function createApproveCommand(): Command {
  return new Command('approve')
    .description('Let a device in: the code it shows (e.g. ABCD-EFGH)')
    .argument('<code>', 'The code the device shows')
    .action(async (code: string) => {
      const reply = await ownerRequest('approve', { userCode: code });
      if (!reply.ok) return output.error(reply.message);
      if (output.getCurrentFormat() === 'json') return output.data(reply.data);
      if (reply.data.claimed) output.info(claimedLine);
      const from = reply.data.requestedFrom as { ip?: string | null } | null;
      output.success(
        `Approved ${reply.data.client}${from?.ip ? `, asking from ${from.ip}` : ''}. It is signing in now.`,
      );
    });
}

/** `omni connect` with no arguments: a one-time link that connects one device, and its QR. */
export async function printConnectLink(options: { url?: string }): Promise<void> {
  const reply = await ownerRequest('connect', options.url ? { url: options.url } : {});
  if (!reply.ok) return output.error(reply.message);
  if (output.getCurrentFormat() === 'json') return output.data(reply.data);
  if (reply.data.claimed) output.info(claimedLine);
  const url = String(reply.data.url);
  output.header('Connect a device to this Omni');
  output.raw(`Open this on the computer you want to connect, or paste it in the Omni app:\n\n  ${url}\n`);
  await new Promise<void>((done) =>
    qrcode.generate(url, { small: true }, (art: string) => {
      output.raw(art);
      done();
    }),
  );
  output.dim(`Works once, until ${reply.data.expiresAt}. Devices elsewhere? Pass --url https://your-omni-address`);
}
