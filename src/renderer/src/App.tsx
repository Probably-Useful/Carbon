import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import {
  DEFAULT_SETTINGS,
  Settings,
  type ClipRecord,
  type ClipTypeFilter
} from '../../shared/types'
import { dayLabel } from './lib/format'
import { useClipFeed } from './lib/useClipFeed'
import TitleBar, { type View } from './components/TitleBar'
import FilterBar, { type FilterKind } from './components/FilterBar'
import DateFilterBar, { type DateRange } from './components/DateFilterBar'
import Dashboard from './components/Dashboard'
import VirtualTimeline, { type TimelineRow } from './components/VirtualTimeline'
import SettingsModal from './components/SettingsModal'

const EMPTY_RANGE: DateRange = { from: '', to: '' }

/** The UI's "Pinned" filter chip is handled client-side (it swaps in the
 * always-loaded pinned list); only 'all' | 'text' | 'image' are real backend
 * filters that the paginated feed queries for. */
function toBackendFilter(kind: FilterKind): ClipTypeFilter {
  return kind === 'text' || kind === 'image' ? kind : 'all'
}

export default function App() {
  const [view, setView] = useState<View>('timeline')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filter, setFilter] = useState<FilterKind>('all')
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [pinned, setPinned] = useState<ClipRecord[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounce the search query so we don't hit the DB on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(handle)
  }, [query])

  const showingPinnedOnly = filter === 'pinned'
  const backendFilter = toBackendFilter(filter)

  const feed = useClipFeed({
    filter: backendFilter,
    from: range.from,
    to: range.to,
    query: showingPinnedOnly ? '' : debouncedQuery
  })

  const [feedCount, setFeedCount] = useState(0)
  useEffect(() => {
    if (showingPinnedOnly || debouncedQuery.trim()) return
    let cancelled = false
    window.carbon.countMatches(backendFilter, range.from, range.to).then((n) => {
      if (!cancelled) setFeedCount(n)
    })
    return () => {
      cancelled = true
    }
  }, [backendFilter, range.from, range.to, showingPinnedOnly, debouncedQuery, feed.items.length])

  const refreshPinned = () => {
    window.carbon.getPinned().then(setPinned)
  }

  const within = (day: string, from: string, to: string): boolean =>
    (!from || day >= from) && (!to || day <= to)

  // Whether a clip (as freshly captured/updated) belongs in the *current*
  // non-pinned view, so live capture events only splice in matching clips
  // instead of forcing a full reload on every copy.
  const matchesFeedView = (c: ClipRecord): boolean => {
    if (c.pinned) return false
    if (filter === 'text' && c.type !== 'text') return false
    if (filter === 'image' && c.type !== 'image') return false
    if (!within(c.day, range.from, range.to)) return false
    const q = debouncedQuery.trim().toLowerCase()
    if (q) {
      if (c.type !== 'text') return false
      return c.text?.toLowerCase().includes(q) ?? false
    }
    return true
  }

  useEffect(() => {
    window.carbon.getSettings().then(setSettings)
    refreshPinned()

    const offAdd = window.carbon.onClipAdd((record) => {
      if (matchesFeedView(record)) feed.prepend(record)
    })
    const offUpdate = window.carbon.onClipUpdate((record) => {
      if (record.pinned) {
        refreshPinned()
        feed.remove(record.id)
      } else if (matchesFeedView(record)) {
        feed.bump(record)
      } else {
        feed.remove(record.id)
      }
    })
    const offOpened = window.carbon.onOpened(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })

    return () => {
      offAdd()
      offUpdate()
      offOpened()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCopy = (clip: ClipRecord) => {
    window.carbon.copyClip(clip.id)
  }

  const handlePin = (clip: ClipRecord) => {
    window.carbon.pinClip(clip.id).then((updated) => {
      if (!updated) return
      if (updated.pinned) {
        setPinned((prev) => [updated, ...prev.filter((c) => c.id !== updated.id)])
        feed.remove(updated.id)
      } else {
        setPinned((prev) => prev.filter((c) => c.id !== updated.id))
        if (matchesFeedView(updated)) feed.insertSorted(updated)
      }
    })
  }

  const handleDelete = (id: number) => {
    setPinned((prev) => prev.filter((c) => c.id !== id))
    feed.remove(id)
    window.carbon.deleteClip(id)
  }

  const handleClearAll = () => {
    setPinned([])
    feed.clear()
    window.carbon.clearClips()
  }

  const countRangeFn = (from: string, to: string) => window.carbon.countRange(from, to)

  const handleDeleteRange = async (from: string, to: string): Promise<number> => {
    const count = await window.carbon.deleteRange(from, to)
    // Pinned clips are never touched by a range delete; the feed, however,
    // may now contain gaps or a stale cursor, so just reload its first page.
    refreshPinned()
    feed.reload()
    return count
  }

  // Build the flattened, virtualizable row list: an optional pinned section,
  // then day-grouped headers + clip rows, then a trailing sentinel that
  // drives infinite scroll. Flattening (vs. nested <Section> per day) is what
  // lets react-window virtualize the whole timeline as a single list instead
  // of mounting every card up front.
  const rows = useMemo<TimelineRow[]>(() => {
    const out: TimelineRow[] = []

    if (showingPinnedOnly) {
      if (pinned.length > 0) out.push({ kind: 'header', key: 'hdr-pinned', title: 'Pinned' })
      for (const clip of pinned) out.push({ kind: 'clip', key: `p-${clip.id}`, clip })
      return out
    }

    const searching = debouncedQuery.trim().length > 0
    if (!searching && pinned.length > 0) {
      out.push({ kind: 'header', key: 'hdr-pinned', title: 'Pinned' })
      for (const clip of pinned) out.push({ kind: 'clip', key: `pin-${clip.id}`, clip })
    }

    let lastDay = ''
    for (const clip of feed.items) {
      if (clip.day !== lastDay) {
        lastDay = clip.day
        out.push({ kind: 'header', key: `hdr-${clip.day}`, title: dayLabel(clip.day) })
      }
      out.push({ kind: 'clip', key: `c-${clip.id}`, clip })
    }
    if (feed.items.length > 0) out.push({ kind: 'sentinel', key: 'sentinel' })
    return out
  }, [pinned, feed.items, showingPinnedOnly, debouncedQuery])

  const searching = debouncedQuery.trim().length > 0
  const loadedVisible = showingPinnedOnly
    ? pinned.length
    : (searching ? 0 : pinned.length) + feed.items.length
  const badgeCount = showingPinnedOnly
    ? pinned.length
    : searching
      ? feed.items.length
      : pinned.length + feedCount
  const isEmpty = !feed.loading && loadedVisible === 0
  const rangeActive = Boolean(range.from || range.to)

  return (
    <div className="carbon-texture flex h-full flex-col overflow-hidden rounded-xl border border-carbon-700/70 bg-carbon-900 text-zinc-100">
      <TitleBar
        view={view}
        onView={setView}
        query={query}
        onQuery={setQuery}
        onOpenSettings={() => setShowSettings(true)}
        searchRef={searchRef}
      />

      {view === 'dashboard' ? (
        <Dashboard
          version={feed.items.length + pinned.length}
          onCopy={handleCopy}
          onPin={handlePin}
          onDelete={handleDelete}
        />
      ) : (
        <>
          <FilterBar active={filter} onChange={setFilter} count={badgeCount} />
          <DateFilterBar range={range} onChange={setRange} />

          <div className="flex-1 overflow-hidden pb-2 pt-1">
            {feed.loading ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                Loading…
              </div>
            ) : isEmpty ? (
              <EmptyState hasQuery={query.length > 0} hasRange={rangeActive} />
            ) : (
              <VirtualTimeline
                rows={rows}
                onCopy={handleCopy}
                onPin={handlePin}
                onDelete={handleDelete}
                onLoadMore={feed.loadMore}
                loadingMore={feed.loadingMore}
                hasMore={feed.hasMore}
                highlightQuery={searching ? debouncedQuery : undefined}
              />
            )}
          </div>
        </>
      )}

      {showSettings ? (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSettingsChange={setSettings}
          onClearAll={handleClearAll}
          onDeleteRange={handleDeleteRange}
          countRange={countRangeFn}
        />
      ) : null}
    </div>
  )
}

function EmptyState({ hasQuery, hasRange }: { hasQuery: boolean; hasRange: boolean }) {
  const message = hasQuery
    ? 'No clips match your search.'
    : hasRange
      ? 'No clips in this date range.'
      : 'Nothing captured yet.'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-carbon-800 text-zinc-600">
        <ClipboardList size={26} />
      </div>
      <p className="text-sm text-zinc-400">{message}</p>
      {!hasQuery && !hasRange ? (
        <p className="max-w-[15rem] text-xs leading-relaxed text-zinc-600">
          Copy anything — text or an image — and it will show up here, grouped by day.
        </p>
      ) : null}
    </div>
  )
}
