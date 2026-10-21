// Builds client.js, the browser half, from the modules in src/client.
//
//   node scripts/build-client.mjs           writes client.js
//   node scripts/build-client.mjs --check   exits 1 when client.js differs from a fresh build
//
// client.js is committed, so `link:` and git installs need no build step. dsh loads it as
// a classic script; the wrapper mirrors packages/client/tsdown.client.ts in
// deepseek-harness: `require` resolves the shell-seeded platform modules (react,
// react-dom, ui-primitives, ...), which therefore stay external.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createLibrary, defineComponent, markReactive } from '@openuidev/lang-core'
import { libraryOf, PROMPT_OPTIONS } from '../src/client/omni-ui-spec.js'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
// DSH's client loader matches a bundle's id to the npm package that ships it.
const PACKAGE_NAME = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).name
const OUTPUT = join(PLUGIN, 'client.js')
// Omni's OpenUI authoring prompt, written from the same component definitions the client
// renders, so the host needs no OpenUI at run time.
const PROMPT_OUTPUT = join(PLUGIN, 'src/host/omni-ui-prompt.js')
// The canvas check for the host's show_canvas, bundled so the host needs no OpenUI or zod
// installed (and never runs their install scripts).
const CHECK_OUTPUT = join(PLUGIN, 'src/host/omni-ui-check.bundle.js')
// react/jsx-runtime is seeded by the shell too (deepseek-harness packages/client/web/src/seed.ts);
// OpenUI's renderer imports it.
const PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

// OpenUI validates with zod, whose namespace re-exports a translation of its error messages
// for every language (~330 KB). Omni's canvases only need English ones.
const zodEnglishOnly = {
  name: 'zod-english-only',
  setup(build) {
    build.onResolve({ filter: /locales\/index\.js$/ }, args => (args.importer.includes('/node_modules/zod/') ? { path: 'zod-locales', namespace: 'zod-english-only' } : undefined))
    build.onLoad({ filter: /.*/, namespace: 'zod-english-only' }, () => ({ contents: "export { default as en } from 'zod/v4/locales/en.js'", resolveDir: PLUGIN }))
  },
}

export async function bundleClient() {
  const result = await build({
    // Region comments name sources relative to the plugin, wherever the script runs from.
    absWorkingDir: PLUGIN,
    entryPoints: ['src/client/index.js'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: PLATFORM_MODULES,
    // Every source declaration ships, used or not, as in the hand-written bundle.
    treeShaking: false,
    // Readable for debugging in the browser: no minification, and Chinese text stays text.
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
    plugins: [zodEnglishOnly],
  })
  if (result.warnings.length > 0) throw new Error(`esbuild warnings:\n${result.warnings.map(warning => warning.text).join('\n')}`)
  return [
    '// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.',
    'window.__ModuleLoader__.load({',
    `  id: '${PACKAGE_NAME}',`,
    '  factory: (require) => {',
    'const module = { exports: {} }',
    result.outputFiles[0].text.trimEnd(),
    // The loader gets a plain exports object tagged as a module, as the tsdown preset
    // emits, rather than esbuild's getter-based `__esModule` object.
    'return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: \'Module\' })',
    '  },',
    '})',
    '',
  ].join('\n')
}

// OpenUI's prompt teaches its whole language. Omni's canvases have no Mutation and no forms,
// so those sections go, and so do the lines that point at them. Each cut must find its text:
// an OpenUI upgrade that moves it fails the build instead of teaching what cannot render.
const DROPPED = ['Mutation — Write Operations', 'Interactive Filters', 'Forms', 'Data Workflow']
const REWORDED = [
  [/\nExample — mutation \+ refresh \+ reset \(PREFERRED pattern\):\n```\n[\s\S]*?```\n/, '\n'],
  [/- @Run\(queryOrMutationRef\) — Execute a Mutation or re-fetch a Query \(ref must be a declared Query\/Mutation\)/, '- @Run(queryRef) — Re-fetch a Query'],
  [/- If a @Run\(mutation\) step fails, remaining steps are skipped \(halt on failure\)\n/, ''],
  [/Use these with Query\(\) for read operations or Mutation\(\) for write operations\. The LLM decides which is appropriate based on the tool's purpose\./, 'Use these with Query() to read.'],
  [/CRITICAL: Use ONLY the tools listed above in Query\(\) and Mutation\(\) calls\.[^\n]*/, 'CRITICAL: Use ONLY the tools listed above in Query() calls. Never invent data: read it with a Query.'],
  [/5\. Every visible filter \$binding appears in at least one Query args object\.\n/, ''],
]

export async function bundleCheck() {
  const result = await build({
    absWorkingDir: PLUGIN,
    entryPoints: ['src/client/omni-ui-check.js'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
    plugins: [zodEnglishOnly],
  })
  if (result.warnings.length > 0) throw new Error(`esbuild warnings:\n${result.warnings.map(warning => warning.text).join('\n')}`)
  return `// Generated from src/client/omni-ui-check.js by \`npm run build\` (scripts/build-client.mjs). Do not edit by hand.\n// Bundles @openuidev/lang-core and zod (MIT; see NOTICE).\n${result.outputFiles[0].text}`
}

export function omniUiPrompt() {
  const reactive = (schema) => { markReactive(schema); return schema }
  let text = libraryOf({ createLibrary, defineComponent, reactive }).prompt(PROMPT_OPTIONS)
  for (const title of DROPPED) {
    const cut = text.replace(new RegExp(`\\n## ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n[\\s\\S]*?(?=\\n## )`), '')
    if (cut === text) throw new Error(`OpenUI prompt: no "## ${title}" section to drop`)
    text = cut
  }
  for (const [pattern, replacement] of REWORDED) {
    if (!pattern.test(text)) throw new Error(`OpenUI prompt: ${pattern} matched nothing`)
    text = text.replace(pattern, replacement)
  }
  if (/Mutation|FormControl|SelectItem/.test(text.replace(/Mutation\(\) is not available[^\n]*/, ''))) throw new Error('OpenUI prompt still teaches Mutation or forms')
  return [
    '// Generated from src/client/omni-ui-spec.js by `npm run build` (scripts/build-client.mjs). Do not edit by hand.',
    `export const OMNI_UI_PROMPT = ${JSON.stringify(text)}`,
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputs = [[OUTPUT, await bundleClient(), 'client.js'], [PROMPT_OUTPUT, omniUiPrompt(), 'src/host/omni-ui-prompt.js'], [CHECK_OUTPUT, await bundleCheck(), 'src/host/omni-ui-check.bundle.js']]
  for (const [file, next, name] of outputs) {
    if (process.argv.includes('--check')) {
      let current = null
      try { current = readFileSync(file, 'utf8') } catch { /* missing counts as stale */ }
      if (current !== next) {
        console.error(`${name} is stale: run \`npm run build\` in ds-bot and commit the result`)
        process.exit(1)
      }
    } else {
      writeFileSync(file, next)
    }
  }
}
