/**
 * Voice Commands
 *
 * omni voice join --instance <id> --channel <channelId> --guild <guildId>
 * omni voice leave --session <sessionId>
 * omni voice sessions
 * omni voice stream <sessionId> [--format opus|pcm] [--user <userId>] [--save <dir>]
 */

import { Command } from 'commander';
import { loadConfig } from '../config.js';
import * as output from '../output.js';

function apiHeaders(): Record<string, string> {
  const config = loadConfig();
  return { 'x-api-key': config.apiKey ?? '', 'Content-Type': 'application/json' };
}

function apiUrl(path: string): string {
  const config = loadConfig();
  return `${config.apiUrl ?? 'http://localhost:8882'}/api/v2${path}`;
}

export function createVoiceCommand(): Command {
  const voice = new Command('voice').description('Voice channel operations');

  voice
    .command('join')
    .description('Join a Discord voice channel')
    .requiredOption('--instance <id>', 'Instance ID or name')
    .requiredOption('--channel <channelId>', 'Discord voice channel ID')
    .requiredOption('--guild <guildId>', 'Discord guild ID')
    .action(async (opts) => {
      try {
        const res = await fetch(apiUrl('/voice/join'), {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({
            instanceId: opts.instance,
            channelId: opts.channel,
            guildId: opts.guild,
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          output.error('Failed to join', body);
          process.exit(1);
        }
        output.success('Joined voice channel');
        output.data(body);
      } catch (err) {
        output.error('Failed to join voice channel', err);
        process.exit(1);
      }
    });

  voice
    .command('leave')
    .description('Leave a voice session')
    .requiredOption('--session <sessionId>', 'Voice session ID')
    .action(async (opts) => {
      try {
        const res = await fetch(apiUrl('/voice/leave'), {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({ sessionId: opts.session }),
        });
        if (!res.ok) {
          output.error('Failed to leave', await res.json());
          process.exit(1);
        }
        output.success('Left voice session');
      } catch (err) {
        output.error('Failed to leave voice session', err);
        process.exit(1);
      }
    });

  voice
    .command('sessions')
    .description('List active voice sessions')
    .action(async () => {
      try {
        const res = await fetch(apiUrl('/voice/sessions'), { headers: apiHeaders() });
        const body = (await res.json()) as { items: unknown[] };
        if (body.items.length === 0) {
          output.info('No active voice sessions');
        } else {
          output.data(body.items);
        }
      } catch (err) {
        output.error('Failed to list sessions', err);
        process.exit(1);
      }
    });

  voice
    .command('stream <sessionId>')
    .description('Stream voice audio via WebSocket')
    .option('--format <format>', 'Audio format: opus or pcm', 'opus')
    .option('--user <userId>', 'Filter to specific user')
    .option('--save <dir>', 'Save audio frames to directory')
    .option('--events-only', 'Show only control events, no audio stats')
    .action(async (sessionId: string, opts) => {
      const config = loadConfig();
      if (!config.apiKey || !config.apiUrl) {
        output.error('Not authenticated. Run: omni auth login');
        process.exit(1);
      }

      const wsUrl = config.apiUrl.replace(/^http/, 'ws');
      let url = `${wsUrl}/api/v2/voice/stream/${sessionId}?api_key=${config.apiKey}&format=${opts.format}`;
      if (opts.user) url += `&user=${opts.user}`;

      output.info(`Connecting to voice stream: ${sessionId}`);
      output.info(`Format: ${opts.format} | User filter: ${opts.user || 'all'}`);

      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      const stats = new Map<string, { frames: number; bytes: number }>();
      let totalFrames = 0;
      const startTime = Date.now();

      // Save dir setup
      let saveDir = '';
      if (opts.save) {
        const { mkdirSync } = await import('node:fs');
        saveDir = opts.save as string;
        mkdirSync(saveDir, { recursive: true });
        output.info(`Saving audio to: ${saveDir}`);
      }

      ws.onopen = () => {
        output.success('Connected to voice stream');
      };

      const handleControl = (data: string): void => {
        const msg = JSON.parse(data) as Record<string, unknown>;
        const ts = new Date().toLocaleTimeString();
        const label = msg.userId || msg.sessionId || '';
        output.info(`[${ts}] ${String(msg.type)}: ${String(label)}`);
      };

      ws.onmessage = async (ev) => {
        if (typeof ev.data === 'string') {
          handleControl(ev.data);
          return;
        }

        // Binary = tagged audio frame
        const buf = Buffer.from(ev.data as ArrayBuffer);
        const userIdLen = buf[0] ?? 0;
        const userId = buf.subarray(1, 1 + userIdLen).toString('utf8');
        const audio = buf.subarray(1 + userIdLen);

        let s = stats.get(userId);
        if (!s) {
          s = { frames: 0, bytes: 0 };
          stats.set(userId, s);
          const ts = new Date().toLocaleTimeString();
          output.info(`[${ts}] New speaker: ${userId}`);
        }
        s.frames++;
        s.bytes += audio.length;
        totalFrames++;

        // Save to file if --save
        if (saveDir) {
          const { appendFileSync } = await import('node:fs');
          appendFileSync(`${saveDir}/${userId}.opus`, audio);
        }

        // Print stats periodically
        if (!opts.eventsOnly && totalFrames % 500 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const lines: string[] = [];
          for (const [uid, st] of stats) {
            lines.push(`  ${uid}: ${st.frames} frames, ${(st.bytes / 1024).toFixed(1)}KB`);
          }
          output.info(`[${elapsed}s] ${totalFrames} frames total\n${lines.join('\n')}`);
        }
      };

      ws.onerror = () => {
        output.error('WebSocket error');
      };

      ws.onclose = (ev) => {
        output.info(`Disconnected: code=${ev.code} ${ev.reason}`);
        // Print final stats
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        output.info(`Session lasted ${elapsed}s, ${totalFrames} total frames`);
        for (const [uid, st] of stats) {
          output.info(`  ${uid}: ${st.frames} frames, ${(st.bytes / 1024).toFixed(1)}KB`);
        }
        process.exit(0);
      };

      // Graceful shutdown
      process.on('SIGINT', () => {
        output.info('Closing stream...');
        ws.close();
      });

      // Keep process alive
      await new Promise(() => {});
    });

  return voice;
}
