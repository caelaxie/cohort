import { BrowserWindow, ipcMain } from 'electron'
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

  ipcMain.handle('cohort:home', () => store.load())
  ipcMain.handle('cohort:select', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('invalid bot id')
    const payload = store.select(id)
    sendState()
    return payload
  })

  return {
    quit: async () => {
      store.close()
    }
  }
}
