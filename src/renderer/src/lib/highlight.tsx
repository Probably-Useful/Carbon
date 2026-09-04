import { Fragment } from 'react'

/**
 * Split text on a search query (case-insensitive) and wrap matches in a
 * highlight span. Pure string splitting on already-rendered, already-fetched
 * text; this runs once per visible card, not on the search query itself, so
 * it never touches the database and cannot affect search fetch speed.
 */
export function highlightMatches(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text

  // Escape regex special characters so a query like "a.b (c)" is matched
  // literally instead of as a pattern.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(re)
  if (parts.length === 1) return text

  return parts.map((part, i) => {
    const isMatch = i % 2 === 1
    return isMatch ? (
      <mark
        key={i}
        className="rounded-[3px] bg-accent/30 text-accent-soft px-0.5 py-0 text-inherit"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  })
}
