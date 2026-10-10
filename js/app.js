// SVE Fish Log — plain JavaScript, no build step.
// Progress lives in localStorage under STORE_KEY; everything else is static data in /data.

const STORE_KEY = "sve-tracker:v1";
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
const SC = { Spring: "var(--sp)", Summer: "var(--su)", Fall: "var(--fa)", Winter: "var(--wi)" };

let FISH = [], ORDER = [], ROOMS = [], BY_NAME = {};
let state = load();

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- storage ----------
function load() {
  const base = { caught: [], bundles: {}, today: { season: "Spring", day: 1, rain: false, hour: "" }, prefs: { showCaught: false, qi: false, hideDone: false } };
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (v && typeof v === "object") return { ...base, ...v, today: { ...base.today, ...v.today }, prefs: { ...base.prefs, ...v.prefs } };
  } catch (e) {}
  return base;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}
const caught = () => new Set(state.caught);
function setCaught(name, on) {
  const s = caught();
  on ? s.add(name) : s.delete(name);
  state.caught = [...s];
  save();
}

// ---------- time & availability ----------
function parseHour(s) {
  const m = s.match(/(\d+)(AM|PM)/);
  return (+m[1] % 12) + (m[2] === "PM" ? 12 : 0);
}
// "6AM–11AM & 7PM–2AM" -> [[6,11],[19,26]]  (hours past midnight count as 24+)
function ranges(t) {
  if (t === "Any") return [[6, 26]];
  return t.split(" & ").map(r => {
    const [a, b] = r.split("–").map(parseHour);
    return [a, b <= a ? b + 24 : b];
  });
}
const hourLabel = h => { const x = h % 24; return (x % 12 || 12) + (x < 12 ? "AM" : "PM"); };

function availableOn(f, ctx) {
  if (!f.ss.includes(ctx.season)) return false;
  if (f.w === "Rain" && !ctx.rain) return false;
  if (f.w === "Sun" && ctx.rain) return false;
  if (f.c === "Night Market" && !(ctx.season === "Winter" && ctx.day >= 15 && ctx.day <= 17)) return false;
  if (f.c === "Legendary II" && !state.prefs.qi) return false;
  if (ctx.hour !== "" && ctx.hour != null) {
    const h = +ctx.hour;
    if (!ranges(f.t).some(([a, b]) => h >= a && h < b)) return false;
  }
  return true;
}
const nextSeason = s => SEASONS[(SEASONS.indexOf(s) + 1) % 4];
const leavesAfter = (f, season) => f.ss.includes(season) && !f.ss.includes(nextSeason(season));

// ---------- festivals & fishing events (game 1.6) ----------
const EVENTS = {
  Spring: { 13: ["Egg Festival", "Town is closed 9AM–2PM. Fish elsewhere in the morning."], 15: ["Desert Festival", "Calico Desert, 10AM–12AM. Fishing contest at the desert pond."], 16: ["Desert Festival", "Calico Desert, 10AM–12AM."], 17: ["Desert Festival", "Calico Desert, 10AM–12AM."], 24: ["Flower Dance", "Cindersap Forest is busy 9AM–2PM."] },
  Summer: { 11: ["Luau", "The Beach is closed 9AM–2PM."], 20: ["Trout Derby", "Catch Rainbow Trout in Cindersap Forest for Golden Tags."], 21: ["Trout Derby", "Catch Rainbow Trout in Cindersap Forest for Golden Tags."], 28: ["Dance of the Moonlight Jellies", "The Beach is closed 10PM–12AM."] },
  Fall: { 16: ["Stardew Valley Fair", "Town is closed 9AM–3PM. Fishing minigame at the fair."], 27: ["Spirit's Eve", "Town is closed 10PM–12AM."] },
  Winter: { 8: ["Festival of Ice", "Cindersap Forest 9AM–2PM. Ice fishing contest."], 12: ["SquidFest", "Catch Squid at the Beach for prizes."], 13: ["SquidFest", "Catch Squid at the Beach for prizes."], 15: ["Night Market", "Submarine ride 5PM–2AM: Midnight Squid, Spook Fish, Blobfish."], 16: ["Night Market", "Submarine ride 5PM–2AM."], 17: ["Night Market", "Last night of the market — last chance for the submarine fish this year."], 25: ["Feast of the Winter Star", "Town is closed 9AM–2PM."] },
};

