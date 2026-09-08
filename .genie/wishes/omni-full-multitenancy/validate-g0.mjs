#!/usr/bin/env node
// Deterministic G0 validator for the omni-full-multitenancy wish.
// Proves, against live source and the G0 evidence artifacts:
//   1. every Drizzle table (parsed from schema.ts) is represented exactly once
//   2. only allowed dispositions are used (tenant|platform|split|quarantine)
//   3. all required non-DB boundary classes exist
//   4. the caller-adjacent tenantId surface is explicitly classified
//   5. every required ADR topic and threat category exists
//   6. the two WISH mirrors are byte-identical
//   7. the reviewed WISH hash is frozen and the materialized hash matches the live mirror
//   8. no production/hold task is authorized by the artifacts
// Read-only. Exits non-zero on the first failed invariant.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("Could not find repository root");
    current = parent;
  }
}

const root = findRepoRoot(scriptDir);
const wishRoot = "brain/wishes/2026/07/16/omni-full-multitenancy";

const FROZEN_REVIEWED_WISH_SHA256 =
  "67b52d941196d4ae481b8270d33f58804f5f0d14bb8e0ccc3e1afbcd42c91938";

const ALLOWED_DISPOSITIONS = new Set(["tenant", "platform", "split", "quarantine"]);

const REQUIRED_BOUNDARY_CLASSES = [
  "nats_jetstream",
  "object_media_storage",
  "filesystem_session_state",
  "in_memory_cache_rate_debounce",
  "idempotency_store",
  "websocket_sse_streaming",
  "a2a_task_stream_store",
  "payload_offload_store",
  "metrics_observability",
  "provider_plugin_registry",
  "tenant_egress",
  "credential_bootstrap",
  "cli_local_state_trust",
  "public_bootstrap_surfaces",
];

const REQUIRED_ADR_TOPICS = [
  "ownership_classes",
  "person_platform_identity_split",
  "isolated_auth_bootstrap",
  "rls_transaction_context_role_split",
  "platform_admin_target_tenant_access",
  "tenant_key_lineage_delegation_revocation",
  "mixed_version_writer_fence_rollback",
  "async_storage_cache_context",
  "tenant_egress_broker_ssrf",
  "shared_runtime_residual_risk",
];

const REQUIRED_THREAT_CATEGORIES = [
  "idor",
  "confused_deputy",
  "auth_bootstrap",
  "key_escalation",
  "pooled_context_leakage",
  "rls_bypass",
  "direct_db_access",
  "async_replay",
  "dlq_backlog_poison",
  "storage_media_leakage",
  "callback_presigned_capability",
  "ssrf_dns_rebinding",
  "revocation_after_dequeue",
  "mixed_version_races",
  "rollback_global_reopen",
  "restore_mismatch",
  "approval_receipt_forgery",
  "shared_runtime_compromise",
];

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}
function readText(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) throw new Error(`Missing artifact: ${rel}`);
  return readFileSync(p, "utf8");
}
function scalar(source, key) {
  const m = source.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m"));
  return m ? m[1].trim() : null;
}
function section(source, startKey, endKeys) {
  const start = source.indexOf(`\n${startKey}:`);
  if (start === -1) return null;
  let end = source.length;
  for (const k of endKeys) {
    const idx = source.indexOf(`\n${k}:`, start + 1);
    if (idx !== -1 && idx < end) end = idx;
  }
  return source.slice(start, end);
}
// Pair each "- <itemKey>: NAME" block with its first "disposition:" value.
function itemDispositions(sectionText, itemKey) {
  const out = new Map();
  const re = new RegExp(`-\\s+${itemKey}:\\s*([^\\n]+?)\\s*\\n[\\s\\S]*?disposition:\\s*(\\w+)`, "g");
  let m;
  while ((m = re.exec(sectionText)) !== null) {
    out.set(m[1].trim(), m[2].trim());
  }
  return out;
}
// Parse a simple YAML "- value" list block (ignores trailing "# comments").
function listItems(source, key, endKeys) {
  const sec = section(source, key, endKeys);
  if (sec === null) return null;
  const out = [];
  const re = /^\s*-\s*([a-z_]+)/gm;
  let m;
  while ((m = re.exec(sec)) !== null) out.push(m[1]);
  return out;
}
// Split a section into one text block per "- <itemKey>:" entry, each block
// spanning up to the next entry (so field checks stay within a single item).
function itemBlocks(sectionText, itemKey) {
  const re = new RegExp(`(^|\\n)\\s*-\\s+${itemKey}:\\s*([^\\n]*)`, "g");
  const starts = [];
  let m;
  while ((m = re.exec(sectionText)) !== null) {
    starts.push({ index: m.index + (m[1] ? m[1].length : 0), name: m[2].trim() });
  }
  const blocks = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : sectionText.length;
    blocks.push({ name: starts[i].name, text: sectionText.slice(starts[i].index, end) });
  }
  return blocks;
}
// Assert every required field key appears at least once inside `blockText`.
function requireFields(blockText, requiredFields, label) {
  for (const f of requiredFields) {
    check(
      new RegExp(`(^|\\n)\\s*${f}:`).test(blockText),
      `${label} missing required field '${f}'`,
    );
  }
}

