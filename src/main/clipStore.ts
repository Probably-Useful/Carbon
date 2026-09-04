import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import {
  Analytics,
  ClipCursor,
  ClipPage,
  ClipPayload,
  ClipQuery,
  ClipRecord,
  ClipType,
  DayDetail,
  Stats,
  TopClip
} from '../shared/types'
import { dayEndMs, dayKey, dayStartMs } from '../shared/day'

/** Raw row shape as stored in the SQLite `clips` table. */
interface Row {
  id: number
  type: ClipType
  text: string | null
  image_file: string | null
  width: number | null
  height: number | null
  created_at: number
  day: string
  hash: string
  pinned: number
  copy_count: number
}

/** Legacy on-disk shape from the v1 clips.jsonl index (for migration). */
interface LegacyClip {
  id: number
  type: ClipType
  text?: string
  imageFile?: string
  width?: number
  height?: number
  createdAt: number
  day: string
  hash: string
  pinned: 0 | 1
}

let db: Database.Database
let dataDir = ''

function dbFile(dir = dataDir): string {
  return join(dir, 'carbon.db')
}
function imagesDir(dir = dataDir): string {
  return join(dir, 'images')
}
function legacyIndexFile(dir = dataDir): string {
  return join(dir, 'clips.jsonl')
}

function ensureDirs(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const img = imagesDir(dir)
  if (!existsSync(img)) mkdirSync(img, { recursive: true })
}

/** Create the schema (idempotent): clips table, FTS5 index, and sync triggers. */
function createSchema(): void {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  // A larger page cache trades a few MB of RAM (per open DB) for far fewer
  // disk reads once history grows into the tens/hundreds of thousands of
  // rows; temp_store=MEMORY keeps the ORDER BY / GROUP BY scratch space used
  // by getStats() off disk too.
  db.pragma('cache_size = -32000')
  db.pragma('temp_store = MEMORY')

  db.exec(`
    CREATE TABLE IF NOT EXISTS clips (
      id         INTEGER PRIMARY KEY,
      type       TEXT    NOT NULL,
      text       TEXT,
      image_file TEXT,
      width      INTEGER,
      height     INTEGER,
      created_at INTEGER NOT NULL,
      day        TEXT    NOT NULL,
      hash       TEXT    NOT NULL UNIQUE,
      pinned     INTEGER NOT NULL DEFAULT 0,
      copy_count INTEGER NOT NULL DEFAULT 1
    );

    -- created_at DESC is the app's natural sort order everywhere (timeline,
    -- search, pagination). Indexing it DESC lets SQLite walk it directly for
    -- both "ORDER BY created_at DESC" and keyset "created_at < ?" scans,
    -- instead of building a temp b-tree to reverse an ASC index at query time.
    CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);

    -- Composite covering indexes for the paginated feed. Query patterns are:
    --   WHERE pinned = ?  [AND type = ?]  ORDER BY created_at DESC, id DESC
    -- Leading column matches the always-present filter (pinned splits the
    -- pinned rail from the day-grouped timeline).
    CREATE INDEX IF NOT EXISTS idx_clips_pinned_created
      ON clips(pinned, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_clips_type_pinned_created
      ON clips(type, pinned, created_at DESC, id DESC);

    -- Used by getStats' GROUP BY day (dashboard activity chart), the day
    -- detail drill-down, and deleteRange's day-bounded scan.
    CREATE INDEX IF NOT EXISTS idx_clips_day ON clips(day);

    -- Full-text index over clip text. External-content table backed by clips,
    -- kept in sync by the triggers below.
    CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
      text,
      content='clips',
      content_rowid='id',
      tokenize='unicode61',
      prefix='2 3 4 5 6 7 8 9 10'
    );

    CREATE TRIGGER IF NOT EXISTS clips_ai AFTER INSERT ON clips BEGIN
      INSERT INTO clips_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS clips_ad AFTER DELETE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS clips_au AFTER UPDATE ON clips BEGIN
      INSERT INTO clips_fts(clips_fts, rowid, text) VALUES ('delete', old.id, old.text);
      INSERT INTO clips_fts(rowid, text) VALUES (new.id, new.text);
    END;
  `)

  migrateColumns()
}