// ---------- bundles helpers ----------
function donated(id) { return new Set(state.bundles[id] || []); }
function setDonated(b, idx, on) {
  const s = donated(b.id);
  on ? s.add(idx) : s.delete(idx);
  state.bundles[b.id] = [...s].sort((x, y) => x - y);
  const it = b.items[idx];
  if (on && it.fish) setCaught(it.n, true); // donating a fish means you've caught it
  save();
}
const bundleDone = b => donated(b.id).size >= b.need;
const allBundles = () => ROOMS.flatMap(r => r.bundles);
// fish name -> list of incomplete bundles that still want it (not yet donated)
function bundleNeeds() {
  const m = {};
  for (const b of allBundles()) {
    if (bundleDone(b)) continue;
    const d = donated(b.id);
    b.items.forEach((it, i) => { if (it.fish && !d.has(i)) (m[it.n] ??= []).push(b.name); });
  }
  return m;
}
const itemImg = it => it.fish ? BY_NAME[it.n]?.img : `img/items/${/^\d/.test(it.n) ? "gold" : slug(it.n)}.png`;

// ---------- shared fish card ----------
function card(f, opts = {}) {
  const done = caught().has(f.n), leg = f.c.startsWith("Legendary");
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-pressed", done);
  b.className = "card" + (f.s === "SVE" ? " sve" : "") + (leg ? " leg" : "") + (done ? " done" : "");
  const dots = SEASONS.map(s => `<i class="${f.ss.includes(s) ? "on" : ""}" style="--c:${SC[s]}" title="${s}"></i>`).join("");
  const tags = [
    f.s === "SVE" ? '<span class="tag sve">SVE</span>' : "",
    f.c !== "Fish" ? `<span class="tag ${leg ? "leg" : ""}">${esc(f.c)}</span>` : "",
    ...(opts.needs || []).map(n => `<span class="tag need">Bundle: ${esc(n)}</span>`),
    opts.last ? '<span class="tag last">Last chance this year</span>' : "",
    opts.wx ? '<span class="tag wx">☂ Rain day</span>' : "",
  ].join("");
  b.innerHTML = `<span class="sprite"><img alt="" loading="lazy" src="${f.img}"></span>
    <span class="nm">${esc(f.n)}<span class="tags">${tags}</span></span>
    <span class="box" aria-hidden="true">${done ? "✓" : ""}</span>
    <span class="meta"><span>🕑 ${esc(f.t)}</span><span class="w-${f.w}">${f.w === "Any" ? "Any weather" : f.w === "Rain" ? "☂ Rain only" : "☀ Sun only"}</span><span class="dots" aria-label="${f.ss.join(", ")}">${dots}</span>${f.d !== "—" ? `<span>Diff ${f.d} · ${esc(f.b)}</span>` : ""}<span>${Number(f.p).toLocaleString()}g</span></span>
    <span class="loc">${esc(f.l)}</span>${f.x ? `<span class="note">${esc(f.x)}</span>` : ""}`;
  b.onclick = () => { setCaught(f.n, !done); render(); };
  return b;
}
function timeKey(t) { return t === "Any" ? "" : t; }
const byTime = (x, y) => timeKey(x.t).localeCompare(timeKey(y.t)) || x.n.localeCompare(y.n);

function section(title, sub, items) {
  const sec = document.createElement("section");
  sec.innerHTML = `<h2>${esc(title)}${sub ? `<span>${esc(sub)}</span>` : ""}</h2><div class="grid"></div>`;
  const g = sec.querySelector(".grid");
  items.forEach(el => g.appendChild(el));
  return sec;
}

