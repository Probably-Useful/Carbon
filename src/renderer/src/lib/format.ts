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