/**
 * Additive column/index migrations for databases created before a column
 * existed. CREATE TABLE IF NOT EXISTS above only applies to brand-new
 * databases, so upgrades need an explicit ALTER TABLE guarded by a check
 * against the live schema.
 */
function migrateColumns(): void {
  const cols = db.prepare('PRAGMA table_info(clips)').all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('copy_count')) {
    db.exec('ALTER TABLE clips ADD COLUMN copy_count INTEGER NOT NULL DEFAULT 1')
  }
  // Partial index: only rows that have actually been re-copied are worth
  // indexing for the most-repeated dashboard stat, which keeps the index
  // tiny even across a huge, mostly-copied-once history.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_clips_copy_count ON clips(copy_count DESC) WHERE copy_count > 1'
  )
  migrateFtsPrefix()
}

/**
 * Rebuild clips_fts with a prefix index if it was created before one existed.
 * Without a prefix index, a prefix query like error* forces FTS5 to walk its
 * entire term dictionary to find every term starting with error before it
 * can even look at postings, which on a large history can cost hundreds of
 * milliseconds regardless of the SEARCH_CANDIDATE_CAP below (the cap limits
 * how many matching rows we read, not how much of the term dictionary FTS5
 * has to scan to find them). Precomputing prefix indexes for lengths 2
 * through 10 covers effectively all real search terms and turns that scan
 * into a direct index lookup, at the one-time cost of a rebuild (done here,
 * once, on upgrade) and a modest increase in index size on disk.
 */
function migrateFtsPrefix(): void {
  const existing = db
    .prepare(`SELECT sql FROM sqlite_master WHERE name = 'clips_fts'`)
    .get() as { sql: string } | undefined
  if (!existing || existing.sql.includes('prefix=')) return

  console.log('[carbon] upgrading search index for faster lookups (one-time)')
  db.exec(`
    DROP TABLE clips_fts;
    CREATE VIRTUAL TABLE clips_fts USING fts5(
      text,
      content='clips',
      content_rowid='id',
      tokenize='unicode61',
      prefix='2 3 4 5 6 7 8 9 10'
    );
    INSERT INTO clips_fts(rowid, text) SELECT id, text FROM clips;
  `)
}

function openDb(dir: string): void {
  dataDir = dir
  ensureDirs(dir)
  db = new Database(dbFile(dir))
  createSchema()
}

/**
 * One-time import of the v1 clips.jsonl index into SQLite. Images already live
 * in images/ and are referenced by name, so only the index rows are imported.
 * Guarded so it runs only when the DB is empty and a legacy file exists; the
 * legacy file is renamed to .bak on success so it is never re-imported.
 */
function maybeMigrateLegacy(): number {
  const legacy = legacyIndexFile()
  if (!existsSync(legacy)) return 0

  const count = db.prepare('SELECT COUNT(*) AS n FROM clips').get() as { n: number }
  if (count.n > 0) return 0

  let imported = 0
  try {
    const lines = readFileSync(legacy, 'utf-8').split('\n')
    const insert = db.prepare(
      `INSERT OR IGNORE INTO clips
         (id, type, text, image_file, width, height, created_at, day, hash, pinned)
       VALUES
         (@id, @type, @text, @image_file, @width, @height, @created_at, @day, @hash, @pinned)`
    )
    const rows: Row[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const c = JSON.parse(trimmed) as LegacyClip
        rows.push({
          id: c.id,
          type: c.type,
          text: c.type === 'text' ? c.text ?? null : null,
          image_file: c.imageFile ?? null,
          width: c.width ?? null,
          height: c.height ?? null,
          created_at: c.createdAt,
          day: c.day ?? dayKey(c.createdAt),
          hash: c.hash,
          pinned: c.pinned ? 1 : 0,
          copy_count: 1
        })
      } catch {
        /* skip a corrupt line rather than aborting the whole import */
      }
    }
    const tx = db.transaction((recs: Row[]) => {
      for (const r of recs) insert.run(r)
    })
    tx(rows)
    imported = rows.length

    // Preserve the original as a backup and prevent re-import next launch.
    try {
      renameSync(legacy, legacy + '.bak')
    } catch {
      /* if rename fails the empty-table guard still prevents double import */
    }
    console.log(`[carbon] migrated ${imported} clip(s) from clips.jsonl to SQLite`)
  } catch (err) {
    console.error('[carbon] legacy migration failed', err)
  }
  return imported
}

