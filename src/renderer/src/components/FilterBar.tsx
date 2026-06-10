export type FilterKind = 'all' | 'text' | 'image' | 'pinned'

const FILTERS: { key: FilterKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Images' },
  { key: 'pinned', label: 'Pinned' }
]

interface Props {
  active: FilterKind
  onChange: (kind: FilterKind) => void
  count: number
}

export default function FilterBar({ active, onChange, count }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              active === f.key
                ? 'bg-accent text-carbon-950'
                : 'text-zinc-400 hover:bg-carbon-700 hover:text-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <span className="font-mono text-[11px] text-zinc-600">{count}</span>
    </div>
  )
}
