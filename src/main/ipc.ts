import { BrowserWindow, ipcMain } from 'electron'
import { parseBotId } from '../shared/roster'
import { defaultCohortHome } from './paths'
import { RosterStore } from './roster'

export function registerIpc(): { quit: () => Promise<void> } {
  const home = process.env.COHORT_HOME ?? defaultCohortHome()
  const store = new RosterStore(home)

  const sendState = (): void => {
    const payload = store.load()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('cohort:state', payload)
    }
  }

  ipcMain.handle('cohort:roster', () => store.load())
  ipcMain.handle('cohort:setCurrent', (_event, raw: unknown) => {
    const roster = store.setCurrent(parseBotId(raw))
    sendState()
    return roster
  })

  return {
    quit: async () => {
      store.close()
    }
  }
}
