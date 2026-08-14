import { BrowserWindow, dialog, ipcMain } from 'electron'
import { defaultCohortHome } from './paths'
import { WorkspaceStore } from './workspaces'
import { copyFilesIntoWorkspace } from './files'
import { buildAppState } from './app-state'
import { BoxManager, type BoxState } from './box'
import { createLiveBoxStarter } from './live-box'
import type { AddFilesResultDto, AppStateDto } from '../shared/workspace'

export function registerIpc(): { quit: () => Promise<void> } {
  const home = process.env.COHORT_HOME ?? defaultCohortHome()
  const store = new WorkspaceStore(home)
  const sendState = (): void => {
    const payload = snapshot()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('cohort:state', payload)
    }
  }

  const boxes = new BoxManager(home, createLiveBoxStarter(), (_state: BoxState) => {
    sendState()
  })

  const snapshot = (): AppStateDto => {
    const workspaces = store.list()
    const current = workspaces.find((item) => item.current)
    let folderError: string | undefined
    if (current) {
      const folder = store.ensureFolder(current.uuid)
      if (folder.status === 'error') folderError = folder.error
    }
    return buildAppState({
      home,
      workspaces,
      boxStatus: boxes.state.status,
      boxError: boxes.state.error,
      folderError
    })
  }

  const current = store.currentUuid()
  boxes.setCurrent(current)

  ipcMain.handle('cohort:list', () => snapshot())
  ipcMain.handle('cohort:create', (_event, name: string) => {
    const result = store.create(typeof name === 'string' ? name : '')
    boxes.setCurrent(result.workspace.uuid)
    return snapshot()
  })
  ipcMain.handle('cohort:setCurrent', (_event, uuid: string) => {
    if (typeof uuid !== 'string') throw new Error('invalid workspace id')
    store.setCurrent(uuid)
    boxes.setCurrent(uuid)
    return snapshot()
  })
  ipcMain.handle('cohort:addFiles', async (event, sources?: string[]) => {
    const currentUuid = store.currentUuid()
    if (!currentUuid) {
      return { copied: 0, total: 0, error: 'no current workspace' } satisfies AddFilesResultDto
    }
    let paths = Array.isArray(sources) ? sources.filter((item) => typeof item === 'string') : []
    if (paths.length === 0) {
      const window = BrowserWindow.fromWebContents(event.sender)
      const picked = window
        ? await dialog.showOpenDialog(window, {
            properties: ['openFile', 'multiSelections']
          })
        : await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections']
          })
      if (picked.canceled) {
        return { copied: 0, total: 0 }
      }
      paths = picked.filePaths
    }
    const report = copyFilesIntoWorkspace(home, currentUuid, paths)
    sendState()
    return report
  })

  return {
    quit: async () => {
      await boxes.quit()
      store.close()
    }
  }
}
