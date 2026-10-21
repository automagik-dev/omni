// Builds what this plugin generates and commits.
//
//   node scripts/build-client.mjs           writes them
//   node scripts/build-client.mjs --check   exits 1 when one differs from a fresh build
//
// src/host/omni-routes.js: the omni API routes its source declares, for those its OpenAPI
// description leaves out. Read from this monorepo's packages/api; outside it, the committed
// list stays as it is.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceRoutes } from './omni-routes.mjs'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
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
  const list = []
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
