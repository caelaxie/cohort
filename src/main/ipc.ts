import { BrowserWindow, dialog, ipcMain } from 'electron'
import { defaultCohortHome } from './paths'
import { WorkspaceStore } from './workspaces'
import { copyFilesIntoWorkspace } from './files'
import { buildAppState } from './app-state'
import { BoxManager } from './box'
import { createLiveBoxStarter } from './live-box'
import { CaptainHost } from './captain'
import type { AddFilesResultDto, AppStateDto } from '../shared/workspace'

// cohort:send guards (KTD7): pure so the renderer-facing contract stays
// testable without electron. Order: shape, then currency.
export function validateCaptainSend(
  uuid: unknown,
  text: unknown,
  currentUuid: string | null
): void {
  if (
    typeof uuid !== 'string' ||
    uuid.length === 0 ||
    typeof text !== 'string' ||
    text.length === 0
  ) {
    throw new Error('invalid captain message')
  }
  if (currentUuid === null) {
    throw new Error('no current workspace')
  }
  if (uuid !== currentUuid) {
    throw new Error('captain is not current')
  }
}

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

  // Captain turns drive box liveness (KTD4): mid-work keeps the sandbox up.
  const captains = new CaptainHost(home, undefined, {
    // Captain commands wait for that workspace's sandbox (KTD5, AE10).
    boxRunner: (uuid) => async (command) => {
      const box = await boxes.waitForRunning(uuid)
      if (!box.exec) throw new Error('sandbox commands are unavailable')
      return box.exec(command)
    },
    // Roster membership from the long-lived store; the host opens one only when unset.
    isKnownWorkspace: (uuid) => store.list().some((item) => item.uuid === uuid)
  })
  // Background file writes must refresh the name list even while away (R10, R12).
  captains.onFileChange(() => {
    invalidateFiles()
    sendState()
  })
  // In-flight assistant text streams into the current thread (KTD9).
  captains.onThreadChange(() => {
    sendState()
  })
  // Working transitions keep the sandbox up mid-turn (KTD4): mark the box so
  // switching away never stops a busy captain.
  captains.onWorkingChange((uuid, working) => {
    boxes.setWorking(uuid, working)
    sendState()
  })

  // Name-list cache: thread-stream ticks must not walk the workspace tree.
  // Every in-app writer (addFiles, captain writes, create, switch) invalidates.
  let filesCache: string[] | null = null
  const invalidateFiles = (): void => {
    filesCache = null
  }

  const loadPersistedThread = (uuid: string): void => {
    if (!captains.threadFile(uuid)) return
    void captains
      .loadThread(uuid)
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
      thread: current ? (captains.thread(current.uuid) ?? undefined) : undefined,
      threadError: current ? captains.threadError(current.uuid) : undefined,
      ...(filesCache !== null ? { files: filesCache } : {}),
      folderError,
      onFilesListed: (files) => {
        filesCache = files
      }
    })
  }

  const current = store.currentUuid()
  boxes.setCurrent(current)
  if (current) loadPersistedThread(current)

  ipcMain.handle('cohort:list', () => snapshot())
  ipcMain.handle('cohort:create', (_event, name: string) => {
    const result = store.create(typeof name === 'string' ? name : '')
    invalidateFiles()
    boxes.setCurrent(result.workspace.uuid)
    return snapshot()
  })
  ipcMain.handle('cohort:setCurrent', (_event, uuid: string) => {
    if (typeof uuid !== 'string') throw new Error('invalid workspace id')
    store.setCurrent(uuid)
    invalidateFiles()
    boxes.setCurrent(uuid)
    loadPersistedThread(uuid)
    return snapshot()
  })
  ipcMain.handle('cohort:send', async (_event, uuid: unknown, text: unknown) => {
    // Closed bridge (KTD7): the renderer sends a uuid and text only.
    // validateCaptainSend has established both are non-empty strings.
    await captains.send(uuid as string, text as string)
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
    invalidateFiles()
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
