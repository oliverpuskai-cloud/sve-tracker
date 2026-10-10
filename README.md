# SVE Fish Log

A free progress tracker for **Stardew Valley Expanded**:

- **Today**: pick the season, day, weather and time, and see which fish you can still catch, which ones bundles need, and which ones won't be back until next year. Festivals and fishing events are flagged.
- **Bundles**: every standard Community Center bundle (plus the JojaMart Missing Bundle). Tap items as you donate them; fish items show where and when to catch them.
- **All fish**: all 115 catches (SVE + vanilla 1.6) with filters.
- **Map**: the valley map with fish per spot, for every fish or only the ones you haven't caught.
- **Backup**: download a backup file, restore one, or paste a progress code.

Progress is saved in each visitor's own browser (`localStorage`). There are no accounts or servers, and the site doesn't track anyone.

## How it's built

Plain HTML, CSS and JavaScript, with no build step and no dependencies.

```
index.html          page shell + navigation
css/style.css       all styles (light + dark theme)
js/app.js           the whole app: storage, Today, Bundles, Fish, Map, Backup
data/fish.json      fish: seasons, times, weather, locations
data/bundles.json   Community Center bundles and their items
img/                fish + item sprites and the valley map
```

To change data (for example a fish's location), edit the JSON files. The page reads them on load.

## Run it on your computer

The page loads its data with `fetch`, so it needs a small local server instead of double-clicking `index.html`:

```bash
python3 -m http.server 4330
```

Then open http://localhost:4330.

## Put it online

**GitHub Pages (simplest, free):** push this folder to a GitHub repository, then go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. The site appears at `https://<your-username>.github.io/<repo-name>/` after a minute or two.

**Railway:** create a new project from the GitHub repository. Railway detects a static site (an `index.html` in the root) and serves it automatically. Then add a domain under **Settings → Networking → Generate Domain**.

## Credits

Fan-made and not affiliated with ConcernedApe or FlashShifter. Sprites and the valley map © ConcernedApe; SVE sprites © FlashShifter. Data and images via [stardewvalleywiki.com](https://stardewvalleywiki.com) and [stardewvalleyexpanded.wiki.gg](https://stardewvalleyexpanded.wiki.gg). Keep the site free and non-commercial.