// ---------- shared conditions (season / day / weather / time) ----------
// Used by Today and Map; both read and write state.today so they stay in sync.
function conditionsHTML(ctx, p) {
  return `
    <div class="ctl"><span>Season</span><div class="seg" id="${p}-season">${SEASONS.map(s => `<button data-s="${s}" style="--c:${SC[s]}" aria-pressed="${ctx.season === s}">${s}</button>`).join("")}</div></div>
    <div class="ctl"><span>Day</span><div class="day"><button id="${p}-prev" aria-label="Previous day">−</button><input id="${p}-day" type="number" min="1" max="28" value="${ctx.day}" aria-label="Day of the season"><button id="${p}-next" aria-label="Next day">+</button></div></div>
    <div class="ctl"><span>Weather (check the TV)</span><div class="seg" id="${p}-wx"><button data-r="0" style="--c:var(--sun)" aria-pressed="${!ctx.rain}">☀ Sunny / windy</button><button data-r="1" style="--c:var(--rain)" aria-pressed="${ctx.rain}">☂ Rain / storm</button></div></div>
    <div class="ctl"><span>Time</span><select id="${p}-hour"><option value="">Whole day</option>${Array.from({ length: 20 }, (_, i) => i + 6).map(h => `<option value="${h}" ${String(ctx.hour) === String(h) ? "selected" : ""}>${hourLabel(h)}</option>`).join("")}</select></div>`;
}
function wireConditions(root, ctx, p) {
  root.querySelectorAll(`#${p}-season button`).forEach(b => b.onclick = () => { ctx.season = b.dataset.s; save(); render(); });
  root.querySelectorAll(`#${p}-wx button`).forEach(b => b.onclick = () => { ctx.rain = b.dataset.r === "1"; save(); render(); });
  const step = d => {
    let day = ctx.day + d, si = SEASONS.indexOf(ctx.season);
    if (day > 28) { day = 1; si = (si + 1) % 4; }
    if (day < 1) { day = 28; si = (si + 3) % 4; }
    ctx.day = day; ctx.season = SEASONS[si]; ctx.rain = false; save(); render();
  };
  $(`${p}-prev`).onclick = () => step(-1);
  $(`${p}-next`).onclick = () => step(1);
  $(`${p}-day`).onchange = e => { ctx.day = Math.min(28, Math.max(1, parseInt(e.target.value) || 1)); save(); render(); };
  $(`${p}-hour`).onchange = e => { ctx.hour = e.target.value; save(); render(); };
}
// Why a fish can't be caught under these conditions ("" = it can)
function whyNot(f, ctx) {
  if (!f.ss.includes(ctx.season)) return f.ss.length === 4 ? "" : "Only in " + f.ss.join(", ");
  if (f.w === "Rain" && !ctx.rain) return "Needs rain";
  if (f.w === "Sun" && ctx.rain) return "Not in the rain";
  if (f.c === "Night Market" && !(ctx.season === "Winter" && ctx.day >= 15 && ctx.day <= 17)) return "Night Market only (Winter 15–17)";
  if (f.c === "Legendary II" && !state.prefs.qi) return "Only during Qi's Extended Family quest";
  if (ctx.hour !== "" && ctx.hour != null && !availableOn(f, ctx)) return "Bites " + f.t;
  return "";
}

// ---------- TODAY ----------
function renderToday(main) {
  const ctx = state.today, got = caught(), needs = bundleNeeds();
  const avail = FISH.filter(f => availableOn(f, ctx));
  const todo = avail.filter(f => !got.has(f.n));
  const daysLeft = 28 - ctx.day;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div class="controls">
    ${conditionsHTML(ctx, "t")}
    <label class="check"><input type="checkbox" id="t-showcaught" ${state.prefs.showCaught ? "checked" : ""}> Show fish I've caught</label>
    <label class="check"><input type="checkbox" id="t-qi" ${state.prefs.qi ? "checked" : ""}> Qi's “Extended Family” quest is active</label>
  </div>
  <div class="events" id="t-events"></div>
  <div class="stats">
    <div class="stat"><b>${todo.length}</b><span>new fish you can catch ${ctx.hour !== "" ? "at " + hourLabel(+ctx.hour) : "today"}</span></div>
    <div class="stat"><b>${todo.filter(f => needs[f.n]).length}</b><span>of them still needed for bundles</span></div>
    <div class="stat"><b>${FISH.filter(f => leavesAfter(f, ctx.season) && !got.has(f.n) && f.c !== "Legendary II").length}</b><span>uncaught fish leave after ${ctx.season} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</span></div>
  </div>`;
  main.appendChild(wrap);

  // events
  const ev = $("t-events"), e = EVENTS[ctx.season]?.[ctx.day];
  const notes = [];
  if (e) notes.push(`<div class="event" style="--c:${SC[ctx.season]}"><b>${esc(e[0])}</b>${esc(e[1])}</div>`);
  if (ctx.rain) {
    const rainOnly = todo.filter(f => f.w === "Rain");
    if (rainOnly.length) notes.push(`<div class="event" style="--c:var(--rain)"><b>Rainy day</b>Go for the rain-only fish: ${rainOnly.map(f => esc(f.n)).join(", ")}.</div>`);
  }
  if (daysLeft <= 3) notes.push(`<div class="event" style="--c:var(--warn)"><b>Season ends soon</b>Fish marked “Last chance” won't be back until next year.</div>`);
  ev.innerHTML = notes.join("");

  // controls
  wireConditions(wrap, ctx, "t");
  $("t-showcaught").onchange = e => { state.prefs.showCaught = e.target.checked; save(); render(); };
  $("t-qi").onchange = e => { state.prefs.qi = e.target.checked; save(); render(); };

  // fish lists
  const shown = state.prefs.showCaught ? avail : todo;
  const opts = f => ({ needs: needs[f.n], last: leavesAfter(f, ctx.season) && f.c !== "Legendary II", wx: ctx.rain && f.w === "Rain" });
  const priority = shown.filter(f => !got.has(f.n) && (needs[f.n] || opts(f).last || opts(f).wx || f.c === "Legendary"));
  const pset = new Set(priority);
  priority.sort((a, b) => (needs[b.n] ? 2 : 0) - (needs[a.n] ? 2 : 0) || byTime(a, b));
  if (priority.length) main.appendChild(section("Catch these first", "bundle fish, last chances, rain-only and legendaries", priority.map(f => card(f, opts(f)))));

  const rest = shown.filter(f => !pset.has(f));
  const groups = {};
  for (const f of rest) (groups[f.a] ??= []).push(f);
  if (rest.length) {
    const h = document.createElement("h2");
    h.className = "subhead";
    h.style.cssText = "font-family:var(--display);font-weight:500;margin:34px 0 0";
    h.textContent = priority.length ? "Everything else you can catch" : "What you can catch";
    main.appendChild(h);
  }
  for (const a of ORDER) if (groups[a]) main.appendChild(section(a, `${groups[a].length} fish`, groups[a].sort(byTime).map(f => card(f, opts(f)))));
  if (!shown.length) main.insertAdjacentHTML("beforeend", '<p class="empty">Nothing new to catch with these settings. Try another time of day or weather.</p>');

  // non-fish bundle items in season
  const extras = [];
  for (const b of allBundles()) {
    if (bundleDone(b)) continue;
    const d = donated(b.id);
    b.items.forEach((it, i) => { if (!it.fish && !d.has(i) && it.s.includes(ctx.season)) extras.push({ it, b }); });
  }
  if (extras.length) {
    const sec = document.createElement("section");
    sec.innerHTML = `<h2>Bundle items in season<span>only available in ${ctx.season} — tick them off on the Bundles tab</span></h2><div class="chiprow">${extras.map(({ it, b }) => `<div class="ichip"><img alt="" loading="lazy" src="${itemImg(it)}"><div><b>${it.q > 1 ? it.q + " × " : ""}${it.gold ? "★ " : ""}${esc(it.n)}</b><small>${esc(b.name)} · ${esc(it.h)}</small></div></div>`).join("")}</div>`;
    main.appendChild(sec);
  }
}

