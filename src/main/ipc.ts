import { ipcMain } from 'electron'
import { Kernel } from './kernel'
import { defaultCohortHome, kernelAuthPath } from './paths'
import { RosterStore } from './roster'

export function registerIpc(): { quit: () => Promise<void> } {
  const home = process.env.COHORT_HOME ?? defaultCohortHome()
  const store = new RosterStore(home)
  const kernel = new Kernel({
    env: process.env,
    primeAuthPath: kernelAuthPath(home)
  })

  ipcMain.handle('cohort:home', () => store.load())
  ipcMain.handle('cohort:select', (_event, id: unknown) => store.select(id))
  ipcMain.handle('cohort:kernel', () => kernel.start())
  ipcMain.handle('cohort:connect', (_event, input: unknown) => kernel.connect(input))

  return {
    quit: async () => {
      await kernel.stop()
      store.close()
    }
  }
}
