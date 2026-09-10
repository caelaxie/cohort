import { ipcMain } from 'electron'
import { defaultCohortHome } from './paths'
import { RosterStore } from './roster'

export function registerIpc(): { quit: () => Promise<void> } {
  const home = process.env.COHORT_HOME ?? defaultCohortHome()
  const store = new RosterStore(home)

  ipcMain.handle('cohort:home', () => store.load())
  ipcMain.handle('cohort:select', (_event, id: unknown) => store.select(id))

  return {
    quit: async () => {
      store.close()
    }
  }
}
