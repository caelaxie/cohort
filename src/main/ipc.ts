import { existsSync, readFileSync } from 'node:fs'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { defaultCohortHome } from './paths'
import { WorkspaceStore } from './workspaces'
import { copyFilesIntoWorkspace } from './files'
import { buildAppState } from './app-state'
import { BoxManager } from './box'
import { createLiveBoxStarter } from './live-box'
import { CaptainHost } from './captain'
import type { AddFilesResultDto, AppStateDto, ThreadMessageDto } from '../shared/workspace'

export function registerIpc(): { quit: () => Promise<void> } {
  const home = process.env.COHORT_HOME ?? defaultCohortHome()
  const store = new WorkspaceStore(home)
  const sendState = (): void => {
    const payload = snapshot()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('cohort:state', payload)
    }
  }

  const boxes = new BoxManager(home, createLiveBoxStarter(), () => {
    sendState()
  })

  const captains = new CaptainHost(home)
  // Captain turns drive box liveness (KTD4): mid-work keeps the sandbox up.
  captains.onWorkingChange(() => {
    for (const item of store.list()) {
      boxes.setWorking(item.uuid, captains.isWorking(item.uuid))
    }
  })
  // Background file writes must refresh the name list even while away (R10, R12).
  captains.onFileChange(() => {
    sendState()
  })
  // In-flight assistant text streams into the current thread (KTD9).
  captains.onThreadChange(() => {
    sendState()
  })

  const currentThread = (): ThreadMessageDto[] | undefined => {
    const currentUuid = store.currentUuid()
    if (!currentUuid) return undefined
    return captains.thread(currentUuid) ?? undefined
  }

  const loadPersistedThread = (uuid: string): void => {
    const file = captains.threadFile(uuid)
    if (!file) return
    void captains
      .loadThread(
        uuid,
        () => existsSync(file),
        () => readFileSync(file, 'utf8')
      )
      .then(() => {
        sendState()
      })
      .catch(() => undefined)
  }

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
      thread: currentThread(),
      folderError
    })
  }

  const current = store.currentUuid()
  boxes.setCurrent(current)
  if (current) loadPersistedThread(current)

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
    loadPersistedThread(uuid)
    return snapshot()
  })
  ipcMain.handle('cohort:send', async (_event, uuid: unknown, text: unknown) => {
    // Closed bridge (KTD7): the renderer sends a uuid and text only.
    if (typeof uuid !== 'string' || typeof text !== 'string' || text.length === 0) {
      throw new Error('invalid captain message')
    }
    const currentUuid = store.currentUuid()
    if (!currentUuid) {
      throw new Error('no current workspace')
    }
    if (uuid !== currentUuid) {
      throw new Error('captain is not current')
    }
    await captains.send(uuid, text)
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
      // Stop every live box and session, surfacing per-box failures (U6).
      const stopErrors = await boxes.quit()
      for (const error of stopErrors) {
        console.error(`cohort: box stop failed during quit: ${error}`)
      }
      await captains.disposeAll()
      store.close()
    }
  }
}
