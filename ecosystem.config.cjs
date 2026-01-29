/**
 * PM2 Ecosystem Configuration
 *
 * Manages local development services:
 * - pgserve (PostgreSQL)
 * - nats-server (NATS with JetStream)
 *
 * Services are only started if their *_MANAGED=true env var is set.
 * Environment variables should be loaded by the shell before PM2 runs.
 *
 * Usage: set -a && . ./.env && set +a && pm2 start ecosystem.config.cjs
 * Or just: make dev-services
 */

const path = require('node:path');

const pgserveManaged = process.env.PGSERVE_MANAGED === 'true';
const natsManaged = process.env.NATS_MANAGED === 'true';

const apps = [];

if (pgserveManaged) {
  apps.push({
    name: 'pgserve',
    script: 'bunx',
    args: ['pgserve', '--port', process.env.PGSERVE_PORT || '8432', '--data', process.env.PGSERVE_DATA || './.pgserve-data'].join(
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
    args: ['-js', '-p', process.env.NATS_PORT || '4222'].join(' '),
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
