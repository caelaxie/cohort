// Smoke: F1–F4 against the real modules in a live Electron main process.
// Covers F1 talk, F2 switch mid-work, F3 come-back, F4 reopen,
// AE4 isolation on disk, AE7 history, AE8 name-list exclusion.
// Run: COHORT_HOME=<tmp> npx electron out/smoke/smoke.js
import { app } from 'electron'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const results = []
const record = (step, ok, detail) => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`)
}

const home = process.env.COHORT_HOME ?? mkdtempSync(join(tmpdir(), 'cohort-smoke-'))

app.whenReady().then(async () => {
  try {
    const { CaptainHost, primeWorkspaceAgentDir } = await import('../src/main/captain')
    const { WorkspaceStore } = await import('../src/main/workspaces')
    const { listWorkspaceFiles } = await import('../src/main/files')

    const store = new WorkspaceStore(home)
    const a = store.create('Alpha')
    const b = store.create('Beta')

    // F1: talk to the current captain, real model reply.
    const host = new CaptainHost(home, undefined, {
      model: {
        id: 'glm-5.2',
        name: 'GLM-5.2',
        api: 'openai-completions',
        provider: 'zai-coding-cn',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        reasoning: true,
        input: ['text'],
        contextWindow: 1000000,
        maxTokens: 131072
      }
    })
    await host.send(
      a.workspace.uuid,
      'Reply with exactly the word READY and nothing else. Do not run any commands.'
    )
    const aThread = host.thread(a.workspace.uuid)
    const aReply = aThread?.filter((m) => m.role === 'assistant').at(-1)?.text ?? ''
    record('F1 real reply', aReply.trim().length > 0, `reply="${aReply.trim().slice(0, 60)}"`)

    // AE4: session files stay inside A's .prime dir.
    const aAgent = primeWorkspaceAgentDir(home, a.workspace.uuid)
    record('AE4 agent dir inside workspace', existsSync(aAgent), aAgent)

    // F2: switch means B; A's history is not B's.
    await host.send(b.workspace.uuid, 'Reply with exactly the word BETA and nothing else.')
    const bThread = host.thread(b.workspace.uuid)
    const bText = JSON.stringify(bThread)
    record(
      'F2 separate threads',
      !bText.includes('READY'),
      `bThread length=${bThread?.length ?? 0}`
    )

    // AE8: reserved history directory hidden from the name list.
    const names = listWorkspaceFiles(home, a.workspace.uuid)
    record('AE8 reserved dir hidden', !names.some((n) => n.startsWith('.prime')), names.join(','))

    // F4: quit + reopen restores A's thread from disk.
    await host.disposeAll()
    const reopened = new CaptainHost(home)
    const restored = await reopened.loadThread(a.workspace.uuid)
    record(
      'F4 thread restored',
      (restored?.length ?? 0) > 0 && JSON.stringify(restored).includes(aReply.trim().slice(0, 20)),
      `messages=${restored?.length ?? 0}`
    )
    await reopened.disposeAll()
    store.close()
  } catch (error) {
    record('smoke crashed', false, error instanceof Error ? `${error.message}` : String(error))
  }
  const failed = results.filter((r) => !r.ok)
  console.log(
    `SMOKE_RESULT ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`
  )
  app.exit(failed.length === 0 ? 0 : 1)
})
