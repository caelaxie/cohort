import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AddFilesResultDto, AppStateDto } from '../shared/workspace'

const cohort = {
  list: (): Promise<AppStateDto> => ipcRenderer.invoke('cohort:list'),
  create: (name: string): Promise<AppStateDto> => ipcRenderer.invoke('cohort:create', name),
  setCurrent: (uuid: string): Promise<AppStateDto> => ipcRenderer.invoke('cohort:setCurrent', uuid),
  addFiles: (paths?: string[]): Promise<AddFilesResultDto> =>
    ipcRenderer.invoke('cohort:addFiles', paths),
  send: (uuid: string, text: string): Promise<AppStateDto> =>
    ipcRenderer.invoke('cohort:send', uuid, text),
  pathsForFiles: (files: File[]): string[] => files.map((file) => webUtils.getPathForFile(file)),
  onState: (listener: (state: AppStateDto) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppStateDto): void => {
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
