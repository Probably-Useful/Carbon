/** Local date key for an epoch timestamp, e.g. "2026-06-10". */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Epoch ms at local midnight for a "YYYY-MM-DD" day key. Lets range filters
 * (Settings > delete-by-range, the date filter bar) query the indexed
 * `created_at` column directly instead of the separate `day` text column, so
 * the same (pinned, created_at) index serves both the filter and the sort.
 */
export function dayStartMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime()
}

/** Epoch ms at the last millisecond of the local day for a "YYYY-MM-DD" key. */
export function dayEndMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).getTime()
}
