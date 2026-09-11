import { contextBridge, ipcRenderer } from 'electron'

const OPEN_SETTINGS = 'cohort:open-settings'

const cohort = {
  home: (): Promise<unknown> => ipcRenderer.invoke('cohort:home'),
  select: (id: string): Promise<unknown> => ipcRenderer.invoke('cohort:select', id),
  kernel: (): Promise<unknown> => ipcRenderer.invoke('cohort:kernel'),
  connect: (input?: unknown): Promise<unknown> => ipcRenderer.invoke('cohort:connect', input),
  onOpenSettings: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on(OPEN_SETTINGS, listener)
    return () => {
      ipcRenderer.removeListener(OPEN_SETTINGS, listener)
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must stay enabled')
}

contextBridge.exposeInMainWorld('cohort', cohort)
