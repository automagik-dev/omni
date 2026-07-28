#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
const purposeRoot = "brain/wishes/2026/07/16/omni-full-multitenancy";
const purposeYamlPath = join(root, purposeRoot, "PURPOSE_SPEC.yaml");
const purposeMdPath = join(root, purposeRoot, "PURPOSE_SPEC.md");
const brainWishPath = join(root, purposeRoot, "WISH.md");
const genieWishPath = join(root, ".genie/wishes/omni-full-multitenancy/WISH.md");
const workApprovalPath = join(root, purposeRoot, "WORK_APPROVAL.md");

function text(path) {
  if (!existsSync(path)) throw new Error(`Missing artifact: ${relative(root, path)}`);
  return readFileSync(path, "utf8");
}

function scalar(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m"));
  if (!match) throw new Error(`Missing scalar: ${key}`);
  return match[1].trim();
}

function rootArtifact(path) {
  if (isAbsolute(path) || path.split(/[\\/]+/).includes("..")) {
    throw new Error(`Artifact path must be repository-root-relative: ${path}`);
  }
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Artifact escapes repository root: ${path}`);
  }
  if (!existsSync(resolved)) throw new Error(`Declared artifact does not exist: ${path}`);
  return resolved;
}

const purposeYaml = text(purposeYamlPath);
const purposeMd = text(purposeMdPath);
const brainWish = text(brainWishPath);
const genieWish = text(genieWishPath);
const workApproval = text(workApprovalPath);

for (const key of [
  "purpose_spec",
  "brainstorm_session",
  "ownership_matrix",
  "purpose_wish_mirror",
  "genie_wish",
  "release_slos",
  "artifact_validator",
  "work_approval",
  "work_materialization",
  "status",
]) {
  rootArtifact(scalar(purposeYaml, key));
}

for (const key of [
  "purpose_session",
  "brainstorm_session",
  "ownership_matrix",
  "release_slos",
  "artifact_validator",
  "work_approval",
]) {
  rootArtifact(scalar(genieWish, key));
}

rootArtifact(scalar(purposeMd, "genie_wish"));

if (brainWish !== genieWish) throw new Error("Purpose/Genie WISH mirrors differ");
if (scalar(genieWish, "execution_authorized") !== "true") {
  throw new Error("WISH does not record bounded work authorization");
}
if (!/^\s*authorized:\s*true\s*$/m.test(purposeYaml)) {
  throw new Error("Purpose does not record bounded work authorization");
}
if (scalar(workApproval, "decision") !== "approved") {
  throw new Error("Work approval is not approved");
}
if (scalar(workApproval, "production_authorized") !== "false") {
  throw new Error("Work approval must not authorize production");
}
if (scalar(workApproval, "credential_mint_authorized") !== "false") {
  throw new Error("Work approval must not authorize credential minting");
}
if (scalar(genieWish, "base_commit") !== scalar(workApproval, "materialization_base_commit")) {
  throw new Error("WISH base commit differs from the approved materialization base");
}
if (scalar(workApproval, "reviewed_wish_sha256") !== "67b52d941196d4ae481b8270d33f58804f5f0d14bb8e0ccc3e1afbcd42c91938") {
  throw new Error("Work approval does not bind the frozen Claude Fable-reviewed WISH");
}

const digest = createHash("sha256").update(genieWish).digest("hex");
if (scalar(workApproval, "materialized_wish_sha256") !== digest) {
  throw new Error("Work approval materialized WISH hash differs from the current mirrors");
}
console.log(`artifact_links_ok root=${root}`);
console.log(`wish_mirror_sha256=${digest}`);
console.log(`reviewed_wish_sha256=${scalar(workApproval, "reviewed_wish_sha256")}`);
console.log("execution_authorized=true");
console.log("production_authorized=false");
