import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  screen
} from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'
import { ClipPayload, DataDirResult, HotkeyResult, Settings } from '../shared/types'
import { loadSettings, saveSettings } from './store'
import {
  addClip,
  changeDataDir,
  clearAll,
  deleteClip,
  getAll,
  getDataDir,
  initStore,
  pinClip
} from './clipStore'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let settings: Settings = loadSettings()

// Hash of the last clipboard content we observed (captured OR written by us),
// used to avoid recording duplicates and our own re-copies.
let lastHash: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

// Flag so the window's close button hides to tray instead of quitting.
let isQuitting = false

const isDev = !app.isPackaged

function resolveDataDir(): string {
  return settings.dataDir && settings.dataDir.trim().length > 0
    ? settings.dataDir
    : join(app.getPath('userData'), 'CarbonData')
}

function hashContent(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/** Read the current clipboard and store/emit a clip if it changed. */
function pollClipboard(): void {
  try {
    const formats = clipboard.availableFormats()
    const hasImage = formats.some((f) => f.startsWith('image'))

    let payload: ClipPayload | null = null

    if (hasImage) {
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        const hash = hashContent(dataUrl)
        if (hash !== lastHash) {
          lastHash = hash
          const size = image.getSize()
          payload = {
            type: 'image',
            dataUrl,
            width: size.width,
            height: size.height,
            createdAt: Date.now(),
            hash
          }
        }
      }
    } else {
      const text = clipboard.readText()
      if (text && text.trim().length > 0) {
        const hash = hashContent(text)
        if (hash !== lastHash) {
          lastHash = hash
          payload = { type: 'text', text, createdAt: Date.now(), hash }
        }
      }
    }

    if (payload) {
      const result = addClip(payload)
      sendToRenderer(result.kind === 'add' ? 'clip:add' : 'clip:update', result.record)
    }
  } catch (err) {
    console.error('[carbon] clipboard poll failed', err)
  }
}

function startPolling(): void {
  stopPolling()
  try {
    const text = clipboard.readText()
    if (text) lastHash = hashContent(text)
  } catch {
    /* ignore */
  }
  pollTimer = setInterval(pollClipboard, settings.pollIntervalMs)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function registerHotkey(accelerator: string): HotkeyResult {
  globalShortcut.unregisterAll()
  if (!accelerator) {
    return { ok: false, hotkey: accelerator, error: 'Empty hotkey' }
  }
  try {
    const ok = globalShortcut.register(accelerator, toggleWindow)
    if (!ok) {
      return { ok: false, hotkey: accelerator, error: 'Hotkey is already in use by another app.' }
    }
    return { ok: true, hotkey: accelerator }
  } catch (err) {
    return { ok: false, hotkey: accelerator, error: (err as Error).message }
  }
}

function positionWindow(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width, height, x, y } = display.workArea
  const [winW, winH] = win.getSize()
  const margin = 12
  win.setPosition(
    Math.round(x + width - winW - margin),
    Math.round(y + height - winH - margin)
  )
}

function toggleWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    positionWindow(mainWindow)
    mainWindow.show()
    mainWindow.focus()
    sendToRenderer('window:opened')
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 380,
    minHeight: 480,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide()
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  tray = new Tray(icon)
  tray.setToolTip('Carbon — clipboard history')
  const menu = Menu.buildFromTemplate([
    { label: 'Open Carbon', click: () => toggleWindow() },
    { type: 'separator' },
    {
      label: 'Quit Carbon',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => toggleWindow())
}

function applyLaunchAtStartup(enabled: boolean): void {
  if (isDev) return
  app.setLoginItemSettings({ openAtLogin: enabled })
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:save', (_e, next: Partial<Settings>) => {
    // dataDir is changed only via the dedicated chooser, not here.
    const { dataDir: _ignore, ...rest } = next
    settings = { ...settings, ...rest }
    saveSettings(settings)
    applyLaunchAtStartup(settings.launchAtStartup)
    startPolling()
    return settings
  })

  ipcMain.handle('hotkey:set', (_e, accelerator: string): HotkeyResult => {
    const result = registerHotkey(accelerator)
    if (result.ok) {
      settings.hotkey = accelerator
      saveSettings(settings)
    } else {
      registerHotkey(settings.hotkey)
    }
    return result
  })

  // --- Clip data ---
  ipcMain.handle('clips:getAll', () => getAll())
  ipcMain.handle('clips:pin', (_e, id: number) => pinClip(id))
  ipcMain.handle('clips:delete', (_e, id: number) => {
    deleteClip(id)
  })
  ipcMain.handle('clips:clear', () => {
    clearAll()
  })

  // --- Storage location ---
  ipcMain.handle('dataDir:get', () => getDataDir())

  ipcMain.handle('dataDir:choose', async (): Promise<DataDirResult> => {
    if (!mainWindow) return { ok: false, dataDir: getDataDir(), error: 'No window' }
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where Carbon stores your clipboard history',
      defaultPath: getDataDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true, dataDir: getDataDir() }
    }
    // Keep clip data in a dedicated subfolder so we never clutter the chosen folder.
    const target = join(picked.filePaths[0], 'CarbonData')
    try {
      const moved = changeDataDir(target)
      settings.dataDir = target
      saveSettings(settings)
      return { ok: true, dataDir: target, moved }
    } catch (err) {
      return { ok: false, dataDir: getDataDir(), error: (err as Error).message }
    }
  })

  ipcMain.on('clipboard:write', (_e, clip: ClipPayload) => {
    if (clip.type === 'image' && clip.dataUrl) {
      const img = nativeImage.createFromDataURL(clip.dataUrl)
      clipboard.writeImage(img)
      lastHash = hashContent(clip.dataUrl)
    } else if (clip.type === 'text' && clip.text != null) {
      clipboard.writeText(clip.text)
      lastHash = hashContent(clip.text)
    }
  })

  ipcMain.on('window:hide', () => mainWindow?.hide())
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('app:quit', () => {
    isQuitting = true
    app.quit()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => toggleWindow())

  app.whenReady().then(() => {
    initStore(resolveDataDir())
    createWindow()
    createTray()
    registerIpc()
    registerHotkey(settings.hotkey)
    applyLaunchAtStartup(settings.launchAtStartup)
    startPolling()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // Keep running in the tray; do not quit on window close.
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopPolling()
})

// A minimal 16x16 monochrome clipboard glyph as a base64 PNG (placeholder tray icon).
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAJ1JREFUOE+1k0EOgCAMBKf//7M9aDQGSltMZG/AlmFLAcwsAlYBVbAJ2AVcwi3gFm4Bt3ALuIVbwC3cAm7hFnALt4BbuAXcwi3gFm4Bt3ALuIVbwC3cAm7hFnALt4BbuAXcwi3gFm4Bt3ALuIVbwC3cAm7hFnALt4BbuAXcwi3gFm4Bt3ALuIVbwC3cAm7hFnALt4BbuAXcwhPyA1+pBHzVQ0c8AAAAAElFTkSuQmCC'
