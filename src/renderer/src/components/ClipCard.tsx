import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Pin, Trash2 } from 'lucide-react'
import type { ClipRecord } from '../../../shared/types'
import { clipTime, classifyText } from '../lib/format'

interface Props {
  clip: ClipRecord
  onCopy: (clip: ClipRecord) => void
  onPin: (clip: ClipRecord) => void
  onDelete: (id: number) => void
}

export default function ClipCard({ clip, onCopy, onPin, onDelete }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    onCopy(clip)
    setCopied(true)
    setTimeout(() => setCopied(false), 1100)
  }

  const tag = clip.type === 'image' ? 'Image' : classifyText(clip.text ?? '')

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.16 }}
      onDoubleClick={handleCopy}
      className="group relative overflow-hidden rounded-xl border border-carbon-700/70 bg-carbon-850/80 p-3 transition hover:border-accent/40 hover:bg-carbon-800"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {clip.pinned ? <Pin size={12} className="text-accent" fill="currentColor" /> : null}
          <span className="rounded-full bg-carbon-700/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            {tag}
          </span>
        </div>
        <span className="font-mono text-[11px] text-zinc-500">{clipTime(clip.createdAt)}</span>
      </div>

      {clip.type === 'image' ? (
        <div className="overflow-hidden rounded-lg border border-carbon-700 bg-carbon-950">
          <img
            src={clip.dataUrl}
            alt="clipboard"
            className="max-h-44 w-full object-contain"
            draggable={false}
          />
          <div className="px-2 py-1 text-[11px] text-zinc-500">
            {clip.width} × {clip.height}px
          </div>
        </div>
      ) : (
        <p className="text-selectable max-h-32 overflow-hidden whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-200">
          {clip.text}
        </p>
      )}

      <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
        <IconButton title="Copy" onClick={handleCopy}>
          {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
        </IconButton>
        <IconButton title={clip.pinned ? 'Unpin' : 'Pin'} onClick={() => onPin(clip)}>
          <Pin size={14} className={clip.pinned ? 'text-accent' : ''} />
        </IconButton>
        <IconButton title="Delete" danger onClick={() => onDelete(clip.id!)}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </motion.div>
  )
}

function IconButton({
  children,
  title,
  onClick,
  danger
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition hover:bg-carbon-700 ${
        danger ? 'hover:text-red-400' : 'hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}
