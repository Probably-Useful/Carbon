import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Calendar,
  Clipboard,
  Copy,
  FileText,
  Flame,
  HardDrive,
  Image,
  Pin,
  Repeat2,
  TrendingUp
} from 'lucide-react'
import type { Analytics, ClipRecord, DayDetail, Stats } from '../../../shared/types'
import { dayLabel, formatBytes, hourLabel, lastNDays, shortDay, weekdayLabel } from '../lib/format'
import DayDetailPanel from './DayDetailPanel'

interface Props {
  /** Bumps whenever clips change so the dashboard can refresh its numbers. */
  version: number
  onCopy: (clip: ClipRecord) => void
  onPin: (clip: ClipRecord) => void
  onDelete: (id: number) => void
}

const ACTIVITY_DAYS = 30

export default function Dashboard({ version, onCopy, onPin, onDelete }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null)
  const [loadingDay, setLoadingDay] = useState(false)

  useEffect(() => {
    window.carbon.getStats().then(setStats)
    window.carbon.getAnalytics().then(setAnalytics)
  }, [version])

  useEffect(() => {
    if (!selectedDay) {
      setDayDetail(null)
      return
    }
    let cancelled = false
    setLoadingDay(true)
    window.carbon.getDayDetail(selectedDay).then((detail) => {
      if (!cancelled) {
        setDayDetail(detail)
        setLoadingDay(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selectedDay])

  // Re-sync the open day-detail panel whenever a clip changes elsewhere
  // (pin/delete/new capture), so counts and content stay accurate without a
  // full reload.
  useEffect(() => {
    if (selectedDay) window.carbon.getDayDetail(selectedDay).then(setDayDetail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const activity = useMemo(() => {
    if (!stats) return []
    const counts = new Map(stats.perDay.map((d) => [d.day, d.count]))
    return lastNDays(ACTIVITY_DAYS).map((day) => ({ day, count: counts.get(day) ?? 0 }))
  }, [stats])

  const maxCount = useMemo(() => activity.reduce((m, a) => Math.max(m, a.count), 0), [activity])

  const activeDays = stats?.perDay.length ?? 0

  const busiestHour = useMemo(() => {
    if (!analytics) return null
    return analytics.byHour.reduce((best, h) => (h.count > best.count ? h : best), analytics.byHour[0])
  }, [analytics])

  const busiestWeekday = useMemo(() => {
    if (!analytics) return null
    return analytics.byWeekday.reduce(
      (best, d) => (d.count > best.count ? d : best),
      analytics.byWeekday[0]
    )
  }, [analytics])

  const maxHourCount = useMemo(
    () => (analytics ? Math.max(...analytics.byHour.map((h) => h.count), 0) : 0),
    [analytics]
  )
  const maxWeekdayCount = useMemo(
    () => (analytics ? Math.max(...analytics.byWeekday.map((d) => d.count), 0) : 0),
    [analytics]
  )

  const handleDelete = (id: number) => {
    onDelete(id)
    setDayDetail((prev) => (prev ? { ...prev, items: prev.items.filter((c) => c.id !== id) } : prev))
  }

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading overview…
      </div>
    )
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="scroll-area h-full space-y-5 overflow-y-auto px-4 pb-6 pt-1">
        <div className="grid grid-cols-2 gap-2.5">
          <StatCard icon={<Clipboard size={15} />} label="Total clips" value={stats.total} />
          <StatCard icon={<Pin size={15} />} label="Pinned" value={stats.pinnedCount} accent />
          <StatCard icon={<FileText size={15} />} label="Text" value={stats.textCount} />
          <StatCard icon={<Image size={15} />} label="Images" value={stats.imageCount} />
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-carbon-700/70 bg-carbon-850/80 p-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-carbon-800 text-accent">
            <HardDrive size={16} />
          </div>
          <div>
            <div className="text-lg font-semibold text-zinc-100">
              {formatBytes(stats.storageBytes)}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">Stored on disk</div>
          </div>
        </div>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              Activity · last {ACTIVITY_DAYS} days
            </h3>
            <span className="font-mono text-[11px] text-zinc-600">
              {activeDays} active {activeDays === 1 ? 'day' : 'days'}
            </span>
          </div>
          <div className="flex h-28 items-end gap-[3px] rounded-xl border border-carbon-700/70 bg-carbon-850/60 p-3">
            {activity.map((a) => {
              const pct = maxCount > 0 ? (a.count / maxCount) * 100 : 0
              return (
                <button
                  key={a.day}
                  disabled={a.count === 0}
                  onClick={() => setSelectedDay(a.day)}
                  title={`${shortDay(a.day)} \u00b7 ${a.count} clip${a.count === 1 ? '' : 's'}`}
                  className="group flex h-full flex-1 items-end disabled:cursor-default"
                >
                  <div
                    className={`w-full rounded-sm transition ${
                      a.count > 0 ? 'bg-accent/70 group-hover:bg-accent' : 'bg-carbon-700/50'
                    }`}
                    style={{ height: `${Math.max(pct, a.count > 0 ? 6 : 2)}%` }}
                  />
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-600">Tap a bar to see that day's clips.</p>
        </section>

        {analytics ? (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              Habits
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              <InsightCard
                icon={<Flame size={15} />}
                label="Current streak"
                value={`${analytics.currentStreakDays} ${analytics.currentStreakDays === 1 ? 'day' : 'days'}`}
                sub={`Best: ${analytics.longestStreakDays} ${analytics.longestStreakDays === 1 ? 'day' : 'days'}`}
                accent={analytics.currentStreakDays > 0}
              />
              <InsightCard
                icon={<TrendingUp size={15} />}
                label="Avg per active day"
                value={analytics.avgPerActiveDay.toString()}
                sub="clips / day"
              />
              <InsightCard
                icon={<Calendar size={15} />}
                label="Busiest hour"
                value={busiestHour && busiestHour.count > 0 ? hourLabel(busiestHour.hour) : '—'}
                sub={busiestHour && busiestHour.count > 0 ? `${busiestHour.count} clips` : 'No data yet'}
              />
              <InsightCard
                icon={<Calendar size={15} />}
                label="Busiest day"
                value={
                  busiestWeekday && busiestWeekday.count > 0
                    ? weekdayLabel(busiestWeekday.weekday)
                    : '—'
                }
                sub={busiestWeekday && busiestWeekday.count > 0 ? `${busiestWeekday.count} clips` : 'No data yet'}
              />
            </div>
          </section>
        ) : null}

        {analytics && maxHourCount > 0 ? (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              By hour of day
            </h3>
            <div className="flex h-20 items-end gap-[2px] rounded-xl border border-carbon-700/70 bg-carbon-850/60 p-3">
              {analytics.byHour.map((h) => {
                const pct = maxHourCount > 0 ? (h.count / maxHourCount) * 100 : 0
                return (
                  <div
                    key={h.hour}
                    title={`${hourLabel(h.hour)} \u00b7 ${h.count} clips`}
                    className="group flex h-full flex-1 items-end"
                  >
                    <div
                      className="w-full rounded-sm bg-accent/50 transition group-hover:bg-accent"
                      style={{ height: `${Math.max(pct, h.count > 0 ? 4 : 1)}%` }}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {analytics && analytics.topRepeated.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              Most repeated
            </h3>
            <div className="space-y-1.5">
              {analytics.topRepeated.map((clip) => (
                <div
                  key={clip.id}
                  className="flex items-center gap-2.5 rounded-lg border border-carbon-700/70 bg-carbon-850/70 px-3 py-2"
                >
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-carbon-800 text-zinc-400">
                    {clip.type === 'image' ? <Image size={13} /> : <Copy size={13} />}
                  </div>
                  <div className="min-w-0 flex-1 truncate text-[12px] text-zinc-300">
                    {clip.type === 'image' ? 'Image clip' : clip.preview}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                    <Repeat2 size={11} />
                    {clip.copyCount}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {analytics && analytics.dedupeRatePct > 0 ? (
          <div className="rounded-xl border border-carbon-700/70 bg-carbon-850/60 p-3 text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">{analytics.dedupeRatePct}%</span> of your
            copies were re-copies of something already in your history.
          </div>
        ) : null}

        {stats.firstDay ? (
          <div className="rounded-xl border border-carbon-700/70 bg-carbon-850/60 p-3 text-xs text-zinc-400">
            Capturing since <span className="font-medium text-zinc-200">{dayLabel(stats.firstDay)}</span>
            {stats.lastDay && stats.lastDay !== stats.firstDay ? (
              <>
                {' '}
                · last clip <span className="font-medium text-zinc-200">{dayLabel(stats.lastDay)}</span>
              </>
            ) : null}
            .
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {selectedDay ? (
          <DayDetailPanel
            day={selectedDay}
            items={dayDetail?.items ?? []}
            loading={loadingDay}
            onClose={() => setSelectedDay(null)}
            onCopy={onCopy}
            onPin={onPin}
            onDelete={handleDelete}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  accent
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="rounded-xl border border-carbon-700/70 bg-carbon-850/80 p-3">
      <div
        className={`mb-2 grid h-8 w-8 place-items-center rounded-lg ${
          accent ? 'bg-accent/15 text-accent' : 'bg-carbon-800 text-zinc-400'
        }`}
      >
        {icon}
      </div>
      <div className="text-xl font-semibold text-zinc-100">{value.toLocaleString()}</div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  )
}

function InsightCard({
  icon,
  label,
  value,
  sub,
  accent
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl border border-carbon-700/70 bg-carbon-850/80 p-3">
      <div
        className={`mb-2 grid h-8 w-8 place-items-center rounded-lg ${
          accent ? 'bg-accent/15 text-accent' : 'bg-carbon-800 text-zinc-400'
        }`}
      >
        {icon}
      </div>
      <div className="text-base font-semibold text-zinc-100">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-zinc-600">{sub}</div> : null}
    </div>
  )
}
