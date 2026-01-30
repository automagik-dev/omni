/**
 * Package scanner for channel plugins
 *
 * Scans the packages directory for channel-* packages
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Discovered channel package information
 */
export interface DiscoveredPackage {
  /** Package name (e.g., 'channel-whatsapp') */
  name: string;

  /** Full path to the package directory */
  path: string;

  /** Path to the package.json */
  packageJsonPath: string;
}

/**
 * Scan for channel packages in a directory
 *
 * Looks for directories matching `channel-*` (excluding `channel-sdk`).
 *
 * @param packagesDir - Path to the packages directory
 * @returns List of discovered channel packages
 */
export async function scanChannelPackages(packagesDir: string): Promise<DiscoveredPackage[]> {
  const discovered: DiscoveredPackage[] = [];

  try {
    const entries = await readdir(packagesDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip non-directories
      if (!entry.isDirectory()) continue;

      // Skip non-channel packages
      if (!entry.name.startsWith('channel-')) continue;

      // Skip the SDK itself
      if (entry.name === 'channel-sdk') continue;

      const packagePath = join(packagesDir, entry.name);
      const packageJsonPath = join(packagePath, 'package.json');

      // Verify package.json exists
      try {
        await stat(packageJsonPath);
        discovered.push({
          name: entry.name,
          path: packagePath,
          packageJsonPath,
        });
      } catch {
        // Skip packages without package.json
      }
    }
  } catch (_error) {
    // Directory doesn't exist or can't be read
    throw new Error(`Failed to scan packages directory: ${packagesDir}`);
  }

  return discovered;
}

/**
 * Get the default packages directory
 *
 * Resolves the path relative to the current working directory
 */
export function getDefaultPackagesDir(): string {
  return join(process.cwd(), 'packages');
}
