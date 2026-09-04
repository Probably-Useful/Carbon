import { LayoutDashboard, List, Minus, Search, Settings, X } from 'lucide-react'

export type View = 'timeline' | 'dashboard'

interface Props {
  view: View
  onView: (view: View) => void
  query: string
  onQuery: (value: string) => void
  onOpenSettings: () => void
  searchRef: React.RefObject<HTMLInputElement>
}

export default function TitleBar({
  view,
  onView,
  query,
  onQuery,
  onOpenSettings,
  searchRef
}: Props) {
  return (
    <header className="drag flex flex-col gap-3 border-b border-carbon-700/60 bg-carbon-900/80 px-4 pb-3 pt-3 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-accent to-accent-soft text-[13px] font-bold text-carbon-950 shadow-glow">
            C
          </div>
          <span className="text-sm font-semibold tracking-wide text-zinc-100">Carbon</span>
        </div>
        <div className="no-drag flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition hover:bg-carbon-700 hover:text-zinc-100"
            title="Settings"
          >
            <Settings size={15} />
          </button>
          <button
            onClick={() => window.carbon.minimizeWindow()}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition hover:bg-carbon-700 hover:text-zinc-100"
            title="Minimize"
          >
            <Minus size={15} />
          </button>
          <button
            onClick={() => window.carbon.hideWindow()}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition hover:bg-red-500/80 hover:text-white"
            title="Close to tray"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="no-drag flex rounded-lg bg-carbon-850 p-0.5 text-xs font-medium">
        <NavButton
          active={view === 'timeline'}
          onClick={() => onView('timeline')}
          icon={<List size={13} />}
          label="Timeline"
        />
        <NavButton
          active={view === 'dashboard'}
          onClick={() => onView('dashboard')}
          icon={<LayoutDashboard size={13} />}
          label="Dashboard"
        />
      </div>

      {view === 'timeline' ? (
        <div className="no-drag relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search your clipboard history…"
            className="text-selectable w-full rounded-lg border border-carbon-700 bg-carbon-850 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-accent/60 focus:shadow-glow"
          />
        </div>
      ) : null}
    </header>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition ${
        active
          ? 'bg-accent text-carbon-950'
          : 'text-zinc-400 hover:bg-carbon-700 hover:text-zinc-200'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
