# Opportunity Day reader

Unofficial, public, read-only view of SET / mai Opportunity Day sessions for credit research. It lives at `/opportunity-day/` so the Bangkok tennis page at the repository root stays a separate site.

Visitors can search and filter. There is no login, no edit control, and no writable backend.

## Proposed public URL

GitHub Pages for this repository publishes the `main` branch from the repository root. After this change is **merged to `main`** and Pages rebuilds, the reader would be at:

**https://joethangrok-ui.github.io/bangkok-tennis-courts/opportunity-day/**

That URL is not live from an unmerged pull request. This folder does not change Pages settings and does not deploy anything.

## Open locally

From the repository root:

```bash
python3 -m http.server 8080
```

Then open http://127.0.0.1:8080/opportunity-day/

The page reads `data/snapshot.json`. Opening `index.html` as a file will not load that JSON.

## What the page shows

Two tabs:

1. **Upcoming schedule** — the rolling two calendar months from today in Asia/Bangkok (UTC+7). On 7 November 2026 that window is 7 November 2026–7 January 2027.
2. **Published sessions** — captured past event pages. A replay link is created only when a card’s status is exactly `Video`. This snapshot has **zero** such cards, so nothing is labeled a replay.

The Q3/2026 PDF export runs through **4 December 2026**. Dates after that, through the end of the window, say **schedule not yet published**. They are not shown as “no events”.

## Coverage in this snapshot

Checked against the official PDF export `Event Calendar for Listed Company Presentation Q3/2026`, header and file metadata **Updated on 7 November 2026 13:31:49** Asia/Bangkok (352 occupied slots).

| Item | Count |
| --- | ---: |
| PDF schedule rows | 352 |
| PDF rows inside 7 Nov 2026–7 Jan 2027 | 330 |
| IAA analyst rows on the PDF (4–5 Nov, hidden unless requested) | 5 |
| Archive cards (search pages 1–40) | 354 |
| Cards joined to the same symbol and date | 270 |
| PDF rows with no same-day card | 85 |
| Archive cards kept separately because the date did not match a PDF row | 84 |
| Of those, dated on or after 7 Nov 2026 | 16 |
| Cards labeled Video | 0 |
| Thai legal names | 0 |
| Markets (SET / mai / LiVEx) | 0 |
| Direct presentation-file URLs | 0 |

Archive capture label: **7 November 2026, Asia/Bangkok**, with no finer clock time. The sample runs about **1 Sep 2026–4 Dec 2026**. The public search was about **944 pages** that day. This is not a complete archive.

English names are copied from cards. If a PDF row has no same-day card but another card for that symbol has one English name, the row says the name came from another card. Thai text on a card is the session title, not a company name.

Same symbol on two dates (GGC on 12 Nov and 16 Nov, INGRS on 15 Oct and 18 Nov) stays two records. Two event ids on one PDF slot (WHA on 20 Nov) both stay. Unmatched PDF rows link to the [official calendar](https://opportunity-day.setgroup.or.th/en/calendar), not to a guessed `/vdo/` id.

IAA sector-analysis and IAA theme sessions are analyst sessions. They are off the company list until “Show IAA analyst sessions” is turned on. Other symbols are not labeled LiVEx or SET or mai.

## How the dates were checked

The PDF grid was read with word positions and the drawn row borders. **TKT** sits in the Friday 27 November 2026 row, slot 11:15–12:00. Weekday headings in the PDF match the calendar dates (for example Tuesday 27 October 2026 for SCGD).

A plain fetch of three event pages shifted the **date** back by one day against those weekday headings (PTTEP, GPSC, SCGD) while the **clock time** matched the PDF slot. Those shifted dates were not used. The same kind of fetch did not return the calendar’s company grid or the search results, and a “no results” shell was not treated as an empty archive. One calendar fetch showed an earlier “Updated on 7 November 2026 01:39:20” string and still no company grid. The schedule here is the **13:31:49** PDF export.

## Refresh

There is **no hourly or automatic update**. Nothing in this folder calls the network when the page is built.

To refresh the snapshot by hand:

1. Open https://opportunity-day.setgroup.or.th/en/calendar in a normal browser. Use the site’s own Export control. Record the “Updated on” timestamp from the PDF header.
2. Replace `data/source/calendar_q3_2026.json` only with rows you can tie to that PDF: `date`, `time_slot_ict` (the seven 45-minute ICT slots), `symbol_or_title`, `is_sector_analysis`, `schedule_quarter`, `timezone`, `source`, `source_page`, `snapshot`. Keep one row per occupied cell. Do not drop a symbol because the archive lacks it. Do not merge two dates for one symbol.
3. For archive cards, render https://opportunity-day.setgroup.or.th/en/search in a browser and page with the site’s own next control. The current file is pages 1–40 only. Do not invent a private API, and do not mark a card `Video` unless the card shows that status. Blank status stays blank.
4. From `opportunity-day/` run `python3 scripts/build_snapshot.py`. The script checks the join rules and writes `data/snapshot.json`. It does not fetch.
5. Run `npm test` (Node’s built-in test runner; no packages to install).

Clock times on the page are ICT (Asia/Bangkok, UTC+7). The window is two calendar months from the viewer’s Bangkok calendar day, with month-ends clamped (31 January plus one month is 28 or 29 February, not 2 or 3 March).

## Tests

```bash
cd opportunity-day
npm test
```

Covers month-end windows, unpublished dates versus checked empty weekdays, search and filters, PDF/archive joins and duplicate sessions, refusal of unverified replay links, escaping, and a headless Chrome pass at 390×844 and 1280×900.
