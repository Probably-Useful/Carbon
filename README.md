# Carbon

An unlimited, day-by-day clipboard history for Windows. Carbon lives in your system
tray, quietly capturing everything you copy — text and images — and organizes it into
a searchable timeline grouped by day. No 25-item cap, no clearing on restart.

## Features

- Unlimited history, stored locally and forever (until you delete it yourself).
- Captures both text and images.
- Timeline grouped by day: Today, Yesterday, and every date before.
- Fast search across all your text clips.
- Pin clips you want to keep handy at the top.
- Fully reconfigurable global hotkey (default `Ctrl + Shift + V`).
- Launches at startup and runs from the tray.
- One-click copy back to the clipboard (or double-click any card).

## Tech

- Electron + electron-vite
- React + TypeScript + Tailwind CSS + Framer Motion
- Dexie (IndexedDB) for local, unlimited storage — no native modules to compile

## Develop

```bash
npm install
npm run dev
```

The window is hidden by default and opens via the tray icon or your hotkey
(`Ctrl + Shift + V`). It also auto-hides when it loses focus, like a tray panel.

> Tip: while developing, the focus-to-hide behaviour can get in the way. Open
> DevTools (the window stays open while DevTools is open) to inspect the UI.

## Build a Windows installer

```bash
npm run build:win
```

The installer is written to `dist/`.

## Auto-update via GitHub Releases

1. Create a GitHub repo and push this project.
2. In `electron-builder.yml`, set `publish.owner` and `publish.repo`.
3. Bump the `version` in `package.json`, then publish:

   ```bash
   npx electron-builder --win --publish always
   ```

   (Set a `GH_TOKEN` environment variable with a GitHub personal access token.)

Installed copies will detect and pull new releases automatically.

## Where your data lives

Carbon stores your clip data in a folder you control:

- Default: `CarbonData` inside the app's user-data directory.
- Change it any time in Settings > Storage location > Change folder. Carbon moves
  your existing history (the `clips.jsonl` index and the `images/` folder) to the new
  location automatically.

Text clips are stored in `clips.jsonl` (one JSON record per line) and images as PNG
files in `images/`. Your settings (hotkey, startup, chosen folder) live separately in
`carbon-settings.json` in the default user-data directory.

## Privacy note

Carbon records everything you copy, including passwords and other secrets, to a
local database on your machine. The data is not encrypted at rest. It never leaves
your computer. Use the Clear history option in Settings to wipe it, or delete
individual clips at any time.

## License

MIT
