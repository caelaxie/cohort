import { contextBridge, ipcRenderer } from 'electron'

const OPEN_SETTINGS = 'cohort:open-settings'
const APPROVALS_CHANGED = 'cohort:approvals-changed'

const cohort = {
  home: (): Promise<unknown> => ipcRenderer.invoke('cohort:home'),
  select: (id: string): Promise<unknown> => ipcRenderer.invoke('cohort:select', id),
  hatch: (name: string): Promise<unknown> => ipcRenderer.invoke('cohort:hatch', name),
  remove: (id: string): Promise<unknown> => ipcRenderer.invoke('cohort:remove', id),
  kernel: (): Promise<unknown> => ipcRenderer.invoke('cohort:kernel'),
  connect: (input?: unknown): Promise<unknown> => ipcRenderer.invoke('cohort:connect', input),
  thread: (botId: string): Promise<unknown> => ipcRenderer.invoke('cohort:thread', botId),
  send: (input: unknown): Promise<unknown> => ipcRenderer.invoke('cohort:send', input),
  room: (): Promise<unknown> => ipcRenderer.invoke('cohort:room'),
  roomSend: (input: unknown): Promise<unknown> => ipcRenderer.invoke('cohort:room-send', input),
  assign: (input: unknown): Promise<unknown> => ipcRenderer.invoke('cohort:assign', input),
  interrupt: (botId: string): Promise<unknown> => ipcRenderer.invoke('cohort:interrupt', botId),
  coordination: (): Promise<unknown> => ipcRenderer.invoke('cohort:coordination'),
  approvals: (): Promise<unknown> => ipcRenderer.invoke('cohort:approvals'),
  requestApproval: (input: unknown): Promise<unknown> =>
    ipcRenderer.invoke('cohort:request-approval', input),
  approve: (id: string): Promise<unknown> => ipcRenderer.invoke('cohort:approve', id),
  deny: (id: string): Promise<unknown> => ipcRenderer.invoke('cohort:deny', id),
  denyAll: (): Promise<unknown> => ipcRenderer.invoke('cohort:deny-all'),
  onOpenSettings: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on(OPEN_SETTINGS, listener)
    return () => {
      ipcRenderer.removeListener(OPEN_SETTINGS, listener)
    }
  },
  onApprovalsChanged: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on(APPROVALS_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(APPROVALS_CHANGED, listener)
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('contextIsolation must stay enabled')
}

contextBridge.exposeInMainWorld('cohort', cohort)
