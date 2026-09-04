# Carbon — Project Documentation

**An unlimited, day-by-day clipboard history app for Windows.**
Version 1.0.0 · Built with Electron + React + TypeScript + SQLite

This document covers everything done on this project: what it is, how it's built, every
optimization made and why, how to install it, and how to rebuild/republish it.

---

## 1. What Carbon Does

Carbon lives in the Windows system tray and silently records everything you copy —
text and images — into a local, unlimited, searchable history. No 25-item clipboard
cap, nothing cleared on restart.

**Core features:**
- Unlimited local history (text + images), stored forever until you delete it
- Timeline grouped by day (Today, Yesterday, then calendar dates)
- Fast full-text search across all captured text
- Pin clips to keep them at the top
- Global hotkey (default `Ctrl+Shift+V`) to open/close the panel from anywhere
- Runs from the tray, launches at Windows startup, auto-hides on focus loss
- One-click copy back to clipboard (or double-click a card)
- A Dashboard tab with usage analytics (see §4)
- Configurable storage location; auto-update support via GitHub Releases

**Privacy note:** Carbon records everything copied, including passwords and secrets,
into a local, unencrypted database. Nothing leaves the machine. Data can be wiped
from Settings at any time.

---

## 2. Tech Stack & Architecture

| Layer | Technology |
|---|---|
| Shell | Electron 31 |
| Build tooling | electron-vite, Vite, electron-builder |
| UI | React 18 + TypeScript + Tailwind CSS + Framer Motion |
| List virtualization | react-window |
| Storage | better-sqlite3 (SQLite), with FTS5 for full-text search |
| Icons | lucide-react |
| Auto-update | electron-updater (GitHub Releases) |

### Process structure (standard Electron 3-process model)

```
src/
  main/           Node.js process: tray, global hotkey, clipboard polling,
                   SQLite access, IPC handlers, window lifecycle
    index.ts        App entry point, all IPC channel registration
    clipStore.ts     All SQLite schema, queries, and data access logic
    store.ts         Settings persistence (carbon-settings.json)

  preload/        Bridge script exposing a typed `window.carbon` API to the
                   renderer via contextBridge (no direct Node access from UI)
    index.ts

  renderer/       The React UI (runs in a sandboxed Chromium window)
    src/
      App.tsx              Root component: state, data fetching orchestration
      components/
        TitleBar.tsx         Window drag region, view switch, search input
        FilterBar.tsx        All / Text / Images / Pinned filter chips
        DateFilterBar.tsx    Date-range filter (redesigned, see §5.5)
        VirtualTimeline.tsx  Virtualized clip list (see §5.2)
        ClipCard.tsx         Individual clip card (copy/pin/delete, highlighting)
        Dashboard.tsx        Analytics + activity chart (see §4)
        DayDetailPanel.tsx   Day drill-down panel (see §4.2)
        SettingsModal.tsx    Hotkey, storage location, delete-by-range, clear all
      lib/
        useClipFeed.ts       Pagination/data-fetching hook (see §5.1)
        highlight.tsx        Search-term highlighting (see §5.6)
        format.ts            Date/time/byte formatting helpers
        hotkey.ts            Keyboard-event to Electron accelerator mapping

  shared/
    types.ts        All TypeScript types shared across main/preload/renderer
    day.ts          Day-key (YYYY-MM-DD) helper functions
```

### Data flow

1. `main/index.ts` polls the OS clipboard on an interval (default 800ms) via
   Electron's `clipboard` module.
2. On a new/changed value, it hashes the content (MD5) to detect duplicates,
   then calls `clipStore.addClip()`.
3. `clipStore.ts` writes to a local SQLite database (`carbon.db`), maintaining
   a full-text search index (FTS5) via triggers.
4. The renderer never talks to SQLite directly — everything goes through
   IPC (`ipcMain.handle` / `ipcRenderer.invoke`) with typed request/response
   shapes defined in `shared/types.ts`.
5. New clips are pushed to the renderer live via `webContents.send` events
   (`clip:add`, `clip:update`) rather than the renderer polling.

