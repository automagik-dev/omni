/**
 * omni-runner.js - Finds and invokes bun/omni regardless of PATH
 *
 * Claude Code plugin hooks execute in restricted PATH environments where
 * ~/.bun/bin isn't available. This Node.js shim (always in PATH because
 * Claude Code requires Node) probes common locations to find bun and omni.
 *
 * Subcommands:
 *   setup  - Install/update omni CLI, bootstrap server, write marker
 *   health - Ensure omni is installed, check server health, auto-recover
 *   run    - Forward args to omni CLI (only subcommand that may exit non-zero)
 *
 * The SessionStart hook that invoked `health` was retired (hooks-v2#retire):
 * the health probe now lives in `genie doctor` as its `omni bridge health`
 * check. Nothing fires this runner automatically on session start anymore;
 * the subcommands below remain for explicit operator use.
 *
 * Usage: node omni-runner.js <setup|health|run> [args...]
 */

import { spawnSync, execFileSync } from 'child_process';
import { existsSync, accessSync, readFileSync, writeFileSync, constants } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const log = (prefix, msg) => process.stderr.write(`[${prefix}] ${msg}\n`);

/**
 * Synchronous spawn wrapper. Returns { status, stdout, stderr, error }.
 */
const exec = (cmd, args = [], opts = {}) => {
  const defaults = { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] };
  return spawnSync(cmd, args, { ...defaults, ...opts });
};

/**
 * Check if a path exists and is executable.
 */
