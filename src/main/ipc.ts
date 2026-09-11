import { homedir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { Kernel } from './kernel'
import { defaultCohortHome } from './paths'
import { RosterStore } from './roster'

export function registerIpc(): { quit: () => Promise<void> } {
  const home = process.env.COHORT_HOME ?? defaultCohortHome()
  const store = new RosterStore(home)
  const kernel = new Kernel({
    env: process.env,
    primeAuthPath: process.env.COHORT_HOME
      ? join(home, 'prime', 'agent', 'auth.json')
      : join(homedir(), '.prime', 'agent', 'auth.json')
  })

  ipcMain.handle('cohort:home', () => store.load())
  ipcMain.handle('cohort:select', (_event, id: unknown) => store.select(id))
  ipcMain.handle('cohort:kernel', () => kernel.status())
  ipcMain.handle('cohort:connect', (_event, input: unknown) => kernel.connect(input))

  return {
    quit: async () => {
      store.close()
    }
  }
}
