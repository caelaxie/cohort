import { join } from 'path'
import { app, shell, BrowserWindow, Menu } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { electronUserData, resolveHome } from './paths'

const home = resolveHome(process.env)
app.setPath('userData', electronUserData(home))

let shutdown: (() => Promise<void>) | null = null

function openSettingsWindow(): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send('cohort:open-settings')
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Settings...',
            accelerator: 'CommandOrControl+,',
            click: openSettingsWindow
          },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ])
  )
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#010102',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('app.cohort.desktop')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const session = registerIpc(home)
    shutdown = session.quit
    installMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', (event) => {
  if (!shutdown) return
  event.preventDefault()
  const stop = shutdown
  shutdown = null
  void stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
