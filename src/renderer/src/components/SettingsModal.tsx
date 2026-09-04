import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarRange, FolderOpen, HardDrive, Keyboard, Power, Trash2, X } from 'lucide-react'
import type { Settings } from '../../../shared/types'
import { eventToAccelerator, prettyAccelerator } from '../lib/hotkey'

interface Props {
  settings: Settings
  onClose: () => void
  onSettingsChange: (next: Settings) => void
  onClearAll: () => void
  /** Deletes non-pinned clips in [from, to]; resolves with the number removed. */
  onDeleteRange: (from: string, to: string) => Promise<number>
  /** Counts clips within a range (async, backed by an indexed DB query) so the
   * UI can preview the delete impact without loading the range into memory. */
  countRange: (from: string, to: string) => Promise<{ inRange: number; pinnedInRange: number }>
}

export default function SettingsModal({
  settings,
  onClose,
  onSettingsChange,
  onClearAll,
  onDeleteRange,
  countRange
}: Props) {
  const [capturing, setCapturing] = useState(false)
  const [draftHotkey, setDraftHotkey] = useState(settings.hotkey)
  const [hotkeyError, setHotkeyError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const captureRef = useRef<HTMLButtonElement>(null)

  // Delete-by-date-range state.
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [confirmingRange, setConfirmingRange] = useState(false)
  const [rangeResult, setRangeResult] = useState<string | null>(null)

  const bothSet = Boolean(rangeFrom && rangeTo)
  const [counts, setCounts] = useState({ inRange: 0, pinnedInRange: 0 })

  useEffect(() => {
    if (!bothSet) {
      setCounts({ inRange: 0, pinnedInRange: 0 })
      return
    }
    let cancelled = false
    countRange(rangeFrom, rangeTo).then((result) => {
      if (!cancelled) setCounts(result)
    })
    return () => {
      cancelled = true
    }
  }, [bothSet, rangeFrom, rangeTo, countRange])

  const deletable = Math.max(counts.inRange - counts.pinnedInRange, 0)

  const resetRange = () => {
    setRangeResult(null)
    setConfirmingRange(false)
  }

  const runDeleteRange = async () => {
    const n = await onDeleteRange(rangeFrom, rangeTo)
    setRangeResult(`Deleted ${n} clip${n === 1 ? '' : 's'}.`)
    setConfirmingRange(false)
    setRangeFrom('')
    setRangeTo('')
  }

  const [dataDir, setDataDir] = useState('')
  const [dirStatus, setDirStatus] = useState<string | null>(null)

  useEffect(() => {
    window.carbon.getDataDir().then(setDataDir)
  }, [])

  useEffect(() => {
    if (!capturing) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(false)
        return
      }
      const accel = eventToAccelerator(e)
      if (accel) {
        setDraftHotkey(accel)
        setCapturing(false)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturing])

  const applyHotkey = async () => {
    const result = await window.carbon.setHotkey(draftHotkey)
    if (result.ok) {
      setHotkeyError(null)
      onSettingsChange({ ...settings, hotkey: draftHotkey })
    } else {
      setHotkeyError(result.error ?? 'Could not register that hotkey.')
      setDraftHotkey(settings.hotkey)
    }
  }

  const toggleStartup = async () => {
    const next = { ...settings, launchAtStartup: !settings.launchAtStartup }
    await window.carbon.saveSettings(next)
    onSettingsChange(next)
  }

  const changeFolder = async () => {
    setDirStatus(null)
    const result = await window.carbon.chooseDataDir()
    if (result.canceled) return
    if (result.ok) {
      setDataDir(result.dataDir)
      onSettingsChange({ ...settings, dataDir: result.dataDir })
      setDirStatus(
        result.moved ? `Moved ${result.moved} image file(s) to the new location.` : 'Storage location updated.'
      )
    } else {
      setDirStatus(result.error ?? 'Could not change the storage folder.')
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-stretch bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="m-auto flex max-h-[92%] w-[88%] flex-col overflow-hidden rounded-2xl border border-carbon-700 bg-carbon-900 shadow-panel"
      >
        <div className="flex items-center justify-between border-b border-carbon-700 px-4 py-3">
          <span className="text-sm font-semibold text-zinc-100">Settings</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition hover:bg-carbon-700 hover:text-zinc-100"
          >
            <X size={15} />
          </button>
        </div>

        <div className="scroll-area space-y-5 overflow-y-auto p-4">
          {/* Hotkey */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Keyboard size={13} /> Global hotkey
            </div>
            <p className="mb-2 text-xs leading-relaxed text-zinc-500">
              Press this combination anywhere to open Carbon. Click the box, then press your keys.
            </p>
            <button
              ref={captureRef}
              onClick={() => {
                setCapturing(true)
                setHotkeyError(null)
              }}
              className={`flex w-full items-center justify-center rounded-lg border px-3 py-3 font-mono text-sm transition ${
                capturing
                  ? 'border-accent bg-accent/10 text-accent shadow-glow'
                  : 'border-carbon-700 bg-carbon-850 text-zinc-100 hover:border-carbon-600'
              }`}
            >
              {capturing ? 'Press keys…' : prettyAccelerator(draftHotkey)}
            </button>
            {hotkeyError ? (
              <p className="mt-2 text-xs text-red-400">{hotkeyError}</p>
            ) : null}
            {draftHotkey !== settings.hotkey ? (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={applyHotkey}
                  className="flex-1 rounded-lg bg-accent py-2 text-xs font-semibold text-carbon-950 transition hover:bg-accent-soft"
                >
                  Save hotkey
                </button>
                <button
                  onClick={() => setDraftHotkey(settings.hotkey)}
                  className="rounded-lg border border-carbon-700 px-3 py-2 text-xs text-zinc-300 transition hover:bg-carbon-700"
                >
                  Reset
                </button>
              </div>
            ) : null}
          </section>

          {/* Storage location */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <HardDrive size={13} /> Storage location
            </div>
            <p className="mb-2 text-xs leading-relaxed text-zinc-500">
              Where Carbon saves your clipboard history on disk. Changing this moves your
              existing data to the new folder.
            </p>
            <div className="mb-2 break-all rounded-lg border border-carbon-700 bg-carbon-850 px-3 py-2 font-mono text-[11px] text-zinc-300">
              {dataDir || 'Loading…'}
            </div>
            <button
              onClick={changeFolder}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-carbon-700 py-2 text-xs font-semibold text-zinc-200 transition hover:border-accent/50 hover:bg-carbon-700"
            >
              <FolderOpen size={14} /> Change folder…
            </button>
            {dirStatus ? <p className="mt-2 text-xs text-accent">{dirStatus}</p> : null}
          </section>

          {/* Startup */}
          <section className="flex items-center justify-between rounded-lg border border-carbon-700 bg-carbon-850 px-3 py-3">
            <div className="flex items-center gap-2">
              <Power size={14} className="text-zinc-400" />
              <div>
                <div className="text-sm text-zinc-100">Launch at startup</div>
                <div className="text-xs text-zinc-500">Start Carbon when Windows boots.</div>
              </div>
            </div>
            <Toggle on={settings.launchAtStartup} onClick={toggleStartup} />
          </section>

          {/* Delete by date range */}
          <section className="rounded-lg border border-carbon-700 bg-carbon-850 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <CalendarRange size={13} /> Delete by date range
            </div>
            <p className="mb-2 text-xs leading-relaxed text-zinc-500">
              Remove all clips captured between two dates. Pinned clips are always kept.
            </p>
            <div className="mb-2 flex items-center gap-1.5">
              <input
                type="date"
                value={rangeFrom}
                max={rangeTo || undefined}
                onChange={(e) => {
                  setRangeFrom(e.target.value)
                  resetRange()
                }}
                className="rounded-md border border-carbon-700 bg-carbon-900 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-accent/60"
              />
              <span className="text-[11px] text-zinc-600">–</span>
              <input
                type="date"
                value={rangeTo}
                min={rangeFrom || undefined}
                onChange={(e) => {
                  setRangeTo(e.target.value)
                  resetRange()
                }}
                className="rounded-md border border-carbon-700 bg-carbon-900 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-accent/60"
              />
            </div>
            {bothSet ? (
              <p className="mb-2 text-[11px] text-zinc-500">
                {counts.inRange} in range · {counts.pinnedInRange} pinned kept ·{' '}
                <span className="text-red-400">{deletable} will be deleted</span>
              </p>
            ) : null}
            {confirmingRange ? (
              <div className="flex gap-2">
                <button
                  onClick={runDeleteRange}
                  className="flex-1 rounded-lg bg-red-500 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
                >
                  Delete {deletable} clip{deletable === 1 ? '' : 's'}
                </button>
                <button
                  onClick={() => setConfirmingRange(false)}
                  className="rounded-lg border border-carbon-700 px-3 py-2 text-xs text-zinc-300 transition hover:bg-carbon-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingRange(true)}
                disabled={!bothSet || deletable === 0}
                className="w-full rounded-lg border border-red-500/40 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete range
              </button>
            )}
            {rangeResult ? <p className="mt-2 text-xs text-accent">{rangeResult}</p> : null}
          </section>

          {/* Danger zone */}
          <section className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-400">
              <Trash2 size={13} /> Clear history
            </div>
            <p className="mb-3 text-xs leading-relaxed text-zinc-500">
              Permanently delete every saved clip. This cannot be undone.
            </p>
            {confirmClear ? (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onClearAll()
                    setConfirmClear(false)
                  }}
                  className="flex-1 rounded-lg bg-red-500 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
                >
                  Yes, delete everything
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="rounded-lg border border-carbon-700 px-3 py-2 text-xs text-zinc-300 transition hover:bg-carbon-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="w-full rounded-lg border border-red-500/40 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/10"
              >
                Clear all history
              </button>
            )}
          </section>

          <button
            onClick={() => window.carbon.quit()}
            className="w-full rounded-lg border border-carbon-700 py-2 text-xs text-zinc-400 transition hover:bg-carbon-700 hover:text-zinc-200"
          >
            Quit Carbon
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition ${on ? 'bg-accent' : 'bg-carbon-600'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
          on ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}
