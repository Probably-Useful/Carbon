import { contextBridge, ipcRenderer } from 'electron'
import {
  Analytics,
  ClipCursor,
  ClipPage,
  ClipRecord,
  ClipTypeFilter,
  DataDirResult,
  DayDetail,
  HotkeyResult,
  Settings,
  Stats
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
  /** Every pinned clip (always fetched in full — pinned is a small, curated set). */
  getPinned(): Promise<ClipRecord[]> {
    return ipcRenderer.invoke('clips:getPinned')
  },
  /** One page of the non-pinned timeline, newest first. Pass the previous
   * page's `nextCursor` to fetch the next one. */
  getPage(
    filter: ClipTypeFilter,
    from: string,
    to: string,
    cursor?: ClipCursor
  ): Promise<ClipPage> {
    return ipcRenderer.invoke('clips:getPage', { filter, from, to, cursor })
  },
  /** Lazily load a single clip's image as a data URL. */
  getImage(id: number): Promise<string | null> {
    return ipcRenderer.invoke('clips:getImage', id)
  },
  /** Full-text search over clip text (FTS5-backed), keyset-paginated like getPage. */
  searchClips(
    query: string,
    filter: ClipTypeFilter,
    from: string,
    to: string,
    cursor?: ClipCursor
  ): Promise<ClipPage> {
    return ipcRenderer.invoke('clips:search', query, filter, from, to, cursor)
  },
  /** Fast count of clips matching a filter/day-range, for the filter bar badge. */
  countMatches(filter: ClipTypeFilter, from: string, to: string): Promise<number> {
    return ipcRenderer.invoke('clips:countMatches', filter, from, to)
  },
  /** Copy a stored clip back to the system clipboard by id. */
  copyClip(id: number): Promise<void> {
    return ipcRenderer.invoke('clips:copy', id)
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
  /** Aggregate stats for the dashboard. */
  getStats(): Promise<Stats> {
    return ipcRenderer.invoke('clips:stats')
  },
  /** Usage analytics (busiest hour/day, streaks, top repeated clips) for the dashboard. */
  getAnalytics(): Promise<Analytics> {
    return ipcRenderer.invoke('clips:analytics')
  },
  /** Every clip captured on a single day, for the dashboard activity-chart drill-down. */
  getDayDetail(day: string): Promise<DayDetail> {
    return ipcRenderer.invoke('clips:dayDetail', day)
  },
  /** Delete all non-pinned clips within a day range (inclusive). Returns count deleted. */
  deleteRange(from: string, to: string): Promise<number> {
    return ipcRenderer.invoke('clips:deleteRange', from, to)
  },
  /** Count clips (and how many are pinned) within a day range, for the delete-range preview. */
  countRange(from: string, to: string): Promise<{ inRange: number; pinnedInRange: number }> {
    return ipcRenderer.invoke('clips:countRange', from, to)
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
