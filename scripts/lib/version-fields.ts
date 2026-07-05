/**
 * Shared registry of every version field tracked by the omni monorepo.
 *
 * Used by:
 *   - scripts/sync-versions.ts  — writes a single calver to every entry
 *   - scripts/verify-versions.ts — fails CI if any entry drifts from root
 *
 * Four kinds of entries are returned (in this order):
 *   1. Standard package.json files (root + every workspace package)
 *   2. The omni Claude plugin manifest (plugins/omni/.claude-plugin/plugin.json)
 *   3. The marketplace plugin entry (.claude-plugin/marketplace.json -> plugins[name=omni])
 *   4. The umbrella Helm chart appVersion (deploy/helm/omni/Chart.yaml)
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

/**
 * Umbrella Helm chart whose `appVersion` must track the release version.
 * Scoped strictly to this one file — the vendored subchart at
 * deploy/helm/omni/charts/autopg/Chart.yaml is versioned independently
 * (it tracks autopg releases, not omni releases) and must never be touched.
 */
const UMBRELLA_CHART_PATH = 'deploy/helm/omni/Chart.yaml';

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

/**
 * Build a VersionField for the umbrella Helm chart's `appVersion` line.
 *
 * Line-based on purpose: Chart.yaml carries load-bearing comments (the
 * appVersion contract, the autopg dependency rationale) that a YAML/JSON
 * round-trip would strip. Only the single `appVersion: "..."` line is
 * rewritten; every other byte of the file is preserved.
 */
function chartAppVersionField(): VersionField {
  const absPath = join(repoRoot, UMBRELLA_CHART_PATH);
  // Anchored to the top-level key at column 0; matches the first (only)
  // appVersion line. Chart.yaml appVersion is always double-quoted here so
  // calver values like 2.260705.3 are never YAML-coerced.
  const lineRe = /^appVersion: "([^"\n]*)"[ \t]*$/m;

  return {
    path: UMBRELLA_CHART_PATH,
    description: 'umbrella helm chart appVersion',
    read(): string | null {
      if (!existsSync(absPath)) return null;
      const content = readFileSync(absPath, 'utf-8');
      return content.match(lineRe)?.[1] ?? null;
    },
    write(version: string): boolean {
      const content = readFileSync(absPath, 'utf-8');
      const current = content.match(lineRe)?.[1];

      if (current === undefined) {
        throw new Error(`${UMBRELLA_CHART_PATH} has no top-level appVersion: "..." line`);
      }

      if (current === version) {
        return false;
      }

      const updated = content.replace(lineRe, `appVersion: "${version}"`);
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
 *   5. deploy/helm/omni/Chart.yaml (appVersion)
 */
export function getAllVersionFields(): VersionField[] {
  const fields: VersionField[] = [];

  fields.push(topLevelJsonField('package.json', 'root package.json'));

  for (const relPath of findWorkspacePackageJsonPaths()) {
    fields.push(topLevelJsonField(relPath, 'workspace package.json'));
  }

  fields.push(topLevelJsonField('plugins/omni/.claude-plugin/plugin.json', 'omni claude plugin manifest'));

  fields.push(marketplacePluginField());

  fields.push(chartAppVersionField());

  return fields;
}
