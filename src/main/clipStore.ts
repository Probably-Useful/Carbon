import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  copyFileSync
} from 'fs'
import { join } from 'path'
import { ClipPayload, ClipRecord, ClipType } from '../shared/types'
import { dayKey } from '../shared/day'

/** Internal on-disk shape. Image bytes live in a separate file, not inline. */
interface StoredClip {
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

let dataDir = ''
let clips: StoredClip[] = []
let nextId = 1
let persistTimer: ReturnType<typeof setTimeout> | null = null

function indexFile(dir = dataDir): string {
  return join(dir, 'clips.jsonl')
}
function imagesDir(dir = dataDir): string {
  return join(dir, 'images')
}

function ensureDirs(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const img = imagesDir(dir)
  if (!existsSync(img)) mkdirSync(img, { recursive: true })
}

/** Initialise the store against a directory, loading any existing clips. */
export function initStore(dir: string): void {
  dataDir = dir
  ensureDirs(dir)
  clips = []
  nextId = 1
  const file = indexFile(dir)
  if (existsSync(file)) {
    try {
      const lines = readFileSync(file, 'utf-8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const rec = JSON.parse(trimmed) as StoredClip
          clips.push(rec)
          if (rec.id >= nextId) nextId = rec.id + 1
        } catch {
          /* skip a corrupt line rather than losing the whole history */
        }
      }
    } catch (err) {
      console.error('[carbon] failed to load clips', err)
    }
  }
  clips.sort((a, b) => a.createdAt - b.createdAt)
}

export function getDataDir(): string {
  return dataDir
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 400)
}

function persistNow(): void {
  persistTimer = null
  try {
    const body = clips.map((c) => JSON.stringify(c)).join('\n')
    const tmp = indexFile() + '.tmp'
    writeFileSync(tmp, body, 'utf-8')
    renameSync(tmp, indexFile())
  } catch (err) {
    console.error('[carbon] failed to persist clips', err)
  }
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  return Buffer.from(base64, 'base64')
}

function toClient(rec: StoredClip, inlineDataUrl?: string): ClipRecord {
  let dataUrl: string | undefined
  if (rec.type === 'image') {
    if (inlineDataUrl) {
      dataUrl = inlineDataUrl
    } else if (rec.imageFile) {
      try {
        const buf = readFileSync(join(imagesDir(), rec.imageFile))
        dataUrl = `data:image/png;base64,${buf.toString('base64')}`
      } catch {
        dataUrl = undefined
      }
    }
  }
  return {
    id: rec.id,
    type: rec.type,
    text: rec.text,
    dataUrl,
    width: rec.width,
    height: rec.height,
    createdAt: rec.createdAt,
    day: rec.day,
    hash: rec.hash,
    pinned: rec.pinned
  }
}

export function getAll(): ClipRecord[] {
  // Newest first for the timeline.
  return [...clips].sort((a, b) => b.createdAt - a.createdAt).map((c) => toClient(c))
}

export type AddResult = { kind: 'add' | 'update'; record: ClipRecord }

export function addClip(payload: ClipPayload): AddResult {
  const existing = clips.find((c) => c.hash === payload.hash)
  if (existing) {
    existing.createdAt = payload.createdAt
    existing.day = dayKey(payload.createdAt)
    schedulePersist()
    return { kind: 'update', record: toClient(existing) }
  }

  const id = nextId++
  const rec: StoredClip = {
    id,
    type: payload.type,
    text: payload.type === 'text' ? payload.text : undefined,
    width: payload.width,
    height: payload.height,
    createdAt: payload.createdAt,
    day: dayKey(payload.createdAt),
    hash: payload.hash,
    pinned: 0
  }

  if (payload.type === 'image' && payload.dataUrl) {
    const fileName = `screenshot-${dayKey(payload.createdAt)}-${id}.png`
    try {
      writeFileSync(join(imagesDir(), fileName), dataUrlToBuffer(payload.dataUrl))
      rec.imageFile = fileName
    } catch (err) {
      console.error('[carbon] failed to write image file', err)
    }
  }

  clips.push(rec)
  schedulePersist()
  return { kind: 'add', record: toClient(rec, payload.dataUrl) }
}

export function pinClip(id: number): ClipRecord | null {
  const rec = clips.find((c) => c.id === id)
  if (!rec) return null
  rec.pinned = rec.pinned ? 0 : 1
  schedulePersist()
  return toClient(rec)
}

export function deleteClip(id: number): void {
  const idx = clips.findIndex((c) => c.id === id)
  if (idx < 0) return
  const [rec] = clips.splice(idx, 1)
  if (rec.imageFile) {
    try {
      rmSync(join(imagesDir(), rec.imageFile), { force: true })
    } catch {
      /* ignore */
    }
  }
  schedulePersist()
}

export function clearAll(): void {
  clips = []
  nextId = 1
  try {
    const dir = imagesDir()
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true })
    }
  } catch {
    /* ignore */
  }
  persistNow()
}

/**
 * Move all clip data to a new directory. Returns the number of image files moved.
 * The clips index is rewritten from memory in the new location.
 */
export function changeDataDir(newDir: string): number {
  if (!newDir || newDir === dataDir) return 0
  ensureDirs(newDir)

  let moved = 0
  const oldImages = imagesDir()
  const newImages = imagesDir(newDir)
  for (const rec of clips) {
    if (!rec.imageFile) continue
    const src = join(oldImages, rec.imageFile)
    const dst = join(newImages, rec.imageFile)
    if (!existsSync(src)) continue
    try {
      copyFileSync(src, dst)
      moved++
    } catch (err) {
      console.error('[carbon] failed to move image', err)
    }
  }

  const oldDir = dataDir
  dataDir = newDir
  persistNow()

  // Clean up the old location now that everything is copied.
  try {
    rmSync(indexFile(oldDir), { force: true })
    rmSync(imagesDir(oldDir), { recursive: true, force: true })
  } catch {
    /* leave old files if cleanup fails; data is already safe in the new dir */
  }

  return moved
}
