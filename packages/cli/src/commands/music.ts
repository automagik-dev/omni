/** Music Command — generate music/audio via Lyria-compatible providers. */

import { writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { getClient } from '../client.js';
import * as output from '../output.js';

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('wav')) return '.wav';
  if (mimeType.includes('ogg') || mimeType.includes('opus')) return '.ogg';
  if (mimeType.includes('aac')) return '.aac';
  if (mimeType.includes('flac')) return '.flac';
  return '.mp3';
}

interface MusicOptions {
  provider?: string;
  model?: string;
  mode?: 'clip' | 'pro';
  duration?: string;
  instrumental?: boolean;
  lyrics?: string;
  genre?: string;
  mood?: string;
  bpm?: string;
  instrument?: string[];
  singerProfile?: string;
  style?: string;
  output?: string;
}

function parsePositiveIntOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid ${flag}: ${value}`);
  return parsed;
}

function assertMusicMode(mode: MusicOptions['mode']): void {
  if (mode && mode !== 'clip' && mode !== 'pro') throw new Error('--mode must be clip or pro');
}

export function createMusicCommand(): Command {
  return new Command('music')
    .description('Generate music/audio from a prompt (Gemini Lyria)')
    .argument('<prompt...>', 'Prompt describing the music/song')
    .option('--provider <name>', 'Music provider (default: config musicgen.provider)')
    .option('--model <model>', 'Model override (e.g. lyria-3-pro-preview, lyria-3-clip-preview)')
    .option('--mode <mode>', 'Generation mode: clip or pro')
    .option('--duration <seconds>', 'Target duration in seconds')
    .option('--instrumental', 'Generate instrumental music without vocals')
    .option('--lyrics <text>', 'Lyrics to include')
    .option('--genre <text>', 'Genre hint')
    .option('--mood <text>', 'Mood hint')
    .option('--bpm <number>', 'Tempo in BPM')
    .option(
      '--instrument <name>',
      'Instrument hint (repeatable)',
      (value, previous: string[] = []) => [...previous, value],
      [],
    )
    .option('--singer-profile <text>', 'Singer/vocal profile')
    .option('--style <text>', 'Style direction')
    .option('-o, --output <path>', 'Save audio to file (default: music.<returned-format>)')
    .action(async (promptParts: string[], options: MusicOptions) => {
      const prompt = promptParts.join(' ').trim();
      if (!prompt) return output.error('Prompt is required. Example: omni music "lo-fi samba for coding"');

      let durationSec: number | undefined;
      let bpm: number | undefined;
      try {
        durationSec = parsePositiveIntOption(options.duration, '--duration');
        bpm = parsePositiveIntOption(options.bpm, '--bpm');
        assertMusicMode(options.mode);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid music options';
        return output.error(message);
      }

      const spinner = ora({ text: 'Generating music…', isEnabled: output.getCurrentFormat() === 'human' }).start();
      try {
        const client = getClient();
        const result = await client.media.music({
          prompt,
          provider: options.provider,
          model: options.model,
          mode: options.mode,
          durationSec,
          instrumental: options.instrumental,
          lyrics: options.lyrics,
          genre: options.genre,
          mood: options.mood,
          bpm,
          instruments: options.instrument,
          singerProfile: options.singerProfile,
          style: options.style,
        });
        const audio = Buffer.from(result.audioBase64, 'base64');
        const out = resolvePath(options.output ?? `music${extensionForMime(result.mimeType)}`);
        writeFileSync(out, audio);
        spinner.succeed(`Music ready (${result.sizeBytes} bytes, ${result.mimeType})`);
        output.success('Music saved', {
          path: out,
          provider: result.provider,
          model: result.model,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          processingMs: result.processingMs,
        });
      } catch (err) {
        spinner.fail('Music generation failed');
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`omni music: ${message}`);
      }
    });
}
