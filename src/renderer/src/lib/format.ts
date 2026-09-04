/** Human-friendly label for a day key like "2026-06-10". */
export function dayLabel(dayKey: string): string {
  const today = new Date()
  const todayKey = toKey(today)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const yesterdayKey = toKey(yesterday)

  if (dayKey === todayKey) return 'Today'
  if (dayKey === yesterdayKey) return 'Yesterday'

  const [y, m, d] = dayKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'
  })
}

function toKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today's day key, e.g. "2026-08-20". */
export function todayKey(): string {
  return toKey(new Date())
}

/** Day key N days before today. */
export function daysAgoKey(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toKey(d)
}

/** Day key for the first day of the current month. */
export function monthStartKey(): string {
  const d = new Date()
  return toKey(new Date(d.getFullYear(), d.getMonth(), 1))
}

/** The last `n` consecutive day keys ending today (ascending). */
export function lastNDays(n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(daysAgoKey(i))
  return out
}

/** Compact date label for a day key, e.g. "20 Aug". */
export function shortDay(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Human-friendly file size, e.g. "12.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`
}

/** Short clock time for a clip, e.g. "14:32". */
export function clipTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Detect simple content kinds so we can tag text clips (url, code, etc.). */
export function classifyText(text: string): string {
  const trimmed = text.trim()
  if (/^https?:\/\/\S+$/i.test(trimmed)) return 'Link'
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(trimmed)) return 'Email'
  if (/[{};=()<>]/.test(trimmed) && /\n/.test(trimmed)) return 'Code'
  if (!trimmed.includes(' ') && trimmed.length > 12) return 'Token'
  return 'Text'
}

/** Compact 12-hour label for an hour bucket (0-23), e.g. 14 maps to "2 PM". */
export function hourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12} ${period}`
}

/** Short weekday label for a weekday index (0 = Sunday), e.g. "Mon". */
export function weekdayLabel(weekday: number): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return names[weekday] ?? ''
}
