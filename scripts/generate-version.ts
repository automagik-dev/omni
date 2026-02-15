#!/usr/bin/env bun

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type VersionArtifact = {
  version: string;
  commit: string;
  date: string;
  branch: string;
  buildNumber: number;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function runGit(command: string): string {
  try {
    return execSync(command, { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Derive build number from git tags for today.
 * Counts existing v2.YYYYMMDD.* tags and returns count + 1.
 * Env var OMNI_BUILD_NUMBER overrides if set.
 */
function resolveBuildNumber(yyyymmdd: string): number {
  // Explicit env var override (for manual/CI use)
  const envOverride = process.env.OMNI_BUILD_NUMBER ?? process.env.BUILD_NUMBER;
  if (envOverride) {
    const parsed = Number.parseInt(envOverride, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Invalid build number: ${envOverride}. Expected a positive integer.`);
    }
    return parsed;
  }

  // Derive from git tags: count v2.YYYYMMDD.* tags (both -dev and release)
  const tagPattern = `v2.${yyyymmdd}.*`;
  const tagOutput = runGit(`git tag --list '${tagPattern}'`);

  if (!tagOutput || tagOutput === 'unknown') {
    return 1;
  }

  const tagCount = tagOutput.split('\n').filter((t) => t.trim().length > 0).length;
  return tagCount + 1;
}

function resolveDate(): string {
  const raw = process.env.OMNI_BUILD_DATE ?? new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid build date: ${raw}. Expected format YYYY-MM-DD.`);
  }

  return raw;
}

function resolveCommit(): string {
  const envCommit = process.env.GIT_COMMIT?.trim();
  if (envCommit) {
    return envCommit.slice(0, 7);
  }
  return runGit('git rev-parse --short HEAD');
}

function resolveBranch(): string {
  const envBranch = process.env.BRANCH_NAME?.trim() ?? process.env.GIT_BRANCH?.trim();
  if (envBranch) {
    return envBranch.replace(/^origin\//, '');
  }
  return runGit('git rev-parse --abbrev-ref HEAD');
}

function main(): void {
  const date = resolveDate();
  const yyyymmdd = date.replaceAll('-', '');
  const buildNumber = resolveBuildNumber(yyyymmdd);
  const commit = resolveCommit();
  const branch = resolveBranch();

  const version = `2.${yyyymmdd}.${buildNumber}`;

  const artifact: VersionArtifact = {
    version,
    commit,
    date,
    branch,
    buildNumber,
  };

  const outputPath = join(repoRoot, 'version.json');
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');

  console.log(`Generated ${outputPath}`);
  console.log(JSON.stringify(artifact));
}

main();
