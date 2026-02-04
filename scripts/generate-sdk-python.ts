/**
 * Generate Python SDK from OpenAPI spec using Docker
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { $ } from 'bun';

async function main() {
  console.log('Python SDK Generation');
  console.log('====================\n');

  const projectRoot = resolve(import.meta.dir, '..');

  // Ensure dist/openapi.json exists
  if (!existsSync('dist/openapi.json')) {
    console.log('1. Generating OpenAPI spec first...');
    await $`bun run generate:sdk`;
    console.log('');
  }

  // Create output directory
  mkdirSync('packages/sdk-python/omni/_generated', { recursive: true });

  console.log('2. Generating Python SDK with openapi-generator (Docker)...');

  try {
    await $`docker run --rm \
      -v ${projectRoot}:/local \
      openapitools/openapi-generator-cli generate \
      -i /local/dist/openapi.json \
      -g python \
      -o /local/packages/sdk-python/omni/_generated \
      --additional-properties=packageName=omni_generated,generateSourceCodeOnly=true,library=urllib3 \
      --global-property=apiTests=false,modelTests=false`;

    console.log('   Generated to packages/sdk-python/omni/_generated/\n');
  } catch (error) {
    console.error('   Generation failed:', error);
    process.exit(1);
  }

  console.log('Done!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review generated code in packages/sdk-python/omni/_generated/');
  console.log('  2. The fluent wrapper is in packages/sdk-python/omni/client.py');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
