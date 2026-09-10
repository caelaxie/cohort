import { contextBridge, ipcRenderer } from 'electron'

const cohort = {
  home: (): Promise<unknown> => ipcRenderer.invoke('cohort:home'),
  select: (id: string): Promise<unknown> => ipcRenderer.invoke('cohort:select', id),
  onState: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      listener(state)
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
