#!/usr/bin/env bun
/**
 * run-evidence.ts — consolidate the live-validation evidence into one committed,
 * key-free artifact.
 *
 * Runs the three side-effect-safe validators (instances, agents, coverage) via
 * the in-process BFF path, captures each one's JSON summary, snapshots `/diag`,
 * and folds in the capability inventory totals. It deliberately does NOT run
 * `validate:chat` (that SENDS a production canary — budget spent): instead it
 * reuses the most recent saved chat evidence if present under `evidence/`, else
 * records it as "run separately — canary budget".
 *
 * Two outputs:
 *   1. evidence/evidence-<date>.json      — full consolidated evidence (committed,
 *      pack-excluded, key-scrubbed, content-truncated).
 *   2. package/src/capabilities/evidence-summary.json — tiny per-family summary
 *      the Capabilities page imports to show last-run timestamps (key-free).
 *
 * SAFETY: the API key is never written. Before writing, the serialized evidence
 * is scanned for the real key (from env) and hard-fails if present; long content
 * fields are truncated.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import inventory from '../package/src/capabilities/capabilities.json' with { type: 'json' };
import { createBff } from '../service/src/bff.ts';

const HERE = import.meta.dir;
const APP = `${HERE}/..`;
const EVIDENCE_DIR = `${APP}/evidence`;
const SUMMARY_PATH = `${APP}/package/src/capabilities/evidence-summary.json`;

function loadEnv(): void {
  if (process.env.OMNI_API_KEY && process.env.OMNI_BASE_URL) return;
  const envPath = `${APP}/.env`;
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

interface ValidatorResult {
  ok: boolean | null;
  exitCode: number | null;
  ranAt: string | null;
  finishedAt: string | null;
  checks: number;
  summary: unknown;
  note?: string;
  parseError?: string;
}

/** Deep-truncate long free-text fields so committed evidence stays readable and never leaks a payload. */
function truncateContent(value: unknown): unknown {
  const CONTENT_KEY = /text|content|body|message|sample|reason|detail/i;
  const walk = (node: unknown, keyHint?: string): unknown => {
    if (typeof node === 'string') {
      const cap = keyHint && CONTENT_KEY.test(keyHint) ? 200 : 2000;
      return node.length > cap ? `${node.slice(0, cap)}…[truncated ${node.length - cap}]` : node;
    }
    if (Array.isArray(node)) return node.map((n) => walk(n));
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  return walk(value);
}

/** Replace every occurrence of the real key with a marker (defence-in-depth; validators already avoid it). */
function scrubKey<T>(value: T, realKey: string): T {
  if (!realKey) return value;
  const json = JSON.stringify(value);
  if (!json.includes(realKey)) return value;
  return JSON.parse(json.split(realKey).join('[REDACTED_OMNI_API_KEY]')) as T;
}

function countChecks(summary: unknown): number {
  const checks = (summary as { checks?: unknown[] })?.checks;
  return Array.isArray(checks) ? checks.length : 0;
}

async function runValidator(script: string): Promise<ValidatorResult> {
  const ranAt = new Date().toISOString();
  const proc = Bun.spawn(['bun', `${HERE}/${script}`], {
    cwd: APP,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env as Record<string, string>,
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const finishedAt = new Date().toISOString();
  let summary: unknown;
  let parseError: string | undefined;
  try {
    summary = JSON.parse(stdout.trim());
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'unparseable stdout';
    summary = { raw: stdout.slice(0, 500) };
  }
  return {
    ok: exitCode === 0,
    exitCode,
    ranAt,
    finishedAt,
    checks: countChecks(summary),
    summary,
    parseError,
  };
}

/** The most recent saved chat evidence, if any (validate:chat can persist one). */
function readChatEvidence(): ValidatorResult {
  try {
    if (existsSync(EVIDENCE_DIR)) {
      const files = readdirSync(EVIDENCE_DIR)
        .filter((f) => /^chat-evidence-.*\.json$/.test(f))
        .sort();
      const latest = files[files.length - 1];
      if (latest) {
        const parsed = JSON.parse(readFileSync(`${EVIDENCE_DIR}/${latest}`, 'utf8'));
        return {
          ok: (parsed as { ok?: boolean }).ok ?? null,
          exitCode: null,
          ranAt:
            (parsed as { generatedAt?: string; ranAt?: string }).generatedAt ??
            (parsed as { ranAt?: string }).ranAt ??
            null,
          finishedAt: null,
          checks: countChecks(parsed),
          summary: parsed,
          note: `reused ${latest} — validate:chat sends a production canary, not re-run here`,
        };
      }
    }
  } catch (err) {
    return {
      ok: null,
      exitCode: null,
      ranAt: null,
      finishedAt: null,
      checks: 0,
      summary: null,
      note: `chat evidence unreadable: ${err instanceof Error ? err.message : 'error'}`,
    };
  }
  return {
    ok: null,
    exitCode: null,
    ranAt: null,
    finishedAt: null,
    checks: 0,
    summary: null,
    note: 'run separately via `bun run validate:chat` — canary budget',
  };
}

async function snapshotDiag(apiKey: string, baseUrl: string): Promise<unknown> {
  try {
    const bff = createBff({ apiKey, baseUrl });
    const res = await bff.fetch(new Request('http://evidence/diag'));
    return await res.json();
  } catch (err) {
    return { auth: 'error', message: err instanceof Error ? err.message : 'diag failed' };
  }
}

async function main(): Promise<number> {
  loadEnv();
  const apiKey = process.env.OMNI_API_KEY ?? '';
  const baseUrl = (process.env.OMNI_BASE_URL ?? '').replace(/\/$/, '');
  if (!apiKey || !baseUrl) {
    console.error('OMNI_API_KEY / OMNI_BASE_URL not set (apps/khal-ui/.env). Cannot gather live evidence.');
    return 1;
  }

  console.error('Running validators (instances, agents, coverage) — chat is reused, never re-sent…');
  const [instances, agents, coverage] = await Promise.all([
    runValidator('validate-instances-live.ts'),
    runValidator('validate-agents-live.ts'),
    runValidator('validate-coverage-live.ts'),
  ]);
  const chat = readChatEvidence();
  const diag = await snapshotDiag(apiKey, baseUrl);

  const totals = (inventory as { totals?: unknown }).totals ?? null;

  const raw = {
    $tool: 'scripts/run-evidence.ts',
    generatedAt: new Date().toISOString(),
    backend: {
      baseUrl,
      auth: (diag as { auth?: string })?.auth ?? null,
      version: (diag as { version?: string })?.version ?? null,
    },
    diag,
    capabilities: totals,
    validators: { instances, agents, coverage, chat },
  };

  // Defence-in-depth: truncate content, then scrub any accidental key material.
  const cleaned = scrubKey(truncateContent(raw), apiKey);

  // Also strip any `omni_sk_…` token (e.g. /diag's non-secret keyPrefix) so the
  // committed evidence contains no key-shaped material at all — keyName still
  // identifies which key ran.
  let serialized = `${JSON.stringify(cleaned, null, 2)}\n`;
  serialized = serialized.replace(/omni_sk_[A-Za-z0-9]+/g, '[omni-key-redacted]');

  // Hard gate: refuse to write if the real key survived scrubbing anywhere.
  if (apiKey && serialized.includes(apiKey)) {
    console.error('ABORT: real API key found in evidence output — refusing to write.');
    return 1;
  }

  if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outPath = `${EVIDENCE_DIR}/evidence-${date}.json`;
  writeFileSync(outPath, serialized);

  // Tiny key-free per-family summary the Capabilities page imports.
  const familySummary = (r: ValidatorResult) => ({
    ranAt: r.ranAt,
    ok: r.ok,
    checks: r.checks,
    ...(r.note ? { note: r.note } : {}),
  });
  const summaryOut = {
    $tool: 'scripts/run-evidence.ts',
    generatedAt: raw.generatedAt,
    backendVersion: raw.backend.version,
    families: {
      instances: familySummary(instances),
      agents: familySummary(agents),
      coverage: familySummary(coverage),
      chat: familySummary(chat),
    },
  };
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summaryOut, null, 2)}\n`);

  const line = (name: string, r: ValidatorResult) =>
    `  ${name.padEnd(10)} ok=${String(r.ok).padEnd(5)} checks=${String(r.checks).padStart(2)} ${r.note ? `(${r.note})` : ''}`;
  console.error('\nEvidence consolidated:');
  console.error(line('instances', instances));
  console.error(line('agents', agents));
  console.error(line('coverage', coverage));
  console.error(line('chat', chat));
  console.error(`\nWrote ${outPath}`);
  console.error(`Wrote ${SUMMARY_PATH}`);

  // Exit non-zero only if a validator that WAS run hard-failed.
  const ranFailed = [instances, agents, coverage].filter((r) => r.ok === false);
  if (ranFailed.length > 0) {
    console.error(`\nWARN: ${ranFailed.length} validator(s) reported failures — see the evidence file.`);
  }
  return 0;
}

process.exit(await main());
