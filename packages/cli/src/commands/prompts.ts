/**
 * Prompts Commands
 *
 * Convenience CLI for managing LLM prompt overrides.
 *
 * omni prompts list
 * omni prompts get <name>
 * omni prompts set <name> [value]
 * omni prompts reset <name>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

/** Prompt name → settings key mapping */
const PROMPT_MAP: Record<string, string> = {
  image: 'prompt.image_description',
  video: 'prompt.video_description',
  document: 'prompt.document_ocr',
  gate: 'prompt.response_gate',
};

const PROMPT_NAMES = Object.keys(PROMPT_MAP);

function resolveKey(name: string): string {
  const key = PROMPT_MAP[name];
  if (!key) {
    output.error(`Unknown prompt name: ${name}. Valid names: ${PROMPT_NAMES.join(', ')}`);
  }
  return key;
}

export function createPromptsCommand(): Command {
  const prompts = new Command('prompts').description('Manage LLM prompt overrides');

  // omni prompts list
  prompts
    .command('list')
    .description('List all prompt settings with override status')
    .action(async () => {
      const client = getClient();

      try {
        const settings = await client.settings.list({ category: 'prompts' });

        const items = settings.map((s) => {
          const name = Object.entries(PROMPT_MAP).find(([, key]) => key === s.key)?.[0] ?? s.key;
          const hasOverride = s.value !== null && s.value !== '' && s.value !== '********';
          return {
            name,
            key: s.key,
            status: hasOverride ? 'override' : 'default',
            description: s.description ?? '-',
          };
        });

        output.list(items, { emptyMessage: 'No prompt settings found. Run `make restart-api` to seed them.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list prompts: ${message}`);
      }
    });

  // omni prompts get <name>
  prompts
    .command('get <name>')
    .description('Show current prompt (image|video|document|gate)')
    .action(async (name: string) => {
      const key = resolveKey(name);
      const client = getClient();

      try {
        const setting = await client.settings.get(key);
        const hasOverride = setting.value !== null && setting.value !== '';

        output.data({
          name,
          key,
          status: hasOverride ? 'override' : 'default',
          value: hasOverride ? setting.value : '(using code default)',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get prompt: ${message}`);
      }
    });

  // omni prompts set <name> [value]
  prompts
    .command('set <name> [value]')
    .description('Set prompt override (reads stdin if no value, for multiline)')
    .option('--reason <reason>', 'Reason for change')
    .action(async (name: string, value: string | undefined, options: { reason?: string }) => {
      const key = resolveKey(name);
      const client = getClient();

      try {
        let promptValue = value;

        // If no inline value, read from stdin
        if (!promptValue) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(Buffer.from(chunk));
          }
          promptValue = Buffer.concat(chunks).toString('utf-8').trim();
        }

        if (!promptValue) {
          output.error('No prompt value provided. Pass as argument or pipe via stdin.');
        }

        const result = await client.settings.set(key, promptValue, options.reason);

        output.success(`Prompt '${name}' override set`, {
          key: result.key,
          updatedAt: result.updatedAt,
        });
        output.info('Run `make restart-api` to apply the change.');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to set prompt: ${message}`);
      }
    });

  // omni prompts reset <name>
  prompts
    .command('reset <name>')
    .description('Clear prompt override (reverts to code default)')
    .action(async (name: string) => {
      const key = resolveKey(name);
      const client = getClient();

      try {
        await client.settings.set(key, null, 'Reset to code default');

        output.success(`Prompt '${name}' reset to code default`);
        output.info('Run `make restart-api` to apply the change.');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to reset prompt: ${message}`);
      }
    });

  return prompts;
}
