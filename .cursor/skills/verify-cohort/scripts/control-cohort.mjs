#!/usr/bin/env node
/**
 * Drive the Cohort Electron window over CDP.
 * Invocation: .cursor/skills/verify-cohort/scripts/control-cohort <command>
 */
import { spawn, execFileSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const here = dirname(fileURLToPath(import.meta.url))
const skillDir = resolve(here, '..')
const lastRunPath = join(skillDir, '.last-run')
const defaultCohortHome = join(os.homedir(), '.cohort')

function fail(message, code = 1) {
  console.error(`FAIL ${message}`)
  process.exit(code)
}

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--') {
      flags._ = argv.slice(i + 1)
      break
    }
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next == null || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i += 1
      }
    } else {
      positional.push(token)
    }
  }
  return { flags, positional }
}

function repoRoot() {
  if (process.env.VERIFY_COHORT_ROOT) return resolve(process.env.VERIFY_COHORT_ROOT)
  let dir = process.cwd()
  while (true) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.name === 'cohort') return dir
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  dir = skillDir
  while (true) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.name === 'cohort') return dir
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  fail('could not find the cohort repo root (package.json name "cohort")')
}

function runDirFromEnvOrLast() {
  if (process.env.VERIFY_COHORT_RUN) return resolve(process.env.VERIFY_COHORT_RUN)
  if (existsSync(lastRunPath)) {
    const listed = readFileSync(lastRunPath, 'utf8').trim()
    if (listed) return listed
  }
  fail('no active run; launch first or set VERIFY_COHORT_RUN')
}

function readRun(dir = runDirFromEnvOrLast()) {
  const path = join(dir, 'run.json')
  if (!existsSync(path)) fail(`missing ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeRun(run) {
  mkdirSync(run.runDir, { recursive: true })
  writeFileSync(join(run.runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
  writeFileSync(lastRunPath, `${run.runDir}\n`)
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function listenerPid(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8'
    }).trim()
    const line = out.split('\n').find(Boolean)
    return line ? Number(line) : null
  } catch {
    return null
  }
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(port)
      })
    })
    server.on('error', reject)
  })
}

async function cdpTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`CDP ${response.status}`)
  return response.json()
}

async function waitForPage(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const targets = await cdpTargets(port)
      const page = targets.find((item) => item.type === 'page' && item.title === 'Cohort')
      if (page) return page
      last = `targets=${targets.map((item) => `${item.type}:${item.title}`).join(',')}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(250)
  }
  throw new Error(`CDP page title Cohort not ready on port ${port}: ${last}`)
}

async function ensurePlaywright() {
  const pkg = join(here, 'node_modules/playwright-core/index.js')
  if (existsSync(pkg)) return
  const pnpm = await spawnSyncPnpm(['install'], here)
  if (pnpm.status !== 0) fail('pnpm install failed in scripts/; install playwright-core there')
}

function spawnSyncPnpm(args, cwd) {
  const result = spawn('pnpm', args, { cwd, stdio: 'inherit' })
  return new Promise((resolvePromise) => {
    result.on('close', (status) => resolvePromise({ status }))
  }).then((value) => value)
}

