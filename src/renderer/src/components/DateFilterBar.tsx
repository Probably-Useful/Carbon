import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Calendar, ChevronDown, X } from 'lucide-react'
import { daysAgoKey, monthStartKey, shortDay, todayKey } from '../lib/format'

export interface DateRange {
  from: string
  to: string
}

interface Props {
  range: DateRange
  onChange: (range: DateRange) => void
}

type PresetKey = 'today' | '7d' | '30d' | 'month' | null

const PRESETS: { key: PresetKey; label: string; make: () => DateRange }[] = [
  { key: 'today', label: 'Today', make: () => ({ from: todayKey(), to: todayKey() }) },
  { key: '7d', label: 'Last 7 days', make: () => ({ from: daysAgoKey(6), to: todayKey() }) },
  { key: '30d', label: 'Last 30 days', make: () => ({ from: daysAgoKey(29), to: todayKey() }) },
  { key: 'month', label: 'This month', make: () => ({ from: monthStartKey(), to: todayKey() }) }
]

/** Which preset (if any) the current range exactly matches, so the pill and
 * the open panel can show it as selected instead of falling back to raw dates. */
function matchingPreset(range: DateRange): PresetKey {
  const preset = PRESETS.find((p) => {
    const made = p.make()
    return made.from === range.from && made.to === range.to
  })
  return preset?.key ?? null
}

function rangeLabel(range: DateRange): string {
  if (!range.from && !range.to) return 'All time'
  const preset = matchingPreset(range)
  if (preset) return PRESETS.find((p) => p.key === preset)!.label
  if (range.from && range.to && range.from === range.to) return shortDay(range.from)
  if (range.from && range.to) return `${shortDay(range.from)} \u2013 ${shortDay(range.to)}`
  if (range.from) return `From ${shortDay(range.from)}`
  return `Until ${shortDay(range.to)}`
}

/**
 * Compact date-range control: a single pill that always shows a clean,
 * human label ("All time", "Last 7 days", "12 Aug - 20 Aug"...) and expands
 * into a floating panel on click, instead of two cramped native date inputs
 * sitting inline in the toolbar. Closes on outside click or Escape.
 */
export default function DateFilterBar({ range, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = Boolean(range.from || range.to)
  const activePreset = matchingPreset(range)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative border-b border-carbon-700/40 px-4 pb-2.5" ref={rootRef}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`no-drag flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
            active
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-carbon-700 bg-carbon-850 text-zinc-400 hover:border-carbon-600 hover:text-zinc-200'
          }`}
        >
          <Calendar size={12} />
          {rangeLabel(range)}
          <ChevronDown
            size={12}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {active ? (
          <button
            onClick={() => onChange({ from: '', to: '' })}
            title="Clear date filter"
            className="no-drag grid h-5 w-5 place-items-center rounded-md text-zinc-500 transition hover:bg-carbon-700 hover:text-zinc-200"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="no-drag absolute left-4 top-[calc(100%+4px)] z-20 w-72 overflow-hidden rounded-xl border border-carbon-700 bg-carbon-850 shadow-panel"
          >
            <div className="grid grid-cols-2 gap-1.5 p-3">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    onChange(p.make())
                    setOpen(false)
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition ${
                    activePreset === p.key
                      ? 'bg-accent text-carbon-950'
                      : 'bg-carbon-800 text-zinc-300 hover:bg-carbon-700 hover:text-zinc-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="border-t border-carbon-700/60 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Custom range
              </div>
              <div className="flex items-center gap-2">
                <DateField
                  value={range.from}
                  max={range.to || undefined}
                  onChange={(v) => onChange({ ...range, from: v })}
                />
                <span className="text-[11px] text-zinc-600">to</span>
                <DateField
                  value={range.to}
                  min={range.from || undefined}
                  onChange={(v) => onChange({ ...range, to: v })}
                />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function DateField({
  value,
  min,
  max,
  onChange
}: {
  value: string
  min?: string
  max?: string
  onChange: (value: string) => void
}) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-carbon-700 bg-carbon-900 px-2 py-1.5 text-[12px] text-zinc-200 outline-none transition [color-scheme:dark] focus:border-accent/60"
    />
  )
}
