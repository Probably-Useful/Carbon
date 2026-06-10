import type { CarbonApi } from '../../preload'

declare global {
  interface Window {
    carbon: CarbonApi
  }
}

export {}