/** Initialise the store against a directory, opening the DB and migrating v1 data. */
export function initStore(dir: string): void {
  openDb(dir)
  maybeMigrateLegacy()
}

export function getDataDir(): string {
  return dataDir
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  return Buffer.from(base64, 'base64')
}

function readImageDataUrl(imageFile: string | null): string | undefined {
  if (!imageFile) return undefined
  try {
    const buf = readFileSync(join(imagesDir(), imageFile))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/**
 * Map a DB row to the client shape. Image bytes are NOT loaded here, the
 * renderer fetches them lazily via getImage(). Pass inlineDataUrl to include
 * the image for a freshly captured clip so it can render immediately.
 */
function toClient(row: Row, inlineDataUrl?: string): ClipRecord {
  return {
    id: row.id,
    type: row.type,
    text: row.text ?? undefined,
    dataUrl: inlineDataUrl,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    createdAt: row.created_at,
    day: row.day,
    hash: row.hash,
    pinned: (row.pinned ? 1 : 0) as 0 | 1,
    copyCount: row.copy_count
  }
}

function getRow(id: number): Row | undefined {
  return db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as Row | undefined
}

/**
 * Every pinned clip, newest first. Always returned in full (no pagination),
 * pinned is a deliberately small, curated set. Unbounded history growth is
 * handled by the paginated feed below, not here.
 */
export function getPinned(): ClipRecord[] {
  const rows = db
    .prepare('SELECT * FROM clips WHERE pinned = 1 ORDER BY created_at DESC, id DESC')
    .all() as Row[]
  return rows.map((r) => toClient(r))
}

const DEFAULT_PAGE_SIZE = 60

// How many FTS candidate rows we're willing to pull before sorting and
// paginating. Without a cap, SQLite has to materialize every match for a
// common word (e.g. "error" across 100k+ clips) into a temp b-tree just to
// hand back the newest 60 of them, a query whose cost scales with how much
// history exists, not with the page size, and it re-runs on every keystroke.
// Capped, the candidate set (and therefore the sort) is a fixed cost no
// matter how large the clip history grows. Ordering candidates by rowid DESC
// before capping biases toward recent matches, which is what "search my
// clipboard history" users expect to see first anyway.
const SEARCH_CANDIDATE_CAP = 3000

/**
 * Shared WHERE clause for the timeline feed and search: an optional type
 * filter plus an inclusive day-range bound expressed against the indexed
 * `created_at` column (not the text `day` column), so both can be satisfied
 * by the same (pinned, created_at) / (type, pinned, created_at) indexes used
 * for the ORDER BY, no separate index or temp b-tree needed for the range.
 */
function rangeClause(
  filter: ClipQuery['filter'],
  from?: string,
  to?: string
): { sql: string; params: Record<string, unknown> } {
  const parts: string[] = ['pinned = 0']
  const params: Record<string, unknown> = {}
  if (filter !== 'all') {
    parts.push('type = @type')
    params.type = filter
  }
  if (from) {
    parts.push('created_at >= @fromMs')
    params.fromMs = dayStartMs(from)
  }
  if (to) {
    parts.push('created_at <= @toMs')
    params.toMs = dayEndMs(to)
  }
  return { sql: parts.join(' AND '), params }
}

function pageResult(rows: Row[], limit: number): ClipPage {
  const items = rows.map((r) => toClient(r))
  const last = rows[rows.length - 1]
  const nextCursor: ClipCursor | null =
    rows.length === limit && last ? { createdAt: last.created_at, id: last.id } : null
  return { items, nextCursor }
}

/**
 * One page of the non-pinned timeline, newest first, optionally filtered by
 * type and/or day range. Keyset-paginated via `cursor`: fetching any page is
 * an indexed range scan bounded by `limit`, so it stays equally fast whether
 * it's page 1 or page 5,000, unlike OFFSET pagination, which gets slower the
 * deeper the user scrolls because the database has to walk past every
 * skipped row first.
 */
export function getPage(query: ClipQuery): ClipPage {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE
  const { sql: where, params } = rangeClause(query.filter, query.from, query.to)
  let cursorSql = ''
  if (query.cursor) {
    cursorSql = ' AND (created_at, id) < (@cursorCa, @cursorId)'
    params.cursorCa = query.cursor.createdAt
    params.cursorId = query.cursor.id
  }
  params.limit = limit

  const rows = db
    .prepare(
      `SELECT * FROM clips
        WHERE ${where}${cursorSql}
        ORDER BY created_at DESC, id DESC
        LIMIT @limit`
    )
    .all(params) as Row[]

  return pageResult(rows, limit)
}

/** Load a single clip's image as a data URL, on demand. */
export function getImage(id: number): string | null {
  const row = getRow(id)
  if (!row || row.type !== 'image') return null
  return readImageDataUrl(row.image_file) ?? null
}

/** Payload needed to write a clip back to the system clipboard. */
export function getCopyPayload(
  id: number
): { type: ClipType; text?: string; dataUrl?: string } | null {
  const row = getRow(id)
  if (!row) return null
  if (row.type === 'image') {
    return { type: 'image', dataUrl: readImageDataUrl(row.image_file) }
  }
  return { type: 'text', text: row.text ?? '' }
}

function ftsMatchExpr(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ')
}

/**
 * Full-text search over clip text using FTS5 (prefix match per token),
 * keyset-paginated exactly like the timeline. The FTS candidate set is capped
 * at SEARCH_CANDIDATE_CAP before the join/sort/pagination, see that
 * constant's comment for why this is what keeps search latency flat
 * regardless of how many clips match a common word. Falls back to a
 * substring LIKE scan when FTS returns nothing on the first page (e.g. the
 * query is too short for meaningful tokens), so mid-word matches still work.
 */
export function searchPage(
  q: string,
  filter: ClipQuery['filter'],
  from: string | undefined,
  to: string | undefined,
  cursor?: ClipCursor,
  limit = DEFAULT_PAGE_SIZE
): ClipPage {
  const trimmed = q.trim()
  if (!trimmed) return { items: [], nextCursor: null }

  const match = ftsMatchExpr(trimmed)
  const { sql: extraWhere, params: extraParams } = rangeClause(filter, from, to)
  let cursorSql = ''
  const params: Record<string, unknown> = {
    ...extraParams,
    match,
    cap: SEARCH_CANDIDATE_CAP,
    limit
  }
  if (cursor) {
    cursorSql = ' AND (c.created_at, c.id) < (@cursorCa, @cursorId)'
    params.cursorCa = cursor.createdAt
    params.cursorId = cursor.id
  }

  let rows: Row[] = []
  try {
    rows = db
      .prepare(
        `SELECT c.* FROM clips c
          WHERE c.id IN (
            SELECT rowid FROM clips_fts WHERE clips_fts MATCH @match ORDER BY rowid DESC LIMIT @cap
          )
          AND ${extraWhere}${cursorSql}
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT @limit`
      )
      .all(params) as Row[]
  } catch {
    rows = []
  }

  if (rows.length === 0 && !cursor) {
    const like = `%${trimmed.replace(/[%_\\]/g, (m) => '\\' + m)}%`
    const likeParams: Record<string, unknown> = { ...extraParams, like, limit }
    rows = db
      .prepare(
        `SELECT * FROM clips
          WHERE type = 'text' AND text LIKE @like ESCAPE '\\' AND ${extraWhere}
          ORDER BY created_at DESC, id DESC
          LIMIT @limit`
      )
      .all(likeParams) as Row[]
  }

  return pageResult(rows, limit)
}

/**
 * Fast count of non-pinned clips matching a filter/range, using the same
 * covering index as getPage so it is an index-only scan (no table access).
 * Safe to call on every filter/range change, unlike search matches (which we
 * deliberately never count, see SEARCH_CANDIDATE_CAP above).
 */
export function countMatches(filter: ClipQuery['filter'], from?: string, to?: string): number {
  const { sql: where, params } = rangeClause(filter, from, to)
  const row = db.prepare(`SELECT COUNT(*) AS n FROM clips WHERE ${where}`).get(params) as {
    n: number
  }
  return row.n
}

export type AddResult = { kind: 'add' | 'update'; record: ClipRecord }

export function addClip(payload: ClipPayload): AddResult {
  const existing = db.prepare('SELECT id FROM clips WHERE hash = ?').get(payload.hash) as
    | { id: number }
    | undefined

  if (existing) {
    // Duplicate re-copy: bump it to now so it resurfaces at the top, and
    // increment copy_count so the dashboard most-re-copied stat and the
    // per-clip re-copy badge stay accurate.
    const day = dayKey(payload.createdAt)
    db.prepare(
      'UPDATE clips SET created_at = ?, day = ?, copy_count = copy_count + 1 WHERE id = ?'
    ).run(payload.createdAt, day, existing.id)
    return { kind: 'update', record: toClient(getRow(existing.id)!) }
  }

  const day = dayKey(payload.createdAt)
  const info = db
    .prepare(
      `INSERT INTO clips (type, text, image_file, width, height, created_at, day, hash, pinned)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0)`
    )
    .run(
      payload.type,
      payload.type === 'text' ? payload.text ?? null : null,
      payload.width ?? null,
      payload.height ?? null,
      payload.createdAt,
      day,
      payload.hash
    )
  const id = Number(info.lastInsertRowid)

  let inlineDataUrl: string | undefined
  if (payload.type === 'image' && payload.dataUrl) {
    const fileName = `screenshot-${day}-${id}.png`
    try {
      writeFileSync(join(imagesDir(), fileName), dataUrlToBuffer(payload.dataUrl))
      db.prepare('UPDATE clips SET image_file = ? WHERE id = ?').run(fileName, id)
      inlineDataUrl = payload.dataUrl
    } catch (err) {
      console.error('[carbon] failed to write image file', err)
    }
  }

  return { kind: 'add', record: toClient(getRow(id)!, inlineDataUrl) }
}

export function pinClip(id: number): ClipRecord | null {
  const row = getRow(id)
  if (!row) return null
  db.prepare('UPDATE clips SET pinned = ? WHERE id = ?').run(row.pinned ? 0 : 1, id)
  return toClient(getRow(id)!)
}

export function deleteClip(id: number): void {
  const row = getRow(id)
  if (!row) return
  db.prepare('DELETE FROM clips WHERE id = ?').run(id)
  if (row.image_file) {
    try {
      rmSync(join(imagesDir(), row.image_file), { force: true })
    } catch {
      /* ignore */
    }
  }
}

export function clearAll(): void {
  db.exec('DELETE FROM clips')
  try {
    const dir = imagesDir()
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true })
    }
  } catch {
    /* ignore */
  }
}

