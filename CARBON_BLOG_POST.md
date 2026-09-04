# I Was Losing My Train of Thought Every Day at Work — So I Built My Own Clipboard

## How a small annoyance turned into a real lesson on databases, indexes, and why "it works on my machine" isn't the same as "it works at scale"

---

### The problem nobody talks about

If you work on a computer all day, you copy-paste constantly. A snippet from a doc, a
value from a spreadsheet, a link from Slack, an error message from your terminal. It's
such a small, invisible action that you don't even think about it — until the moment
you *need* something you copied ten minutes ago, and it's gone.

Windows has a built-in clipboard history (`Win + V`), and it's fine for casual use. But
it has a hard limit of 25 items, and it's not really "yours" — it clears on restart,
it's not searchable in any serious way, and it's really just meant for quick, short-term
use. For someone who copies constantly throughout the day — code, notes, links,
screenshots — 25 slots disappear in about twenty minutes. I kept losing things I needed
and having to go dig them back up from wherever they originally came from, breaking my
focus every time.

That's really the whole origin story. I didn't set out to build a "database project."
I wanted a clipboard that never forgot anything, so I never had to lose momentum again.
So I sat down and built one from scratch, called it **Carbon**, and it lived quietly in
my system tray, capturing everything I copied — text and images — into a searchable
history grouped by day.

It worked great. Until it didn't.

---

### Version 1: Simple, and simply not built for scale

The first version of Carbon was intentionally simple. Here's roughly how it worked
under the hood, in plain terms:

- Every time you copied something, Carbon wrote it down as one line in a plain text
  file (a format called **JSONL**, basically one JSON record per line — think of it
  like a diary where each entry is its own line).
- When you opened the app, Carbon read that *entire file* into memory, all at once,
  as one big list.
- When you searched, it looped through that entire list in memory, checking every
  single item to see if it matched.
- Every time you added, deleted, or pinned something, it rewrote the *entire file*
  back to disk.

For the first few weeks, this was invisible. A few hundred clips, no problem — it's
like keeping your grocery list on a sticky note. But I use this thing constantly, and
clipboard history is one of those things that only ever grows. A few months in, I had
thousands of clips. And that's when I started to feel it: the app took longer to open,
scrolling got choppy, and searching had a noticeable delay before results showed up.

The sticky note had become a phone book, and I was still trying to read the whole thing
top to bottom every time I needed one number.

---

### Why "just load everything" breaks down

Here's the part I think is genuinely interesting, even if you've never touched a
database before.

Imagine your bookshelf has 20 books. If someone asks "do you have anything by this
author," you can just glance across all 20 spines and answer in two seconds. That's
what my search was doing — glancing across every single clip, one by one, in memory.

Now imagine that bookshelf has 100,000 books, and you can only glance at them one at a
time. Same technique, same "just look at everything" strategy — except now it takes
forever. This is the core issue: an approach that feels instant at small scale can
become painfully slow at large scale, and it's not because anything broke. It's because
the method itself doesn't scale. It was doing the same amount of *work per clip* as the
history grew, and the history was always growing.

Same story with saving. Rewriting the *entire file* on every single edit is fine when
the file is small. But once you have tens of thousands of entries, rewriting the whole
thing every time you copy one new thing is like reprinting an entire book because you
added one sentence to it.

I realized the fix wasn't "make the loop faster." The fix was to stop looping through
everything in the first place.

---

### Rebuilding it: bringing in a real database

This is where I brought in **SQLite** — a real, proper database engine, just one that
lives in a single file on your computer instead of running as a separate server. Think
of it as swapping my "one big diary file" for an actual filing cabinet with labeled
folders, alphabetized, cross-referenced, ready to jump straight to what you need instead
of reading every page.

But just moving to a database doesn't automatically fix things — you have to use it
correctly. Here's what actually made the difference, explained simply:

**1. Indexes — a library card catalog for your data**

A database index is exactly like the old card catalog at a library. Without one, if you
want "every book published in 2020," a librarian would have to walk every single shelf
checking every book's copyright page. With an index sorted by year, they walk straight
to the right drawer. I built indexes sorted by the way people actually use Carbon —
newest clips first, pinned clips separate from the rest, by type (text vs. image) — so
the database could jump straight to what it needed instead of scanning everything.

**2. Full-text search (FTS5) — a search engine, not a scanner**

For search specifically, I used a feature of SQLite called FTS5 (Full-Text Search). This
is genuinely the same underlying idea behind Google's search box: instead of reading
every document every time you search, you build a separate index ahead of time — for
every word, a list of exactly which documents contain it. Searching becomes "look up
this word in the index" instead of "read every clip and check if it matches."

**3. The bug I almost shipped: the "common word" trap**

Here's something I only caught because I actually stress-tested this properly instead
of assuming it worked. I generated **one million** fake clips (an intentionally extreme
test — most real users will have thousands, not millions) and searched for a word that
appeared in roughly 60% of them. It took over 600 milliseconds. Slow. Searching for a
*rare* word was instant.

That inconsistency was the clue. It turned out SQLite's search index, by default, has to
scan its entire dictionary of known words to figure out "which words start with these
letters" before it can even start searching — like flipping through an entire card
catalog to find the right drawer, every single time, instead of the catalog itself
being organized by exact prefixes.

