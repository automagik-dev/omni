/**
 * Generate Go SDK from OpenAPI spec using Docker
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { $ } from 'bun';

async function main() {
  console.log('Go SDK Generation');
  console.log('=================\n');

  const projectRoot = resolve(import.meta.dir, '..');

  // Ensure dist/openapi.json exists
  if (!existsSync('dist/openapi.json')) {
    console.log('1. Generating OpenAPI spec first...');
    await $`bun run generate:sdk`;
    console.log('');
  }

  // Create output directory
  mkdirSync('packages/sdk-go/generated', { recursive: true });

  console.log('2. Generating Go SDK with openapi-generator (Docker)...');

  try {
    await $`docker run --rm \
      -v ${projectRoot}:/local \
      openapitools/openapi-generator-cli generate \
      -i /local/dist/openapi.json \
      -g go \
      -o /local/packages/sdk-go/generated \
      --additional-properties=packageName=omni,generateInterfaces=true,isGoSubmodule=true \
      --global-property=apiTests=false,modelTests=false`;

    console.log('   Generated to packages/sdk-go/generated/\n');
  } catch (error) {
    console.error('   Generation failed:', error);
    process.exit(1);
  }

  console.log('Done!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review generated code in packages/sdk-go/generated/');
  console.log('  2. The fluent wrapper is in packages/sdk-go/client.go');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
