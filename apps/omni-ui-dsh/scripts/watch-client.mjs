// Rebuilds client.js whenever src/client changes, so a running DSH instance picks up an edit on
// its next reload. Development only; `npm run build` stays the way the bundle is committed.
//
//   node scripts/watch-client.mjs
import { watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleClient } from './build-client.mjs'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT = join(PLUGIN, 'client.js')
let timer = null
let building = false

async function rebuild() {
  if (building) return
  building = true
  try {
    const next = await bundleClient()
    writeFileSync(OUTPUT, next)
    console.log(`[watch-client] ${new Date().toISOString()} client.js rebuilt`)
  } catch (error) {
    console.error(`[watch-client] build failed: ${error.message}`)
  } finally {
    building = false
  }
}

rebuild()
watch(join(PLUGIN, 'src', 'client'), { recursive: true }, (_event, file) => {
  if (!file || !file.endsWith('.js')) return
  clearTimeout(timer)
  timer = setTimeout(rebuild, 150)
})
console.log('[watch-client] watching src/client')