const isExecutable = (filePath) => {
  try {
    if (!existsSync(filePath)) return false;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Ensure bun's directory is in process.env.PATH so that child processes
 * (especially omni, whose shebang is #!/usr/bin/env bun) can find it.
 */
const ensureBunInPath = (bunPath) => {
  if (!bunPath) return;
  const bunDir = dirname(bunPath);
  const currentPath = process.env.PATH || '';
  if (!currentPath.split(':').includes(bunDir)) {
    process.env.PATH = `${bunDir}:${currentPath}`;
  }
};

// ---------------------------------------------------------------------------
// findBun() - returns absolute path or null
// ---------------------------------------------------------------------------

const findBun = () => {
  // 1. PATH lookup via `which`
  try {
    const result = execFileSync('which', ['bun'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const found = result.trim();
    if (found) return found;
  } catch {
    // not in PATH
  }

  // 2. ~/.bun/bin/bun
  const homeBun = join(homedir(), '.bun', 'bin', 'bun');
  if (isExecutable(homeBun)) return homeBun;

  // 3. /usr/local/bin/bun
  const usrBun = '/usr/local/bin/bun';
  if (isExecutable(usrBun)) return usrBun;

  return null;
};

// ---------------------------------------------------------------------------
// findOmni(bunPath) - returns absolute path or null
// ---------------------------------------------------------------------------

const findOmni = (bunPath) => {
  // 1. PATH lookup via `which`
  try {
    const result = execFileSync('which', ['omni'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const found = result.trim();
    if (found) return found;
  } catch {
    // not in PATH
  }

  // 2. bun global bin directory
  if (bunPath) {
    try {
      const binDir = execFileSync(bunPath, ['pm', 'bin', '-g'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const candidate = join(binDir, 'omni');
      if (isExecutable(candidate)) return candidate;
    } catch {
      // bun pm bin -g failed
    }
  }

  // 3. ~/.bun/bin/omni (common symlink location)
  const homeOmni = join(homedir(), '.bun', 'bin', 'omni');
  if (isExecutable(homeOmni)) return homeOmni;

  return null;
};

// ---------------------------------------------------------------------------
// Read plugin.json version
// ---------------------------------------------------------------------------

const readPluginVersion = () => {
  try {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
    const pluginJsonPath = join(pluginRoot, '.claude-plugin', 'plugin.json');
    const data = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    return data.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

// ---------------------------------------------------------------------------
// Get version string from a CLI tool
// ---------------------------------------------------------------------------

const getVersion = (binPath, args = ['--version']) => {
  try {
    const result = exec(binPath, args);
    // Parse bare version from output like "2.260224.3 (server: ...)"
    const raw = (result.stdout || '').trim();
    return raw.split(/\s+/)[0] || 'unknown';
  } catch {
    return 'unknown';
  }
};

// ---------------------------------------------------------------------------
// Marker file path
// ---------------------------------------------------------------------------

const getMarkerPath = () => {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
  return join(pluginRoot, '.install-version');
};

// ---------------------------------------------------------------------------
// Read persisted update channel
//
// `omni update --next` writes `updateChannel: "next"` to ~/.omni/config.json,
// but this runner has historically hardcoded `bun add -g @automagik/omni`
// (which resolves to @latest = stable), silently downgrading users who
// explicitly opted into the next channel. Read the persisted choice so the
// install/update paths here respect the user's intent. Defaults to `latest`.
// ---------------------------------------------------------------------------

const getUpdateChannel = () => {
  try {
    const cfgPath = join(homedir(), '.omni', 'config.json');
    if (!existsSync(cfgPath)) return 'latest';
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    return cfg.updateChannel === 'next' ? 'next' : 'latest';
  } catch {
    return 'latest';
  }
};

const omniPackageSpec = () => `@automagik/omni@${getUpdateChannel()}`;

// ---------------------------------------------------------------------------
// Subcommand: setup
// ---------------------------------------------------------------------------

const cmdSetup = () => {
  try {
    // 1. Find bun
    const bunPath = findBun();
    if (!bunPath) {
      log('omni-setup', 'bun not found. Install it first:  curl -fsSL https://bun.sh/install | bash');
      process.exit(0);
    }
    ensureBunInPath(bunPath);

    // 2. Find omni (before install/update)
    let omniPath = findOmni(bunPath);

    const spec = omniPackageSpec();
    if (!omniPath) {
      // Install omni CLI on the user's persisted channel
      log('omni-setup', `Installing ${spec}...`);
      const install = exec(bunPath, ['add', '-g', spec], { stdio: ['pipe', 'inherit', 'inherit'] });
      if (install.status !== 0) {
        log('omni-setup', `Install failed -- you can install manually: bun add -g ${spec}`);
        process.exit(0);
      }
    } else {
      // Update omni CLI on the user's persisted channel (next or latest)
      log('omni-setup', `Updating to ${spec}...`);
      const updateResult = exec(bunPath, ['add', '-g', spec], { stdio: ['pipe', 'inherit', 'inherit'] });
      if (updateResult.status !== 0) {
        log('omni-setup', 'Update failed -- continuing with current version');
      }
    }

    // 3. Find omni again after install/update
    omniPath = findOmni(bunPath);
    if (!omniPath) {
      log('omni-setup', 'Installed but omni not found in PATH. Add bun global bin to your PATH.');
      process.exit(0);
    }

    // 4. Bootstrap server (idempotent -- skips if already running)
    log('omni-setup', 'Bootstrapping server...');
    exec(omniPath, ['install', '--non-interactive'], { stdio: ['pipe', 'inherit', 'inherit'] });

    // 5. Check server health
    let healthy = false;
    const statusResult = exec(omniPath, ['status', '--json']);
    if (statusResult.status === 0 && statusResult.stdout) {
      try {
        const status = JSON.parse(statusResult.stdout);
        healthy = status.apiStatus === 'healthy';
      } catch {
        // JSON parse failed
      }
    }

    // 6. Write marker file
    const omniVersion = getVersion(omniPath);
    const bunVersion = getVersion(bunPath);
    const pluginVersion = readPluginVersion();
    const marker = {
      pluginVersion,
      bunVersion,
      omniVersion,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(getMarkerPath(), JSON.stringify(marker, null, 2) + '\n', 'utf-8');

    // 7. Summary
    const healthStr = healthy ? 'server healthy' : 'server not healthy';
    log('omni-setup', `Installed omni v${omniVersion} -- ${healthStr}`);
  } catch (err) {
    log('omni-setup', `Unexpected error: ${err.message}`);
  }

  process.exit(0);
};

// ---------------------------------------------------------------------------
// Subcommand: health
// ---------------------------------------------------------------------------

const cmdHealth = () => {
  try {
    // 1. Find bun (needed for findOmni, install, and omni's shebang)
    const bunPath = findBun();
    if (!bunPath) {
      log('omni', 'bun not found -- install: curl -fsSL https://bun.sh/install | bash');
      process.exit(0);
    }
    ensureBunInPath(bunPath);

    // 2. Find omni — if missing, auto-install (first-time setup)
    let omniPath = findOmni(bunPath);
    if (!omniPath) {
      const spec = omniPackageSpec();
      log('omni', `CLI not found -- installing ${spec}...`);
      const install = exec(bunPath, ['add', '-g', spec], { stdio: ['pipe', 'inherit', 'inherit'] });
      if (install.status !== 0) {
        log('omni', `Install failed -- run manually: bun add -g ${spec}`);
        process.exit(0);
      }
      omniPath = findOmni(bunPath);
      if (!omniPath) {
        log('omni', 'Installed but CLI not found in PATH');
        process.exit(0);
      }

      // First install: bootstrap server too
      log('omni', 'Bootstrapping server...');
      exec(omniPath, ['install', '--non-interactive'], { stdio: ['pipe', 'inherit', 'inherit'] });

      // Write marker
      const marker = {
        pluginVersion: readPluginVersion(),
        bunVersion: getVersion(bunPath),
        omniVersion: getVersion(omniPath),
        installedAt: new Date().toISOString(),
      };
      writeFileSync(getMarkerPath(), JSON.stringify(marker, null, 2) + '\n', 'utf-8');
    }

    const version = getVersion(omniPath);

    // 3. Check server status
    let statusJson = null;
    const statusResult = exec(omniPath, ['status', '--json']);
    if (statusResult.status === 0 && statusResult.stdout) {
      try {
        statusJson = JSON.parse(statusResult.stdout);
      } catch {
        // parse failed
      }
    }

    // 4. If unhealthy or not running, try auto-recovery
    const isHealthy = statusJson && statusJson.apiStatus === 'healthy';
    if (!isHealthy) {
      // Attempt to start
      const startResult = exec(omniPath, ['start'], { stdio: ['pipe', 'inherit', 'inherit'] });
      if (startResult.status !== 0) {
        log('omni', 'start command failed -- will re-check status anyway');
      }

      // Wait 3 seconds for startup
      spawnSync('sleep', ['3']);

      // Re-check status
      const retryResult = exec(omniPath, ['status', '--json']);
      if (retryResult.status === 0 && retryResult.stdout) {
        try {
          statusJson = JSON.parse(retryResult.stdout);
        } catch {
          statusJson = null;
        }
      } else {
        statusJson = null;
      }
    }

    // 5. Parse service count and report
    if (!statusJson) {
      log('omni', `v${version} -- server not running`);
      process.exit(0);
    }

    const finalHealthy = statusJson.apiStatus === 'healthy';
    let serviceCount = 0;
    if (Array.isArray(statusJson.processes)) {
      serviceCount = statusJson.processes.filter((p) => p.pid != null).length;
    }

    if (finalHealthy) {
      log('omni', `v${version} -- healthy (${serviceCount} services)`);
    } else {
      log('omni', `v${version} -- unhealthy`);
    }
  } catch (err) {
    log('omni', `Unexpected error: ${err.message}`);
  }

  process.exit(0);
};

// ---------------------------------------------------------------------------
// Subcommand: run
// ---------------------------------------------------------------------------

const cmdRun = (args) => {
  const bunPath = findBun();
  if (bunPath) ensureBunInPath(bunPath);

  const omniPath = findOmni(bunPath);

  if (!omniPath) {
    log('omni', `CLI not found. Install with: bun add -g ${omniPackageSpec()}`);
    process.exit(1);
  }

  const result = spawnSync(omniPath, args, { stdio: 'inherit' });

  if (result.error) {
    log('omni', `Failed to spawn omni: ${result.error.message}`);
    process.exit(1);
  }

  if (result.signal) {
    log('omni', `Process terminated by signal: ${result.signal}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
};

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

const subcommand = process.argv[2];
const remainingArgs = process.argv.slice(3);

switch (subcommand) {
  case 'setup':
    cmdSetup();
    break;
  case 'health':
    cmdHealth();
    break;
  case 'run':
    cmdRun(remainingArgs);
    break;
  default:
    process.stderr.write('Usage: node omni-runner.js <setup|health|run> [args...]\n');
    process.exit(1);
}