async function connectPage(run) {
  await ensurePlaywright()
  const playwright = await import(
    pathToFileURL(join(here, 'node_modules/playwright-core/index.js')).href
  )
  const chromium = playwright.chromium ?? playwright.default.chromium
  if (!chromium) fail('playwright-core has no chromium export')
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${run.cdpPort}`)
  const pages = browser.contexts().flatMap((context) => context.pages())
  const page =
    pages.find((item) => item.url().includes('localhost') || item.url().includes('index.html')) ??
    pages[0]
  if (!page) {
    await browser.close()
    fail('CDP connected but no renderer page')
  }
  page.setDefaultTimeout(Number(process.env.VERIFY_COHORT_TIMEOUT_MS ?? 10000))
  return { browser, page }
}

function locator(page, flags) {
  const exact = flags['no-exact'] ? false : true
  if (flags.text) return page.getByText(flags.text, { exact })
  if (!flags.role) fail('need --role or --text')
  const options = { exact }
  if (flags.name) options.name = flags.name
  if (flags.level) options.level = Number(flags.level)
  return page.getByRole(flags.role, options)
}

function resolveOutPath(path) {
  if (!path) fail('need --path')
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

function sqlite(home, sql) {
  try {
    return execFileSync('sqlite3', ['-readonly', join(home, 'state.sqlite'), sql], {
      encoding: 'utf8'
    }).trim()
  } catch (error) {
    return `sqlite-error: ${error instanceof Error ? error.message : error}`
  }
}

async function cmdLaunch(flags) {
  const root = repoRoot()
  if (!existsSync(join(root, 'node_modules/electron-vite'))) {
    fail('app deps missing; run pnpm install at the repo root')
  }
  const id = flags.id || `r${Date.now()}`
  const runDir = resolve(flags['run-dir'] || process.env.VERIFY_COHORT_RUN || join(skillDir, 'runs', id))
  const home = join(runDir, 'home')
  const userData = join(runDir, 'electron-profile')
  if (resolve(home) === resolve(defaultCohortHome)) {
    fail('refusing to use ~/.cohort; verification needs an isolated COHORT_HOME')
  }

  if (!flags.force && existsSync(lastRunPath) && !process.env.VERIFY_COHORT_RUN && !flags['run-dir']) {
    try {
      const previous = readRun(readFileSync(lastRunPath, 'utf8').trim())
      if (pidAlive(previous.pid)) {
        fail(`already running pid=${previous.pid} runDir=${previous.runDir}; cleanup first or pass --run-dir`)
      }
    } catch {
      // stale pointer
    }
  }

  mkdirSync(home, { recursive: true })
  mkdirSync(userData, { recursive: true })
  const logPath = join(runDir, 'launch.log')
  const logFd = openSync(logPath, 'w')
  const port = Number(flags.port) || (await freePort())
  const electronVite = join(root, 'node_modules/.bin/electron-vite')
  const child = spawn(
    electronVite,
    ['dev', `--remoteDebuggingPort=${port}`, '--', `--user-data-dir=${userData}`],
    {
      cwd: root,
      env: { ...process.env, COHORT_HOME: home },
      detached: true,
      stdio: ['ignore', logFd, logFd]
    }
  )
  closeSync(logFd)
  if (!child.pid) fail('failed to spawn electron-vite')
  child.unref()

  const run = {
    pid: child.pid,
    cdpPort: port,
    home,
    userData,
    runDir,
    logPath,
    repoRoot: root,
    startedAt: new Date().toISOString()
  }
  writeRun(run)

  try {
    const page = await waitForPage(port, Number(flags.timeout ?? 60000))
    run.electronPid = listenerPid(port)
    run.rendererUrl = page.url
    writeRun(run)
    console.log(
      [
        `OK launch pid=${run.pid}`,
        `electronPid=${run.electronPid ?? '?'}`,
        `cdp=http://127.0.0.1:${port}`,
        `home=${home}`,
        `userData=${userData}`,
        `runDir=${runDir}`,
        `title=${page.title}`,
        `url=${page.url}`
      ].join(' ')
    )
  } catch (error) {
    const tail = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-2000) : ''
    fail(`${error instanceof Error ? error.message : error}\n${tail}`)
  }
}

async function cmdDoctor() {
  const run = readRun()
  const problems = []
  if (!pidAlive(run.pid)) problems.push(`launcher pid ${run.pid} is dead`)
  const owner = listenerPid(run.cdpPort)
  if (!owner) problems.push(`nothing listening on 127.0.0.1:${run.cdpPort}`)
  else {
    run.electronPid = owner
    const command = commandOf(owner)
    if (!/Electron/i.test(command)) problems.push(`port ${run.cdpPort} is not Electron: ${command}`)
  }
  if (resolve(run.home) === resolve(defaultCohortHome)) {
    problems.push('COHORT_HOME is ~/.cohort; refuse to drive the owner home')
  }
  if (!run.home.startsWith(run.runDir)) problems.push('home is outside this run dir')
  if (!run.userData.startsWith(run.runDir)) problems.push('userData is outside this run dir')

  let title = ''
  let url = ''
  let text = ''
  try {
    const targets = await cdpTargets(run.cdpPort)
    const page = targets.find((item) => item.type === 'page')
    title = page?.title ?? ''
    url = page?.url ?? ''
    if (title !== 'Cohort') problems.push(`window title is ${JSON.stringify(title)}, expected Cohort`)
    if (url.startsWith('http') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      problems.push(`renderer url looks wrong: ${url}`)
    }
  } catch (error) {
    problems.push(`CDP: ${error instanceof Error ? error.message : error}`)
  }

  try {
    const { browser, page } = await connectPage(run)
    text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim()
    await browser.close()
    if (!text.includes('Crew') || !text.includes('Hatch')) {
      problems.push('renderer did not paint Crew and Hatch')
    }
    if (text.includes('The app bridge is missing')) {
      problems.push('window.cohort is missing; you are not in the Electron window')
    }
  } catch (error) {
    problems.push(`renderer: ${error instanceof Error ? error.message : error}`)
  }

  const teammateCount = sqlite(run.home, 'select count(*) from teammates;')
  writeRun(run)
  const summary = [
    `pid=${run.pid}`,
    `electronPid=${run.electronPid ?? owner ?? '?'}`,
    `cdp=http://127.0.0.1:${run.cdpPort}`,
    `title=${title || '?'}`,
    `home=${run.home}`,
    `userData=${run.userData}`,
    `teammates=${teammateCount}`,
    `url=${url}`
  ].join(' ')
  if (problems.length) fail(`${problems.join('; ')} | ${summary}`)
  console.log(`OK doctor ${summary}`)
}

