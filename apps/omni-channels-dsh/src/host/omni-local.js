// Running Omni on this computer: a sandboxed Omni (`omni install --sandbox`, packages/cli)
// in a home of its own, sharing nothing with another install. It runs on Bun: the one this
// computer has, else one this plugin downloads once from Bun's own releases and checks
// against the release's SHASUMS256.txt before unpacking it. `bun x` then installs and starts
// @automagik/omni at this plugin's version (`install --sandbox --at-login --json`), and the sandbox's
// key links this host the way "Use it" does (omni-discover.js). The key is read here, from
// the sandbox's config file, and never reaches the page.
//
// Installing takes minutes the first time (Postgres comes down too), so it runs as a job:
// the page starts it once the person confirms, then polls its progress. One job at a time;
// it lives in memory, and a restart drops it (the CLI's install is safe to run again).
// The Connect step runs the same install in a terminal the person watches instead
// (omni-terminal.js), with this module's Bun.
import { spawn as spawnProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { z } from 'zod'
import { linkWithKey, sandboxHome } from './omni-discover.js'
import { PLUGIN_VERSION } from './version.js'

export { sandboxHome }

// The Bun this plugin downloads when the computer has none, and where its release lives.
export const BUN_VERSION = '1.4.2'
const BUN_RELEASE = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`
const BUN_ASSETS = {
  'darwin-arm64': 'bun-darwin-aarch64.zip',
  'darwin-x64': 'bun-darwin-x64.zip',
  'linux-arm64': 'bun-linux-aarch64.zip',
  'linux-x64': 'bun-linux-x64.zip',
}
const MAX_DOWNLOAD = 256 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000
const INSTALL_TIMEOUT_MS = 15 * 60_000
const MAX_OUTPUT = 64 * 1024
const MAX_FILE = 1024 * 1024

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

// The one line `--json` prints (packages/cli/src/sandbox.ts, SandboxReport).
const Report = z.object({
  ok: z.boolean(),
  installed: z.boolean().optional(),
  home: z.string().max(4096).optional(),
  version: z.string().max(64).nullable().optional(),
  apiUrl: z.string().max(2048).nullable().optional(),
  configPath: z.string().max(4096).nullable().optional(),
  logsDir: z.string().max(4096).nullable().optional(),
  error: z.string().max(4096).optional(),
}).passthrough()
const SandboxConfig = z.object({ apiKey: z.string().min(1).max(4096) }).passthrough()
const InstallPayload = z.object({ confirm: z.literal(true).optional(), update: z.boolean().optional() }).optional()

// <OMNI_HOME>, else ~/.omni: the desktop app sets OMNI_HOME to its own home.
const omniRoot = ({ env, home }) => env.OMNI_HOME || join(home, '.omni')
const ownBun = ctx => join(omniRoot(ctx), 'runtime', 'bun', 'bun')

function executable(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// The Bun to run Omni with, in this order: $BUN_INSTALL's, ~/.bun's, the first on PATH, then
// the one this plugin downloaded. Null when there is none.
export function findBun({ env = process.env, home = homedir(), isExecutable = executable } = {}) {
  const places = [
    env.BUN_INSTALL ? join(env.BUN_INSTALL, 'bin', 'bun') : null,
    join(home, '.bun', 'bin', 'bun'),
    ...String(env.PATH ?? '').split(delimiter).filter(dir => isAbsolute(dir)).map(dir => join(dir, 'bun')),
    ownBun({ env, home }),
  ]
  return places.find(path => path !== null && isExecutable(path)) ?? null
}

// One file out of a zip archive (stored or deflated, no zip64: Bun's release zips are
// a folder holding the one binary). `wanted` picks it by its name in the archive.
export function unzipEntry(zip, wanted) {
  let end = -1
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) { end = at; break }
  }
  if (end < 0) throw new Error('not a zip archive')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('the zip archive is damaged')
    const method = zip.readUInt16LE(at + 10)
    const compressed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    if (wanted(name)) {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('the zip archive is damaged')
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + compressed)
      if (method !== 0 && method !== 8) throw new Error(`${name} is packed in a way this cannot unpack`)
      const out = method === 0 ? Buffer.from(data) : inflateRawSync(data)
      if (out.length !== size) throw new Error(`${name} did not unpack whole`)
      return out
    }
    at += 46 + skip
  }
  return null
}

async function download(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length > MAX_DOWNLOAD) throw new Error(`${url} is larger than expected`)
  return body
}

// Bun, downloaded into this plugin's runtime folder when the computer has none. The zip
// must match the release's published checksum, or nothing is unpacked.
export async function downloadBun({ env = process.env, home = homedir(), platform = process.platform, arch = process.arch, fetchImpl = fetch } = {}) {
  const asset = BUN_ASSETS[`${platform}-${arch}`]
  if (!asset) throw new Error(`Bun has no release for ${platform} on ${arch}`)
  const sums = (await download(`${BUN_RELEASE}/SHASUMS256.txt`, fetchImpl)).toString('utf8')
  const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(([, name]) => name === asset)?.[0]
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Bun ${BUN_VERSION}'s checksums do not list ${asset}`)
  const zip = await download(`${BUN_RELEASE}/${asset}`, fetchImpl)
  const actual = createHash('sha256').update(zip).digest('hex')
  if (actual !== expected) throw new Error(`The Bun download does not match its published checksum (${asset}); nothing was installed`)
  const binary = unzipEntry(zip, name => name.endsWith('/bun') || name === 'bun')
  if (!binary) throw new Error(`${asset} holds no bun binary`)
  const target = ownBun({ env, home })
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, binary, { mode: 0o755 })
  await chmod(temp, 0o755)
  await rename(temp, target)
  return target
}

