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

function resolveBuildNumber(): number {
  const raw = process.env.OMNI_BUILD_NUMBER ?? process.env.BUILD_NUMBER ?? '1';
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid build number: ${raw}. Expected a positive integer.`);
  }

  return parsed;
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
  const buildNumber = resolveBuildNumber();
  const date = resolveDate();
  const commit = resolveCommit();
  const branch = resolveBranch();

  const yyyymmdd = date.replaceAll('-', '');
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
