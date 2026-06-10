import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ClipboardList } from 'lucide-react'
import { DEFAULT_SETTINGS, Settings, type ClipRecord } from '../../shared/types'
import { dayLabel } from './lib/format'
import TitleBar from './components/TitleBar'
import FilterBar, { type FilterKind } from './components/FilterBar'
import ClipCard from './components/ClipCard'
import SettingsModal from './components/SettingsModal'

export default function App() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKind>('all')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [clips, setClips] = useState<ClipRecord[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  // Wire up the capture pipeline and load existing history once on mount.
  useEffect(() => {
    window.carbon.getSettings().then(setSettings)

    const offAdd = window.carbon.onClipAdd((record) => {
      setClips((prev) => (prev.some((c) => c.id === record.id) ? prev : [record, ...prev]))
    })
    const offUpdate = window.carbon.onClipUpdate((record) => {
      setClips((prev) => [record, ...prev.filter((c) => c.id !== record.id)])
    })
    const offOpened = window.carbon.onOpened(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })

    // Load the full history after listeners are attached so nothing is missed.
    window.carbon.getClips().then((all) => {
      setClips((prev) => {
        // Merge any clips that arrived between attach and load, de-duped by id.
        const ids = new Set(all.map((c) => c.id))
        const extra = prev.filter((c) => !ids.has(c.id))
        return [...extra, ...all]
      })
    })

    return () => {
      offAdd()
      offUpdate()
      offOpened()
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clips.filter((c) => {
      if (filter === 'text' && c.type !== 'text') return false
      if (filter === 'image' && c.type !== 'image') return false
      if (filter === 'pinned' && !c.pinned) return false
      if (q) {
        if (c.type === 'text') return (c.text ?? '').toLowerCase().includes(q)
        return false
      }
      return true
    })
  }, [clips, query, filter])

  const groups = useMemo(() => {
    const pinned = filtered.filter((c) => c.pinned)
    const rest = filtered.filter((c) => !c.pinned)
    const byDay = new Map<string, ClipRecord[]>()
    for (const c of rest) {
      const arr = byDay.get(c.day) ?? []
      arr.push(c)
      byDay.set(c.day, arr)
    }
    const dayGroups = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
    return { pinned, dayGroups }
  }, [filtered])

  const handleCopy = (clip: ClipRecord) => {
    window.carbon.writeClip({
      type: clip.type,
      text: clip.text,
      dataUrl: clip.dataUrl,
      width: clip.width,
      height: clip.height,
      createdAt: clip.createdAt,
      hash: clip.hash
    })
  }

  const handlePin = (clip: ClipRecord) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, pinned: c.pinned ? 0 : 1 } : c))
    )
    window.carbon.pinClip(clip.id)
  }

  const handleDelete = (id: number) => {
    setClips((prev) => prev.filter((c) => c.id !== id))
    window.carbon.deleteClip(id)
  }

  const handleClearAll = () => {
    setClips([])
    window.carbon.clearClips()
  }

  const isEmpty = filtered.length === 0

  return (
    <div className="carbon-texture flex h-full flex-col overflow-hidden rounded-xl border border-carbon-700/70 bg-carbon-900 text-zinc-100">
      <TitleBar
        query={query}
        onQuery={setQuery}
        onOpenSettings={() => setShowSettings(true)}
        searchRef={searchRef}
      />

      <FilterBar active={filter} onChange={setFilter} count={filtered.length} />

      <div className="scroll-area flex-1 overflow-y-auto px-4 pb-6">
        {isEmpty ? (
          <EmptyState hasQuery={query.length > 0} />
        ) : (
          <div className="space-y-5">
            {groups.pinned.length > 0 ? (
              <Section title="Pinned">
                <AnimatePresence initial={false}>
                  {groups.pinned.map((clip) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      onCopy={handleCopy}
                      onPin={handlePin}
                      onDelete={handleDelete}
                    />
                  ))}
                </AnimatePresence>
              </Section>
            ) : null}

            {groups.dayGroups.map(([day, items]) => (
              <Section key={day} title={dayLabel(day)}>
                <AnimatePresence initial={false}>
                  {items.map((clip) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      onCopy={handleCopy}
                      onPin={handlePin}
                      onDelete={handleDelete}
                    />
                  ))}
                </AnimatePresence>
              </Section>
            ))}
          </div>
        )}
      </div>

      {showSettings ? (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSettingsChange={setSettings}
          onClearAll={handleClearAll}
        />
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="sticky top-0 z-10 -mx-4 mb-2 bg-carbon-900/95 px-4 py-1.5 backdrop-blur">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          {title}
        </h2>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-carbon-800 text-zinc-600">
        <ClipboardList size={26} />
      </div>
      <p className="text-sm text-zinc-400">
        {hasQuery ? 'No clips match your search.' : 'Nothing captured yet.'}
      </p>
      {!hasQuery ? (
        <p className="max-w-[15rem] text-xs leading-relaxed text-zinc-600">
          Copy anything — text or an image — and it will show up here, grouped by day.
        </p>
      ) : null}
    </div>
  )
}