// The arguments Omni's CLI is run with: no shell, nothing interpolated.
export const installArgs = version => ['x', '--bun', `@automagik/omni@${version}`, 'install', '--sandbox', '--at-login', '--json']

// The environment the CLI runs in: this one, with Bun's folder first on PATH (the CLI runs on
// Bun) and without an Omni config or key of this host's, which are not the sandbox's.
export function installEnv(bun, env = process.env) {
  const { OMNI_CONFIG_DIR, OMNI_API_KEY, OMNI_API_URL, ...rest } = env
  return { ...rest, PATH: [dirname(bun), env.PATH].filter(Boolean).join(delimiter) }
}

// Runs the CLI and reads its report: the last line it printed on stdout. Exit 3 means no
// sandbox at that home; any other failure carries the CLI's own words.
export function runInstall({ bun, version = PLUGIN_VERSION, env = process.env, spawn = spawnProcess, timeoutMs = INSTALL_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const keep = (text, chunk) => (text + chunk).slice(-MAX_OUTPUT)
    let child
    try {
      child = spawn(bun, installArgs(version), { env: installEnv(bun, env), stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    } catch (error) {
      resolve({ ok: false, error: `Could not start Bun: ${error.message}` })
      return
    }
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout = keep(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = keep(stderr, chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `Could not start Bun: ${error.message}` })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const line = stdout.trim().split('\n').pop() ?? ''
      let report = null
      try {
        const parsed = Report.safeParse(JSON.parse(line))
        report = parsed.success ? parsed.data : null
      } catch {}
      const tail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 600)
      if (report === null) {
        resolve({ ok: false, error: signal ? 'Installing Omni took too long and was stopped.' : `Omni's installer stopped without a report${tail ? `: ${tail}` : ''} (exit ${code})` })
        return
      }
      if (code === 3) resolve({ ...report, ok: false, error: report.error ?? 'There is no sandboxed Omni there.' })
      else if (code !== 0 || !report.ok) resolve({ ...report, ok: false, error: report.error ?? (tail || `Omni's installer failed (exit ${code})`) })
      else resolve(report)
    })
  })
}

// The sandbox's key, from the config file its report names, which must sit in its home.
export function sandboxKey(report) {
  if (!report.home || !report.configPath) return null
  const inside = relative(report.home, report.configPath)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null
  try {
    if (statSync(report.configPath).size > MAX_FILE) return null
    const parsed = SandboxConfig.safeParse(JSON.parse(readFileSync(report.configPath, 'utf8')))
    return parsed.success ? parsed.data.apiKey : null
  } catch {
    return null
  }
}

export function install(rt, deps = {}) {
  const env = deps.env ?? process.env
  const home = deps.home ?? homedir()
  const spawn = deps.spawn ?? spawnProcess
  const fetchImpl = deps.fetch ?? ((...args) => fetch(...args))
  const version = deps.version ?? PLUGIN_VERSION
  let job = null

  const progress = () => (job === null ? { status: 'idle' } : {
    status: job.status,
    step: job.step,
    update: job.update,
    ...(job.origin ? { origin: job.origin } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.logsDir ? { logsDir: job.logsDir } : {}),
  })

  async function run(current) {
    try {
      let bun = findBun({ env, home })
      if (bun === null) {
        current.step = 'download-bun'
        bun = await downloadBun({ env, home, fetchImpl, platform: deps.platform, arch: deps.arch })
      }
      current.step = 'install'
      const report = await runInstall({ bun, version, env, spawn })
      current.logsDir = report.logsDir ?? null
      if (!report.ok) throw new Error(report.error)
      const key = sandboxKey(report)
      if (!report.apiUrl || key === null) throw new Error('The sandboxed Omni started, but its key could not be read.')
      current.step = 'linking'
      const linked = await linkWithKey(rt, report.apiUrl, key)
      if (linked.status !== 'paired') throw new Error('The sandboxed Omni did not take its own key.')
      current.status = 'paired'
      current.origin = linked.origin
    } catch (error) {
      current.status = 'failed'
      current.error = error?.message ?? String(error)
    }
  }

  // Without `confirm`, only what the page should ask about: where it goes, which version.
  async function start(body) {
    const parsed = InstallPayload.safeParse(body ?? undefined)
    if (!parsed.success) throw invalid('Confirm installing Omni on this computer first')
    const update = parsed.data?.update === true
    if (job?.status === 'installing') return progress()
    if (parsed.data?.confirm !== true) return { status: 'confirm', home: sandboxHome({ env, home }), version, update }
    job = { status: 'installing', step: 'bun', update, origin: null, error: null, logsDir: null }
    job.done = run(job)
    return progress()
  }

  rt.omniLocalEndpoint = (endpoint, body) => (endpoint === 'omni-local-progress' ? progress() : start(body))
  rt.omniLocalJob = () => job?.done
  // Installing changes this computer, so only a host that may change things answers it.
  rt.ctx.effect(() => rt.hooks.endpoint('omni-local-install', body => start(body)), 'omni-channels: omni-local-install')
  rt.ctx.effect(() => rt.hooks.endpoint('omni-local-progress', async () => progress(), { read: true }), 'omni-channels: omni-local-progress')
}