### Where data lives

- Default: `<AppData>\Roaming\carbon\CarbonData\` (Windows `userData` path)
- Configurable in Settings → Storage location → Change folder (moves existing
  data automatically)
- Contents: `carbon.db` (SQLite database), `images/` (PNG files for image clips)
- Settings (hotkey, startup, storage path) live separately in
  `<AppData>\Roaming\carbon\carbon-settings.json`
- A `CARBON_DATA_DIR` environment variable can override the data directory for
  testing without touching saved settings

---

## 3. Performance Work: Why and What Changed

The original prototype loaded the *entire* clip history into memory and into
the DOM on every launch, and its search implementation had a latency problem
that scaled with how common the search term was rather than staying constant.
Both were identified and fixed with real benchmarking (up to **1,000,000
synthetic clips / 427 MB database** — a deliberately extreme worst case; most
real users will have hundreds to low thousands of clips).

### 3.1 Search: from O(matches) to O(1)

**Problem found:** SQLite's FTS5 full-text index, without a prefix index, has
to scan its *entire term dictionary* to resolve a prefix query like
`"error"*`. On a large corpus this cost hundreds of milliseconds *per
keystroke* and got worse the more history existed and the more common the
search term was — the exact "lag as data scales" failure mode.

**Fixes applied (in `clipStore.ts`):**
1. **FTS5 prefix index** — added `prefix='2 3 4 5 6 7 8 9 10'` to the virtual
   table definition, precomputing indexes for term lengths 2–10. This turns a
   dictionary scan into a direct index lookup.
2. **Capped candidate search** — search now selects the newest N (3000) FTS
   matches *before* joining/sorting/paginating, rather than materializing and
   sorting every match first. This keeps the query cost bounded regardless of
   how many rows match.
3. **Keyset pagination for search results** — results page using
   `(created_at, id)` cursors instead of `OFFSET`, so scrolling further into
   results never gets slower.
4. **Automatic one-time migration** — existing databases (created before the
   prefix index existed) are detected via their stored schema SQL and
   silently rebuilt on first launch after upgrade. Verified this runs exactly
   once and doesn't repeat.

**Verified results (1,000,000-row database, real benchmarks):**

| Scenario | Before | After |
|---|---|---|
| Search a word matching 60% of all rows (worst case) | 617 ms | **3 ms** |
| Search the most common word in the corpus | 471 ms | **4 ms** |
| Search a rare word | 112 ms | **6 ms** |
| Search on a 300K-row dataset (earlier pass) | 355–669 ms | 20–23 ms |

Write/insert latency (what happens on every clipboard copy) was also measured
and is unaffected — sub-millisecond per insert, confirmed directly, since each
insert only touches its own small set of prefix terms, not the whole
dictionary.

### 3.2 Timeline loading & rendering

**Problem found:** `getAll()` loaded every clip (text + metadata) into memory
and the renderer mounted a DOM node (with Framer Motion animation) for every
single clip, with no virtualization. At real "unlimited history" scale this
would freeze the UI on launch and while scrolling.

**Fixes applied:**
1. **Keyset-paginated backend queries** (`getPage`, `searchPage` in
   `clipStore.ts`) — fetch one page (60 clips) at a time using a
   `(created_at, id)` cursor, backed by composite covering indexes
   (`idx_clips_pinned_created`, `idx_clips_type_pinned_created`). Fetching any
   page is an indexed range scan bounded by page size — page 1 and page 5,000
   cost the same, unlike `OFFSET`-based pagination which slows down the
   deeper you scroll.
2. **List virtualization** (`VirtualTimeline.tsx`, using `react-window`) —
   only the clips actually visible in the viewport (plus a small overscan
   buffer) are ever mounted as DOM nodes. Scrolling through thousands of clips
   costs the same as scrolling through a few dozen.
3. **Infinite scroll** — a sentinel row at the end of the virtualized list
   triggers loading the next page automatically as it scrolls into view.
4. **Lazy image loading** (already present, kept) — image bytes are fetched
   on demand via `IntersectionObserver` only when a card scrolls into view,
   not loaded up front.
5. **Pinned clips excluded from pagination** — pinned is a deliberately small,
   curated set always loaded in full (`getPinned()`), separate from the
   unbounded day-grouped feed.

### 3.3 Database schema & query optimizations

- **Composite covering indexes** on `(pinned, created_at DESC, id DESC)` and
  `(type, pinned, created_at DESC, id DESC)` so the exact WHERE + ORDER BY
  pattern used everywhere (timeline, search, filters) is served directly by
  an index, never a full table scan or a temp b-tree sort.
- **Date-range filters** query against the indexed `created_at` column
  (converted from day-keys via `dayStartMs`/`dayEndMs` in `shared/day.ts`)
  instead of the separate text `day` column, so range filters reuse the same
  indexes as sorting.
- **Single-pass aggregate query for dashboard stats** — `getStats()` computes
  all four counts (total/text/image/pinned) plus min/max day span in one
  query instead of five separate `COUNT(*)` queries, roughly halving cost at
  scale.
- **Tuned SQLite pragmas** — `journal_mode=WAL`, `synchronous=NORMAL`,
  `cache_size=-32000` (32 MB page cache), `temp_store=MEMORY` (keeps sort/
  group scratch space off disk).
- **Fast, index-only count queries** — `countMatches()` (filter bar badge) and
  `countRange()` (delete-by-range preview) never scan clip text, only counts
  via covering indexes.
- **Partial index for re-copy tracking** — `idx_clips_copy_count` only
  indexes rows where `copy_count > 1`, keeping it tiny even across a huge,
  mostly-copied-once history.

All of the above were validated with `EXPLAIN QUERY PLAN` to confirm SQLite is
actually using the intended indexes, not falling back to scans, at every
stage of this work.

---

## 4. New Analytics & Dashboard Features

### 4.1 Usage analytics (`getAnalytics()` in `clipStore.ts`)

All computed via cheap, indexed aggregate queries — deliberately avoiding
anything that scans clip text, so this stays fast at any history size.

- **Busiest hour of day** — clip counts bucketed by local hour (0–23) via
  SQLite's `strftime(..., 'localtime')`
- **Busiest day of week** — same, bucketed by weekday
- **Capture streaks** — current and longest run of consecutive days with at
  least one clip (computed in JS over the small, one-row-per-active-day list)
- **Most repeated clips** — a `copy_count` column increments every time
  identical content is re-copied; surfaced as a ranked "Most repeated" list
  with preview text
- **Dedupe rate** — percentage of copy events that were repeats of existing
  content vs. genuinely new
- **Average clips per active day**

### 4.2 Day-detail drill-down

Clicking any bar in the dashboard's 30-day activity chart opens a slide-over
panel (`DayDetailPanel.tsx`) showing every clip captured that day (pinned
first), with the same copy/pin/delete actions as the main timeline. Backed by
`getDayDetail()` — a single indexed query, since one day's clips are always a
small, bounded set.

### 4.3 Search highlighting

Matched search terms are highlighted inline in clip cards using a `<mark>`
wrapper (`lib/highlight.tsx`). This is pure client-side string splitting on
already-rendered, already-fetched text — it runs once per visible card after
data arrives and cannot affect search fetch speed.

### 4.4 Date filter redesign

Replaced the original cramped inline native date inputs with a single pill
button showing a human-readable label ("All time", "Last 7 days", a specific
range) that expands into a floating panel with quick presets (Today, 7d, 30d,
This month) plus a custom range picker (`DateFilterBar.tsx`).

---

## 5. Renderer Architecture Details

### 5.1 `useClipFeed` hook (`lib/useClipFeed.ts`)

Drives the non-pinned clip feed (timeline or search) with keyset pagination.
Only one page is ever held in memory at a time; `loadMore()` fetches the next
page using the cursor returned by the previous one. A generation counter
guards against race conditions if filters/search change while a fetch is in
flight (e.g. typing quickly, switching filters mid-load) — stale responses are
dropped instead of clobbering newer results.

### 5.2 `VirtualTimeline` component

Flattens pinned clips, day-group headers, and clip cards into a single
indexable row list (`TimelineRow[]`), which is what makes virtualization
possible — `react-window`'s `List` needs one flat sequence to mount only
on-screen rows. Row heights are measured live via `useDynamicRowHeight` since
cards vary in height (short vs. long text, images vs. text).

### 5.3 Live capture updates

New clips arrive via `clip:add`/`clip:update` IPC events. The renderer checks
whether a freshly captured clip matches the *currently active* filter/search/
date-range view before splicing it into the visible list — if it doesn't
match, it's left for the next natural page load instead of forcing a full
reload on every copy.

### 5.4 Settings & delete-by-range

`SettingsModal.tsx` fetches range counts (`countRange()`) via an async,
debounced effect against the database rather than scanning an in-memory list,
since post-pagination the renderer no longer holds the full history anyway.

---

## 6. Packaging & Building

### 6.1 Build configuration

- **`electron-builder.yml`** — defines the Windows NSIS installer target,
  app icon, and native-module handling. `better-sqlite3`'s compiled binary is
  explicitly kept outside the `asar` archive (`asarUnpack`) since native
  modules can't be loaded from inside one.
- **`electron.vite.config.ts`** — build config for the three separate bundles
  (main/preload/renderer), each with its own Vite build.
- **`scripts/generate-icons.mjs`** — generates the app icon (PNG + ICO) and
  tray icon data URL from a hand-coded pixel pattern (accent-green rounded
  square with a "C"), pure Node with no native dependencies.

### 6.2 Build commands

```bash
npm install              # install dependencies (rebuilds better-sqlite3 for Electron automatically)
npm run typecheck        # type-check main + renderer
npm run dev               # run in development (hot reload, DevTools available)
npm run build             # compile without packaging
npm run build:win         # full production build → NSIS installer in dist/
npm run build:unpack      # unpacked build only (dist/win-unpacked/), skips installer creation — faster for testing
```

### 6.3 What `npm run build:win` produces

```
dist/
  Carbon-Setup-1.0.0.exe          The installer (~80 MB) — this is what you ship
  Carbon-Setup-1.0.0.exe.blockmap  Used by electron-updater for delta updates
  latest.yml                       Update manifest, used by electron-updater
  win-unpacked/                    Unpacked app (Carbon.exe + resources) — same
                                    content the installer installs, useful for
                                    quick manual testing without installing
