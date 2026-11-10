import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { loadCommandTree, scanPluginFiles } from './check-skill-cli';

const root = resolve(import.meta.dir, '..');
const plugin = join(root, 'plugins/omni');

const build = Bun.spawnSync(['make', 'cli-build'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (build.exitCode !== 0) throw new Error(`CLI source build failed (${build.exitCode})`);

// RFC-0005: resolve the shipped manifest, router and peers without a Claude session or server.
z.object({ name: z.literal('omni') }).parse(
  JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8')),
);
const routerPath = join(plugin, 'skills/omni/SKILL.md');
const router = readFileSync(routerPath, 'utf8');
const peers = [...router.matchAll(/\]\((\.\.\/[^)]+\/SKILL\.md)\)/g)];
if (!peers.length) throw new Error('Plugin router resolves no peer skills');
for (const peer of peers) {
  if (!readFileSync(resolve(dirname(routerPath), peer[1] ?? ''), 'utf8').trim()) {
    throw new Error(`Empty router peer: ${peer[1]}`);
  }
}

// Reuse the command/flag checker, including its nested-command and source-line diagnostics.
const tree = await loadCommandTree();
const { count, invocations, errors } = scanPluginFiles(plugin, tree);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
else {
  const home = mkdtempSync(join(tmpdir(), 'omni-plugin-smoke-'));
  try {
    const help = Bun.spawnSync([process.execPath, join(root, 'packages/cli/dist/index.js'), '--help'], {
      cwd: root,
      env: { HOME: home, PATH: process.env.PATH, NO_COLOR: '1' },
    });
    if (help.exitCode !== 0 || !help.stdout.toString().includes('Usage: omni')) {
      throw new Error(`Built CLI help failed (${help.exitCode}): ${help.stderr.toString()}`);
    }
    console.log(
      `Plugin smoke: built CLI help, manifest, router and ${new Set(peers.map((peer) => peer[1])).size} peers loaded; ${count} files, ${invocations} invocations match the registered CLI`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
