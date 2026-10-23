// Builds client.js, the browser half, from the modules in src/client, and the other files
// this plugin generates and commits.
//
//   node scripts/build-client.mjs           writes them
//   node scripts/build-client.mjs --check   exits 1 when one differs from a fresh build
//
// client.js is committed, so `link:` and git installs need no build step. DSH loads it as
// a classic script that hands a factory to its module loader; `require` resolves the
// shell-seeded platform modules (react, react-dom) and the Bot team's client bundle,
// which this package names in dsh.client.external, so all of them stay external.
//
// src/host/omni-routes.js: the omni API routes its source declares, for those its OpenAPI
// description leaves out. Read from this monorepo's packages/api; outside it, the committed
// list stays as it is.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { sourceRoutes } from './omni-routes.mjs'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'))
// DSH's client loader matches a bundle's id to the npm package that ships it.
const PACKAGE_NAME = MANIFEST.name
const OUTPUT = join(PLUGIN, 'client.js')
export const PLATFORM_MODULES = ['react', 'react-dom']
// The other plugins' bundles this one requires, as dsh.client.external names them.
export const EXTERNAL_BUNDLES = MANIFEST.dsh.client.external
// The Bot team's client (automagik-dev/automagik), and the name it had before it moved there:
// a DSH that still runs @automagik/omni-dsh hands the team's client over under that name.
// dsh.client.external names both, so whichever is installed loads first.
export const TEAM_CLIENT = '@automagik/bots-dsh/client'
export const FORMER_TEAM_CLIENT = '@automagik/omni-dsh/client'

export async function bundleClient() {
  const result = await build({
    absWorkingDir: PLUGIN,
    entryPoints: ['src/client/index.js'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: [...PLATFORM_MODULES, ...EXTERNAL_BUNDLES],
    // xterm's stylesheet joins the page's styles as text (src/client/omni-terminal.js).
    loader: { '.css': 'text' },
    treeShaking: false,
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
  })
  if (result.warnings.length > 0) throw new Error(`esbuild warnings:\n${result.warnings.map(warning => warning.text).join('\n')}`)
  return [
    '// Generated from src/client by `npm run build` (scripts/build-client.mjs). Do not edit by hand.',
    'window.__ModuleLoader__.load({',
    `  id: '${PACKAGE_NAME}',`,
    '  factory: (dshRequire) => {',
    // The Bot team's client, else the same bundle under its former name: a DSH that still
    // runs @automagik/omni-dsh has no @automagik/bots-dsh, and a miss would stop the whole UI.
    `const require = (spec) => { if (spec !== '${TEAM_CLIENT}') return dshRequire(spec); try { return dshRequire(spec) } catch (error) { try { return dshRequire('${FORMER_TEAM_CLIENT}') } catch { throw error } } }`,
    'const module = { exports: {} }',
    result.outputFiles[0].text.trimEnd(),
    // The loader gets a plain exports object tagged as a module, as DSH's own bundles are.
    'return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: \'Module\' })',
    '  },',
    '})',
    '',
  ].join('\n')
}

const ROUTES_OUTPUT = join(PLUGIN, 'src/host/omni-routes.js')
const API_SOURCE = join(PLUGIN, '..', '..', 'packages', 'api')

export function omniRoutes() {
  const routes = sourceRoutes(API_SOURCE)
  if (routes === null) return null
  return [
    '// Generated from packages/api/src/routes/v2 by `npm run build` (scripts/omni-routes.mjs). Do not edit by hand.',
    `export const SOURCE_ROUTES = ${JSON.stringify(routes, null, 0).replace(/\},\{/g, '},\n  {').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')}`,
    '',
  ].join('\n')
}

export async function outputs() {
  const list = [[OUTPUT, await bundleClient(), 'client.js']]
  const routes = omniRoutes()
  if (routes !== null) list.push([ROUTES_OUTPUT, routes, 'src/host/omni-routes.js'])
  return list
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, next, name] of await outputs()) {
    if (process.argv.includes('--check')) {
      let current = null
      try { current = readFileSync(file, 'utf8') } catch { /* missing counts as stale */ }
      if (current !== next) {
        console.error(`${name} is stale: run \`npm run build\` in apps/omni-channels-dsh and commit the result`)
        process.exit(1)
      }
    } else {
      writeFileSync(file, next)
    }
  }
}
