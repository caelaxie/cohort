import { describe, expect, it } from 'vitest'
import { BoxManager, type RunningBox } from './box'

function fakeStarter(log: string[]): (input: { hostPath: string; guestPath: string }) => Promise<RunningBox> {
  return async (input) => {
    log.push(`start:${input.guestPath}:${input.hostPath}`)
    return {
      stop: async () => {
        log.push('stop')
      }
    }
  }
}

describe('BoxManager', () => {
  it('starts a box for the current uuid', async () => {
    const log: string[] = []
    const states: string[] = []
    const manager = new BoxManager('/tmp/cohort-box', fakeStarter(log), (state) => {
      states.push(state.status)
    })
    manager.setCurrent('44444444-4444-4444-8444-444444444444')
    await manager.quit()
    expect(states).toContain('starting')
    expect(log.some((entry) => entry.startsWith('start:/workspace:'))).toBe(true)
  })

  it('overlapping switches stop the previous box', async () => {
    const log: string[] = []
    const manager = new BoxManager('/tmp/cohort-box', fakeStarter(log), () => undefined)
    manager.setCurrent('44444444-4444-4444-8444-444444444444')
    manager.setCurrent('55555555-5555-4555-8555-555555555555')
    await manager.quit()
    expect(log.filter((entry) => entry === 'stop').length).toBeGreaterThanOrEqual(1)
  })
})
