// Assembles what the packaged app carries next to Electron, in build/:
//
//   build/runtime/node_modules   the pinned DeepSeek Harness (runtime/package.json + lock)
//   build/profile/               the dsh profile the app starts: package.json, cordis.patch.yml,
//                                and node_modules holding only Omni's plugins
//
// The plugins (../omni-ui-dsh, and ../omni-ai-dsh with the onboarding) are packed with
// `npm pack`, so the app ships exactly what each package publishes. Their @deepseek-ai
// peers are not installed again: dsh supplies them.
// Native packages are per platform, so run this on the platform you build for.
// Usage: node scripts/prepare-runtime.mjs [--skip-runtime]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Each plugin's folder beside this app, by the package name the profile depends on.
const PLUGINS = {
  '@automagik/omni-dsh': resolve(APP, '..', 'omni-ui-dsh'),
  '@automagik/omni-ai-dsh': resolve(APP, '..', 'omni-ai-dsh'),
}
const BUILD = join(APP, 'build')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// @openuidev/lang-core and others phone home from install scripts unless told not to.
const env = { ...process.env, DO_NOT_TRACK: '1', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' }
const run = (args, cwd) => execFileSync(npm, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] })
const say = message => console.log(`[prepare-runtime] ${message}`)

const runtimeDir = join(BUILD, 'runtime')
if (!process.argv.includes('--skip-runtime') || !existsSync(join(runtimeDir, 'node_modules'))) {
  say('installing the pinned DeepSeek Harness')
  rmSync(runtimeDir, { recursive: true, force: true })
  mkdirSync(runtimeDir, { recursive: true })
  for (const file of ['package.json', 'package-lock.json']) {
    if (existsSync(join(APP, 'runtime', file))) cpSync(join(APP, 'runtime', file), join(runtimeDir, file))
  }
  run(existsSync(join(runtimeDir, 'package-lock.json')) ? ['ci', '--omit=dev'] : ['install', '--omit=dev'], runtimeDir)
  // A fresh lock is the one to commit (runtime/package-lock.json).
  if (!existsSync(join(APP, 'runtime', 'package-lock.json'))) cpSync(join(runtimeDir, 'package-lock.json'), join(APP, 'runtime', 'package-lock.json'))
}

say(`packing ${Object.keys(PLUGINS).join(' and ')}`)
const packs = join(BUILD, 'packs')
rmSync(packs, { recursive: true, force: true })
mkdirSync(packs, { recursive: true })
const packed = Object.entries(PLUGINS).map(([name, dir]) => {
  const [info] = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', packs], { cwd: dir, env, encoding: 'utf8' }))
  if (info.name !== name) throw new Error(`${dir} packs ${info.name}, not ${name}`)
  return { name, version: info.version, tarball: join(packs, info.filename) }
})

const profileDir = join(BUILD, 'profile')
rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })
const profile = JSON.parse(readFileSync(join(APP, 'profile', 'package.json'), 'utf8'))
for (const plugin of packed) profile.dependencies[plugin.name] = plugin.version
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(profile, null, 2)}\n`)
cpSync(join(APP, 'profile', 'cordis.patch.yml'), join(profileDir, 'cordis.patch.yml'))
// One install of every tarball: --no-save leaves the versions written above in place.
run(['install', ...packed.map(plugin => plugin.tarball), '--omit=dev', '--legacy-peer-deps', '--no-save', '--no-package-lock', '--ignore-scripts'], profileDir)

// The app copies the profile into its home again whenever this id changes (src/dsh.js).
writeFileSync(join(profileDir, '.build-id'), `${packed.map(plugin => plugin.version).join('+')}+${new Date().toISOString()}\n`)

const versions = {
  dsh: JSON.parse(readFileSync(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version,
  plugin: packed[0].version,
  plugins: Object.fromEntries(packed.map(plugin => [plugin.name, plugin.version])),
}
writeFileSync(join(BUILD, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`)
say(`ready: dsh ${versions.dsh}, ${packed.map(plugin => `${plugin.name} ${plugin.version}`).join(', ')}`)