The fix was to pre-build that prefix lookup ahead of time — essentially pre-labeling the
catalog drawers by every possible starting fragment (2 letters, 3 letters, up to 10),
so finding the right drawer became instant instead of a full scan. After that fix, the
same "worst case" search that took 600+ milliseconds dropped to **3 milliseconds** — and
stayed that fast no matter how common or rare the word was. That's roughly a 200x
improvement, and it came from understanding *why* something was slow, not just
guessing at fixes.

**4. Pagination — reading one page at a time, not memorizing the whole book**

The other big change: Carbon used to load your *entire* clip history into memory the
moment you opened the app. I changed this to load just the newest 60 clips, and quietly
fetch the next 60 only as you scroll further down — the same pattern almost every app
with a long feed uses (think Instagram or Twitter's endless scroll). This is called
**pagination**, and specifically I used a style called **keyset pagination** — instead
of saying "give me items 5,000 to 5,060" (which forces the database to count past the
first 5,000), you say "give me the next 60 items older than this exact timestamp." The
second approach stays equally fast whether you're on page 1 or page 5,000, because the
database can jump straight there using the index instead of counting.

**5. Only rendering what's on screen**

Even with the data loading fast, I found the on-screen list itself would still get
sluggish with thousands of clips, because the app was creating a visual card for
*every single one*, even the ones off-screen that you couldn't see. I fixed this with a
technique called **virtualization**: only the clips actually visible in your current
scroll position get turned into real, on-screen elements. Scroll further, and the ones
that leave view get recycled. Scrolling through 100,000 clips now costs the same as
scrolling through 20, because the screen never has more than a screenful of things
drawn at once.

---

### How I actually tested it (not just "trust me")

I didn't want to just assume these fixes worked — I wanted proof, with real numbers.
So I wrote small scripts that generated large amounts of fake clip data (up to a
million clips, deliberately more than any real user would likely ever hit) and
timed everything: opening the app, scrolling, searching for common words vs. rare
words, filtering by date, and so on — before and after each change.

That testing process is actually what caught the prefix-index bug above. Without
deliberately testing an extreme, unrealistic worst case, that bug would have shipped
quietly and only shown up for someone with a genuinely large history, probably months
later, and I'd have had no idea why.

I also used a SQLite feature called `EXPLAIN QUERY PLAN`, which is basically asking the
database "how are you actually planning to answer this question?" — it tells you
whether it's using an index (fast) or scanning everything (slow), which took the
guesswork out of whether a fix actually worked or just felt like it should.

---

### The features that came out of really understanding the data

Once the storage and search were solid, I realized I now had something more valuable
than just "clips" — I had a genuine, queryable history of my own behavior. So I added a
dashboard:

- **What time of day and day of the week I copy the most** — turns out patterns emerge
  once you can actually look.
- **Streaks** — how many consecutive days I've used it, and my longest streak.
- **Most repeated clips** — content I copy over and over (which quietly told me a lot
  about which snippets I *should* just save somewhere permanent).
- **Click into any day** on the activity chart to see exactly what I copied that day.

None of this needed scanning through raw clip text — it's all fast, aggregate
questions the database can answer directly from its indexes, the same way asking a
librarian "how many books did we get in March" doesn't require reading every book.

I also added inline **highlighting** of your search term inside results, so you can
see exactly why something matched.

---

### Packaging it up

The last step was turning this from "a project I run with a dev command" into
something installable — a real Windows application. I used a tool called
**electron-builder** to bundle the whole app — the interface, the database engine,
everything — into a single installer file. Double-click it, and it installs like any
other Windows app: Start Menu shortcut, desktop icon, runs quietly from the tray, and
starts automatically when Windows boots. No one installing it needs to know or care
that there's a database and a search engine humming along underneath.

---

### The one place I brought in outside help: polishing the UI

Everything above — the storage engine, the indexes, the search fix, the pagination,
the virtualization, the analytics, the packaging — I built by hand, one piece at a
time, understanding each decision as I made it. That part mattered to me. I wanted to
actually know *why* something was slow before I called it fixed, not just paste a
solution and hope.

Where I did lean on a tool was right at the end, purely for visual polish. Once the
engineering was solid, I used **Antigravity** to help refine the interface — things
like cleaning up a date-range filter that had grown cramped as I bolted on more
features, tightening spacing, and making the whole thing feel more like a finished
product instead of a functional prototype. That's a UI pass, not an architecture
decision — the data model, the query design, the performance work, all of that came
first and came from actually sitting with the problem.

---

### What I actually learned from this

The honest takeaway isn't "I'm a database expert now." It's something more useful:
**the way you store and access data is a design decision, not an implementation
detail** — and it's invisible right up until the moment your data outgrows the
assumptions you made on day one.

Version 1 of Carbon wasn't *wrong*. It was the right amount of engineering for what it
needed to be at the time. But "works well with a few hundred records" and "works well
with a hundred thousand records" are genuinely different problems, and the only way I
actually caught that gap — rather than just hoping it was fine — was by deliberately
trying to break it with more data than I thought I'd ever realistically have, and
measuring, not guessing.

That's the whole story: a personal annoyance, a simple fix, a fix that stopped being
simple as it grew, and the process of figuring out exactly why — and proving the
second fix actually worked before trusting it.

---

*Carbon is a personal project — a clipboard manager that never forgets, built because
I got tired of losing my train of thought. If you've ever wished your clipboard
remembered more than the last 25 things, you know exactly the itch this scratched.*