// ---------- BUNDLES ----------
function renderBundles(main) {
  const ctx = state.today, all = allBundles();
  const doneCount = all.filter(bundleDone).length;
  const head = document.createElement("div");
  head.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${doneCount} / ${all.length}</b><span>bundles complete</span></div>
      ${ROOMS.map(r => `<div class="stat"><b>${r.bundles.filter(bundleDone).length} / ${r.bundles.length}</b><span>${esc(r.room)}</span></div>`).join("")}
    </div>
    <div class="controls"><label class="check"><input type="checkbox" id="b-hide" ${state.prefs.hideDone ? "checked" : ""}> Hide finished bundles</label>
    <p class="lede">Tap an item when you've put it in the bundle. Items marked <b style="color:var(--need)">TODAY</b> can be caught or found on the day set in the Today tab (${ctx.season} ${ctx.day}, ${ctx.rain ? "rain" : "sunny"}).</p></div>`;
  main.appendChild(head);
  $("b-hide").onchange = e => { state.prefs.hideDone = e.target.checked; save(); render(); };

  for (const r of ROOMS) {
    const list = r.bundles.filter(b => !(state.prefs.hideDone && bundleDone(b)));
    if (!list.length) continue;
    const sec = document.createElement("section");
    sec.innerHTML = `<h2>${esc(r.room)}<span>${r.bundles.filter(bundleDone).length} / ${r.bundles.length} done${r.room === "Abandoned JojaMart" ? " · opens after the Community Center is restored" : ""}</span></h2><div class="bgrid"></div>`;
    const grid = sec.querySelector(".bgrid");
    for (const b of list) {
      const d = donated(b.id), complete = bundleDone(b);
      const el = document.createElement("div");
      el.className = "bundle" + (complete ? " complete" : "");
      el.innerHTML = `<div class="bhead"><h3>${esc(b.name)}</h3><span class="n">${Math.min(d.size, b.need)} / ${b.need}${complete ? " ✓" : ""}</span></div>
        <p class="reward">Reward: ${esc(b.reward)}</p>${b.need < b.items.length ? `<p class="pick">Any ${b.need} of these ${b.items.length}</p>` : ""}<div class="items"></div>`;
      const items = el.querySelector(".items");
      b.items.forEach((it, i) => {
        const got = d.has(i), f = it.fish ? BY_NAME[it.n] : null;
        const today = f ? availableOn(f, ctx) : it.s.length ? it.s.includes(ctx.season) : false;
        const where = f ? `${f.l} · ${f.ss.length === 4 ? "all year" : f.ss.join(", ")} · ${f.t}${f.w !== "Any" ? " · " + (f.w === "Rain" ? "rain only" : "sun only") : ""}` : it.h + (it.s.length ? ` · ${it.s.join(", ")}` : "");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "item" + (got ? " got" : "");
        btn.setAttribute("aria-pressed", got);
        btn.innerHTML = `<img alt="" loading="lazy" src="${itemImg(it)}"><span class="in"><b>${it.gold ? '<span class="gold">★</span> ' : ""}${it.silver ? "Silver+ " : ""}${esc(it.n)}</b>${it.q > 1 ? ` <span class="qty">× ${it.q}</span>` : ""}${!got && today && !complete ? ' <span class="today">Today</span>' : ""}<small>${esc(where)}</small></span><span class="box" aria-hidden="true">${got ? "✓" : ""}</span>`;
        btn.onclick = () => { setDonated(b, i, !got); render(); };
        items.appendChild(btn);
      });
      grid.appendChild(el);
    }
    main.appendChild(sec);
  }
}