// -------------------------------------------------------------------------
// 1 + 2. Drizzle tables: parse live schema, cross-check manifest coverage.
// -------------------------------------------------------------------------
const schema = readText("packages/db/src/schema.ts");
const schemaTables = new Set();
{
  const re = /pgTable\(\s*['"]([a-z0-9_]+)['"]/g;
  let m;
  while ((m = re.exec(schema)) !== null) schemaTables.add(m[1]);
}
const tenantIdInSchema = (schema.match(/tenant_id|tenantId/g) || []).length;
check(tenantIdInSchema === 0, `schema.ts unexpectedly references tenant_id (${tenantIdInSchema} hits)`);

const manifest = readText(`${wishRoot}/OWNERSHIP_MANIFEST.yaml`);

// The manifest declares the fields every entry MUST carry; enforce them per block.
const REQUIRED_ENTRY_FIELDS = listItems(manifest, "required_entry_fields", ["drizzle_tables"]);
check(
  Array.isArray(REQUIRED_ENTRY_FIELDS) && REQUIRED_ENTRY_FIELDS.length > 0,
  "manifest missing required_entry_fields declaration",
);
const requiredFields = REQUIRED_ENTRY_FIELDS || [];

const declaredTableCount = Number(scalar(manifest, "drizzle_pgtable_count"));
check(
  declaredTableCount === schemaTables.size,
  `manifest drizzle_pgtable_count=${declaredTableCount} != live schema count=${schemaTables.size}`,
);

const drizzleSection = section(manifest, "drizzle_tables", ["caller_adjacent_tenant_context", "non_drizzle_boundaries"]);
check(drizzleSection !== null, "manifest missing drizzle_tables section");
const tableDisp = itemDispositions(drizzleSection || "", "table");

// exactly-once coverage in both directions
for (const t of schemaTables) {
  check(tableDisp.has(t), `Drizzle table not represented in manifest: ${t}`);
}
for (const t of tableDisp.keys()) {
  check(schemaTables.has(t), `manifest lists a table not present in schema.ts: ${t}`);
}
check(
  tableDisp.size === schemaTables.size,
  `manifest table count=${tableDisp.size} != schema table count=${schemaTables.size}`,
);
// no duplicate table entries (Map would collapse dups, so count raw "- table:" lines)
const rawTableEntries = (drizzleSection || "").match(/-\s+table:/g) || [];
check(
  rawTableEntries.length === schemaTables.size,
  `duplicate/extra table entries: ${rawTableEntries.length} raw vs ${schemaTables.size} tables`,
);
for (const [t, d] of tableDisp) {
  check(ALLOWED_DISPOSITIONS.has(d), `table ${t} has invalid disposition '${d}'`);
}
// Every individual table block must carry all required entry fields.
for (const block of itemBlocks(drizzleSection || "", "table")) {
  requireFields(block.text, requiredFields, `Drizzle table '${block.name}'`);
}

// -------------------------------------------------------------------------
// 3. Required non-DB boundary classes.
// -------------------------------------------------------------------------
const boundarySection = section(manifest, "non_drizzle_boundaries", []);
check(boundarySection !== null, "manifest missing non_drizzle_boundaries section");
const boundaryDisp = itemDispositions(boundarySection || "", "class");
for (const c of REQUIRED_BOUNDARY_CLASSES) {
  check(boundaryDisp.has(c), `required non-DB boundary class missing: ${c}`);
}
for (const [c, d] of boundaryDisp) {
  check(ALLOWED_DISPOSITIONS.has(d), `boundary class ${c} has invalid disposition '${d}'`);
}
// Reject duplicate boundary class entries (the Map above silently collapses dups).
const rawBoundaryClasses = [];
{
  const re = /-\s+class:\s*([a-z0-9_]+)/g;
  let m;
  while ((m = re.exec(boundarySection || "")) !== null) rawBoundaryClasses.push(m[1]);
}
check(
  rawBoundaryClasses.length === new Set(rawBoundaryClasses).size,
  `duplicate non-Drizzle boundary class entries: ${rawBoundaryClasses.length} raw vs ${new Set(rawBoundaryClasses).size} unique`,
);
check(
  rawBoundaryClasses.length === boundaryDisp.size,
  `boundary class parse mismatch: ${rawBoundaryClasses.length} raw vs ${boundaryDisp.size} with dispositions`,
);
// Every individual boundary block must carry all required entry fields.
for (const block of itemBlocks(boundarySection || "", "class")) {
  requireFields(block.text, requiredFields, `non-Drizzle boundary '${block.name}'`);
}
const declaredBoundaryClasses = Number(scalar(manifest, "non_drizzle_boundary_classes"));
check(
  declaredBoundaryClasses === boundaryDisp.size,
  `manifest non_drizzle_boundary_classes=${declaredBoundaryClasses} != counted=${boundaryDisp.size}`,
);

// -------------------------------------------------------------------------
// 4. Caller-adjacent tenantId surface explicitly classified.
// -------------------------------------------------------------------------
const callerSection = section(manifest, "caller_adjacent_tenant_context", ["non_drizzle_boundaries"]);
check(callerSection !== null, "manifest missing caller_adjacent_tenant_context section");
const callerDisp = callerSection ? scalar(callerSection, "disposition") : null;
check(callerDisp !== null && ALLOWED_DISPOSITIONS.has(callerDisp), `caller-adjacent tenant context disposition invalid: ${callerDisp}`);
// The caller-adjacent item must carry the same required entry fields.
if (callerSection !== null) {
  requireFields(callerSection, requiredFields, "caller-adjacent tenant context");
}
check(callerSection !== null && /decision:\s*\w+/.test(callerSection), "caller-adjacent tenant context missing rename-or-derive decision");
check(
  callerSection !== null && /OMNI_TENANT_ID/.test(callerSection) && /OmniCustomerContext\.tenantId/.test(callerSection),
  "caller-adjacent tenant context does not reference the OMNI_TENANT_ID / OmniCustomerContext.tenantId surface",
);

// -------------------------------------------------------------------------
// 5. Required ADR topics and threat categories.
// -------------------------------------------------------------------------
const adrDir = join(root, wishRoot, "adrs");
check(existsSync(adrDir), "adrs/ directory missing");
const adrTopics = new Set();
if (existsSync(adrDir)) {
  for (const f of readdirSync(adrDir)) {
    if (!f.endsWith(".md")) continue;
    const body = readFileSync(join(adrDir, f), "utf8");
    const m = body.match(/adr_topic:\s*([a-z_]+)/);
    if (m) adrTopics.add(m[1]);
  }
}
for (const topic of REQUIRED_ADR_TOPICS) {
  check(adrTopics.has(topic), `required ADR topic missing: ${topic}`);
}

const threat = readText(`${wishRoot}/THREAT_MODEL.md`);
const threatCats = new Set();
{
  const re = /category:\s*([a-z_]+)/g;
  let m;
  while ((m = re.exec(threat)) !== null) threatCats.add(m[1]);
}
for (const cat of REQUIRED_THREAT_CATEGORIES) {
  check(threatCats.has(cat), `required threat category missing: ${cat}`);
}

// -------------------------------------------------------------------------
// 6 + 7. WISH mirrors identical; reviewed hash frozen; materialized hash matches.
// -------------------------------------------------------------------------
const brainWish = readText(`${wishRoot}/WISH.md`);
const genieWish = readText(".genie/wishes/omni-full-multitenancy/WISH.md");
check(brainWish === genieWish, "WISH mirrors differ (brain vs .genie)");

const workApproval = readText(`${wishRoot}/WORK_APPROVAL.md`);
check(
  scalar(workApproval, "reviewed_wish_sha256") === FROZEN_REVIEWED_WISH_SHA256,
  "reviewed_wish_sha256 is not the frozen Fable-reviewed hash",
);
const liveDigest = createHash("sha256").update(genieWish).digest("hex");
check(
  scalar(workApproval, "materialized_wish_sha256") === liveDigest,
  `materialized_wish_sha256 (${scalar(workApproval, "materialized_wish_sha256")}) != live mirror digest (${liveDigest})`,
);
check(scalar(workApproval, "production_authorized") === "false", "WORK_APPROVAL must not authorize production");
check(scalar(workApproval, "credential_mint_authorized") === "false", "WORK_APPROVAL must not authorize credential minting");

// -------------------------------------------------------------------------
// 8. No production/hold task authorized by the artifacts.
// -------------------------------------------------------------------------
const materialization = readText(`${wishRoot}/WORK_MATERIALIZATION.md`);
check(scalar(materialization, "production_task_count") === "0", "WORK_MATERIALIZATION production_task_count must be 0");
check(scalar(materialization, "hold_task_count") === "0", "WORK_MATERIALIZATION hold_task_count must be 0");
check(scalar(materialization, "task_count") === "9", "WORK_MATERIALIZATION task_count must be 9 (G0-G8A)");
for (const forbidden of ["H8.1", "H8.2", "H8.3", "H8.4", "H9.1", "H9.2"]) {
  const re = new RegExp(`\\|\\s*${forbidden.replace(".", "\\.")}\\s*\\|\\s*\`t_`);
  check(!re.test(materialization), `a task row exists for non-executable hold ${forbidden}`);
}
for (const prodGroup of ["G8B", "G8C", "G8D", "G8E", "G9A", "G9B"]) {
  const re = new RegExp(`\\|\\s*${prodGroup}\\s*\\|\\s*\`t_`);
  check(!re.test(materialization), `a task row exists for production group ${prodGroup}`);
}

// -------------------------------------------------------------------------
// Report.
// -------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`validate-g0: FAIL (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("validate-g0: PASS");
console.log(`  root=${relative(process.cwd(), root) || "."}`);
console.log(`  drizzle_tables=${schemaTables.size} (each represented once)`);
console.log(`  non_db_boundary_classes=${boundaryDisp.size}`);
console.log(`  caller_adjacent_tenant_context=${callerDisp}`);
console.log(`  adr_topics=${adrTopics.size} threat_categories=${threatCats.size}`);
console.log(`  wish_mirrors_identical=true`);
console.log(`  reviewed_wish_sha256=${FROZEN_REVIEWED_WISH_SHA256}`);
console.log(`  materialized_wish_sha256=${liveDigest}`);
console.log("  production_or_hold_tasks=0");
