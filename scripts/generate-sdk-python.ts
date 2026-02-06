/**
 * Generate Python SDK from OpenAPI spec using Docker
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { $ } from 'bun';

/**
 * Fix package-style imports based on current location.
 * Converts absolute imports to relative imports.
 */
function fixPackageImports(input: string, currentSubpackage: string): string {
  let result = input;
  if (currentSubpackage) {
    // Same package: from omni_generated.api.x -> from .x (when in api/)
    const samePackagePattern = new RegExp(`from omni_generated\\.${currentSubpackage}\\.`, 'g');
    result = result.replace(samePackagePattern, 'from .');
    // Cross-package: from omni_generated.other.x -> from ..other.x
    result = result.replace(/from omni_generated\./g, 'from ..');
    result = result.replace(/from omni_generated import /g, 'from .. import ');
  } else {
    result = result.replace(/from omni_generated\./g, 'from .');
    result = result.replace(/from omni_generated import /g, 'from . import ');
  }
  // Handle 'import omni_generated.xxx' -> 'from . import xxx'
  result = result.replace(/import omni_generated\.(\w+)/g, 'from . import $1');
  return result;
}

/**
 * Fix bare 'omni_generated.models' references by adding imports and updating refs.
 */
function fixModelsReferences(input: string, currentSubpackage: string): string {
  if (!input.includes('omni_generated.models')) {
    return input;
  }
  let result = input;
  const hasModelsImport = result.includes('from . import models') || result.includes('from .. import models');
  if (!hasModelsImport) {
    const importLine = currentSubpackage ? 'from .. import models\n' : 'from . import models\n';
    result = result.replace(/(from typing.*?\n)/, `$1${importLine}`);
  }
  return result.replace(/omni_generated\.models/g, 'models');
}

/**
 * Process a single Python file to fix its imports.
 */
function processPythonFile(filePath: string, currentSubpackage: string): void {
  let content = readFileSync(filePath, 'utf-8');
  const original = content;

  content = fixPackageImports(content, currentSubpackage);
  content = fixModelsReferences(content, currentSubpackage);

  if (content !== original) {
    writeFileSync(filePath, content);
  }
}

/**
 * Recursively fix imports in generated Python files.
 *
 * The OpenAPI generator creates absolute imports like:
 *   from omni_generated.api.access_api import AccessApi
 *   from omni_generated.models.instance import Instance
 *
 * We need to convert these to proper relative imports based on file location:
 *   - Root level: from omni_generated.api.x -> from .api.x
 *   - In api/: from omni_generated.api.x -> from .x (same package)
 *   - In api/: from omni_generated.models.x -> from ..models.x (different package)
 *   - In models/: from omni_generated.models.x -> from .x (same package)
 */
function fixPythonImports(rootDir: string, currentDir?: string): void {
  const dir = currentDir ?? rootDir;
  const entries = readdirSync(dir, { withFileTypes: true });

  const relativePath = dir.slice(rootDir.length).replace(/^\//, '');
  const currentSubpackage = relativePath.split('/')[0];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      fixPythonImports(rootDir, fullPath);
    } else if (entry.name.endsWith('.py')) {
      processPythonFile(fullPath, currentSubpackage);
    }
  }
}

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
    // Get current user's UID/GID to set correct ownership
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;

    await $`docker run --rm \
      -v ${projectRoot}:/local \
      -u ${uid}:${gid} \
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

  console.log('3. Fixing Python imports (absolute → relative)...');
  const generatedDir = resolve(projectRoot, 'packages/sdk-python/omni/_generated/omni_generated');
  fixPythonImports(generatedDir);
  console.log('   Fixed imports in generated files\n');

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
