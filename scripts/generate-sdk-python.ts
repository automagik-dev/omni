/**
 * Generate Python SDK from OpenAPI spec using Docker
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { $ } from 'bun';

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

  // Calculate the relative path from root to determine current subpackage
  const relativePath = dir.slice(rootDir.length).replace(/^\//, '');
  const currentSubpackage = relativePath.split('/')[0]; // e.g., 'api', 'models', or ''

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      fixPythonImports(rootDir, fullPath);
    } else if (entry.name.endsWith('.py')) {
      let content = readFileSync(fullPath, 'utf-8');
      const original = content;

      if (currentSubpackage) {
        // We're in a subpackage (api/, models/, docs/)

        // Same package imports: from omni_generated.api.x -> from .x (when in api/)
        const samePackagePattern = new RegExp(`from omni_generated\\.${currentSubpackage}\\.`, 'g');
        content = content.replace(samePackagePattern, 'from .');

        // Cross-package imports: from omni_generated.other.x -> from ..other.x
        // This handles imports from api/ to models/ or vice versa
        content = content.replace(/from omni_generated\./g, 'from ..');
      } else {
        // We're at root level - simple conversion
        content = content.replace(/from omni_generated\./g, 'from .');
      }

      // Handle 'from omni_generated import xxx' -> 'from . import xxx'
      if (currentSubpackage) {
        content = content.replace(/from omni_generated import /g, 'from .. import ');
      } else {
        content = content.replace(/from omni_generated import /g, 'from . import ');
      }

      // Handle 'import omni_generated.xxx' -> 'from . import xxx'
      content = content.replace(/import omni_generated\.(\w+)/g, 'from . import $1');

      // Handle bare 'omni_generated.xxx' references (e.g., in getattr calls)
      // Need to add proper import and fix references
      if (content.includes('omni_generated.models')) {
        // Add models import at top if not present
        if (!content.includes('from . import models') && !content.includes('from .. import models')) {
          const importLine = currentSubpackage ? 'from .. import models\n' : 'from . import models\n';
          // Insert after other imports
          content = content.replace(/(from typing.*?\n)/, `$1${importLine}`);
        }
        content = content.replace(/omni_generated\.models/g, 'models');
      }

      if (content !== original) {
        writeFileSync(fullPath, content);
      }
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
