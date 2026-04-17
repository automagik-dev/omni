#!/usr/bin/env bun
/**
 * Echo Bot — Mini app example for Omni Voice Gateway.
 *
 * Connects to a voice session via WebSocket, receives audio from all
 * participants, and sends it back so the bot echoes everything it hears.
 *
 * Usage:
 *   bun run examples/echo-bot.ts <sessionId> [apiKey] [apiUrl]
 */

const SESSION_ID = process.argv[2];
const API_KEY = process.argv[3] || process.env.OMNI_API_KEY || '';
const API_URL = (process.argv[4] || process.env.OMNI_API_URL || 'http://localhost:8882').replace(/^http/, 'ws');

if (!SESSION_ID || !API_KEY) {
  process.stderr.write('Usage: bun run examples/echo-bot.ts <sessionId> <apiKey> [apiUrl]\n');
  process.exit(1);
}

const url = `${API_URL}/api/v2/voice/stream/${SESSION_ID}?api_key=${API_KEY}&format=opus`;
process.stdout.write(`Echo bot connecting to session: ${SESSION_ID}\n`);

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';

let echoedFrames = 0;
const startTime = Date.now();

ws.onopen = () => {
  process.stdout.write('Connected — echoing all audio back to Discord\n');
};

ws.onmessage = (ev) => {
  if (typeof ev.data === 'string') {
    const msg = JSON.parse(ev.data) as Record<string, unknown>;
    process.stdout.write(`${String(msg.type)}: ${String(msg.userId || msg.sessionId || '')}\n`);
    return;
  }

  const buf = Buffer.from(ev.data as ArrayBuffer);
  const userIdLen = buf[0] ?? 0;
  const audio = buf.subarray(1 + userIdLen);

  ws.send(audio);

  echoedFrames++;
  if (echoedFrames % 500 === 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    process.stdout.write(`${echoedFrames} frames echoed (${elapsed}s)\n`);
  }
};

ws.onerror = () => {
  process.stderr.write('WebSocket error\n');
};

ws.onclose = (ev) => {
  process.stdout.write(`Disconnected: code=${ev.code} ${ev.reason}\n`);
  process.exit(0);
};

process.on('SIGINT', () => {
  ws.close();
});

await new Promise(() => {});
