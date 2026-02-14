/**
 * TTS Commands
 *
 * omni tts voices - List available TTS voices
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createTtsCommand(): Command {
  const tts = new Command('tts').description('Text-to-speech operations');

  // omni tts voices
  tts
    .command('voices')
    .description('List available TTS voices')
    .action(async () => {
      const client = getClient();

      try {
        const voices = await client.messages.listVoices();

        if (voices.length === 0) {
          output.info('No TTS voices available. Check ElevenLabs configuration.');
          return;
        }

        const items = voices.map((v) => ({
          voiceId: v.voiceId,
          name: v.name,
          category: v.category ?? '-',
        }));

        output.list(items, { emptyMessage: 'No voices found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list voices: ${message}`);
      }
    });

  return tts;
}