// ---------- ALL FISH ----------
const listFilter = { q: "", src: "", cat: "", hide: false, season: "All" };
function renderFish(main) {
  const needs = bundleNeeds(), got = caught();
  const bar = document.createElement("div");
  bar.innerHTML = `<div class="controls">
    <div class="ctl"><span>Season</span><div class="seg" id="f-season">${["All", ...SEASONS].map(s => `<button data-s="${s}" style="--c:${SC[s] || "var(--accent)"}" aria-pressed="${listFilter.season === s}">${s}</button>`).join("")}</div></div>
    <div class="ctl" style="flex:1 1 200px"><span>Search</span><input type="search" id="f-q" value="${esc(listFilter.q)}" placeholder="Fish or location…" style="font:inherit;padding:6px 10px;border:2px solid var(--line);border-radius:5px;background:var(--panel);color:var(--ink)"></div>
    <div class="ctl"><span>Source</span><select id="f-src"><option value="">All fish</option><option value="SVE">SVE only</option><option value="Vanilla">Vanilla only</option></select></div>
    <div class="ctl"><span>Type</span><select id="f-cat"><option value="">All types</option><option>Fish</option><option>Legendary</option><option>Legendary II</option><option>Crab Pot</option><option>Night Market</option></select></div>
    <label class="check"><input type="checkbox" id="f-hide" ${listFilter.hide ? "checked" : ""}> Hide caught</label></div>`;
  main.appendChild(bar);
  $("f-src").value = listFilter.src; $("f-cat").value = listFilter.cat;
  bar.querySelectorAll("#f-season button").forEach(b => b.onclick = () => { listFilter.season = b.dataset.s; render(); });
  $("f-q").oninput = e => { listFilter.q = e.target.value; drawList(); };
  $("f-src").onchange = e => { listFilter.src = e.target.value; drawList(); };
  $("f-cat").onchange = e => { listFilter.cat = e.target.value; drawList(); };
  $("f-hide").onchange = e => { listFilter.hide = e.target.checked; drawList(); };
  const out = document.createElement("div");
  main.appendChild(out);
  function drawList() {
    out.innerHTML = "";
    const q = listFilter.q.trim().toLowerCase();
    const list = FISH.filter(f => (listFilter.season === "All" || f.ss.includes(listFilter.season)) && (!listFilter.src || f.s === listFilter.src) && (!listFilter.cat || f.c === listFilter.cat) && (!listFilter.hide || !got.has(f.n)) && (!q || (f.n + " " + f.l + " " + f.a).toLowerCase().includes(q)));
    const groups = {};
    for (const f of list) (groups[f.a] ??= []).push(f);
    for (const a of ORDER) if (groups[a]) {
      const allHere = FISH.filter(f => f.a === a && (listFilter.season === "All" || f.ss.includes(listFilter.season)));
      out.appendChild(section(a, `${allHere.filter(f => got.has(f.n)).length} / ${allHere.length} caught`, groups[a].sort(byTime).map(f => card(f, { needs: needs[f.n] }))));
    }
    if (!list.length) out.innerHTML = '<p class="empty">No fish match these filters.</p>';
  }
  drawList();
}

