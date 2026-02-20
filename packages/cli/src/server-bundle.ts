/**
 * Server Bundle Path Resolution
 *
 * Locates the bundled server index.js shipped inside the npm package.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as output from './output.js';

/** Get path to the bundled server index.js relative to this binary */
export function getServerBundlePath(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const distDir = dirname(thisFile);
    return join(distDir, 'server', 'index.js');
  } catch {
    // Fallback: relative to cwd (source installs / dev mode)
    return join(process.cwd(), 'dist', 'server', 'index.js');
  }
}

/** Abort with a human-readable bundle-not-found message */
export function bundleNotFoundError(bundlePath: string): never {
  output.error(
    `Server bundle not found at: ${bundlePath}\n  This command requires @automagik/omni installed from npm.\n  Install: bun add -g @automagik/omni\n  Or build locally: make cli-build-full`,
    undefined,
    1,
  );
}
