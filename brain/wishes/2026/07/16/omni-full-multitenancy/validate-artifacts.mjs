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

for (const key of [
  "purpose_spec",
  "brainstorm_session",
  "ownership_matrix",
  "purpose_wish_mirror",
  "genie_wish",
  "release_slos",
  "artifact_validator",
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
]) {
  rootArtifact(scalar(genieWish, key));
}

rootArtifact(scalar(purposeMd, "genie_wish"));

if (brainWish !== genieWish) throw new Error("Purpose/Genie WISH mirrors differ");
if (scalar(genieWish, "execution_authorized") !== "false") {
  throw new Error("WISH unexpectedly authorizes execution");
}
if (!/^\s*authorized:\s*false\s*$/m.test(purposeYaml)) {
  throw new Error("Purpose unexpectedly authorizes execution");
}

const digest = createHash("sha256").update(genieWish).digest("hex");
console.log(`artifact_links_ok root=${root}`);
console.log(`wish_mirror_sha256=${digest}`);
console.log("execution_authorized=false");
