// Convert a browser KeyboardEvent into an Electron accelerator string,
// e.g. "Control+Shift+V". Returns null until a valid combo (>=1 modifier
// plus a non-modifier key) is pressed.

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

const SPECIAL_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert'
}

export function eventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')

  const key = e.key
  if (MODIFIER_KEYS.has(key)) return null // still only modifiers held

  let mainKey: string | null = null

  if (/^[a-zA-Z]$/.test(key)) {
    mainKey = key.toUpperCase()
  } else if (/^[0-9]$/.test(key)) {
    mainKey = key
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    mainKey = key
  } else if (e.code?.startsWith('Digit')) {
    mainKey = e.code.replace('Digit', '')
  } else if (SPECIAL_KEYS[key]) {
    mainKey = SPECIAL_KEYS[key]
  }

  if (!mainKey) return null
  if (parts.length === 0) return null // require at least one modifier

  parts.push(mainKey)
  return parts.join('+')
}

/** Pretty label for display, e.g. "Ctrl + Shift + V". */
export function prettyAccelerator(accel: string): string {
  return accel
    .split('+')
    .map((p) => (p === 'Control' ? 'Ctrl' : p === 'Super' ? 'Win' : p))
    .join(' + ')
}