async function withPage(fn) {
  const run = readRun()
  if (resolve(run.home) === resolve(defaultCohortHome)) {
    fail('refusing to drive ~/.cohort')
  }
  if (!pidAlive(run.pid) && !listenerPid(run.cdpPort)) fail('instance is down; doctor, then relaunch')
  const { browser, page } = await connectPage(run)
  try {
    return await fn(page, run)
  } finally {
    await browser.close()
  }
}

async function cmdClick(flags) {
  await withPage(async (page) => {
    await locator(page, flags).click()
    console.log(`OK click role=${flags.role ?? ''} name=${flags.name ?? flags.text ?? ''}`)
  })
}

async function cmdFill(flags) {
  if (flags.value == null) fail('need --value')
  await withPage(async (page) => {
    await locator(page, flags).fill(String(flags.value))
    console.log(`OK fill name=${flags.name ?? ''} value=${flags.value}`)
  })
}

async function cmdPress(flags) {
  const key = flags.key
  if (!key) fail('need --key')
  await withPage(async (page) => {
    await page.keyboard.press(String(key))
    console.log(`OK press ${key}`)
  })
}

async function cmdWait(flags) {
  await withPage(async (page) => {
    await locator(page, flags).waitFor({ state: flags.gone ? 'hidden' : 'visible' })
    console.log(`OK wait ${flags.role ?? 'text'} ${flags.name ?? flags.text ?? ''}`)
  })
}

async function cmdExpect(flags) {
  await withPage(async (page) => {
    const loc = locator(page, flags)
    if (flags.gone) {
      const count = await loc.count()
      if (count !== 0) fail(`expected gone, found ${count}`)
      console.log('OK expect gone')
      return
    }
    await loc.first().waitFor({ state: 'visible' })
    if (flags.attr) {
      const value = await loc.first().getAttribute(String(flags.attr))
      const expected = flags.value === undefined ? 'page' : String(flags.value)
      if (String(value) !== expected) {
        fail(`attr ${flags.attr}=${JSON.stringify(value)} expected ${JSON.stringify(expected)}`)
      }
    }
    console.log('OK expect')
  })
}

async function cmdSnapshot(flags) {
  const out = resolveOutPath(flags.path)
  mkdirSync(dirname(out), { recursive: true })
  await withPage(async (page) => {
    const body = await page.locator('body').ariaSnapshot()
    writeFileSync(out, `${body}\n`)
    console.log(`OK snapshot ${out}`)
  })
}

async function cmdScreenshot(flags) {
  const out = resolveOutPath(flags.path)
  mkdirSync(dirname(out), { recursive: true })
  await withPage(async (page) => {
    await page.screenshot({ path: out, fullPage: true })
    console.log(`OK screenshot ${out}`)
  })
}

async function cmdText() {
  await withPage(async (page) => {
    console.log(await page.locator('body').innerText())
  })
}

function cmdRoster() {
  const run = readRun()
  const rows = sqlite(run.home, "select uuid || '|' || name from teammates order by created_at, uuid;")
  const current = sqlite(run.home, "select value from meta where key='current_id';")
  console.log(`current=${current || 'hatch'}`)
  console.log('hatch|Hatch')
  console.log(rows || '')
}

