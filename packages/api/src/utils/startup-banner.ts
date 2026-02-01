/**
 * Startup Banner
 *
 * Displays a pretty startup banner with server info
 */

import { createLogger } from '@omni/core';
import { networkInterfaces } from 'node:os';

const log = createLogger('api:startup');

/** ANSI color codes */
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[38;5;75m',
  magenta: '\x1b[35m',
} as const;

/**
 * Box drawing characters
 */
const BOX = {
  topLeft: '\u250C',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
  horizontal: '\u2500',
  vertical: '\u2502',
} as const;

/**
 * Get all local IP addresses
 */
function getLocalIPs(): string[] {
  const ips: string[] = [];
  const interfaces = networkInterfaces();

  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (!addr.internal && addr.family === 'IPv4') {
        ips.push(addr.address);
      }
    }
  }

  return ips;
}

/**
 * Create a padded line for the box
 */
function padLine(content: string, width: number): string {
  // Strip ANSI codes for length calculation
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = width - stripped.length;
  return content + ' '.repeat(Math.max(0, padding));
}

/**
 * Print the startup banner
 */
export function printStartupBanner(options: {
  version: string;
  host: string;
  port: number;
  docsPath?: string;
  healthPath?: string;
  metricsPath?: string;
}): void {
  const { version, host, port, docsPath = '/api/v2/docs', healthPath = '/api/v2/health', metricsPath = '/api/v2/metrics' } = options;

  const localIPs = getLocalIPs();
  const isAllInterfaces = host === '0.0.0.0';
  const baseUrl = isAllInterfaces ? `http://localhost:${port}` : `http://${host}:${port}`;

  const WIDTH = 58;

  const lines: string[] = [];

  // Title
  lines.push('');
  lines.push(`${COLORS.cyan}  Omni API${COLORS.reset} ${COLORS.dim}v${version}${COLORS.reset}`);
  lines.push('');

  // Box top
  lines.push(`  ${COLORS.dim}${BOX.topLeft}${BOX.horizontal.repeat(WIDTH)}${BOX.topRight}${COLORS.reset}`);

  // URLs section
  const addLine = (label: string, value: string, color: string = COLORS.green) => {
    const content = `  ${COLORS.dim}${label}:${COLORS.reset} ${color}${value}${COLORS.reset}`;
    lines.push(`  ${COLORS.dim}${BOX.vertical}${COLORS.reset} ${padLine(content, WIDTH - 2)} ${COLORS.dim}${BOX.vertical}${COLORS.reset}`);
  };

  addLine('Local', baseUrl, COLORS.green);

  if (isAllInterfaces && localIPs.length > 0) {
    for (const ip of localIPs.slice(0, 2)) {
      addLine('Network', `http://${ip}:${port}`, COLORS.blue);
    }
  }

  // Separator
  lines.push(`  ${COLORS.dim}${BOX.vertical}${COLORS.reset} ${' '.repeat(WIDTH - 2)} ${COLORS.dim}${BOX.vertical}${COLORS.reset}`);

  // Links
  addLine('API Docs', `${baseUrl}${docsPath}`, COLORS.cyan);
  addLine('Health', `${baseUrl}${healthPath}`, COLORS.yellow);
  addLine('Metrics', `${baseUrl}${metricsPath}`, COLORS.magenta);

  // Box bottom
  lines.push(`  ${COLORS.dim}${BOX.bottomLeft}${BOX.horizontal.repeat(WIDTH)}${BOX.bottomRight}${COLORS.reset}`);
  lines.push('');

  // Print to stdout directly for the banner
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }

  // Log startup complete (for log consistency)
  log.info('Server ready', { host, port, version });
}
