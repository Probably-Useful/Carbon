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
  /** How many times this exact content has been re-copied (starts at 1). */
  copyCount: number
}

export type ClipChange =
  | { kind: 'add'; record: ClipRecord }
  | { kind: 'update'; record: ClipRecord }

/**
 * Keyset pagination cursor: the (createdAt, id) of the last row already
 * fetched. Passing it back fetches the next page strictly older than it.
 * Keyset (vs. OFFSET) pagination stays O(page size) at any depth because it
 * resumes from an indexed value instead of counting past rows.
 */
export interface ClipCursor {
  createdAt: number
  id: number
}

/** One page of the timeline/search feed, plus the cursor to fetch the next page. */
export interface ClipPage {
  items: ClipRecord[]
  /** Pass to the next call to continue past this page; null when exhausted. */
  nextCursor: ClipCursor | null
}

export type ClipTypeFilter = 'all' | 'text' | 'image'

/** Query params shared by the timeline feed and search, both keyset-paginated. */
export interface ClipQuery {
  filter: ClipTypeFilter
  /** Inclusive day-key bounds ("YYYY-MM-DD"); empty string means unbounded. */
  from?: string
  to?: string
  cursor?: ClipCursor
  limit?: number
}

/** Clip count for a single day key, used by the dashboard activity chart. */
export interface DayCount {
  day: string
  count: number
}

/** Aggregate stats for the dashboard. */
export interface Stats {
  total: number
  textCount: number
  imageCount: number
  pinnedCount: number
  /** Total bytes on disk: the SQLite database plus stored images. */
  storageBytes: number
  /** Earliest and latest day keys with clips, or null when empty. */
  firstDay: string | null
  lastDay: string | null
  /** One entry per day that has clips, ascending by day. */
  perDay: DayCount[]
}

/** A single re-copied clip surfaced on the dashboard most-repeated list. */
export interface TopClip {
  id: number
  type: ClipType
  /** Truncated preview text for display; omitted for images. */
  preview?: string
  copyCount: number
}

/**
 * User-facing usage analytics for the dashboard, computed with cheap,
 * indexed aggregate queries (no per-row text scanning) so this stays fast
 * regardless of history size.
 */
export interface Analytics {
  /** Clip counts bucketed by local hour of day (0-23), for the busiest-hour chart. */
  byHour: { hour: number; count: number }[]
  /** Clip counts bucketed by local day of week (0 = Sunday), for the busiest-day chart. */
  byWeekday: { weekday: number; count: number }[]
  /** Consecutive days up to and including today with at least one clip. */
  currentStreakDays: number
  /** Longest such streak ever recorded. */
  longestStreakDays: number
  /** Clips whose content has been copied more than once, ranked by copy count. */
  topRepeated: TopClip[]
  /** Share of captures that were duplicates of existing content (0-100). */
  dedupeRatePct: number
  /** Average clips captured per active day. */
  avgPerActiveDay: number
}

/** Every clip captured on a single day, used by the dashboard day-detail panel. */
export interface DayDetail {
  day: string
  items: ClipRecord[]
}

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
