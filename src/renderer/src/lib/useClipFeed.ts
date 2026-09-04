import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipCursor, ClipRecord, ClipTypeFilter } from '../../../shared/types'

export interface FeedParams {
  filter: ClipTypeFilter
  from: string
  to: string
  /** Empty string means "browse the timeline"; non-empty runs a search instead. */
  query: string
}

/**
 * Drives the non-pinned clip feed (timeline or search) with keyset
 * pagination: only one page (default 60 rows) is ever fetched at a time, and
 * `loadMore` fetches the next page from the cursor returned by the previous
 * one. This is what keeps opening Carbon and scrolling its history fast
 * regardless of how many clips have ever been captured — the old
 * implementation loaded the *entire* history into memory and into the DOM on
 * every launch, which is fine at a few hundred clips and a real problem at
 * tens of thousands.
 *
 * A generation counter guards against races: if params change while a fetch
 * is in flight, the stale response is dropped instead of clobbering newer
 * results (e.g. typing quickly in the search box, or switching filters mid-load).
 */
export function useClipFeed(params: FeedParams) {
  const [items, setItems] = useState<ClipRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const cursorRef = useRef<ClipCursor | null>(null)
  const hasMoreRef = useRef(true)
  const genRef = useRef(0)

  const { filter, from, to, query } = params

  const fetchPage = useCallback(
    (cursor: ClipCursor | undefined) => {
      const trimmed = query.trim()
      return trimmed
        ? window.carbon.searchClips(trimmed, filter, from, to, cursor)
        : window.carbon.getPage(filter, from, to, cursor)
    },
    [filter, from, to, query]
  )

  // Reset and load the first page whenever the query shape changes.
  useEffect(() => {
    const gen = ++genRef.current
    setLoading(true)
    cursorRef.current = null
    hasMoreRef.current = true
    fetchPage(undefined).then((page) => {
      if (gen !== genRef.current) return
      setItems(page.items)
      cursorRef.current = page.nextCursor
      hasMoreRef.current = page.nextCursor !== null
      setLoading(false)
    })
  }, [fetchPage])

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMoreRef.current) return
    const gen = genRef.current
    setLoadingMore(true)
    fetchPage(cursorRef.current ?? undefined).then((page) => {
      if (gen !== genRef.current) {
        setLoadingMore(false)
        return
      }
      setItems((prev) => [...prev, ...page.items])
      cursorRef.current = page.nextCursor
      hasMoreRef.current = page.nextCursor !== null
      setLoadingMore(false)
    })
  }, [fetchPage, loading, loadingMore])

  /** Prepend a freshly captured clip (only call this when it matches the current view). */
  const prepend = useCallback((record: ClipRecord) => {
    setItems((prev) => (prev.some((c) => c.id === record.id) ? prev : [record, ...prev]))
  }, [])

  /** Move a duplicate re-copy back to the top, or insert it if it's new to this view. */
  const bump = useCallback((record: ClipRecord) => {
    setItems((prev) => [record, ...prev.filter((c) => c.id !== record.id)])
  }, [])

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const removeMany = useCallback((ids: Set<number>) => {
    setItems((prev) => prev.filter((c) => !ids.has(c.id)))
  }, [])

  const insertSorted = useCallback((record: ClipRecord) => {
    setItems((prev) => {
      if (prev.some((c) => c.id === record.id)) return prev
      const idx = prev.findIndex((c) => c.createdAt < record.createdAt)
      const next = idx === -1 ? [...prev, record] : [...prev.slice(0, idx), record, ...prev.slice(idx)]
      return next
    })
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const reload = useCallback(() => {
    const gen = ++genRef.current
    setLoading(true)
    cursorRef.current = null
    hasMoreRef.current = true
    fetchPage(undefined).then((page) => {
      if (gen !== genRef.current) return
      setItems(page.items)
      cursorRef.current = page.nextCursor
      hasMoreRef.current = page.nextCursor !== null
      setLoading(false)
    })
  }, [fetchPage])

  return {
    items,
    loading,
    loadingMore,
    hasMore: hasMoreRef.current,
    loadMore,
    prepend,
    bump,
    remove,
    removeMany,
    insertSorted,
    clear,
    reload
  }
}
