# Bangkok tennis courts

Draft static directory of tennis venues in Bangkok — areas, indoor/outdoor/auto types, hours, rough prices, and booking links.

**Not live availability.** Open slots usually need LINE, phone, or login on each venue’s site. Confirm before you go.

As of: Fri 6 Nov 2026, 17:42 Asia/Bangkok

## Open locally

Open `index.html` in a browser, or from this folder:

```bash
# Python 3
python3 -m http.server 8080
# then visit http://localhost:8080
```

## GitHub Pages

1. Push this repo to `main` (or your default branch).
2. On GitHub: **Settings → Pages**.
3. **Source:** Deploy from a branch.
4. Branch: `main`, folder: `/ (root)`.
5. Save. After a minute or two, the site will be at:

**https://joethangrok-ui.github.io/bangkok-tennis-courts/**

## Contents

- `index.html` — self-contained page (filters by area + type, search, metrics table)
- No build step or framework required
