# Junimo Planner

https://junimoplanner.com — a free planner and progress tracker for **Stardew Valley** and **Stardew Valley Expanded**:

- **Today**: pick the season, day, weather and time, and see which fish you can still catch, which ones bundles need, and which ones won't be back until next year. Festivals, fishing events and birthdays are flagged. **My to-do** holds your own tasks for today and plans for coming days (per farm).
- **Bundles**: three bundle sets per farm: Standard (vanilla), SVE Normal and SVE Hard, each with the JojaMart Missing Bundle. Tap items as you donate them, or mark a bundle, a room or the whole Community Center done in one click. Fish items show where and when to catch them.
- **Villagers**: birthday calendar, loved and liked gifts for 33 vanilla and 16 SVE villagers, and a gift search ("who loves Diamond?").
- **Crops**: what to plant on the chosen day — growth time (with Speed-Gro / Agriculturist), harvests left before the season ends, last day to plant, seed cost and profit per plant, for 43 vanilla and 12 SVE crops.
- **Recipes**: 107 cooking and 157 crafting recipes (vanilla + SVE) with ingredients and how to unlock each one, a cooked/crafted tick per farm, and an "ingredients for everything" checklist.
- **All fish**: all 115 catches (SVE + vanilla 1.6) with filters.
- **Map**: the valley map with fish per spot, for every fish or only the ones you haven't caught.
- **Farms**: keep separate progress for each save file (new, rename, delete in the header).
- **Backup**: download a backup of all farms, restore one, or paste a progress code.

Progress is saved in each visitor's own browser (`localStorage`). Signing in with Google is optional: it also keeps the progress in [Supabase](https://supabase.com), so it syncs across devices. Setup steps are in [supabase/SETUP.md](supabase/SETUP.md). The site doesn't track anyone.

## How it's built

Plain HTML, CSS and JavaScript, with no build step and no dependencies.

```
index.html          page shell + navigation
css/style.css       all styles (light + dark theme)
js/app.js           the whole app: storage, Today, Bundles, Fish, Map, Backup
js/cloud.js         optional Google sign-in + cloud sync (Supabase)
js/config.js        Supabase project URL + public key (empty = sign-in off)
supabase/           database table + setup guide
data/fish.json      fish: seasons, times, weather, locations
data/villagers.json birthdays + gift tastes
data/recipes.json   cooking + crafting recipes, unlock sources, sprite index
data/crops.json     crop seasons, growth/regrowth days, seed shops and prices, sell prices
data/bundles.json   bundle sets (vanilla, SVE Normal, SVE Hard) and their items
img/                fish + item sprites and the valley map
```

To change data (for example a fish's location), edit the JSON files. The page reads them on load.

When you publish changes, bump the `?v=` number on `js/app.js` and `css/style.css` in `index.html` (and `privacy.html`). The data files reuse the same number automatically, so visitors' browsers load the new version instead of an old saved copy.

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
