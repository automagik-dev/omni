/**
 * Explicit CLI presence probe. Usage: node omni-runner.js [health]
 * SessionStart stays retired; `genie doctor` owns the bridge health check.
 * This probe never installs software, starts services, or invokes the CLI.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== 'health')) {
  process.stderr.write('Usage: node omni-runner.js [health]\n');
  process.exit(1);
}

const directories = [
  ...(process.env.PATH || '').split(delimiter).filter(Boolean),
  join(homedir(), '.bun', 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
];

const findExecutable = (name) =>
  directories.map((directory) => join(directory, name)).find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

const omni = findExecutable('omni');
const bun = findExecutable('bun');
if (omni) {
  process.stderr.write(`[omni] CLI found: ${omni}\n`);
} else {
  process.stderr.write('[omni] CLI not found. Install manually: bun add -g @automagik/omni\n');
}
if (!bun) {
  process.stderr.write('[omni] Bun runtime not found. Install manually: https://bun.sh\n');
}
