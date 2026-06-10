import { contextBridge, ipcRenderer } from 'electron'
import {
  ClipPayload,
  ClipRecord,
  DataDirResult,
  HotkeyResult,
  Settings
} from '../shared/types'

const api = {
  // --- Capture stream ---
  /** Subscribe to newly captured clips. Returns an unsubscribe fn. */
  onClipAdd(callback: (clip: ClipRecord) => void): () => void {
    const listener = (_e: unknown, clip: ClipRecord) => callback(clip)
    ipcRenderer.on('clip:add', listener)
    return () => ipcRenderer.removeListener('clip:add', listener)
  },

  /** Subscribe to updates of existing clips (e.g. a duplicate re-copied). */
  onClipUpdate(callback: (clip: ClipRecord) => void): () => void {
    const listener = (_e: unknown, clip: ClipRecord) => callback(clip)
    ipcRenderer.on('clip:update', listener)
    return () => ipcRenderer.removeListener('clip:update', listener)
  },

  /** Fired when the window is opened via hotkey/tray. */
  onOpened(callback: () => void): () => void {
    const listener = () => callback()
    ipcRenderer.on('window:opened', listener)
    return () => ipcRenderer.removeListener('window:opened', listener)
  },

  // --- Clip data ---
  getClips(): Promise<ClipRecord[]> {
    return ipcRenderer.invoke('clips:getAll')
  },
  pinClip(id: number): Promise<ClipRecord | null> {
    return ipcRenderer.invoke('clips:pin', id)
  },
  deleteClip(id: number): Promise<void> {
    return ipcRenderer.invoke('clips:delete', id)
  },
  clearClips(): Promise<void> {
    return ipcRenderer.invoke('clips:clear')
  },

  // --- Settings ---
  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke('settings:get')
  },
  saveSettings(settings: Partial<Settings>): Promise<Settings> {
    return ipcRenderer.invoke('settings:save', settings)
  },
  setHotkey(accelerator: string): Promise<HotkeyResult> {
    return ipcRenderer.invoke('hotkey:set', accelerator)
  },

  // --- Storage location ---
  getDataDir(): Promise<string> {
    return ipcRenderer.invoke('dataDir:get')
  },
  chooseDataDir(): Promise<DataDirResult> {
    return ipcRenderer.invoke('dataDir:choose')
  },

  // --- Clipboard write-back ---
  writeClip(clip: ClipPayload): void {
    ipcRenderer.send('clipboard:write', clip)
  },

  // --- Window controls ---
  hideWindow(): void {
    ipcRenderer.send('window:hide')
  },
  minimizeWindow(): void {
    ipcRenderer.send('window:minimize')
  },
  quit(): void {
    ipcRenderer.send('app:quit')
  }
}

export type CarbonApi = typeof api

contextBridge.exposeInMainWorld('carbon', api)
