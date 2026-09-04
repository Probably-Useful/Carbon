import { useEffect } from 'react'
import { List, useDynamicRowHeight, type RowComponentProps } from 'react-window'
import ClipCard from './ClipCard'
import type { ClipRecord } from '../../../shared/types'

/**
 * A flattened row in the virtualized timeline: either a section header
 * ("Pinned", "Today", "12 August"...) or a clip card. Flattening headers and
 * cards into one list (rather than nesting a <Section> per day, as before)
 * is what makes virtualization possible — react-window needs a single flat,
 * indexable sequence of "rows" so it can mount only the ones on screen.
 */
export type TimelineRow =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'clip'; key: string; clip: ClipRecord }
  | { kind: 'sentinel'; key: string }

interface RowProps {
  rows: TimelineRow[]
  onCopy: (clip: ClipRecord) => void
  onPin: (clip: ClipRecord) => void
  onDelete: (id: number) => void
  onLoadMore: () => void
  loadingMore: boolean
  hasMore: boolean
  highlightQuery?: string
}

/** Runs `fn` once whenever this component mounts — used below so the
 * trailing sentinel row triggers loadMore the moment it scrolls into the
 * virtualized window, giving infinite scroll without a separate IntersectionObserver. */
function useOnMount(fn: () => void): void {
  useEffect(() => {
    fn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function LoadMoreTrigger({
  onLoadMore,
  loadingMore,
  hasMore
}: {
  onLoadMore: () => void
  loadingMore: boolean
  hasMore: boolean
}): React.ReactElement | null {
  useOnMount(() => {
    if (hasMore) onLoadMore()
  })
  if (!hasMore) return null
  return (
    <div className="flex items-center justify-center py-4 text-[11px] text-zinc-600">
      {loadingMore ? 'Loading more…' : ''}
    </div>
  )
}

function Row({
  index,
  style,
  rows,
  onCopy,
  onPin,
  onDelete,
  onLoadMore,
  loadingMore,
  hasMore,
  highlightQuery
}: RowComponentProps<RowProps>): React.ReactElement | null {
  const row = rows[index]
  if (!row) return null

  if (row.kind === 'header') {
    return (
      <div style={style} className="px-4">
        <div className="py-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            {row.title}
          </h2>
        </div>
      </div>
    )
  }

  if (row.kind === 'sentinel') {
    // The last row doubles as an infinite-scroll trigger: once it mounts
    // (i.e. scrolls into the rendered window) it fires loadMore.
    return (
      <div style={style} className="px-4 pb-2">
        <LoadMoreTrigger onLoadMore={onLoadMore} loadingMore={loadingMore} hasMore={hasMore} />
      </div>
    )
  }

  return (
    <div style={style} className="px-4 pb-2">
      <ClipCard
        clip={row.clip}
        onCopy={onCopy}
        onPin={onPin}
        onDelete={onDelete}
        highlightQuery={highlightQuery}
      />
    </div>
  )
}

const AVG_ROW_HEIGHT = 132

interface Props {
  rows: TimelineRow[]
  onCopy: (clip: ClipRecord) => void
  onPin: (clip: ClipRecord) => void
  onDelete: (id: number) => void
  onLoadMore: () => void
  loadingMore: boolean
  hasMore: boolean
  highlightQuery?: string
}

/**
 * Virtualized replacement for the old "render every clip's card into the DOM"
 * timeline. react-window's `List` only mounts rows near the visible
 * viewport (plus a small overscan buffer), so scrolling through tens of
 * thousands of clips costs the same as scrolling through a few dozen — DOM
 * node count stays bounded by viewport height, not by history size.
 *
 * Row heights are measured live via useDynamicRowHeight since clip cards vary
 * in height (short vs. long text, images vs. text). Headers get a fixed,
 * known height so only clip rows pay the (still cheap) measurement cost.
 */
export default function VirtualTimeline({
  rows,
  onCopy,
  onPin,
  onDelete,
  onLoadMore,
  loadingMore,
  hasMore,
  highlightQuery
}: Props) {
  const dynamicRowHeight = useDynamicRowHeight({ defaultRowHeight: AVG_ROW_HEIGHT })

  return (
    <List
      className="scroll-area"
      rowCount={rows.length}
      rowHeight={dynamicRowHeight}
      rowComponent={Row}
      rowProps={{ rows, onCopy, onPin, onDelete, onLoadMore, loadingMore, hasMore, highlightQuery }}
      rowKey={(index) => rows[index]?.key ?? index}
      overscanCount={6}
      style={{ height: '100%', width: '100%' }}
    />
  )
}
