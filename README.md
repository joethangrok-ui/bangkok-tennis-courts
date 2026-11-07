# Bangkok tennis courts

Static directory of 16 Bangkok tennis venues, plus an hourly check of public booking pages.

**This is not live court availability.** A new timestamp means the checker ran. It does not mean a court is free. Venues without a supported slot feed stay “check directly” or “availability unknown”.

## What actually updates

The checker in `scripts/refresh_availability.py` does two things, and only these:

1. **Page probe.** For sources marked `fetch_public_page`, it requests that exact public HTTPS URL and records the HTTP result, the time in Asia/Bangkok, and whether the body contained a supported record.
2. **Supported records only.**
   - OpenActive `Slot` JSON-LD with `startDate` and integer `remainingUses` becomes a slot row.
   - schema.org `openingHoursSpecification` in public JSON-LD becomes published opening hours.
   - Marketing text, the word “available”, and a page reload are ignored.

Sources marked `not_probed` (LINE, Facebook, the CSTD member app) are not contacted. `lastSuccessfulProbeAt` stays empty for them.

OnCourt’s `robots.txt` allows public pages and disallows `/api/` and `/ingest/`. The checker refuses those paths even if a URL is added later. It does not log in, message venues, or book.

Checked on 7 Nov 2026, none of the 16 venues published a supported slot feed. Curve, Simoorgh, and CV Sport Club publish schema.org opening hours on their OnCourt profiles (06:00–00:00 every day in that JSON-LD). Autoplay’s public page publishes schema.org hours of 06:00–24:00 and says booking is on LINE. Those hours are not free courts.

### What would be required for real slots

| Venue group | Blocker | Legitimate access |
| --- | --- | --- |
| Curve, Simoorgh, CV Sport | Slots load inside OnCourt. `/api/` is disallowed and undocumented for this use. | A public availability feed or API from OnCourt. |
| Le Smash | Booking grid is behind login, including the non-member entry. | Venue-published feed, or a member credential this repo will not store. |
| Crystal Sports, Dropshot | Public page has no slot list. No documented availability API was found. | A documented public feed from the venue. |
| RQ49, APF | Public pages give phone, LINE, or a description. | The venue’s own channel. |
| Olympic Club | The hotel page describes a court and a phone extension. This checker gets an AWS human-verification response (HTTP 405) and does not bypass it. | A public slot feed, or reading the page in a normal browser. |
| Cozy Tennis | The homepage that loads tells players to check LINE @cozytennis. It has no slot feed. Some requests are replaced by a bot check. | A public slot feed. This job will not solve a captcha or message LINE. |
| Troops, Autoplay, Tennistar, Passion | Booking is LINE. | A public feed. This job does not message LINE. |
| Sirisuk | Facebook. | A public feed. This job does not call Facebook. |
| Lumphini | Hourly booking is the Bangkok CSTD Smart Member app after membership. `publicspace.bangkok.go.th` is an event-permit system, not an hourly court board. | A public slot feed from Bangkok, or an authorized app API. |

Playtomic’s third-party API and Kourtiva both need operator credentials. They are not used.

## Schedule and publication

Workflow: `.github/workflows/probe-booking-sources.yml`

- Cron `17 * * * *` (UTC). That is every hour of every day, including Saturday and Sunday. The minute is 17 so the job is less likely to sit in the top-of-hour queue. GitHub can still start it late.
- The schedule runs only from the default branch. Merging this workflow to `main` is what turns it on. It also has **Run workflow** for a manual run.
- The job writes `data/availability.json`, commits it as `github-actions[bot]`, and deploys the site with `actions/upload-pages-artifact` and `actions/deploy-pages`.
- A commit made with `GITHUB_TOKEN` does **not** trigger the branch Pages build. The deploy step is what publishes the hourly result. GitHub’s docs: [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

### Setup after merge

1. **Actions permissions.** Settings → Actions → General → Workflow permissions → **Read and write permissions**. The workflow asks for `contents: write`, `pages: write`, and `id-token: write`. A read-only repository token can probe in the log and then fail the commit, so the site will not refresh.
2. **Pages source.** The site currently deploys from branch `main` / root, which is why the merge itself will publish once. For later hours, set Settings → Pages → Build and deployment → Source to **GitHub Actions**, then run **Probe booking sources** once from the Actions tab and confirm the deploy job is green. If the source stays “Deploy from a branch”, bot commits will not rebuild the live site.
3. **Stale banner.** The page treats the probe file as stale after 180 minutes. A missed or delayed hour shows “stale” instead of looking freshly checked.
4. Scheduled workflows are disabled after about 60 days without a repository commit. A successful hourly commit keeps the schedule eligible.

No repository secrets are required.

## Files

- `index.html` — directory, filters, and the source-check table
- `data/venues.json` — the original directory. Draft hours and prices are labeled as drafts.
- `data/sources.json` — which URL is probed, or why it is not
- `data/availability.json` — last probe result, written by the script
- `scripts/refresh_availability.py` — the checker
- `scripts/test_refresh_availability.py` — failure and “do not invent slots” tests

## Local

```bash
python3 scripts/test_refresh_availability.py
python3 scripts/refresh_availability.py
python3 -m http.server 8080
```

Then open `http://localhost:8080`. The probe contacts the public URLs in `data/sources.json` (about one request per second).

## Freshness rules

- `generatedAt` is when this probe file was written.
- `lastSuccessfulProbeAt` is the last HTTP 200 read of that source that was not a bot wall. A failed recheck keeps the old time and does not invent slots.
- Opening hours keep the time they were confirmed. After a failed recheck they are labeled as last published hours, not as a new reading.
- `liveAvailability` is true only when a supported feed has at least one slot with `remainingUses` > 0.