// ---------- MAP ----------
const SPOTS = [
  { id: "summit", nm: "Adventurer's Summit", x: 1000, y: 40, t: l => /adventurer/.test(l) },
  { id: "mountain", nm: "Mountain Lake", x: 960, y: 262, t: l => /mountain|same spot as legend/.test(l) },
  { id: "mines", nm: "The Mines", x: 935, y: 165, t: l => /mines/.test(l) },
  { id: "diamond", nm: "Diamond Cavern", x: 1385, y: 330, t: l => /diamond cavern/.test(l) },
  { id: "highlands", nm: "The Highlands", x: 1240, y: 40, t: l => /highlands(?!\s*(cavern|ruins))/.test(l) },
  { id: "hcavern", nm: "Highlands Cavern", x: 1385, y: 130, t: l => /highlands cavern/.test(l) },
  { id: "hruins", nm: "Highlands Ruins", x: 1385, y: 230, t: l => /highlands ruins/.test(l) },
  { id: "junimo", nm: "Junimo Woods & Sprite Spring", x: 55, y: 140, t: l => /junimo woods|sprite spring/.test(l) },
  { id: "farm", nm: "The Farm", x: 490, y: 410, t: l => /\bfarm\b/.test(l) },
  { id: "secret", nm: "Secret Woods", x: 175, y: 520, t: l => /secret woods/.test(l) },
  { id: "maze", nm: "Forbidden Maze", x: 55, y: 240, t: l => /forbidden maze/.test(l) },
  { id: "swamp", nm: "Witch's Swamp", x: 55, y: 340, t: l => /witch's swamp/.test(l) },
  { id: "hench", nm: "Henchman's Backyard", x: 55, y: 440, t: l => /henchman/.test(l) },
  { id: "town", nm: "Pelican Town & river", x: 880, y: 460, t: l => /rivers|pelican town|town river|town –|crab pot – freshwater|same spot as angler/.test(l) && !/ginger/.test(l) },
  { id: "morris", nm: "Morris Property", x: 1100, y: 440, t: l => /morris/.test(l) },
  { id: "sewers", nm: "Sewers", x: 860, y: 570, t: l => /sewer/.test(l) && !/bug lair/.test(l) },
  { id: "buglair", nm: "Mutant Bug Lair", x: 720, y: 610, t: l => /bug lair/.test(l) },
  { id: "bugland", nm: "Bugland", x: 1010, y: 610, t: l => /bugland/.test(l) },
  { id: "forest", nm: "Cindersap Forest", x: 400, y: 610, t: l => /cindersap|forest pond|forest river|rivers|same spot as glacierfish/.test(l) && !/ginger/.test(l) },
  { id: "fwest", nm: "Forest West", x: 55, y: 640, t: l => /forest west/.test(l) },
  { id: "shear", nm: "Shearwater Bridge", x: 55, y: 740, t: l => /shearwater/.test(l) },
  { id: "beach", nm: "The Beach", x: 990, y: 730, t: l => /\(beach\)|beach|crab pot – ocean|same spot as crimsonfish/.test(l) },
  { id: "vineyard", nm: "Blue Moon Vineyard", x: 1230, y: 640, t: l => /vineyard/.test(l) },
  { id: "night", nm: "Night Market", x: 860, y: 820, t: l => /night market/.test(l) },
  { id: "fable", nm: "Fable Reef", x: 700, y: 905, t: l => /fable reef/.test(l) },
  { id: "ginger", nm: "Ginger Island", x: 1235, y: 775, t: l => /ginger island|volcano/.test(l) && !/pirate/.test(l) },
  { id: "pirate", nm: "Pirate Cove", x: 1370, y: 880, t: l => /pirate/.test(l) },
  { id: "desert", nm: "Calico Desert", x: 210, y: 150, t: l => /desert/.test(l) },
  { id: "badlands", nm: "Crimson Badlands", x: 420, y: 40, t: l => /badlands/.test(l) },
];
const OFFMAP = new Set(["summit", "highlands", "hcavern", "hruins", "diamond", "junimo", "maze", "swamp", "hench", "fwest", "shear", "fable", "pirate", "badlands", "vineyard", "morris", "bugland"]);
const mapState = { mode: "todo", spot: null };

function renderMap(main) {
  const got = caught(), needs = bundleNeeds(), { mode } = mapState, ctx = state.today;
  const fish = FISH.filter(f => mode === "all" || !got.has(f.n));
  const can = f => availableOn(f, ctx);
  const by = Object.fromEntries(SPOTS.map(s => [s.id, []]));
  for (const f of fish) for (const id of f.spots) by[id].push(f);
  const liveCount = fish.filter(can).length;
  const when = `${ctx.season} ${ctx.day}, ${ctx.rain ? "rain" : "sunny"}${ctx.hour !== "" ? ", " + hourLabel(+ctx.hour) : ""}`;

  const wrap = document.createElement("div");
  wrap.className = "mapwrap";
  wrap.innerHTML = `<div class="controls">
      <div class="ctl"><span>Show</span><div class="seg" id="m-mode"><button data-m="todo" aria-pressed="${mode === "todo"}">Still to catch</button><button data-m="all" aria-pressed="${mode === "all"}">Every fish</button></div></div>
      ${conditionsHTML(ctx, "m")}
    </div>
    <p class="lede"><b>${liveCount}</b> ${mode === "todo" ? "uncaught " : ""}fish ${liveCount === 1 ? "bites" : "bite"} on ${esc(when)}. Bright pictures can be caught now, faded ones can't. Tap a spot to see why and to tick fish off.</p>
    <div class="mapscroll" style="margin-top:10px"><svg viewBox="-80 0 1600 960" role="img" aria-label="Map of fishing spots">
      <rect x="-80" y="0" width="1600" height="960" fill="var(--sea)"/>
      <rect x="94" y="84" width="1244" height="764" rx="6" fill="var(--edge)"/>
      <image href="img/map.png" x="100" y="90" width="1232" height="752" class="pix" preserveAspectRatio="none"/>
      <text x="110" y="78" class="tlabel">Official valley map</text>
      <text x="1330" y="878" text-anchor="end" class="tlabel">dashed = SVE area off the vanilla map</text>
      <g id="pins"></g></svg></div>
    <p class="mapnote">The number on each spot counts the fish you can catch there right now. The background is the vanilla in-game map; SVE areas it doesn't show sit around the edge in dashed boxes.</p>
    <div id="spotpanel"></div>`;
  main.appendChild(wrap);
  wrap.querySelectorAll("#m-mode button").forEach(b => b.onclick = () => { mapState.mode = b.dataset.m; render(); });
  wireConditions(wrap, ctx, "m");

  const g = wrap.querySelector("#pins"), NS = "http://www.w3.org/2000/svg";
  for (const s of SPOTS) {
    const list = by[s.id];
    const total = FISH.filter(f => f.spots.includes(s.id)).length;
    if (!total) continue;
    const live = list.filter(can), cleared = mode === "todo" && !list.length, dim = !cleared && !live.length;
    const pin = document.createElementNS(NS, "g");
    pin.setAttribute("class", "pin" + (mapState.spot === s.id ? " sel" : "") + (cleared ? " clear" : "") + (dim ? " dim" : "") + (OFFMAP.has(s.id) ? " off" : ""));
    pin.setAttribute("tabindex", "0");
    pin.setAttribute("role", "button");
    pin.setAttribute("aria-label", `${s.nm}: ${live.length} fish catchable now`);
    // catchable fish first, then the rest faded
    const show = [...live, ...list.filter(f => !can(f))].slice(0, 3), n = show.length, w = Math.max(n * 30 + 8, 46);
    let inner = `<rect x="${s.x - w / 2}" y="${s.y - 20}" width="${w}" height="38" rx="8" class="pinbox"/>`;
    show.forEach((f, i) => { inner += `<image href="${f.img}" x="${s.x - w / 2 + 6 + i * 30}" y="${s.y - 17}" width="30" height="30" class="pix${can(f) ? "" : " off"}${got.has(f.n) ? " got" : ""}"/>`; });
    if (!n) inner += `<text x="${s.x}" y="${s.y + 6}" text-anchor="middle" class="tick">✓</text>`;
    if (!cleared) inner += `<circle cx="${s.x + w / 2}" cy="${s.y - 20}" r="12" class="badge"/><text x="${s.x + w / 2}" y="${s.y - 16}" text-anchor="middle" class="badgetxt">${live.length}</text>`;
    inner += `<text x="${s.x}" y="${s.y + 34}" text-anchor="middle" class="plabel">${esc(s.nm)}</text>`;
    pin.innerHTML = inner;
    const pick = () => {
      mapState.spot = mapState.spot === s.id ? null : s.id;
      render();
      const p = $("spotpanel");
      if (mapState.spot && p) p.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    };
    pin.addEventListener("click", pick);
    pin.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    g.appendChild(pin);
  }
  const panel = $("spotpanel");
  if (mapState.spot) {
    const s = SPOTS.find(x => x.id === mapState.spot), list = (by[mapState.spot] || []).sort(byTime);
    const live = list.filter(can), later = list.filter(f => !can(f));
    const sec = section(s.nm, `${live.length} catchable now${later.length ? ` · ${later.length} not right now` : ""}`, live.map(f => card(f, { needs: needs[f.n], wx: ctx.rain && f.w === "Rain" })));
    if (!live.length) sec.querySelector(".grid").innerHTML = `<p class="empty">${list.length ? "Nothing bites here on " + esc(when) + "." : "All caught here."}</p>`;
    panel.appendChild(sec);
    if (later.length) {
      const sec2 = section("Not right now", "change the season, weather or time to catch these", later.map(f => { const c = card(f, { needs: needs[f.n] }); c.classList.add("later"); c.querySelector(".nm").insertAdjacentHTML("beforeend", `<span class="why">${esc(whyNot(f, ctx))}</span>`); return c; }));
      panel.appendChild(sec2);
    }
  } else panel.innerHTML = '<p class="empty">Tap a spot on the map to list its fish.</p>';
}

// ---------- BACKUP ----------
function renderBackup(main) {
  const div = document.createElement("div");
  div.className = "stack";
  div.style.marginTop = "18px";
  div.innerHTML = `
    <div class="panel stack">
      <h2 style="font-family:var(--display);font-weight:500;margin:0">Save a backup</h2>
      <p class="lede" style="margin:0">Your progress lives in this browser only. Download a backup now and then, or to move it to another device.</p>
      <div><button class="btn primary" id="k-export">Download backup file</button></div>
    </div>
    <div class="panel stack">
      <h2 style="font-family:var(--display);font-weight:500;margin:0">Restore or move progress</h2>
      <p class="lede" style="margin:0">Choose a backup file, or paste a progress code (for example the one from the Claude version of this tracker). Fish and bundles in the code are added to what you already have; nothing gets unticked.</p>
      <input type="file" id="k-file" accept="application/json,.json">
      <textarea id="k-code" placeholder='Paste a progress code, e.g. {"caught":["Anchovy","Carp"]}'></textarea>
      <div><button class="btn primary" id="k-import">Import code</button></div>
      <p class="msg" id="k-msg" role="status"></p>
    </div>
    <div class="panel stack">
      <h2 style="font-family:var(--display);font-weight:500;margin:0">Start over</h2>
      <p class="lede" style="margin:0">Clears every ticked fish and bundle item in this browser. Download a backup first if you might want it back.</p>
      <div><button class="btn" id="k-reset">Clear all progress</button> <span id="k-confirm"></span></div>
    </div>`;
  main.appendChild(div);
  $("k-export").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "sve-fish-log", version: 1, savedAt: new Date().toISOString(), caught: state.caught, bundles: state.bundles }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sve-fish-log-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const merge = text => {
    let v;
    try { v = JSON.parse(text); } catch (e) { $("k-msg").textContent = "That isn't a valid progress code. Copy the whole code, including the curly brackets."; return; }
    const names = Array.isArray(v) ? v : v.caught || [];
    const known = names.filter(n => BY_NAME[n]);
    state.caught = [...new Set([...state.caught, ...known])];
    let items = 0;
    if (v.bundles && typeof v.bundles === "object") for (const [id, arr] of Object.entries(v.bundles)) {
      if (!Array.isArray(arr)) continue;
      state.bundles[id] = [...new Set([...(state.bundles[id] || []), ...arr.filter(Number.isInteger)])];
      items += arr.length;
    }
    save(); render();
    $("k-msg").textContent = `Imported ${known.length} fish${items ? ` and ${items} bundle items` : ""}.`;
  };
  $("k-import").onclick = () => merge($("k-code").value);
  $("k-file").onchange = e => { const f = e.target.files[0]; if (f) f.text().then(merge); };
  $("k-reset").onclick = () => {
    $("k-confirm").innerHTML = '<button class="btn" id="k-yes" style="border-color:var(--warn);color:var(--warn)">Yes, clear everything</button>';
    $("k-yes").onclick = () => { state.caught = []; state.bundles = {}; save(); render(); };
  };
}