```

This was built and verified: the installer was generated successfully, and
the packaged `Carbon.exe` was launched standalone (no dev tooling, no
node_modules) and confirmed to run the full pipeline — tray icon, clipboard
capture, SQLite writes, image capture — with zero errors.

---

## 7. Installing Carbon

### 7.1 On this PC (or any Windows 10/11 PC)

1. Locate the installer: `dist\Carbon-Setup-1.0.0.exe`
2. Double-click it to run the installer.
3. The installer (NSIS, not "one-click") will let you:
   - Choose the install directory
   - Create a desktop shortcut (enabled by default)
   - Create a Start Menu shortcut (enabled by default)
4. Finish the install. Carbon starts automatically and minimizes to the
   system tray (bottom-right, near the clock — click the ^ arrow to see
   hidden tray icons if it's not visible immediately).
5. Press **`Ctrl+Shift+V`** anywhere to open the Carbon panel, or click its
   tray icon.
6. Carbon is configured to launch automatically at Windows startup by
   default (toggle this in Settings if you don't want that).

No other software is required — the installer bundles Electron, Node.js
runtime, and all dependencies (including the compiled SQLite binary). The
target PC does **not** need Node.js, Python, or any dev tools installed.

### 7.2 On another PC

Copy `Carbon-Setup-1.0.0.exe` to the other PC (USB drive, cloud storage, email,
etc.) and run it there — it's fully self-contained. No internet connection is
required to install or run (only needed later if you set up auto-update via
GitHub Releases, see §8).

### 7.3 Uninstalling

Use Windows Settings → Apps → Carbon → Uninstall, or run the uninstaller from
the install directory. This removes the app but does **not** delete your
clip history (`CarbonData` folder) — delete that manually if you want a full
wipe, or use Settings → Clear history before uninstalling.

### 7.4 First-run notes

- The window is **hidden by default** — this is intentional tray-app
  behavior, not a bug. Use the hotkey or tray icon to open it.
- It also auto-hides when it loses focus (clicking elsewhere), like a
  dropdown panel. To inspect the UI without it disappearing, open DevTools
  (only available in dev builds, not the packaged installer).
- If you have existing clip history from an earlier version of Carbon, the
  app will run a one-time, automatic search-index upgrade on first launch
  after installing this version (see §3.1) — this is silent and safe, and
  only happens once.

---

## 8. Publishing Updates (Auto-Update, Optional / Future)

The app already includes `electron-updater` and is configured for GitHub
Releases in `electron-builder.yml`. To enable auto-update for real:

1. Create a GitHub repository and push this project to it.
2. In `electron-builder.yml`, replace:
   ```yaml
   publish:
     provider: github
     owner: YOUR_GITHUB_USERNAME
     repo: carbon
   ```
   with your actual GitHub username/repo.
3. Bump `"version"` in `package.json` for each release.
4. Set a `GH_TOKEN` environment variable with a GitHub personal access token
   (needs `repo` scope).
5. Publish:
   ```bash
   npx electron-builder --win --publish always
   ```
   This uploads the installer, blockmap, and `latest.yml` to a GitHub
   Release automatically.

Once configured, installed copies of Carbon will detect and pull new
releases automatically without manual reinstallation.

---

## 9. Known Constraints & Fair Warnings

- **Windows only.** The tray/hotkey/startup logic and NSIS installer target
  are Windows-specific. Porting to macOS/Linux would need platform-specific
  work (different tray APIs, `.dmg`/`.AppImage` packaging, etc.) — not
  attempted here.
- **Unencrypted local storage.** Clip data (including anything sensitive
  copied, like passwords) is stored in plain SQLite on disk. This is
  documented in-app and in the README as an explicit privacy note, not an
  oversight.
- **Single-machine, no sync.** There is no cloud sync between devices; each
  installation has its own independent history.
- **Benchmarks used synthetic data.** The 1,000,000-row scale test used
  procedurally generated text with a deliberately skewed vocabulary (worst
  case for search) — not real user clipboard content, which is normally far
  less repetitive. Real-world numbers should be at least as good, likely
  better.

---

## 10. Summary of Files Changed/Added in This Project

**Backend (main process):**
- `src/main/clipStore.ts` — schema, indexes, pagination, search, analytics, migrations
- `src/main/index.ts` — IPC handlers for all new endpoints
- `src/shared/types.ts` — pagination, analytics, day-detail types
- `src/shared/day.ts` — day-key ↔ epoch-ms helpers for indexed range queries

**Bridge:**
- `src/preload/index.ts` — typed API surface matching the new backend

**Frontend (renderer):**
- `src/renderer/src/App.tsx` — rewritten for paginated feed + virtualization
- `src/renderer/src/lib/useClipFeed.ts` — new pagination hook
- `src/renderer/src/lib/highlight.tsx` — new search-highlighting utility
- `src/renderer/src/lib/format.ts` — added hour/weekday label helpers
- `src/renderer/src/components/VirtualTimeline.tsx` — new virtualized list
- `src/renderer/src/components/Dashboard.tsx` — rewritten with analytics
- `src/renderer/src/components/DayDetailPanel.tsx` — new day drill-down panel
- `src/renderer/src/components/DateFilterBar.tsx` — redesigned date filter UI
- `src/renderer/src/components/ClipCard.tsx` — added copy-count badge, highlighting
- `src/renderer/src/components/SettingsModal.tsx` — async range-count fetching

**Packaging:**
- `dist/Carbon-Setup-1.0.0.exe` — the built, tested Windows installer
