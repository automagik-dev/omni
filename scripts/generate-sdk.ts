#!/usr/bin/env bun
/**
 * Generate TypeScript SDK from OpenAPI spec
 *
 * This script:
 * 1. Imports the OpenAPI spec directly from the API package
 * 2. Writes it to dist/openapi.json
 * 3. Generates TypeScript types using openapi-typescript
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { $ } from 'bun';
import { openApiSpec } from '../packages/api/src/routes/openapi';

async function main() {
  console.log('SDK Generation');
  console.log('==============\n');

  // Step 1: Export OpenAPI spec
  console.log('1. Exporting OpenAPI spec...');
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/openapi.json', JSON.stringify(openApiSpec, null, 2));
  console.log('   Written to dist/openapi.json\n');

  // Step 2: Generate TypeScript types
  console.log('2. Generating TypeScript types...');
  await $`bunx openapi-typescript dist/openapi.json -o packages/sdk/src/types.generated.ts`;
  console.log('   Written to packages/sdk/src/types.generated.ts\n');

  console.log('Done!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
