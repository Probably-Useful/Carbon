// Shared types used across the main, preload, and renderer processes.

export type ClipType = 'text' | 'image'

export interface ClipPayload {
  type: ClipType
  /** Present when type === 'text'. */
  text?: string
  /** Present when type === 'image'. A PNG data URL. */
  dataUrl?: string
  /** For images: pixel dimensions. */
  width?: number
  height?: number
  /** Epoch milliseconds when the clip was captured. */
  createdAt: number
  /** Content hash used for de-duplication. */
  hash: string
}

/** A stored clip as delivered to the renderer for display. */
export interface ClipRecord {
  id: number
  type: ClipType
  text?: string
  /** Loaded on demand from the image file as a data URL. */
  dataUrl?: string
  width?: number
  height?: number
  createdAt: number
  /** Local date key, e.g. "2026-06-10", used to group the timeline by day. */
  day: string
  hash: string
  pinned: 0 | 1
}

export type ClipChange =
  | { kind: 'add'; record: ClipRecord }
  | { kind: 'update'; record: ClipRecord }

export interface Settings {
  /** Electron accelerator string, e.g. "Control+Shift+V". */
  hotkey: string
  launchAtStartup: boolean
  /** Poll interval for the clipboard watcher, in milliseconds. */
  pollIntervalMs: number
  /**
   * Absolute path to the folder where clip data is stored. Empty string means
   * "use the default" (a CarbonData folder inside the app's user-data dir).
   */
  dataDir: string
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Control+Shift+V',
  launchAtStartup: true,
  pollIntervalMs: 800,
  dataDir: ''
}

export interface HotkeyResult {
  ok: boolean
  hotkey: string
  error?: string
}

export interface DataDirResult {
  ok: boolean
  dataDir: string
  moved?: number
  error?: string
  canceled?: boolean
}
