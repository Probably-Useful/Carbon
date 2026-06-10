import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, Settings } from '../shared/types'

const SETTINGS_FILE = () => join(app.getPath('userData'), 'carbon-settings.json')

export function loadSettings(): Settings {
  try {
    const file = SETTINGS_FILE()
    if (!existsSync(file)) return { ...DEFAULT_SETTINGS }
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    // Merge with defaults so new fields are backfilled on upgrade.
    return { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    console.error('[carbon] failed to persist settings', err)
  }
}
