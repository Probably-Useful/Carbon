import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { ClipRecord } from '../../../shared/types'
import { dayLabel } from '../lib/format'
import ClipCard from './ClipCard'

interface Props {
  day: string
  items: ClipRecord[]
  loading: boolean
  onClose: () => void
  onCopy: (clip: ClipRecord) => void
  onPin: (clip: ClipRecord) => void
  onDelete: (id: number) => void
}

/**
 * Slide-over panel showing everything captured on one day, opened by
 * clicking a bar in the dashboard's activity chart. A single day's clips
 * are always a small, bounded set (unlike the full timeline), so this loads
 * and renders the plain list directly rather than going through the
 * paginated/virtualized feed used for the main timeline.
 */
export default function DayDetailPanel({
  day,
  items,
  loading,
  onClose,
  onCopy,
  onPin,
  onDelete
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 flex flex-col bg-carbon-900"
    >
      <div className="flex items-center justify-between border-b border-carbon-700/60 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">{dayLabel(day)}</div>
          <div className="text-[11px] text-zinc-500">
            {loading ? 'Loading…' : `${items.length} clip${items.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition hover:bg-carbon-700 hover:text-zinc-100"
        >
          <X size={15} />
        </button>
      </div>

      <div className="scroll-area flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            No clips on this day.
          </div>
        ) : (
          items.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onCopy={onCopy} onPin={onPin} onDelete={onDelete} />
          ))
        )}
      </div>
    </motion.div>
  )
}