function cmdFiles() {
  const run = readRun()
  const current = sqlite(run.home, "select value from meta where key='current_uuid';")
  if (!current) fail('no current workspace')
  const dir = join(run.home, 'workspaces', current)
  if (!existsSync(dir)) fail(`missing folder ${dir}`)
  const listing = execFileSync('find', [dir, '-type', 'f', '-print'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((path) => path.slice(dir.length + 1))
    .sort()
  console.log(listing.join('\n'))
}

function cmdPickFiles(flags, positional) {
  const paths = [...(flags._ ?? []), ...positional]
  if (paths.length === 0) fail('need file paths after pick-files')
  const run = readRun()
  const pid = run.electronPid || listenerPid(run.cdpPort)
  if (!pid) fail('no Electron pid')
  const file = resolve(paths[0])
  if (!existsSync(file)) fail(`missing ${file}`)
  const escaped = file.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `
tell application "System Events"
  set proc to first process whose unix id is ${pid}
  set frontmost of proc to true
  delay 0.4
  keystroke "g" using {command down, shift down}
  delay 0.4
  keystroke "${escaped}"
  delay 0.2
  keystroke return
  delay 0.5
  keystroke return
end tell
`
  execFileSync('osascript', ['-e', script], { stdio: 'inherit' })
  console.log(`OK pick-files ${file}`)
}

function cmdCleanup() {
  const run = readRun()
  const artifactsHint = join(skillDir, 'artifacts')
  if (pidAlive(run.pid)) {
    try {
      process.kill(-run.pid, 'SIGTERM')
    } catch {
      try {
        process.kill(run.pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }
  const electronPid = run.electronPid || listenerPid(run.cdpPort)
  if (electronPid && pidAlive(electronPid)) {
    try {
      process.kill(electronPid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (!pidAlive(run.pid) && !listenerPid(run.cdpPort)) break
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
  }
  if (listenerPid(run.cdpPort)) fail(`port ${run.cdpPort} still listening; not killing by process name`)
  if (run.runDir.startsWith(skillDir) || run.runDir.startsWith('/tmp/')) {
    rmSync(run.runDir, { recursive: true, force: true })
  }
  if (existsSync(lastRunPath)) rmSync(lastRunPath)
  console.log(`OK cleanup removed ${run.runDir}; evidence stays in ${artifactsHint}`)
}

function cmdHelp() {
  console.log(`control-cohort — drive the Cohort Electron window

Launch / health:
  control-cohort launch [--run-dir DIR] [--id ID] [--port N]
  control-cohort doctor
  control-cohort cleanup

Drive (Playwright over CDP, ARIA roles):
  control-cohort click --role button --name New
  control-cohort fill --role textbox --name Name --value Alpha
  control-cohort press --key Escape
  control-cohort wait --text "No workspaces"
  control-cohort expect --role button --name Alpha --attr aria-current --value page
  control-cohort expect --text "No workspaces" --gone
  control-cohort snapshot --path artifacts/foo.aria.txt
  control-cohort screenshot --path artifacts/foo.png
  control-cohort text
  control-cohort roster
  control-cohort files
  control-cohort pick-files -- /path/to/file.txt

Never open http://localhost:5173 in Chrome. Never set COHORT_HOME to ~/.cohort.
`)
}

const { flags, positional } = parseArgs(process.argv.slice(2))
const command = positional.shift() || 'help'

try {
  switch (command) {
    case 'launch':
      await cmdLaunch(flags)
      break
    case 'doctor':
      await cmdDoctor()
      break
    case 'click':
      await cmdClick(flags)
      break
    case 'fill':
      await cmdFill(flags)
      break
    case 'press':
      await cmdPress(flags)
      break
    case 'wait':
      await cmdWait(flags)
      break
    case 'expect':
      await cmdExpect(flags)
      break
    case 'snapshot':
      await cmdSnapshot(flags)
      break
    case 'screenshot':
      await cmdScreenshot(flags)
      break
    case 'text':
      await cmdText()
      break
    case 'roster':
      cmdRoster()
      break
    case 'files':
      cmdFiles()
      break
    case 'pick-files':
      cmdPickFiles(flags, positional)
      break
    case 'cleanup':
      cmdCleanup()
      break
    case 'help':
    case '-h':
    case '--help':
      cmdHelp()
      break
    default:
      fail(`unknown command ${command}`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
