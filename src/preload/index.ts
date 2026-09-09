import { contextBridge, ipcRenderer } from 'electron'
import { parseRoster, type BotId, type Roster } from '../shared/roster'

const cohort = {
  roster: (): Promise<Roster> => ipcRenderer.invoke('cohort:roster').then(parseRoster),
  setCurrent: (id: BotId): Promise<Roster> =>
    ipcRenderer.invoke('cohort:setCurrent', id).then(parseRoster),
  onState: (listener: (roster: Roster) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
      listener(parseRoster(raw))
    }
    ipcRenderer.on('cohort:state', handler)
    return () => {
      ipcRenderer.removeListener('cohort:state', handler)
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must stay enabled')
}

contextBridge.exposeInMainWorld('cohort', cohort)
