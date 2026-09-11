import { homedir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { Kernel } from './kernel'
import { defaultCohortHome } from './paths'
import { primeTurn } from './prime'
import { RosterStore } from './roster'
import { TalkStore } from './talk'

export function registerIpc(): { quit: () => Promise<void> } {
  const home = process.env.COHORT_HOME ?? defaultCohortHome()
  const primeAuthPath = process.env.COHORT_HOME
    ? join(home, 'prime', 'agent', 'auth.json')
    : join(homedir(), '.prime', 'agent', 'auth.json')
  const store = new RosterStore(home)
  const kernel = new Kernel({
    env: process.env,
    primeAuthPath
  })
  const talk = new TalkStore({
    home,
    known: (id) => store.known(id),
    turn: primeTurn({
      home,
      endpoint: () => kernel.endpoint(),
      bot: (id) => {
        const found = store.bot(id)
        if (!found) {
          throw new Error('unknown bot')
        }
        return found
      }
    })
  })

  ipcMain.handle('cohort:home', () => store.load())
  ipcMain.handle('cohort:select', (_event, id: unknown) => store.select(id))
  ipcMain.handle('cohort:hatch', (_event, name: unknown) => store.hatch(name))
  ipcMain.handle('cohort:remove', (_event, id: unknown) => store.remove(id))
  ipcMain.handle('cohort:kernel', () => kernel.status())
  ipcMain.handle('cohort:connect', (_event, input: unknown) => kernel.connect(input))
  ipcMain.handle('cohort:thread', (_event, id: unknown) => talk.thread(id))
  ipcMain.handle('cohort:send', (_event, input: unknown) => talk.send(input))

  return {
    quit: async () => {
      talk.close()
      store.close()
    }
  }
}
