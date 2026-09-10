import { contextBridge, ipcRenderer } from 'electron'

const cohort = {
  home: (): Promise<unknown> => ipcRenderer.invoke('cohort:home'),
  select: (id: string): Promise<unknown> => ipcRenderer.invoke('cohort:select', id),
  kernel: (): Promise<unknown> => ipcRenderer.invoke('cohort:kernel'),
  connect: (input?: unknown): Promise<unknown> => ipcRenderer.invoke('cohort:connect', input)
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must stay enabled')
}

contextBridge.exposeInMainWorld('cohort', cohort)