// ---------- shell ----------
const ROUTES = { today: renderToday, bundles: renderBundles, fish: renderFish, map: renderMap, backup: renderBackup };
function route() { const r = location.hash.slice(1); return ROUTES[r] ? r : "today"; }

function render() {
  const r = route(), main = $("view"), y = window.scrollY;
  document.querySelectorAll("nav.main a").forEach(a => { if (a.getAttribute("href") === "#" + r) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  main.innerHTML = "";
  ROUTES[r](main);
  window.scrollTo(0, y);
  const got = caught(), tot = FISH.length;
  $("tot").textContent = tot;
  $("cnt").textContent = FISH.filter(f => got.has(f.n)).length;
  $("barfill").style.width = (FISH.filter(f => got.has(f.n)).length / tot * 100) + "%";
  $("mini").innerHTML = SEASONS.map(s => { const a = FISH.filter(f => f.ss.includes(s)); return `<span style="--c:${SC[s]}">${s} ${a.filter(f => got.has(f.n)).length}/${a.length}</span>`; }).join("");
}
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
window.addEventListener("storage", e => { if (e.key === STORE_KEY) { state = load(); render(); } });

Promise.all([fetch("data/fish.json").then(r => r.json()), fetch("data/bundles.json").then(r => r.json())])
  .then(([fd, bd]) => {
    FISH = fd.fish; ORDER = fd.order; ROOMS = bd;
    for (const f of FISH) { BY_NAME[f.n] = f; const l = f.l.toLowerCase(); f.spots = SPOTS.filter(s => s.t(l)).map(s => s.id); }
    render();
  })
  .catch(() => { $("view").innerHTML = '<p class="empty">Couldn\'t load the fish data. If you opened index.html straight from your computer, run it through a local server instead (see README).</p>'; });
