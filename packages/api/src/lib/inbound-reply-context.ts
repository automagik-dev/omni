/**
 * Opt-in inbound reply context (PR #1297), shared by every `plugin.connect()`
 * call site that builds options from a persisted instance row: the create,
 * connect and restart routes (routes/v2/instances.ts) and boot/health
 * auto-reconnect (plugins/instance-monitor.ts).
 *
 * The WhatsApp (Baileys) plugin reads `config.options.inboundReplyContext` in
 * `createConnection()` and only then adds `replyTo` / `target` to its events.
 * The key is set ONLY when the flag is on, so a connect for an instance that
 * has not opted in carries exactly the options it carried before.
 */
export function applyInboundReplyContextOption(
  options: Record<string, unknown>,
  instance: { channel: string; inboundReplyContext?: boolean | null },
): void {
  if (instance.channel === 'whatsapp-baileys' && instance.inboundReplyContext === true) {
    options.inboundReplyContext = true;
  }
}
