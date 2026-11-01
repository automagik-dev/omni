import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const BUN = readFileSync(join(ROOT, '.bun-version'), 'utf8').trim();
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

// Exercise the actual entrypoints with a private HOME and command fixtures. No network,
// package manager, shell profile or machine-wide Bun is used or changed.
function runInstaller(file: string, version: string, consent = false, installedVersion = version) {
  const home = mkdtempSync(join(tmpdir(), 'omni-bun-installer-'));
  homes.push(home);
  const bin = join(home, 'fixtures');
  mkdirSync(bin);
  mkdirSync(join(home, '.bun/bin'), { recursive: true });
  const script = (path: string, body: string) => writeFileSync(path, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  const bunBody = (v: string) =>
    `if [[ "$1" == --version ]]; then echo '${v}'; elif [[ "$1" == pm ]]; then echo "$HOME/.bun/bin"; fi`;
  script(join(bin, 'bun'), bunBody(version));
  script(join(home, '.bun/bin/bun'), bunBody(installedVersion));
  for (const cmd of ['git', 'make', 'pm2', 'psql', 'ffmpeg', 'node', 'docker', 'omni']) {
    script(join(bin, cmd), 'echo "fixture 1.0.0"');
  }
  script(
    join(bin, 'curl'),
    String.raw`[[ "$*" == *https://bun.sh/install* ]] || exit 91
printf 'called\n' >> "$HOME/downloads"
cat <<'INSTALL'
cat > "$HOME/.bun/bin/bun" <<'BUN'
#!/bin/bash
if [[ "$1" == --version ]]; then echo 'PINNED_BUN'; elif [[ "$1" == pm ]]; then echo "$HOME/.bun/bin"; fi
BUN
chmod +x "$HOME/.bun/bin/bun"
INSTALL`.replace('PINNED_BUN', BUN),
  );
  // Sourcing a profile after installation used to put the wrong Bun back on PATH.
  writeFileSync(join(home, '.bashrc'), 'exit 98\n');
  const args = file === 'install.sh' ? ['--cli'] : file === 'install-client.sh' ? ['--no-color'] : ['--install'];
  const result = Bun.spawnSync(['/bin/bash', join(ROOT, file), ...args], {
    env: {
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      NO_COLOR: '1',
      OMNI_ALLOW_BUN_DOWNGRADE: consent ? '1' : '',
    },
  });
  const output = result.stdout.toString() + result.stderr.toString();
  return { home, output, code: result.exitCode, installed: readFileSync(join(home, '.bun/bin/bun'), 'utf8') };
}

for (const file of ['install.sh', 'install-client.sh', 'scripts/check-dependencies.sh']) {
  describe(file, () => {
    test('explains an older Bun replacement and keeps the pinned Bun ahead of shell profiles', () => {
      const result = runInstaller(file, '1.3.14');
      expect(result.code).toBe(0);
      expect(result.output).toContain('Found Bun 1.3.14');
      expect(result.output).toContain(`will replace ${result.home}/.bun/bin/bun with Bun ${BUN}`);
      expect(result.installed).toContain(BUN);
      expect(readFileSync(join(result.home, 'downloads'), 'utf8')).toBe('called\n');
    });

    for (const version of ['1.4.5', '1.10.0', '2.0.0']) {
      test(`refuses to replace newer Bun ${version} without explicit consent`, () => {
        const result = runInstaller(file, version);
        expect(result.code).toBe(1);
        expect(result.output).toContain(`Refusing to downgrade Bun ${version}`);
        expect(result.output).toContain('OMNI_ALLOW_BUN_DOWNGRADE=1');
        expect(result.installed).toContain(version);
        expect(() => readFileSync(join(result.home, 'downloads'))).toThrow();
      });
    }

    test('also protects a newer ~/.bun binary hidden behind an older PATH binary', () => {
      const result = runInstaller(file, '1.3.14', false, '1.5.0');
      expect(result.code).toBe(1);
      expect(result.output).toContain('Refusing to downgrade Bun 1.5.0');
      expect(result.installed).toContain('1.5.0');
      expect(() => readFileSync(join(result.home, 'downloads'))).toThrow();
    });

    test('allows a downgrade only with explicit consent', () => {
      const result = runInstaller(file, '1.5.0', true);
      expect(result.code).toBe(0);
      expect(result.output).toContain('Found Bun 1.5.0');
      expect(result.installed).toContain(BUN);
      expect(readFileSync(join(result.home, 'downloads'), 'utf8')).toBe('called\n');
    });

    test('leaves an already pinned runtime alone', () => {
      const result = runInstaller(file, BUN);
      expect(result.code).toBe(0);
      expect(() => readFileSync(join(result.home, 'downloads'))).toThrow();
    });
  });
}
