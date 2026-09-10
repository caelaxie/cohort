#!/usr/bin/env node
// cohort-drive: drive a running Cohort Electron window over the Chrome DevTools
// Protocol. Zero dependencies; needs Node 22+ (global fetch and WebSocket).
//
// Usage: node cohort-drive.mjs <command> --port <cdp-port> [options]
//
// Commands:
//   doctor                        check the instance is worth driving
//   state      [--path out.json]  print window.cohort.home() (read-only)
//   eval       --js EXPR          evaluate an expression in the page, print JSON
//   click      --text TXT | --selector CSS
//   fill       --label TXT | --selector CSS   --value TXT
//   key        --key Escape [--selector CSS]
//   wait       --js EXPR [--timeout MS]       poll until EXPR is truthy
//   snapshot   [--path out.txt]   text tree of headings/buttons/inputs/alerts
//   screenshot --path out.png
//
// Exit code is 0 on success, 1 on any failure. All output goes to stdout so a
// calling agent can tee it into evidence files.

import { writeFileSync } from 'node:fs'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        args[key] = true
      } else {
        args[key] = next
        i += 1
      }
    } else {
      args._.push(arg)
    }
  }
  return args
}

function fail(message) {
  console.error(`cohort-drive: ${message}`)
  process.exit(1)
}

async function pageTarget(port) {
  let targets
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`)
    targets = await res.json()
  } catch {
    fail(
      `no CDP endpoint on 127.0.0.1:${port} — is the app running with REMOTE_DEBUGGING_PORT=${port}?`
    )
  }
  const page = targets.find((t) => t.type === 'page')
  if (!page)
    fail(
      `no page target on port ${port} (saw: ${targets.map((t) => t.type).join(', ') || 'nothing'})`
    )
  return page
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', () => reject(new Error('websocket connect failed')), {
        once: true
      })
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaljs(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      fail(`page evaluation failed: ${detail}`)
    }
    return result.result.value
  }

  close() {
    this.ws.close()
  }
}

// In-page helpers. Keep them plain: they run in the renderer, which is a
// sandboxed, context-isolated page — no Node APIs, no imports.
const PAGE_HELPERS = `
function __visible(el) {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}
function __byText(text) {
  const els = [...document.querySelectorAll('button, [role="button"], a, [role="link"]')]
  return els.find((el) => __visible(el) && el.textContent.trim() === text) ?? null
}
function __byLabel(label) {
  const labels = [...document.querySelectorAll('label')]
  const hit = labels.find((l) => l.textContent.trim().includes(label))
  if (!hit) return null
  if (hit.htmlFor) return document.getElementById(hit.htmlFor)
  return hit.querySelector('input, textarea')
}
function __setValue(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  const port = args.port ?? process.env.COHORT_CDP_PORT
  if (!command) fail('missing command')
  if (!port) fail('missing --port (or COHORT_CDP_PORT)')

  const page = await pageTarget(port)
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  try {
    switch (command) {
      case 'doctor': {
        const bridge = await cdp.evaljs(`typeof window.cohort === 'object' && !!window.cohort`)
        if (!bridge) fail('window.cohort bridge missing — wrong page or broken preload')
        const state = await cdp.evaljs(`window.cohort.home()`)
        const report = {
          ok: true,
          page: { title: page.title, url: page.url },
          bridge: true,
          hatch: { id: state.hatch.id, name: state.hatch.name },
          current: state.current
        }
        console.log(JSON.stringify(report, null, 2))
        break
      }
      case 'state': {
        const state = await cdp.evaljs(`window.cohort.home()`)
        const text = JSON.stringify(state, null, 2)
        if (args.path) writeFileSync(args.path, text + '\n')
        console.log(text)
        break
      }
      case 'eval': {
        if (!args.js) fail('eval needs --js')
        const value = await cdp.evaljs(args.js)
        console.log(JSON.stringify(value, null, 2))
        break
      }
      case 'click': {
        if (!args.text && !args.selector) fail('click needs --text or --selector')
        const found = await cdp.evaljs(`(() => {
          ${PAGE_HELPERS}
          const el = ${args.selector ? `document.querySelector(${JSON.stringify(args.selector)})` : `__byText(${JSON.stringify(args.text)})`}
          if (!el || !__visible(el)) return false
          el.scrollIntoView({ block: 'nearest' })
          el.click()
          return true
        })()`)
        if (!found) fail(`no visible element for ${args.selector ?? `"${args.text}"`}`)
        console.log(`clicked ${args.selector ?? `"${args.text}"`}`)
        break
      }
      case 'fill': {
        if ((!args.label && !args.selector) || args.value === undefined) {
          fail('fill needs --label or --selector, and --value')
        }
        const found = await cdp.evaljs(`(() => {
          ${PAGE_HELPERS}
          const el = ${args.selector ? `document.querySelector(${JSON.stringify(args.selector)})` : `__byLabel(${JSON.stringify(args.label)})`}
          if (!el) return false
          el.focus()
          __setValue(el, ${JSON.stringify(args.value)})
          return true
        })()`)
        if (!found) fail(`no input for ${args.selector ?? `label "${args.label}"`}`)
        console.log(
          `filled ${args.selector ?? `label "${args.label}"`} with ${JSON.stringify(args.value)}`
        )
        break
      }
      case 'key': {
        if (!args.key) fail('key needs --key')
        await cdp.evaljs(`(() => {
          const target = ${args.selector ? `document.querySelector(${JSON.stringify(args.selector)})` : 'document.activeElement'} ?? document.body
          target.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(args.key)}, bubbles: true, cancelable: true }))
          return true
        })()`)
        console.log(`sent key ${args.key}`)
        break
      }
      case 'wait': {
        if (!args.js) fail('wait needs --js')
        const timeout = Number(args.timeout ?? 15000)
        const deadline = Date.now() + timeout
        let ok = false
        while (Date.now() < deadline) {
          ok = Boolean(await cdp.evaljs(args.js))
          if (ok) break
          await new Promise((r) => setTimeout(r, 250))
        }
        if (!ok) fail(`wait timed out after ${timeout}ms: ${args.js}`)
        console.log(`condition met: ${args.js}`)
        break
      }
      case 'snapshot': {
        const text = await cdp.evaljs(`(() => {
          ${PAGE_HELPERS}
          const lines = []
          for (const el of document.querySelectorAll('h1, h2, [role="alert"], button, input, label, li, p')) {
            if (!__visible(el)) continue
            const tag = el.tagName.toLowerCase()
            const role = el.getAttribute('role')
            const current = el.getAttribute('aria-current')
            const text = (el.tagName === 'INPUT' ? el.value || el.placeholder : el.textContent.trim())
            if (!text || text.length > 120) continue
            if ((tag === 'li' || tag === 'p') && el.closest('li') !== el) continue
            if (tag === 'li' && el.querySelector('button')) continue
            lines.push([tag, role, current, JSON.stringify(text)].filter(Boolean).join(' '))
          }
          return lines.join('\\n')
        })()`)
        if (args.path) writeFileSync(args.path, text + '\n')
        console.log(text)
        break
      }
      case 'screenshot': {
        if (!args.path) fail('screenshot needs --path')
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(args.path, Buffer.from(shot.data, 'base64'))
        console.log(`wrote ${args.path}`)
        break
      }
      default:
        fail(`unknown command: ${command}`)
    }
  } finally {
    cdp.close()
  }
}

main().catch((error) => fail(error.message))
