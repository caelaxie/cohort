import { BrowserWindow, ipcMain } from 'electron'
import { ApprovalStore } from './approval'
import { Computer } from './computer'
import { Kernel } from './kernel'
import type { Layout } from './paths'
import { primeTurn } from './prime'
import { RosterStore } from './roster'
import { TalkStore } from './talk'

function notifyApprovals(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('cohort:approvals-changed')
  }
}

export function registerIpc(layout: Layout): { quit: () => Promise<void> } {
  const store = new RosterStore(layout.root)
  const kernel = new Kernel({
    env: process.env,
    primeAuthPath: layout.primeAuth
  })
  const talk = new TalkStore({
    home: layout.root,
    known: (id) => store.known(id),
    turn: primeTurn({
      home: layout.root,
      endpoint: () => kernel.endpoint(),
      bot: (id) => {
        const found = store.bot(id)
        if (!found) {
          throw new Error('unknown bot')
        }
        return found
      }
    })
  })
  const approvals = new ApprovalStore({
    home: layout.root,
    known: (id) => store.known(id),
    onChange: notifyApprovals
  })
  const computer = new Computer({ approvals })

  ipcMain.handle('cohort:home', () => store.load())
  ipcMain.handle('cohort:select', (_event, id: unknown) => store.select(id))
  ipcMain.handle('cohort:hatch', (_event, name: unknown) => store.hatch(name))
  ipcMain.handle('cohort:remove', (_event, id: unknown) => {
    talk.interrupt(id)
    return store.remove(id)
  })
  ipcMain.handle('cohort:kernel', () => kernel.status())
  ipcMain.handle('cohort:connect', (_event, input: unknown) => kernel.connect(input))
  ipcMain.handle('cohort:thread', (_event, id: unknown) => talk.thread(id))
  ipcMain.handle('cohort:send', (_event, input: unknown) => talk.send(input))
  ipcMain.handle('cohort:room', () => talk.room())
  ipcMain.handle('cohort:room-send', (_event, input: unknown) => talk.roomSend(input))
  ipcMain.handle('cohort:assign', (_event, input: unknown) => talk.assign(input))
  ipcMain.handle('cohort:interrupt', (_event, id: unknown) => talk.interrupt(id))
  ipcMain.handle('cohort:coordination', () => talk.coordination())
  ipcMain.handle('cohort:approvals', () => approvals.snapshot())
  ipcMain.handle('cohort:request-approval', (_event, input: unknown) => approvals.require(input))
  ipcMain.handle('cohort:approve', (_event, id: unknown) => approvals.approve(id))
  ipcMain.handle('cohort:deny', (_event, id: unknown) => approvals.deny(id))
  ipcMain.handle('cohort:deny-all', () => approvals.denyAll())

  return {
    quit: async () => {
      computer.stop()
      talk.close()
      approvals.close()
      store.close()
    }
  }
}
