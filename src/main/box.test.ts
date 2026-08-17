import { describe, expect, it } from 'vitest'
import { BoxManager, type RunningBox } from './box'

const HOME = '/tmp/cohort-box'
const A = '44444444-4444-4444-8444-444444444444'
const B = '55555555-5555-4555-8555-555555555555'

function fakeStarter(
  log: string[],
  failFor = new Set<string>()
): (input: { hostPath: string; guestPath: string }) => Promise<RunningBox> {
  return async (input) => {
    if (failFor.has(input.hostPath)) throw new Error('boom')
    log.push(`start:${input.hostPath}`)
    return {
      stop: async () => {
        log.push(`stop:${input.hostPath}`)
      }
    }
  }
}

describe('BoxManager registry', () => {
  it('starts a box for the current uuid', async () => {
    const log: string[] = []
    const states: string[] = []
    const manager = new BoxManager(HOME, fakeStarter(log), () => {
      states.push(manager.state.status)
    })
    manager.setCurrent(A)
    await manager.settle()
    expect(states).toContain('starting')
    expect(manager.state).toMatchObject({ status: 'running', uuid: A })
    expect(log.some((entry) => entry.startsWith(`start:${HOME}/workspaces/${A}`))).toBe(true)
    await manager.quit()
  })

  it('keeps a working box running after switching away (AE1)', async () => {
    const log: string[] = []
    const manager = new BoxManager(HOME, fakeStarter(log), () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    manager.setWorking(A, true)
    manager.setCurrent(B)
    await manager.settle()
    expect(log.filter((entry) => entry.startsWith('stop'))).toHaveLength(0)
    const live = manager.liveStates()
    expect(live.map((box) => box.uuid).sort()).toEqual([A, B])
    await manager.quit()
  })

  it('stops an idle box after switching away (AE9)', async () => {
    const log: string[] = []
    const manager = new BoxManager(HOME, fakeStarter(log), () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    manager.setCurrent(B)
    await manager.settle()
    expect(log).toContain(`stop:${HOME}/workspaces/${A}`)
    expect(manager.liveStates().map((box) => box.uuid)).toEqual([B])
    await manager.quit()
  })

  it('does not start two boxes for overlapping switches on the same uuid', async () => {
    const log: string[] = []
    const manager = new BoxManager(HOME, fakeStarter(log), () => undefined)
    manager.setCurrent(A)
    manager.setCurrent(A)
    await manager.settle()
    expect(log.filter((entry) => entry.startsWith(`start:${HOME}/workspaces/${A}`))).toHaveLength(1)
    await manager.quit()
  })

  it('keeps the previous working box when the new box fails to start', async () => {
    const log: string[] = []
    const failFor = new Set([`${HOME}/workspaces/${B}`])
    const manager = new BoxManager(HOME, fakeStarter(log, failFor), () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    manager.setWorking(A, true)
    manager.setCurrent(B)
    await manager.settle()
    expect(manager.state).toMatchObject({ status: 'error', uuid: B })
    expect(manager.state.error).toBe('boom')
    expect(manager.liveStates().some((box) => box.uuid === A && box.status === 'running')).toBe(
      true
    )
    await manager.quit()
  })

  it('quit stops every live box even when one stop fails', async () => {
    const log: string[] = []
    const starter = async (input: { hostPath: string; guestPath: string }): Promise<RunningBox> => {
      const path = input.hostPath
      return {
        stop: async () => {
          if (path.endsWith(A)) throw new Error('stop failed')
          log.push(`stop:${path}`)
        }
      }
    }
    const manager = new BoxManager(HOME, starter, () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    manager.setWorking(A, true)
    manager.setCurrent(B)
    await manager.settle()
    const errors = await manager.quit()
    expect(log).toContain(`stop:${HOME}/workspaces/${B}`)
    expect(errors).toHaveLength(1)
    expect(manager.liveStates()).toHaveLength(0)
    expect(manager.state).toEqual({ status: 'none', uuid: null })
  })

  it('drops the box when work ends while the uuid is not current', async () => {
    const log: string[] = []
    const manager = new BoxManager(HOME, fakeStarter(log), () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    manager.setWorking(A, true)
    manager.setCurrent(B)
    await manager.settle()
    manager.setWorking(A, false)
    await manager.settle()
    expect(log).toContain(`stop:${HOME}/workspaces/${A}`)
    expect(manager.liveStates().map((box) => box.uuid)).toEqual([B])
    await manager.quit()
  })

  it('keeps the box when work ends while the uuid is current', async () => {
    const log: string[] = []
    const manager = new BoxManager(HOME, fakeStarter(log), () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    manager.setWorking(A, true)
    manager.setWorking(A, false)
    await manager.settle()
    expect(log.filter((entry) => entry.startsWith('stop'))).toHaveLength(0)
    expect(manager.liveStates().map((box) => box.uuid)).toEqual([A])
    await manager.quit()
  })

  it('reuses the running box when switching back without a restart', async () => {
    const log: string[] = []
    const manager = new BoxManager(HOME, fakeStarter(log), () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    manager.setWorking(A, true)
    manager.setCurrent(B)
    await manager.settle()
    manager.setCurrent(A)
    await manager.settle()
    expect(log.filter((entry) => entry.startsWith(`start:${HOME}/workspaces/${A}`))).toHaveLength(1)
    expect(manager.state).toMatchObject({ status: 'running', uuid: A })
    await manager.quit()
  })

  it('restarts an errored box when its captain starts working', async () => {
    const log: string[] = []
    const failFor = new Set([`${HOME}/workspaces/${A}`])
    const manager = new BoxManager(HOME, fakeStarter(log, failFor), () => undefined)
    manager.setCurrent(A)
    await manager.settle()
    expect(manager.state.status).toBe('error')
    failFor.clear()
    manager.setWorking(A, true)
    await manager.settle()
    expect(manager.state).toMatchObject({ status: 'running', uuid: A })
    await manager.quit()
  })
})
