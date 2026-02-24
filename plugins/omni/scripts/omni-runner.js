/**
 * omni-runner.js - Finds and invokes bun/omni regardless of PATH
 *
 * Claude Code plugin hooks execute in restricted PATH environments where
 * ~/.bun/bin isn't available. This Node.js shim (always in PATH because
 * Claude Code requires Node) probes common locations to find bun and omni.
 *
 * Subcommands:
 *   setup  - Install/update omni CLI, bootstrap server, write marker
 *   health - Check server health, auto-recover if unhealthy
 *   run    - Forward args to omni CLI (only subcommand that may exit non-zero)
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

    if (!omniPath) {
      // Install omni CLI
      log('omni-setup', 'Installing @automagik/omni CLI...');
      const install = exec(bunPath, ['add', '-g', '@automagik/omni'], { stdio: ['pipe', 'inherit', 'inherit'] });
      if (install.status !== 0) {
        log('omni-setup', 'Install failed -- you can install manually: bun add -g @automagik/omni');
        process.exit(0);
      }
    } else {
      // Update omni CLI to latest
      log('omni-setup', 'Updating @automagik/omni CLI...');
      exec(bunPath, ['add', '-g', '@automagik/omni@latest'], { stdio: ['pipe', 'inherit', 'inherit'] });
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
    // 1. Find bun (needed for findOmni and omni's shebang)
    const bunPath = findBun();
    if (bunPath) ensureBunInPath(bunPath);

    // 2. Find omni
    const omniPath = findOmni(bunPath);
    if (!omniPath) {
      log('omni', 'CLI not installed -- run: bun add -g @automagik/omni');
      process.exit(0);
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
      exec(omniPath, ['start'], { stdio: ['pipe', 'inherit', 'inherit'] });

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
    log('omni', 'CLI not found. Install with: bun add -g @automagik/omni');
    process.exit(1);
  }

  const result = spawnSync(omniPath, args, { stdio: 'inherit' });

  if (result.error) {
    log('omni', `Failed to spawn omni: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status);
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