/**
 * Move all clip data to a new directory. Returns the number of image files
 * copied. The DB file and images/ folder are relocated, then the old ones removed.
 */
export function changeDataDir(newDir: string): number {
  if (!newDir || newDir === dataDir) return 0
  ensureDirs(newDir)

  let moved = 0
  const oldImages = imagesDir()
  const newImages = imagesDir(newDir)
  try {
    for (const f of readdirSync(oldImages)) {
      try {
        copyFileSync(join(oldImages, f), join(newImages, f))
        moved++
      } catch (err) {
        console.error('[carbon] failed to copy image', err)
      }
    }
  } catch {
    /* no images to move */
  }

  const oldDir = dataDir

  // Close the DB so the file can be copied cleanly, then reopen at the new path.
  db.close()
  copyFileSync(dbFile(oldDir), dbFile(newDir))
  openDb(newDir)

  // Clean up the old location now that everything is copied.
  try {
    rmSync(dbFile(oldDir), { force: true })
    rmSync(dbFile(oldDir) + '-wal', { force: true })
    rmSync(dbFile(oldDir) + '-shm', { force: true })
    rmSync(oldImages, { recursive: true, force: true })
  } catch {
    /* leave old files if cleanup fails; data is already safe in the new dir */
  }

  return moved
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const f of readdirSync(dir)) {
      try {
        total += statSync(join(dir, f)).size
      } catch {
        /* ignore unreadable entry */
      }
    }
  } catch {
    /* no directory */
  }
  return total
}

function fileSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Aggregate stats for the dashboard: counts, storage on disk, and per-day
 * activity. The four counts plus min/max span are computed in a single pass
 * over the table (one aggregate query) instead of five separate COUNT(*)
 * queries, roughly halving the cost at large history sizes.
 */
export function getStats(): Stats {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(type = 'text') AS textCount,
              SUM(type = 'image') AS imageCount,
              SUM(pinned = 1) AS pinnedCount,
              MIN(day) AS firstDay,
              MAX(day) AS lastDay
         FROM clips`
    )
    .get() as {
    total: number
    textCount: number | null
    imageCount: number | null
    pinnedCount: number | null
    firstDay: string | null
    lastDay: string | null
  }

  const perDay = (
    db
      .prepare('SELECT day, COUNT(*) AS count FROM clips GROUP BY day ORDER BY day')
      .all() as { day: string; count: number }[]
  ).map((r) => ({ day: r.day, count: r.count }))

  const storageBytes =
    fileSize(dbFile()) +
    fileSize(dbFile() + '-wal') +
    fileSize(dbFile() + '-shm') +
    dirSize(imagesDir())

  return {
    total: totals.total,
    textCount: totals.textCount ?? 0,
    imageCount: totals.imageCount ?? 0,
    pinnedCount: totals.pinnedCount ?? 0,
    storageBytes,
    firstDay: totals.firstDay,
    lastDay: totals.lastDay,
    perDay
  }
}

const PREVIEW_LEN = 80

/** Trim a clip's text to a short single-line preview for lists like topRepeated. */
function previewOf(text: string | null): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LEN ? flat.slice(0, PREVIEW_LEN) + '...' : flat
}

/**
 * Compute the longest and current run of consecutive days that have at
 * least one clip, from an ascending list of day keys. Runs in JS over the
 * (small, one-row-per-active-day) list rather than in SQL, since date
 * arithmetic across day-key gaps is awkward to express as a single query and
 * the list is already small (one row per active day, not per clip).
 */
function computeStreaks(days: string[], todayDay: string): { current: number; longest: number } {
  if (days.length === 0) return { current: 0, longest: 0 }

  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = dayStartMs(days[i - 1])
    const cur = dayStartMs(days[i])
    const gapDays = Math.round((cur - prev) / 86400000)
    run = gapDays === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }

  // Current streak: walk backward from the most recent active day only if
  // it's today or yesterday (otherwise the streak is already broken).
  const last = days[days.length - 1]
  const gapFromToday = Math.round((dayStartMs(todayDay) - dayStartMs(last)) / 86400000)
  if (gapFromToday > 1) return { current: 0, longest }

  let current = 1
  for (let i = days.length - 1; i > 0; i--) {
    const prev = dayStartMs(days[i - 1])
    const cur = dayStartMs(days[i])
    const gapDays = Math.round((cur - prev) / 86400000)
    if (gapDays === 1) current++
    else break
  }
  return { current, longest }
}

/**
 * User-facing usage analytics for the dashboard: busiest hour/weekday,
 * capture streaks, most re-copied clips, dedupe rate, and average clips per
 * active day. Every query here is an aggregate over indexed or small
 * (one-row-per-day) result sets, deliberately avoiding anything that scans
 * clip text, so this stays fast at any history size.
 */
export function getAnalytics(): Analytics {
  const byHourRows = db
    .prepare(
      `SELECT CAST(strftime('%H', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
              COUNT(*) AS count
         FROM clips
        GROUP BY hour`
    )
    .all() as { hour: number; count: number }[]
  const byHourMap = new Map(byHourRows.map((r) => [r.hour, r.count]))
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: byHourMap.get(hour) ?? 0
  }))

  const byWeekdayRows = db
    .prepare(
      `SELECT CAST(strftime('%w', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
              COUNT(*) AS count
         FROM clips
        GROUP BY weekday`
    )
    .all() as { weekday: number; count: number }[]
  const byWeekdayMap = new Map(byWeekdayRows.map((r) => [r.weekday, r.count]))
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    count: byWeekdayMap.get(weekday) ?? 0
  }))

  const activeDays = (
    db.prepare('SELECT DISTINCT day FROM clips ORDER BY day').all() as { day: string }[]
  ).map((r) => r.day)
  const todayDay = dayKey(Date.now())
  const streaks = computeStreaks(activeDays, todayDay)

  const topRows = db
    .prepare(
      `SELECT id, type, text, copy_count AS copyCount FROM clips
        WHERE copy_count > 1
        ORDER BY copy_count DESC, created_at DESC
        LIMIT 8`
    )
    .all() as { id: number; type: ClipType; text: string | null; copyCount: number }[]
  const topRepeated: TopClip[] = topRows.map((r) => ({
    id: r.id,
    type: r.type,
    preview: r.type === 'text' ? previewOf(r.text) : undefined,
    copyCount: r.copyCount
  }))

  const dedupe = db
    .prepare(
      `SELECT COUNT(*) AS repeated, SUM(copy_count) AS totalCaptures
         FROM clips WHERE copy_count > 1`
    )
    .get() as { repeated: number; totalCaptures: number | null }
  const totalRow = db.prepare('SELECT COUNT(*) AS n FROM clips').get() as { n: number }
  // Approximate total capture events as stored rows plus the extra re-copies
  // folded into copy_count (each re-copy bumps copy_count instead of adding
  // a new row), so the dedupe rate reflects actual copy activity, not just
  // distinct content.
  const extraRecopies = (dedupe.totalCaptures ?? 0) - dedupe.repeated
  const totalCaptureEvents = totalRow.n + extraRecopies
  const dedupeRatePct =
    totalCaptureEvents > 0 ? Math.round((extraRecopies / totalCaptureEvents) * 1000) / 10 : 0

  const avgPerActiveDay =
    activeDays.length > 0 ? Math.round((totalRow.n / activeDays.length) * 10) / 10 : 0

  return {
    byHour,
    byWeekday,
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    topRepeated,
    dedupeRatePct,
    avgPerActiveDay
  }
}

/**
 * Every clip captured on a single day, newest first (pinned clips first),
 * for the dashboard activity chart's click-to-drill-down. A single indexed
 * range scan (the day column is indexed) rather than a paginated feed, since
 * one day's worth of clips is bounded and small even for a heavy user.
 */
export function getDayDetail(day: string): DayDetail {
  const rows = db
    .prepare('SELECT * FROM clips WHERE day = ? ORDER BY pinned DESC, created_at DESC')
    .all(day) as Row[]
  return { day, items: rows.map((r) => toClient(r)) }
}

/**
 * Count clips within [fromDay, toDay] (inclusive) and how many of those are
 * pinned, for the Settings delete-by-date-range preview. A direct indexed
 * query rather than scanning the renderer's in-memory clip list, which, post
 * pagination, no longer holds the full history anyway.
 */
export function countRange(
  fromDay: string,
  toDay: string
): { inRange: number; pinnedInRange: number } {
  const from = fromDay || '0000-00-00'
  const to = toDay || '9999-99-99'
  const row = db
    .prepare(
      `SELECT COUNT(*) AS inRange, SUM(pinned = 1) AS pinnedInRange
         FROM clips WHERE day >= ? AND day <= ?`
    )
    .get(from, to) as { inRange: number; pinnedInRange: number | null }
  return { inRange: row.inRange, pinnedInRange: row.pinnedInRange ?? 0 }
}

/**
 * Delete every clip whose day falls within [fromDay, toDay] (inclusive),
 * except pinned clips, which are always kept. Empty bounds are treated as open.
 * Returns the number of clips deleted.
 */
export function deleteRange(fromDay: string, toDay: string): number {
  const from = fromDay || '0000-00-00'
  const to = toDay || '9999-99-99'
  const rows = db
    .prepare(
      'SELECT id, image_file FROM clips WHERE pinned = 0 AND day >= ? AND day <= ?'
    )
    .all(from, to) as { id: number; image_file: string | null }[]

  if (rows.length === 0) return 0

  const del = db.prepare('DELETE FROM clips WHERE id = ?')
  db.transaction((rs: typeof rows) => {
    for (const r of rs) del.run(r.id)
  })(rows)

  for (const r of rows) {
    if (r.image_file) {
      try {
        rmSync(join(imagesDir(), r.image_file), { force: true })
      } catch {
        /* ignore */
      }
    }
  }
  return rows.length
}
