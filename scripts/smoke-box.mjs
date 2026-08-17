// Live box smoke: real SimpleBox start, exec through the captain chain,
// AE1 keep-alive while working, AE9 idle drop, quit-all.
import { app } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

app.whenReady().then(async () => {
  const results = []
  const record = (step, ok, detail) => {
    results.push(ok)
    console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`)
  }
  try {
    const home = process.env.COHORT_HOME ?? mkdtempSync(join(tmpdir(), 'cohort-boxsmoke-'))
    const { BoxManager } = await import('../src/main/box')
    const { createLiveBoxStarter } = await import('../src/main/live-box')
    const { WorkspaceStore } = await import('../src/main/workspaces')

    const store = new WorkspaceStore(home)
    const a = store.create('Alpha')
    const b = store.create('Beta')

    const boxes = new BoxManager(home, createLiveBoxStarter(), () => undefined)
    boxes.setCurrent(a.workspace.uuid)
    const boxA = await boxes.waitForRunning(a.workspace.uuid)
    const exec = boxA.exec
    if (!exec) {
      record('box exec exposed', false)
    } else {
      const result = await exec('echo cohort-box-ok')
      record('KTD5 real box exec', result.exitCode === 0 && result.stdout.includes('cohort-box-ok'), `exit=${result.exitCode} out="${result.stdout.trim()}"`)
    }

    // AE1: switch away while A is working keeps A's box.
    boxes.setWorking(a.workspace.uuid, true)
    boxes.setCurrent(b.workspace.uuid)
    await boxes.settle()
    const liveAfterSwitch = boxes.liveStates().map((s) => s.uuid)
    record('AE1 working box kept', liveAfterSwitch.includes(a.workspace.uuid) && liveAfterSwitch.includes(b.workspace.uuid), liveAfterSwitch.join(','))

    // AE9: A's work ends while not current -> box drops.
    boxes.setWorking(a.workspace.uuid, false)
    await boxes.settle()
    const liveAfterIdle = boxes.liveStates().map((s) => s.uuid)
    record('AE9 idle box dropped', !liveAfterIdle.includes(a.workspace.uuid) && liveAfterIdle.includes(b.workspace.uuid), liveAfterIdle.join(','))

    const errors = await boxes.quit()
    record('quit stops all', errors.length === 0 && boxes.liveStates().length === 0)
    store.close()
  } catch (error) {
    record('crashed', false, error instanceof Error ? error.message : String(error))
  }
  const failed = results.filter((ok) => !ok).length
  console.log(`BOXSMOKE_RESULT ${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed}/${results.length}`)
  app.exit(failed === 0 ? 0 : 1)
})
