/**
 * Shared registry of every version field tracked by the omni monorepo.
 *
 * Used by:
 *   - scripts/sync-versions.ts  — writes a single calver to every entry
 *   - scripts/verify-versions.ts — fails CI if any entry drifts from root
 *
 * Three kinds of entries are returned (in this order):
 *   1. Standard package.json files (root + every workspace package)
 *   2. The omni Claude plugin manifest (plugins/omni/.claude-plugin/plugin.json)
 *   3. The marketplace plugin entry (.claude-plugin/marketplace.json -> plugins[name=omni])
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, '..', '..');

/** Workspace package directories that should NOT be touched by version sync. */
const EXCLUDED_WORKSPACE_PACKAGES = new Set(['audio-decode-shim']);

/** Marketplace plugin entry that this repo owns and keeps in sync. */
const MARKETPLACE_PLUGIN_NAME = 'omni';

export type VersionField = {
  /** Path relative to the repo root, used for human-readable output. */
  path: string;
  /** Short label describing what kind of field this is. */
  description: string;
  /** Returns the version currently stored in the file, or null if missing. */
  read: () => string | null;
  /** Writes the version. Returns true if the file was changed. */
  write: (version: string) => boolean;
};

function detectIndent(content: string): string {
  return content.match(/^(\s+)"/m)?.[1] ?? '  ';
}

/** Build a VersionField that targets a top-level `version` key in a JSON file. */
function topLevelJsonField(relPath: string, description: string): VersionField {
  const absPath = join(repoRoot, relPath);

  return {
    path: relPath,
    description,
    read(): string | null {
      if (!existsSync(absPath)) return null;
      const content = readFileSync(absPath, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;
      return typeof data.version === 'string' ? data.version : null;
    },
    write(version: string): boolean {
      const content = readFileSync(absPath, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;

      if (data.version === version) {
        return false;
      }

      data.version = version;
      const indent = detectIndent(content);
      const updated = `${JSON.stringify(data, null, indent)}\n`;
      writeFileSync(absPath, updated, 'utf-8');
      return true;
    },
  };
}

/** Build a VersionField for the nested marketplace plugin entry. */
function marketplacePluginField(): VersionField {
  const relPath = '.claude-plugin/marketplace.json';
  const absPath = join(repoRoot, relPath);

  type MarketplacePlugin = { name: string; version: string };
  type Marketplace = { plugins: MarketplacePlugin[] };

  return {
    path: relPath,
    description: `marketplace plugin "${MARKETPLACE_PLUGIN_NAME}"`,
    read(): string | null {
      if (!existsSync(absPath)) return null;
      const content = readFileSync(absPath, 'utf-8');
      const data = JSON.parse(content) as Marketplace;
      const entry = data.plugins?.find((p) => p.name === MARKETPLACE_PLUGIN_NAME);
      return entry && typeof entry.version === 'string' ? entry.version : null;
    },
    write(version: string): boolean {
      const content = readFileSync(absPath, 'utf-8');
      const data = JSON.parse(content) as Marketplace;
      const entry = data.plugins?.find((p) => p.name === MARKETPLACE_PLUGIN_NAME);

      if (!entry) {
        throw new Error(`marketplace.json has no plugin named "${MARKETPLACE_PLUGIN_NAME}"`);
      }

      if (entry.version === version) {
        return false;
      }

      entry.version = version;
      const indent = detectIndent(content);
      const updated = `${JSON.stringify(data, null, indent)}\n`;
      writeFileSync(absPath, updated, 'utf-8');
      return true;
    },
  };
}

/** Walk packages/* and apps/* and yield package.json paths (excluding the deny list). */
function findWorkspacePackageJsonPaths(): string[] {
  const paths: string[] = [];

  for (const dir of ['packages', 'apps']) {
    const base = join(repoRoot, dir);
    if (!existsSync(base)) continue;

    const entries = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !EXCLUDED_WORKSPACE_PACKAGES.has(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const pkgPath = join(base, entry.name, 'package.json');
      if (existsSync(pkgPath)) {
        paths.push(`${dir}/${entry.name}/package.json`);
      }
    }
  }

  return paths;
}

/**
 * Returns every version field tracked by this repo, in a stable order:
 *   1. root package.json
 *   2. workspace package.json files (alphabetical, packages/ before apps/)
 *   3. plugins/omni/.claude-plugin/plugin.json
 *   4. .claude-plugin/marketplace.json (omni entry)
 */
export function getAllVersionFields(): VersionField[] {
  const fields: VersionField[] = [];

  fields.push(topLevelJsonField('package.json', 'root package.json'));

  for (const relPath of findWorkspacePackageJsonPaths()) {
    fields.push(topLevelJsonField(relPath, 'workspace package.json'));
  }

  fields.push(topLevelJsonField('plugins/omni/.claude-plugin/plugin.json', 'omni claude plugin manifest'));

  fields.push(marketplacePluginField());

  return fields;
}
