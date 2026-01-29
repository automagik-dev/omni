/**
 * PM2 Ecosystem Configuration
 *
 * Manages local development services:
 * - pgserve (PostgreSQL)
 * - nats-server (NATS with JetStream)
 *
 * Services are only started if their *_MANAGED=true env var is set.
 * Use `make dev-services` to start, `make dev-stop` to stop.
 */

const fs = require('node:fs');
const path = require('node:path');

// Load .env file manually (since dotenv may not be installed)
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const [key, ...valueParts] = trimmed.split('=');
    if (key) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  }

  return env;
}

const fileEnv = loadEnvFile();
const getEnv = (key, defaultValue) => process.env[key] || fileEnv[key] || defaultValue;

const pgserveManaged = getEnv('PGSERVE_MANAGED') === 'true';
const natsManaged = getEnv('NATS_MANAGED') === 'true';

const apps = [];

if (pgserveManaged) {
  apps.push({
    name: 'pgserve',
    script: 'bunx',
    args: ['pgserve', '--port', getEnv('PGSERVE_PORT', '8432'), '--data', getEnv('PGSERVE_DATA', './.pgserve-data')].join(
      ' ',
    ),
    cwd: __dirname,
    env: {
      NODE_ENV: 'development',
    },
    autorestart: true,
    watch: false,
    max_restarts: 5,
    restart_delay: 1000,
  });
}

if (natsManaged) {
  const natsServerPath = path.join(__dirname, 'bin', 'nats-server');

  apps.push({
    name: 'nats',
    script: natsServerPath,
    args: ['-js', '-p', getEnv('NATS_PORT', '4222')].join(' '),
    cwd: __dirname,
    env: {
      NODE_ENV: 'development',
    },
    autorestart: true,
    watch: false,
    max_restarts: 5,
    restart_delay: 1000,
  });
}

module.exports = { apps };
