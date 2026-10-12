// Junimo Planner — plain JavaScript, no build step.
// Progress lives in localStorage under STORE_KEY; everything else is static data in /data.
// The store holds several farms (one per save file); `state` always points at the active farm.

import * as cloud from "./cloud.js";

const STORE_KEY = "sve-tracker:v1";
// the ?v= number on this script (set in index.html) is reused for the data files, so one bump refreshes both
const DATA_V = new URL(import.meta.url).searchParams.get("v") || "dev";
const dataUrl = name => `data/${name}.json?v=${DATA_V}`;
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
const SC = { Spring: "var(--sp)", Summer: "var(--su)", Fall: "var(--fa)", Winter: "var(--wi)" };

let FISH = [], ORDER = [], SETS = {}, BY_NAME = {}, VILLAGERS = [], UNIVERSAL = { vanilla: [], sve: [] }, ITEM_IMG = {}, RECIPES = { cooking: [], crafting: [], img: {} }, CROPS = [], COLL = { museum: [], shipping: [], milestones: [], special: [] };
let store = load();
let state = store.farms[store.active];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- storage ----------
function newFarm(name) {
  return { name, bundleSet: "sve", caught: [], bundles: {}, done: {}, todos: [], made: { cooking: {}, crafting: {} }, shop: { cooking: {}, crafting: {} }, col: { museum: {}, shipping: {} }, qi: false, today: { year: 1, season: "Spring", day: 1, rain: false, hour: "" } };
}
function fixFarm(f, name) {
  const b = newFarm(name);
  // farms saved before bundle sets existed used the standard bundles
  return { ...b, bundleSet: "vanilla", ...f, today: { ...b.today, ...(f && f.today) }, done: { ...(f && f.done) }, todos: Array.isArray(f && f.todos) ? f.todos : [], made: { cooking: { ...(f && f.made && f.made.cooking) }, crafting: { ...(f && f.made && f.made.crafting) } }, shop: { cooking: { ...(f && f.shop && f.shop.cooking) }, crafting: { ...(f && f.shop && f.shop.crafting) } }, col: { museum: { ...(f && f.col && f.col.museum) }, shipping: { ...(f && f.col && f.col.shipping) } } };
}
function load() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) {}
  return parseStore(v);
}
// Turn saved JSON (from this browser, a backup or the cloud) into a complete store
function parseStore(v) {
  const prefs = { showCaught: false, hideDone: false };
  if (v && v.farms && typeof v.farms === "object" && Object.keys(v.farms).length) {
    const farms = Object.fromEntries(Object.entries(v.farms).map(([id, f]) => [id, fixFarm(f, f.name || "My farm")]));
    return { version: 2, updatedAt: v.updatedAt || 0, active: farms[v.active] ? v.active : Object.keys(farms)[0], farms, prefs: { ...prefs, ...v.prefs } };
  }
  // version 1 kept one farm's progress at the top level: move it into "My farm"
  const first = v && typeof v === "object" ? fixFarm({ caught: v.caught, bundles: v.bundles, today: v.today, qi: v.prefs?.qi }, "My farm") : newFarm("My farm");
  return { version: 2, active: "farm-1", farms: { "farm-1": first }, prefs: { ...prefs, showCaught: !!v?.prefs?.showCaught, hideDone: !!v?.prefs?.hideDone } };
}
function save() {
  store.updatedAt = Date.now();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  cloud.queuePush();
}
// Cloud sync hooks: replace this browser's copy, or combine two copies without losing ticks
function replaceStore(data) {
  store = parseStore(data);
  state = store.farms[store.active];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  render();
}
function mergeStores(cloudData, local) {
  const merged = parseStore(JSON.parse(JSON.stringify(cloudData)));
  for (const f of Object.values(local.farms)) {
    const same = Object.values(merged.farms).find(x => x.name === f.name);
    if (same) mergeInto(same, f);
    else {
      let n = 1; while (merged.farms["farm-" + n]) n++;
      merged.farms["farm-" + n] = JSON.parse(JSON.stringify(f));
    }
  }
  merged.updatedAt = Date.now();
  return merged;
}
function switchFarm(id) { store.active = id; state = store.farms[id]; save(); render(); }

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

// Some fish are catchable all year on Ginger Island but only in their seasons elsewhere (f.gi).
const gingerOnly = (f, ctx) => !!f.gi && !f.ss.includes(ctx.season);
function availableOn(f, ctx, spot) {
  if (!f.ss.includes(ctx.season) && !(f.gi && (spot === undefined || spot === "ginger"))) return false;
  if (f.w === "Rain" && !ctx.rain) return false;
  if (f.w === "Sun" && ctx.rain) return false;
  if (f.c === "Night Market" && !(ctx.season === "Winter" && ctx.day >= 15 && ctx.day <= 17)) return false;
  if (f.c === "Legendary II" && !state.qi) return false;
  if (ctx.hour !== "" && ctx.hour != null) {
    const h = +ctx.hour;
    if (!ranges(f.t).some(([a, b]) => h >= a && h < b)) return false;
  }
  return true;
}
const nextSeason = s => SEASONS[(SEASONS.indexOf(s) + 1) % 4];
const leavesAfter = (f, season) => !f.gi && f.ss.includes(season) && !f.ss.includes(nextSeason(season));

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
// ---------- SVE on/off (per farm) ----------
// One switch for the whole site (header). Vanilla mode only hides SVE content; nothing saved is removed.
const sveOn = () => store.prefs.sve !== false;
const fishList = () => sveOn() ? FISH : FISH.filter(f => f.s !== "SVE");
const villagerList = () => VILLAGERS.filter(v => sveOn() ? !v.vanillaOnly : !v.sve);
const recipeList = kind => sveOn() ? RECIPES[kind] : RECIPES[kind].filter(r => !r.sve);
const universalLoves = () => sveOn() ? [...UNIVERSAL.vanilla, ...UNIVERSAL.sve] : UNIVERSAL.vanilla;
const bundleSetId = () => !sveOn() ? "vanilla" : (SETS[state.bundleSet] ? state.bundleSet : "vanilla");

// A bundle is done when enough items are ticked, or when it was marked "All done" in one go.
const bundleDone = b => !!state.done[b.id] || donated(b.id).size >= b.need;
// Each farm picks a bundle set (standard, SVE Normal or SVE Hard). Bundle ids differ per set,
// so progress in one set is kept if the farm switches to another and back.
const rooms = () => SETS[bundleSetId()].rooms;
const allBundles = () => rooms().flatMap(r => r.bundles);
const CC_ROOMS = () => rooms().filter(r => r.room !== "Abandoned JojaMart");
function completeBundles(list) {
  for (const b of list) {
    state.done[b.id] = true;
    // bundles that need every item: you must have caught all their fish
    if (b.need === b.items.length) b.items.forEach(it => { if (it.fish) setCaught(it.n, true); });
  }
  save();
}
function resetBundles(list) {
  for (const b of list) { delete state.done[b.id]; delete state.bundles[b.id]; }
  save();
}
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

// "Used in" line on a fish card: cooking recipes that need this exact fish
function recipesHTML(f) {
  const rs = (f.r || []).filter(r => sveOn() || !r.sve);
  if (!rs.length) return "";
  const list = rs.map(r => `<b>${esc(r.n)}</b>${r.q > 1 ? ` (×${r.q})` : ""}${r.w ? ` <span class="with">+ ${esc(r.w)}</span>` : ""}${r.sve ? ' <span class="tag sve">SVE</span>' : ""}`).join("; ");
  return `<span class="recipes">🍳 Cooking: ${list}</span>`;
}

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
    opts.gi ? '<span class="tag gi">🏝 Ginger Island only</span>' : "",
  ].join("");
  b.innerHTML = `<span class="sprite"><img alt="" loading="lazy" src="${f.img}"></span>
    <span class="nm">${esc(f.n)}<span class="tags">${tags}</span></span>
    <span class="box" aria-hidden="true">${done ? "✓" : ""}</span>
    <span class="meta"><span>🕑 ${esc(f.t)}</span><span class="w-${f.w}">${f.w === "Any" ? "Any weather" : f.w === "Rain" ? "☂ Rain only" : "☀ Sun only"}</span><span class="dots" aria-label="${f.ss.join(", ")}">${dots}</span>${f.d !== "—" ? `<span>Diff ${f.d} · ${esc(f.b)}</span>` : ""}<span>${Number(f.p).toLocaleString()}g</span></span>
    <span class="loc">${esc(f.l)}</span>${f.x ? `<span class="note">${esc(f.x)}</span>` : ""}${recipesHTML(f)}`;
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
    <div class="ctl"><span>Year</span><div class="day"><input id="${p}-year" type="number" min="1" max="99" value="${ctx.year || 1}" aria-label="Year" style="width:3.6em"></div></div>
    <div class="ctl"><span>Day</span><div class="day"><button id="${p}-prev" aria-label="Previous day">−</button><input id="${p}-day" type="number" min="1" max="28" value="${ctx.day}" aria-label="Day of the season"><button id="${p}-next" aria-label="Next day">+</button></div></div>
    <div class="ctl"><span>Weather (check the TV)</span><div class="seg" id="${p}-wx"><button data-r="0" style="--c:var(--sun)" aria-pressed="${!ctx.rain}">☀ Sunny / windy</button><button data-r="1" style="--c:var(--rain)" aria-pressed="${ctx.rain}">☂ Rain / storm</button></div></div>
    <div class="ctl"><span>Time</span><select id="${p}-hour"><option value="">Whole day</option>${Array.from({ length: 20 }, (_, i) => i + 6).map(h => `<option value="${h}" ${String(ctx.hour) === String(h) ? "selected" : ""}>${hourLabel(h)}</option>`).join("")}</select></div>`;
}
function wireConditions(root, ctx, p) {
  root.querySelectorAll(`#${p}-season button`).forEach(b => b.onclick = () => { ctx.season = b.dataset.s; save(); render(); });
  root.querySelectorAll(`#${p}-wx button`).forEach(b => b.onclick = () => { ctx.rain = b.dataset.r === "1"; save(); render(); });
  const step = d => {
    let day = ctx.day + d, si = SEASONS.indexOf(ctx.season);
    let year = ctx.year || 1;
    if (day > 28) { day = 1; si = (si + 1) % 4; if (si === 0) year++; }
    if (day < 1) { day = 28; si = (si + 3) % 4; if (si === 3) year = Math.max(1, year - 1); }
    ctx.day = day; ctx.season = SEASONS[si]; ctx.year = year; ctx.rain = false; save(); render();
  };
  $(`${p}-prev`).onclick = () => step(-1);
  $(`${p}-next`).onclick = () => step(1);
  $(`${p}-day`).onchange = e => { ctx.day = Math.min(28, Math.max(1, parseInt(e.target.value) || 1)); save(); render(); };
  $(`${p}-hour`).onchange = e => { ctx.hour = e.target.value; save(); render(); };
  $(`${p}-year`).onchange = e => { ctx.year = Math.min(99, Math.max(1, parseInt(e.target.value) || 1)); save(); render(); };
}
// Why a fish can't be caught under these conditions ("" = it can)
function whyNot(f, ctx, spot) {
  if (!f.ss.includes(ctx.season) && !(f.gi && spot === "ginger")) return f.gi ? `Only on Ginger Island in ${ctx.season}` : "Only in " + f.ss.join(", ");
  if (f.w === "Rain" && !ctx.rain) return "Needs rain";
  if (f.w === "Sun" && ctx.rain) return "Not in the rain";
  if (f.c === "Night Market" && !(ctx.season === "Winter" && ctx.day >= 15 && ctx.day <= 17)) return "Night Market only (Winter 15–17)";
  if (f.c === "Legendary II" && !state.qi) return "Only during Qi's Extended Family quest";
  if (ctx.hour !== "" && ctx.hour != null && !availableOn(f, ctx, spot)) return "Bites " + f.t;
  return "";
}

// ---------- MY TO-DO (written by the player, per farm) ----------
// Each task has an in-game due day counted from Year 1 Spring 1 (null = no date).
const absDay = c => ((c.year || 1) - 1) * 112 + SEASONS.indexOf(c.season) * 28 + c.day;
const dateOf = n => ({ year: Math.floor((n - 1) / 112) + 1, season: SEASONS[Math.floor(((n - 1) % 112) / 28)], day: ((n - 1) % 28) + 1 });
const dateLabel = n => { const d = dateOf(n); return `${d.season} ${d.day}${d.year !== (state.today.year || 1) ? `, Year ${d.year}` : ""}`; };
let todoFocus = null; // which add-box to focus after re-render
const todoForm = { season: "", day: "" };

function renderTodos(box) {
  const today = absDay(state.today), list = state.todos;
  const forToday = list.filter(t => t.due !== null && (t.done ? t.due === today || t.doneOn === today : t.due <= today));
  const later = list.filter(t => !t.done && (t.due === null || t.due > today)).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  const item = t => {
    const late = !t.done && t.due !== null && t.due < today, future = t.due !== null && t.due > today;
    const meta = late ? `<span class="tmeta late">from ${dateLabel(t.due)}</span>` : future ? `<span class="tmeta">${dateLabel(t.due)} · in ${t.due - today} day${t.due - today === 1 ? "" : "s"}</span>` : t.due === null && !t.done ? '<span class="tmeta">no date</span>' : "";
    return `<li class="titem${t.done ? " done" : ""}" data-id="${t.id}"><input type="checkbox" ${t.done ? "checked" : ""} aria-label="Done: ${esc(t.text)}"><span class="ttext">${esc(t.text)}${meta}</span>${future || t.due === null ? '<button type="button" class="tbtn" data-act="now" title="Do it today">Today</button>' : ""}<button type="button" class="tbtn x" data-act="del" aria-label="Delete ${esc(t.text)}">×</button></li>`;
  };
  const doneToday = forToday.filter(t => t.done).length;
  box.innerHTML = `<section class="todos"><h2>My to-do<span>your own notes for this farm, they sync if you're signed in</span></h2>
    <div class="tcols">
      <div class="panel tcol"><h3>Today <small>${state.today.season} ${state.today.day}</small></h3>
        <ul class="tlist">${forToday.map(item).join("") || '<li class="tempty">Nothing yet. Add what you want to get done today, like “water the crops” or “give Abigail an amethyst”.</li>'}</ul>
        <form class="tadd" data-list="today"><input id="td-today" maxlength="140" placeholder="Add a task for today…" aria-label="New task for today"><button class="btn small primary" type="submit">Add</button></form>
        ${doneToday ? `<button type="button" class="tclear" id="td-clear">Clear ${doneToday} done</button>` : ""}
      </div>
      <div class="panel tcol"><h3>Coming up</h3>
        <ul class="tlist">${later.map(item).join("") || '<li class="tempty">Plans for the next days, like “buy Rarecrow at Spirit’s Eve” or “save 10 Hardwood for the coop”. Pick a day and it moves to Today when that day comes.</li>'}</ul>
        <form class="tadd" data-list="later"><input id="td-later" maxlength="140" placeholder="Add a plan…" aria-label="New plan">
          <select id="td-season" aria-label="Season"><option value="">No date</option>${SEASONS.map(s => `<option ${todoForm.season === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <input id="td-day" type="number" min="1" max="28" placeholder="Day" aria-label="Day" value="${todoForm.day}" ${todoForm.season ? "" : "disabled"}>
          <button class="btn small primary" type="submit">Add</button></form>
      </div>
    </div></section>`;

  box.querySelectorAll(".tadd").forEach(f => f.onsubmit = e => {
    e.preventDefault();
    const which = f.dataset.list, input = f.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    let due = today;
    if (which === "later") {
      todoForm.season = $("td-season").value; todoForm.day = $("td-day").value;
      if (!todoForm.season) due = null;
      else {
        const day = Math.min(28, Math.max(1, parseInt(todoForm.day) || 1));
        due = absDay({ year: state.today.year, season: todoForm.season, day });
        if (due <= today) due += 112; // a day that's already passed this year means next year
      }
    }
    state.todos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, due, done: false });
    todoFocus = which === "later" ? "td-later" : "td-today";
    save(); render();
  });
  $("td-season").onchange = e => { todoForm.season = e.target.value; $("td-day").disabled = !e.target.value; if (e.target.value && !$("td-day").value) $("td-day").value = Math.min(28, state.today.day + 1); };
  box.querySelectorAll(".titem").forEach(li => {
    const t = list.find(x => x.id === li.dataset.id);
    li.querySelector("input").onchange = e => { t.done = e.target.checked; t.doneOn = t.done ? today : undefined; save(); render(); };
    li.querySelectorAll(".tbtn").forEach(b => b.onclick = () => {
      if (b.dataset.act === "del") state.todos = state.todos.filter(x => x.id !== t.id);
      else t.due = today;
      save(); render();
    });
  });
  const clear = $("td-clear");
  if (clear) clear.onclick = () => { state.todos = state.todos.filter(t => !(t.done && forToday.includes(t))); save(); render(); };
  if (todoFocus) { const el = $(todoFocus); todoFocus = null; if (el) el.focus({ preventScroll: true }); }
}

// ---------- TODAY ----------
function renderToday(main) {
  const ctx = state.today, got = caught(), needs = bundleNeeds();
  const avail = fishList().filter(f => availableOn(f, ctx));
  const todo = avail.filter(f => !got.has(f.n));
  const daysLeft = 28 - ctx.day;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div class="controls">
    ${conditionsHTML(ctx, "t")}
    <label class="check"><input type="checkbox" id="t-showcaught" ${store.prefs.showCaught ? "checked" : ""}> Show fish I've caught</label>
    <label class="check"><input type="checkbox" id="t-qi" ${state.qi ? "checked" : ""}> Qi's “Extended Family” quest is active</label>
  </div>
  <div class="events" id="t-events"></div>
  <div class="stats">
    <div class="stat"><b>${todo.length}</b><span>new fish you can catch ${ctx.hour !== "" ? "at " + hourLabel(+ctx.hour) : "today"}</span></div>
    <div class="stat"><b>${todo.filter(f => needs[f.n]).length}</b><span>of them still needed for bundles</span></div>
    <div class="stat"><b>${fishList().filter(f => leavesAfter(f, ctx.season) && !got.has(f.n) && f.c !== "Legendary II").length}</b><span>uncaught fish leave after ${ctx.season} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</span></div>
  </div>
  <div id="t-todo"></div>`;
  main.appendChild(wrap);
  renderTodos($("t-todo"));

  // events
  const ev = $("t-events"), e = EVENTS[ctx.season]?.[ctx.day];
  const notes = [];
  if (e) notes.push(`<div class="event" style="--c:${SC[ctx.season]}"><b>${esc(e[0])}</b>${esc(e[1])}</div>`);
  for (const v of birthdaysOn(ctx.season, ctx.day)) notes.push(`<div class="event bdayev" style="--c:var(--legend)"><img alt="" src="${v.img}"><span><b>${esc(v.n)}'s birthday</b>A gift counts 8× today. Loves: ${v.l.slice(0, 6).map(esc).join(", ") || "the universal loves"}${v.l.length > 6 ? "…" : ""} <a href="#villagers">See all</a></span></div>`);
  if (ctx.rain) {
    const rainOnly = todo.filter(f => f.w === "Rain");
    if (rainOnly.length) notes.push(`<div class="event" style="--c:var(--rain)"><b>Rainy day</b>Go for the rain-only fish: ${rainOnly.map(f => esc(f.n)).join(", ")}.</div>`);
  }
  if (daysLeft <= 3) notes.push(`<div class="event" style="--c:var(--warn)"><b>Season ends soon</b>Fish marked “Last chance” won't be back until next year.</div>`);
  ev.innerHTML = notes.join("");

  // controls
  wireConditions(wrap, ctx, "t");
  $("t-showcaught").onchange = e => { store.prefs.showCaught = e.target.checked; save(); render(); };
  $("t-qi").onchange = e => { state.qi = e.target.checked; save(); render(); };

  // fish lists
  const shown = store.prefs.showCaught ? avail : todo;
  const opts = f => ({ needs: needs[f.n], last: leavesAfter(f, ctx.season) && f.c !== "Legendary II", wx: ctx.rain && f.w === "Rain", gi: gingerOnly(f, ctx) });
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
let confirmKey = null; // which "reset" is waiting for a second click
function bulkButton(key, done, labelDo, labelUndo, onDo, onUndo, big) {
  const wrap = document.createElement("span");
  wrap.className = "bulk";
  const cls = "btn" + (big ? " primary" : " small");
  if (!done) {
    wrap.innerHTML = `<button type="button" class="${cls}">${labelDo}</button>`;
    wrap.firstChild.onclick = () => { confirmKey = null; onDo(); render(); };
  } else if (confirmKey === key) {
    wrap.innerHTML = `<span class="sure">Untick everything here?</span> <button type="button" class="btn small danger">Yes, reset</button> <button type="button" class="btn small">Cancel</button>`;
    const [yes, no] = wrap.querySelectorAll("button");
    yes.onclick = () => { confirmKey = null; onUndo(); render(); };
    no.onclick = () => { confirmKey = null; render(); };
  } else {
    wrap.innerHTML = `<button type="button" class="btn small ghost">${labelUndo}</button>`;
    wrap.firstChild.onclick = () => { confirmKey = key; render(); };
  }
  return wrap;
}

function renderBundles(main) {
  const ctx = state.today, all = allBundles();
  const doneCount = all.filter(bundleDone).length;
  const cc = CC_ROOMS().flatMap(r => r.bundles), ccDone = cc.every(bundleDone);
  const head = document.createElement("div");
  head.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${doneCount} / ${all.length}</b><span>bundles complete</span></div>
      ${rooms().map(r => `<div class="stat"><b>${r.bundles.filter(bundleDone).length} / ${r.bundles.length}</b><span>${esc(r.room)}</span></div>`).join("")}
    </div>
    ${sveOn() ? "" : '<p class="lede" style="margin-top:14px">Vanilla mode: these are the standard Community Center bundles.</p>'}
    <div class="setbar panel" ${sveOn() ? "" : "hidden"}><div><b>Bundle set</b><p class="lede" style="margin:2px 0 0">Pick the bundles your save uses. SVE asks for Normal or Hard when you create the save; “Standard” is the unmodded game. Each set keeps its own progress.</p></div>
      <div class="seg" id="b-set">${Object.entries(SETS).map(([id, s]) => `<button type="button" data-set="${id}" aria-pressed="${bundleSetId() === id}">${esc(s.label)}</button>`).join("")}</div></div>
    <div class="ccbar panel"><div><b>${ccDone ? "Community Center restored ✓" : "Already finished the Community Center?"}</b><p class="lede" style="margin:2px 0 0">${ccDone ? "Every room is marked done on this farm." : "Mark every room done in one click. You can still reset single rooms or bundles below."}</p></div><span id="b-cc"></span></div>
    <div class="controls"><label class="check"><input type="checkbox" id="b-hide" ${store.prefs.hideDone ? "checked" : ""}> Hide finished bundles</label>
    <p class="lede">Tap an item when you've put it in the bundle, or use <b>All done</b> on a bundle or room. Items marked <b style="color:var(--need)">TODAY</b> can be caught or found on the day set in the Today tab (${ctx.season} ${ctx.day}, ${ctx.rain ? "rain" : "sunny"}).</p></div>`;
  main.appendChild(head);
  $("b-cc").appendChild(bulkButton("cc", ccDone, "Mark whole Community Center done", "Reset Community Center", () => completeBundles(cc), () => resetBundles(cc), true));
  $("b-hide").onchange = e => { store.prefs.hideDone = e.target.checked; save(); render(); };
  head.querySelectorAll("#b-set button").forEach(b => b.onclick = () => { state.bundleSet = b.dataset.set; confirmKey = null; save(); render(); });

  for (const r of rooms()) {
    const roomDone = r.bundles.every(bundleDone);
    const list = r.bundles.filter(b => !(store.prefs.hideDone && bundleDone(b)));
    const sec = document.createElement("section");
    sec.innerHTML = `<div class="roomhead"><h2>${esc(r.room)}<span>${r.bundles.filter(bundleDone).length} / ${r.bundles.length} done${r.room === "Abandoned JojaMart" ? " · opens after the Community Center is restored" : ""}</span></h2></div><div class="bgrid"></div>`;
    sec.querySelector(".roomhead").appendChild(bulkButton("room:" + r.room, roomDone, "Mark room done", "Reset room", () => completeBundles(r.bundles), () => resetBundles(r.bundles)));
    const grid = sec.querySelector(".bgrid");
    if (!list.length) grid.innerHTML = '<p class="empty" style="padding:8px 0;text-align:left">All done here.</p>';
    for (const b of list) {
      const d = donated(b.id), complete = bundleDone(b), flagged = !!state.done[b.id] && d.size < b.need;
      const el = document.createElement("div");
      el.className = "bundle" + (complete ? " complete" : "");
      el.innerHTML = `<div class="bhead"><h3>${esc(b.name)}</h3><span class="n">${flagged ? "Done" : Math.min(d.size, b.need) + " / " + b.need}${complete ? " ✓" : ""}</span></div>
        <p class="reward">Reward: ${esc(b.reward)}</p>${b.need < b.items.length ? `<p class="pick">Any ${b.need} of these ${b.items.length}</p>` : ""}<div class="items"></div><div class="bfoot"></div>`;
      el.querySelector(".bfoot").appendChild(bulkButton("b:" + b.id, complete, "All done", "Reset bundle", () => completeBundles([b]), () => resetBundles([b])));
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

// ---------- VILLAGERS ----------
const vilFilter = { q: "", who: "all", season: null };
const birthdaysOn = (season, day) => villagerList().filter(v => v.b && v.b.s === season && v.b.d === day);
// days from (season, day) until a villager's next birthday (0 = today)
function daysUntil(v, season, day) {
  if (!v.b) return Infinity;
  const at = (SEASONS.indexOf(v.b.s) * 28 + v.b.d) - (SEASONS.indexOf(season) * 28 + day);
  return (at + 112) % 112;
}
function giftChip(item, hit) {
  const f = BY_NAME[item];
  const src = f ? f.img : ITEM_IMG[item];
  const pic = src ? `<img alt="" loading="lazy" src="${src}">` : "";
  const now = f && availableOn(f, state.today) ? ' title="Catchable on the day set in Today"' : "";
  return `<span class="gift${hit ? " hit" : ""}${f ? " fishy" : ""}"${now}>${pic}${esc(item)}${f && now ? " 🎣" : ""}</span>`;
}
function villagerCard(v, q) {
  const ctx = state.today, until = daysUntil(v, ctx.season, ctx.day);
  const match = s => q && s.toLowerCase().includes(q);
  const el = document.createElement("article");
  el.className = "villager" + (v.sve ? " sve" : "") + (until === 0 ? " bday" : "");
  el.id = "v-" + v.id;
  const when = !v.b ? "No birthday listed" : `${v.b.s} ${v.b.d}` + (until === 0 ? ' · <b class="soon">Birthday today!</b>' : until <= 7 ? ` · <b class="soon">in ${until} day${until === 1 ? "" : "s"}</b>` : "");
  el.innerHTML = `<div class="vhead"><img class="portrait" alt="" loading="lazy" src="${v.img}">
      <div class="vmeta"><h3>${esc(v.n)}${v.aka ? ` <small>(${esc(v.aka)})</small>` : ""}</h3>
      <div class="tags">${v.sve ? '<span class="tag sve">SVE</span>' : ""}${v.marry ? '<span class="tag need">Marriage</span>' : ""}${v.roommate ? '<span class="tag">Roommate</span>' : ""}</div>
      <p class="when">🎂 ${when}</p></div></div>
    <p class="glabel">Loves</p><div class="gifts">${v.l.map(i => giftChip(i, match(i))).join("") || '<span class="none">Only the universal loves</span>'}</div>
    ${v.note ? `<p class="gnote">${esc(v.note)}</p>` : ""}
    ${v.k.length ? `<details ${q && v.k.some(match) ? "open" : ""}><summary>Likes (${v.k.length})</summary><div class="gifts">${v.k.map(i => giftChip(i, match(i))).join("")}</div></details>` : ""}`;
  return el;
}

function renderVillagers(main) {
  const ctx = state.today, season = vilFilter.season || ctx.season;
  const q = vilFilter.q.trim().toLowerCase();
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="controls">
      <div class="ctl"><span>Birthday calendar</span><div class="seg" id="v-season">${SEASONS.map(s => `<button data-s="${s}" style="--c:${SC[s]}" aria-pressed="${season === s}">${s}</button>`).join("")}</div></div>
      <div class="ctl" style="flex:1 1 220px"><span>Search a villager or a gift</span><input type="search" id="v-q" value="${esc(vilFilter.q)}" placeholder="e.g. Abigail, Diamond, Pink Cake…" style="font:inherit;padding:6px 10px;border:2px solid var(--line);border-radius:5px;background:var(--panel);color:var(--ink)"></div>
      <div class="ctl"><span>Show</span><div class="seg" id="v-who">${[["all", "Everyone"], ["marry", "Marriage candidates"]].map(([k, l]) => `<button data-w="${k}" aria-pressed="${vilFilter.who === k}">${l}</button>`).join("")}</div></div>
    </div>
    <section><h2>${season} birthdays<span>${season === ctx.season ? `today is ${ctx.season} ${ctx.day} (set on the Today tab)` : "tap a birthday to jump to that villager"}</span></h2><div class="cal" id="v-cal"></div></section>
    <div class="univbox"><b>Everyone loves</b> (almost) these, and a birthday gift counts 8× towards friendship:<div class="gifts" style="margin-top:6px">${universalLoves().map(i => giftChip(i, false)).join("")}</div></div>
    <div id="v-list"></div>`;
  main.appendChild(wrap);

  // calendar: 4 weeks of Mon–Sun, like the in-game one
  const cal = $("v-cal");
  cal.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<div class="dow">${d}</div>`).join("");
  for (let d = 1; d <= 28; d++) {
    const who = birthdaysOn(season, d), ev = EVENTS[season]?.[d];
    const cell = document.createElement("div");
    cell.className = "day" + (season === ctx.season && d === ctx.day ? " today" : "") + (who.length ? " has" : "");
    cell.innerHTML = `<span class="dn">${d}</span>${ev ? `<span class="fest">${esc(ev[0])}</span>` : ""}<span class="who">${who.map(v => `<button type="button" data-v="${v.id}" title="${esc(v.n)}"><img alt="${esc(v.n)}" src="${v.img}"><span>${esc(v.n)}</span></button>`).join("")}</span>`;
    cal.appendChild(cell);
  }
  cal.querySelectorAll("button[data-v]").forEach(b => b.onclick = () => {
    vilFilter.q = ""; render();
    const el = document.getElementById("v-" + b.dataset.v);
    if (el) { el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); }
  });
  wrap.querySelectorAll("#v-season button").forEach(b => b.onclick = () => { vilFilter.season = b.dataset.s; render(); });
  wrap.querySelectorAll("#v-who button").forEach(b => b.onclick = () => { vilFilter.who = b.dataset.w; render(); });
  $("v-q").oninput = e => { vilFilter.q = e.target.value; drawList(); };

  function drawList() {
    const q = vilFilter.q.trim().toLowerCase(), out = $("v-list");
    out.innerHTML = "";
    let list = villagerList().filter(v => vilFilter.who === "all" || v.marry);
    if (q) {
      const byName = list.filter(v => v.n.toLowerCase().includes(q));
      const loves = list.filter(v => !byName.includes(v) && v.l.some(i => i.toLowerCase().includes(q)));
      const likes = list.filter(v => !byName.includes(v) && !loves.includes(v) && v.k.some(i => i.toLowerCase().includes(q)));
      const universal = universalLoves().filter(i => i.toLowerCase().includes(q));
      if (universal.length) out.insertAdjacentHTML("beforeend", `<p class="lede" style="margin-top:16px">${universal.map(esc).join(", ")} ${universal.length === 1 ? "is a" : "are"} universal love: almost everyone loves ${universal.length === 1 ? "it" : "them"}.</p>`);
      const grp = (title, vs) => { if (!vs.length) return; const sec = document.createElement("section"); sec.innerHTML = `<h2>${title}<span>${vs.length}</span></h2><div class="vgrid"></div>`; vs.forEach(v => sec.querySelector(".vgrid").appendChild(villagerCard(v, q))); out.appendChild(sec); };
      grp("Villagers", byName); grp(`Love “${esc(vilFilter.q.trim())}”`, loves); grp(`Like “${esc(vilFilter.q.trim())}”`, likes);
      if (!byName.length && !loves.length && !likes.length && !universal.length) out.innerHTML = '<p class="empty">No villager or gift matches that. Try a shorter word.</p>';
      return;
    }
    // no search: soonest birthday first, from the Today tab's date
    list = [...list].sort((a, b) => daysUntil(a, ctx.season, ctx.day) - daysUntil(b, ctx.season, ctx.day) || a.n.localeCompare(b.n));
    const sec = document.createElement("section");
    sec.innerHTML = `<h2>All villagers<span>${list.length} · next birthday first, counting from ${ctx.season} ${ctx.day}</span></h2><div class="vgrid"></div>`;
    list.forEach(v => sec.querySelector(".vgrid").appendChild(villagerCard(v, "")));
    out.appendChild(sec);
  }
  drawList();
}

// ---------- CROPS: what to plant today ----------
// Growth speed-ups work like the game: days removed = ceil(total days × speed bonus).
const FERT = { none: ["No fertilizer", 0], speed: ["Speed-Gro", 0.10], deluxe: ["Deluxe Speed-Gro", 0.25], hyper: ["Hyper Speed-Gro", 0.33] };
const cropList = () => sveOn() ? CROPS : CROPS.filter(c => !c.sve);
function growDays(c, opts) {
  const boost = FERT[opts.fert][1] + (opts.agri ? 0.10 : 0);
  return Math.max(1, c.days - Math.ceil(c.days * boost - 1e-9));
}
function seedCost(c, opts) {
  const ok = c.shops.filter(s => (opts.joja || s.shop !== "JojaMart") && (opts.jojaRoute || s.shop !== "Joja Emporium"));
  if (!ok.length) return null;
  return ok.reduce((a, b) => (b.price < a.price ? b : a));
}
// What one harvested item is worth after processing (game 1.6 rules).
// Tiller (+10%) only counts for raw crops; Artisan (+40%) only for artisan goods.
const PROC = { raw: "Sell raw", keg: "Keg", jar: "Preserves Jar", best: "Best of the three" };
function productOptions(c, opts) {
  const raw = { how: "raw", name: c.n, unit: Math.floor(c.price * (opts.tiller ? 1.1 : 1)) };
  const art = v => Math.floor(v * (opts.artisan ? 1.4 : 1));
  const out = [raw];
  if (c.type === "fruit") {
    out.push({ how: "keg", name: "Wine", unit: art(c.price * 3) });
    out.push({ how: "jar", name: "Jelly", unit: art(c.price * 2 + 50) });
  } else if (c.type === "veg") {
    out.push({ how: "keg", name: "Juice", unit: art(c.price * 2.25) });
    out.push({ how: "jar", name: "Pickles", unit: art(c.price * 2 + 50) });
  } else if (c.type === "special" && c.proc && c.proc.keg) {
    out.push({ how: "keg", name: c.proc.keg[0], unit: art(c.proc.keg[1]), note: c.proc.kegNote });
  }
  return out;
}
function bestProduct(c, opts) {
  const all = productOptions(c, opts);
  if (opts.proc === "best") return all.reduce((a, b) => (b.unit > a.unit ? b : a));
  return all.find(o => o.how === opts.proc) || all[0];   // flowers etc. can't be processed: sold raw
}

// Plan one plant put in the ground on ctx (season, day) and harvested until the crop dies.
function planCrop(c, ctx, opts) {
  const si = SEASONS.indexOf(ctx.season);
  if (!c.seasons.includes(ctx.season)) return null;
  let seasonsLeft = 0;
  while (seasonsLeft < 4 && c.seasons.includes(SEASONS[(si + seasonsLeft) % 4])) seasonsLeft++;
  const daysLeft = seasonsLeft * 28 - ctx.day;          // days until the crop dies at the end of its last season
  const g = growDays(c, opts);
  const product = bestProduct(c, opts), price = product.unit;
  const seed = seedCost(c, opts), cost = seed ? seed.price : 0;
  let harvests = 0, profit = 0, plantings = 1;
  if (g <= daysLeft) {
    if (c.regrow) { harvests = 1 + Math.floor((daysLeft - g) / c.regrow); profit = harvests * c.yield * price - cost; }
    else { plantings = Math.floor(daysLeft / g); harvests = plantings; profit = harvests * (c.yield * price - cost); }
  }
  const lastAbs = seasonsLeft * 28 - g;                   // last day (counted from day 1 of this season) to plant
  const last = lastAbs >= 1 ? { season: SEASONS[(si + Math.floor((lastAbs - 1) / 28)) % 4], day: ((lastAbs - 1) % 28) + 1 } : null;
  return { g, daysLeft, harvests, plantings, profit, perDay: harvests ? profit / daysLeft : 0, price, product, seed, last, ok: harvests > 0 };
}

function renderCrops(main) {
  const ctx = state.today, opts = { fert: "none", agri: false, tiller: false, artisan: false, proc: "raw", joja: true, jojaRoute: false, unsold: false, ...store.prefs.crops };
  if (!PROC[opts.proc]) opts.proc = "raw";
  if (!FERT[opts.fert]) opts.fert = "none";
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="controls">${conditionsHTML(ctx, "c")}</div>
    <div class="controls">
      <div class="ctl"><span>What you do with the harvest</span><div class="seg" id="c-proc">${Object.entries(PROC).map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${opts.proc === k}">${l}</button>`).join("")}</div></div>
      <div class="ctl"><span>Fertilizer</span><select id="c-fert">${Object.entries(FERT).map(([k, [l]]) => `<option value="${k}" ${opts.fert === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <label class="check"><input type="checkbox" id="c-agri" ${opts.agri ? "checked" : ""}> Agriculturist (grows 10% faster)</label>
      <label class="check"><input type="checkbox" id="c-tiller" ${opts.tiller ? "checked" : ""}> Tiller (raw crops sell for 10% more)</label>
      <label class="check"><input type="checkbox" id="c-artisan" ${opts.artisan ? "checked" : ""}> Artisan (artisan goods sell for 40% more)</label>
      <label class="check"><input type="checkbox" id="c-joja" ${opts.joja ? "checked" : ""}> Buy at JojaMart too</label>
      ${sveOn() ? `<label class="check"><input type="checkbox" id="c-jojaRoute" ${opts.jojaRoute ? "checked" : ""}> I'm on the Joja route (Joja Emporium seeds)</label>` : ""}
      <label class="check"><input type="checkbox" id="c-unsold" ${opts.unsold ? "checked" : ""}> Also show crops whose seeds aren't sold in shops (profit without seed cost)</label>
    </div>
    <p class="lede">For one plant put in the ground on <b>${ctx.season} ${ctx.day}</b>, kept until the crop dies at the end of its season. Profit is base-quality value × harvests, minus seeds (single-harvest crops are replanted each time). ${opts.proc === "raw" ? "" : "Processing assumes you have enough Kegs or Jars; a Keg takes about a week for Wine and 4 days for Juice, a Jar 2–3 days. "} Prices and days from the Stardew Valley wiki${sveOn() ? " and the SVE wiki" : ""}.</p>
    <div id="c-list"></div>`;
  main.appendChild(wrap);
  wireConditions(wrap, ctx, "c");
  const setOpt = (k, v) => { store.prefs.crops = { ...opts, [k]: v }; save(); render(); };
  $("c-fert").onchange = e => setOpt("fert", e.target.value);
  wrap.querySelectorAll("#c-proc button").forEach(b => b.onclick = () => setOpt("proc", b.dataset.p));
  for (const k of ["agri", "tiller", "artisan", "joja", "jojaRoute", "unsold"]) if ($("c-" + k)) $("c-" + k).onchange = e => setOpt(k, e.target.checked);

  const rows = cropList().map(c => ({ c, p: planCrop(c, ctx, opts) })).filter(r => r.p && (opts.unsold ? (opts.jojaRoute || !r.c.shops.some(s => s.shop === "Joja Emporium")) : r.p.seed));
  const good = rows.filter(r => r.p.ok && r.p.profit > 0).sort((a, b) => b.p.profit - a.p.profit);
  const loss = rows.filter(r => r.p.ok && r.p.profit <= 0).sort((a, b) => b.p.profit - a.p.profit);
  const late = rows.filter(r => !r.p.ok);
  const out = $("c-list");
  const row = ({ c, p }) => {
    const seedTxt = p.seed ? `${esc(c.seed || "Seeds")}: ${p.seed.price.toLocaleString()}g at ${esc(p.seed.shop)}` : `${esc(c.seed || "Seeds")}: not sold in shops`;
    const tags = [c.sve ? '<span class="tag sve">SVE</span>' : "", c.regrow ? `<span class="tag need">regrows every ${c.regrow}d</span>` : "", c.trellis ? '<span class="tag">trellis</span>' : "", c.giant ? '<span class="tag">giant crop</span>' : "", c.seasons.length > 1 ? `<span class="tag">${c.seasons.join(" + ")}</span>` : ""].join("");
    return `<article class="crop${p.ok ? "" : " late"}">
      <div class="chead"><img alt="" loading="lazy" src="${c.img}"><div class="cmeta"><h3>${esc(c.n)}</h3><div class="tags">${tags}</div></div>
        ${p.ok ? `<div class="cprofit"><b class="${p.profit < 0 ? "neg" : ""}">${p.profit.toLocaleString()}g</b><span>${p.perDay.toFixed(1)}g / day</span></div>` : '<div class="cprofit"><b class="neg">Too late</b></div>'}</div>
      <dl class="cstats">
        <div><dt>Grows in</dt><dd>${p.g} day${p.g === 1 ? "" : "s"}${p.g !== c.days ? ` <s>${c.days}</s>` : ""}</dd></div>
        <div><dt>Harvests left</dt><dd>${p.harvests}${c.yield > 1 ? ` × ${c.yield}` : ""}</dd></div>
        <div><dt>${p.product.how === "raw" ? "Sells for" : "As " + esc(p.product.name)}</dt><dd>${p.price.toLocaleString()}g</dd></div>
        <div><dt>Last day to plant</dt><dd>${p.last ? `${p.last.season} ${p.last.day}` : "—"}</dd></div>
      </dl>
      <p class="cseed">🌱 ${seedTxt}</p>${opts.proc !== "raw" && p.product.how === "raw" ? `<p class="gnote">${c.type === "flower" ? "Flowers can't go in a Keg or Jar, so this is the raw price (they do make nearby honey better)." : opts.proc === "best" ? "Selling raw pays most for this one." : "Can't be processed this way, so this is the raw price."}</p>` : ""}${p.product.note ? `<p class="gnote">${esc(p.product.note)}</p>` : ""}${c.note ? `<p class="gnote">${esc(c.note)}</p>` : ""}
    </article>`;
  };
  out.innerHTML = (good.length ? `<section><h2>Worth planting today<span>${good.length} crops · most profit first</span></h2><div class="cgrid">${good.map(row).join("")}</div></section>` : `<p class="empty">${ctx.season === "Winter" ? "Almost nothing grows outdoors in Winter. Try the greenhouse, or pick another season." : "Nothing will finish growing before the season ends. Try an earlier day."}</p>`)
    + (loss.length ? `<section><h2>Would lose money<span>ready in time, but the seeds cost more than you'd earn</span></h2><div class="cgrid">${loss.map(row).join("")}</div></section>` : "")
    + (late.length ? `<section><h2>Too late this season<span>won't be ready before ${ctx.season} ends</span></h2><div class="cgrid">${late.map(row).join("")}</div></section>` : "");
}

// ---------- COLLECTIONS: museum + shipping ----------
const colState = { part: "museum", kind: "", q: "", hide: false };
function colTile(item, part, sub, q) {
  const done = !!state.col[part][item.id];
  const b = document.createElement("button");
  b.type = "button";
  b.className = "item colitem" + (done ? " got" : "");
  b.setAttribute("aria-pressed", done);
  const hit = q && item.n.toLowerCase().includes(q);
  b.innerHTML = `<img alt="" loading="lazy" src="${item.img}"><span class="in"><b${hit ? ' class="hl"' : ""}>${esc(item.n)}</b>${item.sve ? ' <span class="tag sve">SVE</span>' : ""}<small>${esc(sub)}</small></span><span class="box" aria-hidden="true">${done ? "✓" : ""}</span>`;
  b.onclick = () => { if (done) delete state.col[part][item.id]; else state.col[part][item.id] = true; save(); render(); };
  return b;
}
function renderCollections(main) {
  const part = colState.part, q = colState.q.trim().toLowerCase();
  const museum = COLL.museum.filter(m => sveOn() || !m.sve), shipping = COLL.shipping.filter(s => sveOn() || !s.sve);
  const doneM = museum.filter(m => state.col.museum[m.id]).length, doneS = shipping.filter(s => state.col.shipping[s.id]).length;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="controls">
      <div class="ctl"><span>Collection</span><div class="seg" id="k-part"><button data-p="museum" aria-pressed="${part === "museum"}">🏛 Museum (${doneM}/${museum.length})</button><button data-p="shipping" aria-pressed="${part === "shipping"}">📦 Shipping (${doneS}/${shipping.length})</button></div></div>
      <div class="ctl" style="flex:1 1 200px"><span>Search</span><input type="search" id="k-q" value="${esc(colState.q)}" placeholder="${part === "museum" ? "e.g. Dwarf Scroll, Amethyst, Skull Cavern…" : "e.g. Truffle Oil, Mango, Coral…"}" style="font:inherit;padding:6px 10px;border:2px solid var(--line);border-radius:5px;background:var(--panel);color:var(--ink)"></div>
      ${part === "museum" ? `<div class="ctl"><span>Show</span><select id="k-kind"><option value="">Everything</option><option value="Artifact">Artifacts</option><option value="min">Minerals & gems</option></select></div>` : ""}
      <label class="check"><input type="checkbox" id="k-hide" ${colState.hide ? "checked" : ""}> Hide ${part === "museum" ? "donated" : "shipped"}</label>
    </div><div id="k-body"></div>`;
  main.appendChild(wrap);
  wrap.querySelectorAll("#k-part button").forEach(b => b.onclick = () => { colState.part = b.dataset.p; colState.kind = ""; render(); });
  if ($("k-kind")) { $("k-kind").value = colState.kind; $("k-kind").onchange = e => { colState.kind = e.target.value; render(); }; }
  $("k-hide").onchange = e => { colState.hide = e.target.checked; render(); };
  $("k-q").oninput = e => { colState.q = e.target.value; draw(); };
  const body = $("k-body");
  const head = document.createElement("div");
  if (part === "museum") {
    const arts = museum.filter(m => m.kind === "Artifact"), mins = museum.filter(m => m.kind !== "Artifact");
    const next = COLL.milestones.find(x => x.at > doneM);
    head.innerHTML = `<div class="stats">
        <div class="stat"><b>${doneM} / ${museum.length}</b><span>donated to the museum</span></div>
        <div class="stat"><b>${arts.filter(m => state.col.museum[m.id]).length} / ${arts.length}</b><span>artifacts</span></div>
        <div class="stat"><b>${mins.filter(m => state.col.museum[m.id]).length} / ${mins.length}</b><span>minerals & gems</span></div>
      </div>
      <details class="panel rewards"><summary><b>Museum rewards</b> · ${next ? `next at ${next.at} donations: ${esc(next.reward)}` : "all donation rewards collected"}</summary>
        <ul>${COLL.milestones.map(x => `<li class="${doneM >= x.at ? "got" : ""}"><b>${x.at}${x.at === 95 ? (sveOn() ? " vanilla items (all 102 in SVE)" : " (all items)") : ""}</b> ${esc(x.reward)}</li>`).join("")}</ul>
        <p class="lede" style="margin:6px 0">Gunther also gives rewards for special sets:</p>
        <ul>${COLL.special.map(x => `<li><b>${esc(x.need)}</b> → ${esc(x.reward)}</li>`).join("")}</ul>
      </details>`;
  } else {
    head.innerHTML = `<div class="stats">
        <div class="stat"><b>${doneS} / ${shipping.length}</b><span>items shipped (the Full Shipment achievement)</span></div>
        <div class="stat"><b>${shipping.length - doneS}</b><span>still to ship</span></div>
      </div>
      <p class="lede">Put one of each in the shipping bin. Fish have their own collection (the Fish tabs), and cooked dishes count on the Recipes tab.${sveOn() ? " Includes the 50 items SVE adds to the shipping tab (marked SVE)." : ""}</p>`;
  }
  body.appendChild(head);
  const out = document.createElement("div");
  body.appendChild(out);
  function draw() {
    const q = colState.q.trim().toLowerCase();
    out.innerHTML = "";
    if (part === "museum") {
      const list = museum.filter(m => (!colState.kind || (colState.kind === "Artifact" ? m.kind === "Artifact" : m.kind !== "Artifact")) && !(colState.hide && state.col.museum[m.id]) && (!q || (m.n + " " + m.where).toLowerCase().includes(q)));
      for (const [title, items] of [["Artifacts", list.filter(m => m.kind === "Artifact")], ["Minerals & gems", list.filter(m => m.kind !== "Artifact")]]) {
        if (!items.length) continue;
        const sec = document.createElement("section");
        sec.innerHTML = `<h2>${title}<span>${items.length} shown</span></h2><div class="colgrid"></div>`;
        items.forEach(m => sec.querySelector(".colgrid").appendChild(colTile(m, "museum", (m.kind !== "Artifact" ? m.kind + " · " : "") + m.where, q)));
        out.appendChild(sec);
      }
      if (!list.length) out.innerHTML = '<p class="empty">Nothing matches.</p>';
    } else {
      const list = shipping.filter(s => !(colState.hide && state.col.shipping[s.id]) && (!q || s.n.toLowerCase().includes(q)));
      const cats = ["Crop", "Fruit tree", "Forage", "Animal product", "Artisan good", "Resource", "Monster loot & rare find"];
      for (const c of cats) {
        const items = list.filter(s => s.cat === c);
        if (!items.length) continue;
        const all = shipping.filter(s => s.cat === c);
        const sec = document.createElement("section");
        sec.innerHTML = `<h2>${({ "Fruit tree": "Fruit trees", Forage: "Forage", "Monster loot & rare find": "Monster loot & rare finds" })[c] || c + "s"}<span>${all.filter(s => state.col.shipping[s.id]).length} / ${all.length} shipped</span></h2><div class="colgrid"></div>`;
        items.forEach(s => sec.querySelector(".colgrid").appendChild(colTile(s, "shipping", c, q)));
        out.appendChild(sec);
      }
      if (!list.length) out.innerHTML = '<p class="empty">Nothing matches.</p>';
    }
  }
  draw();
}

// ---------- RECIPES (cooking + crafting) ----------
const recState = { kind: "cooking", view: "list", q: "", src: "", unlock: "", hideMade: false, onlyMissing: true, hideHave: false };
const UNLOCK = { friend: ["❤", "Friendship"], tv: ["📺", "Queen of Sauce"], skill: ["⭐", "Skill level"], shop: ["🛒", "Buy"], quest: ["📜", "Quest / order"], event: ["🎬", "Event"], starter: ["✔", "Known from the start"] };
const ingImg = n => RECIPES.img[n] || BY_NAME[n]?.img || "";
function ingChip(name, qty, made, hit) {
  const src = ingImg(name);
  const pic = src ? `<img alt="" loading="lazy" src="${src}">` : `<span class="noimg" aria-hidden="true">${name.startsWith("Any ") ? "✱" : "?"}</span>`;
  return `<span class="gift ing${hit ? " hit" : ""}${made ? " madeof" : ""}" title="${made ? "Made from another recipe" : ""}">${pic}${esc(name)}${qty > 1 ? ` <b>×${qty}</b>` : ""}</span>`;
}
function recipeCard(r, kind, q) {
  const made = !!state.made[kind][r.id], [icon, label] = UNLOCK[r.k] || ["•", ""];
  const el = document.createElement("article");
  el.className = "recipe" + (r.sve ? " sve" : "") + (made ? " made" : "");
  const pic = RECIPES.img[r.n];
  el.innerHTML = `<div class="rhead">${pic ? `<img class="rpic" alt="" loading="lazy" src="${pic}">` : '<span class="rpic noimg">?</span>'}
      <div class="rmeta"><h3>${esc(r.n)}</h3><div class="tags">${r.sve ? '<span class="tag sve">SVE</span>' : ""}${r.cat ? `<span class="tag">${esc(r.cat)}</span>` : ""}${r.yield ? `<span class="tag need">makes ${r.yield}</span>` : ""}</div></div>
      <label class="rmade"><input type="checkbox" ${made ? "checked" : ""}> ${kind === "cooking" ? "Cooked" : "Crafted"}</label></div>
    <p class="unlock u-${r.k}" title="${esc(label)}"><span aria-hidden="true">${icon}</span> ${esc(r.src)}</p>
    <div class="gifts">${r.ing.map(([n, qty, m]) => ingChip(n, qty, m, q && n.toLowerCase().includes(q))).join("")}</div>${r.note ? `<p class="gnote">${esc(r.note)}</p>` : ""}`;
  el.querySelector("input").onchange = e => { if (e.target.checked) state.made[kind][r.id] = true; else delete state.made[kind][r.id]; save(); render(); };
  return el;
}
// Total of every ingredient across a list of recipes: [{n, qty, recipes:[names], made}]
function totals(list) {
  const m = new Map();
  for (const r of list) for (const [n, qty, made] of r.ing) {
    const e = m.get(n) || { n, qty: 0, recipes: [], made: !!made };
    e.qty += qty; e.recipes.push(r.n); m.set(n, e);
  }
  return [...m.values()].sort((a, b) => a.n.localeCompare(b.n));
}

function renderRecipes(main) {
  const kind = recState.kind, all = recipeList(kind), madeMap = state.made[kind];
  const madeCount = all.filter(r => madeMap[r.id]).length;
  const head = document.createElement("div");
  head.innerHTML = `<div class="controls">
      <div class="ctl"><span>Recipes</span><div class="seg" id="r-kind"><button data-k="cooking" aria-pressed="${kind === "cooking"}">🍳 Cooking (${recipeList("cooking").length})</button><button data-k="crafting" aria-pressed="${kind === "crafting"}">🔨 Crafting (${recipeList("crafting").length})</button></div></div>
      <div class="ctl"><span>Show</span><div class="seg" id="r-view"><button data-v="list" aria-pressed="${recState.view === "list"}">Recipe list</button><button data-v="shop" aria-pressed="${recState.view === "shop"}">Ingredients for everything</button></div></div>
    </div>
    <div class="stats">
      <div class="stat"><b>${madeCount} / ${all.length}</b><span>${kind === "cooking" ? "dishes cooked" : "items crafted"} on this farm${kind === "cooking" ? " (Gourmet Chef needs every vanilla one)" : " (Craft Master needs every vanilla one)"}</span></div>
      <div class="stat"><b>${all.filter(r => r.k === "friend").length}</b><span>need friendship ❤ to unlock</span></div>
    </div>
    <div id="r-body"></div>`;
  main.appendChild(head);
  head.querySelectorAll("#r-kind button").forEach(b => b.onclick = () => { recState.kind = b.dataset.k; render(); });
  head.querySelectorAll("#r-view button").forEach(b => b.onclick = () => { recState.view = b.dataset.v; render(); });
  const body = $("r-body");
  if (recState.view === "shop") return renderShopping(body, kind, all);

  body.innerHTML = `<div class="controls">
      <div class="ctl" style="flex:1 1 240px"><span>Search a recipe or an ingredient</span><input type="search" id="r-q" value="${esc(recState.q)}" placeholder="e.g. Pink Cake, Egg, Iron Bar…" style="font:inherit;padding:6px 10px;border:2px solid var(--line);border-radius:5px;background:var(--panel);color:var(--ink)"></div>
      
      <div class="ctl"><span>Unlocked by</span><select id="r-unlock"><option value="">Anything</option>${Object.entries(UNLOCK).map(([k, [i, l]]) => `<option value="${k}">${i} ${l}</option>`).join("")}</select></div>
      <label class="check"><input type="checkbox" id="r-hide" ${recState.hideMade ? "checked" : ""}> Hide ${kind === "cooking" ? "cooked" : "crafted"}</label>
    </div>
    <p class="lede">❤ friendship · 📺 Queen of Sauce (TV, Sundays and Wednesday reruns) · ⭐ skill level · 🛒 buy · 📜 quest or special order · 🎬 event · ✔ known from the start. Ingredients with a dashed border are made with another recipe.</p>
    <div id="r-list"></div>`;
  $("r-unlock").value = recState.unlock;
  $("r-unlock").onchange = e => { recState.unlock = e.target.value; draw(); };
  $("r-hide").onchange = e => { recState.hideMade = e.target.checked; draw(); };
  $("r-q").oninput = e => { recState.q = e.target.value; draw(); };
  function draw() {
    const q = recState.q.trim().toLowerCase(), out = $("r-list");
    out.innerHTML = "";
    const list = all.filter(r => (!recState.unlock || r.k === recState.unlock) && !(recState.hideMade && madeMap[r.id]));
    if (q) {
      const byName = list.filter(r => r.n.toLowerCase().includes(q));
      const uses = list.filter(r => !byName.includes(r) && r.ing.some(([n]) => n.toLowerCase().includes(q)));
      const grp = (title, rs) => { if (!rs.length) return; const sec = document.createElement("section"); sec.innerHTML = `<h2>${title}<span>${rs.length}</span></h2><div class="rgrid"></div>`; rs.forEach(r => sec.querySelector(".rgrid").appendChild(recipeCard(r, kind, q))); out.appendChild(sec); };
      grp("Recipes", byName); grp(`Uses “${esc(recState.q.trim())}”`, uses);
      if (!byName.length && !uses.length) out.innerHTML = '<p class="empty">No recipe or ingredient matches that.</p>';
      return;
    }
    const groups = new Map();
    for (const r of list) { const g = kind === "crafting" ? r.cat : (r.sve ? "SVE recipes" : "Vanilla recipes"); (groups.get(g) || groups.set(g, []).get(g)).push(r); }
    for (const [g, rs] of groups) {
      const sec = document.createElement("section");
      sec.innerHTML = `<h2>${esc(g)}<span>${rs.filter(r => madeMap[r.id]).length} / ${rs.length} made</span></h2><div class="rgrid"></div>`;
      rs.forEach(r => sec.querySelector(".rgrid").appendChild(recipeCard(r, kind, "")));
      out.appendChild(sec);
    }
    if (!list.length) out.innerHTML = '<p class="empty">No recipes match these filters.</p>';
  }
  draw();
}

function renderShopping(body, kind, all) {
  const shop = state.shop[kind], madeMap = state.made[kind];
  const recipes = recState.onlyMissing ? all.filter(r => !madeMap[r.id]) : all;
  const rows = totals(recipes);
  const have = rows.filter(r => shop[r.n]).length;
  body.innerHTML = `<div class="controls">
      <label class="check"><input type="checkbox" id="s-missing" ${recState.onlyMissing ? "checked" : ""}> Only recipes I haven't ${kind === "cooking" ? "cooked" : "crafted"} yet (${recipes.length})</label>
      <label class="check"><input type="checkbox" id="s-hide" ${recState.hideHave ? "checked" : ""}> Hide ingredients I've ticked</label>
      <button type="button" class="btn small ghost" id="s-reset">Untick all</button>
    </div>
    <p class="lede">Everything you need to ${kind === "cooking" ? "cook" : "craft"} ${recState.onlyMissing ? "the recipes you haven't made yet" : "every recipe"} once. Tick an ingredient when you have the full amount. <b>${have} / ${rows.length}</b> ready. Ingredients made with another recipe are listed too, so make those first.</p>
    <div class="panel shoplist"><ul id="s-list"></ul></div>`;
  const ul = $("s-list");
  for (const r of rows) {
    if (recState.hideHave && shop[r.n]) continue;
    const li = document.createElement("li");
    li.className = "srow" + (shop[r.n] ? " got" : "");
    const src = ingImg(r.n);
    li.innerHTML = `<label><input type="checkbox" ${shop[r.n] ? "checked" : ""}>${src ? `<img alt="" loading="lazy" src="${src}">` : '<span class="noimg">✱</span>'}<span class="sname">${esc(r.n)}${r.made ? ' <span class="tag">made with a recipe</span>' : ""}</span><span class="sqty">×${r.qty.toLocaleString()}</span></label>
      <details><summary>for ${r.recipes.length} recipe${r.recipes.length === 1 ? "" : "s"}</summary><p>${[...new Set(r.recipes)].map(esc).join(", ")}</p></details>`;
    li.querySelector("input").onchange = e => { if (e.target.checked) shop[r.n] = true; else delete shop[r.n]; save(); render(); };
    ul.appendChild(li);
  }
  if (!ul.children.length) ul.innerHTML = '<li class="tempty">Nothing left on the list.</li>';
  $("s-missing").onchange = e => { recState.onlyMissing = e.target.checked; render(); };
  $("s-hide").onchange = e => { recState.hideHave = e.target.checked; render(); };
  $("s-reset").onclick = () => { state.shop[kind] = {}; save(); render(); };
}

// ---------- ALL FISH ----------
const listFilter = { q: "", src: "", cat: "", hide: false, season: "All" };
function renderFish(main) {
  const needs = bundleNeeds(), got = caught();
  const bar = document.createElement("div");
  bar.innerHTML = `<div class="controls">
    <div class="ctl"><span>Season</span><div class="seg" id="f-season">${["All", ...SEASONS].map(s => `<button data-s="${s}" style="--c:${SC[s] || "var(--accent)"}" aria-pressed="${listFilter.season === s}">${s}</button>`).join("")}</div></div>
    <div class="ctl" style="flex:1 1 200px"><span>Search</span><input type="search" id="f-q" value="${esc(listFilter.q)}" placeholder="Fish or location…" style="font:inherit;padding:6px 10px;border:2px solid var(--line);border-radius:5px;background:var(--panel);color:var(--ink)"></div>
    
    <div class="ctl"><span>Type</span><select id="f-cat"><option value="">All types</option><option>Fish</option><option>Legendary</option><option>Legendary II</option><option>Crab Pot</option><option>Night Market</option></select></div>
    <label class="check"><input type="checkbox" id="f-hide" ${listFilter.hide ? "checked" : ""}> Hide caught</label></div>`;
  main.appendChild(bar);
  $("f-cat").value = listFilter.cat;
  bar.querySelectorAll("#f-season button").forEach(b => b.onclick = () => { listFilter.season = b.dataset.s; render(); });
  $("f-q").oninput = e => { listFilter.q = e.target.value; drawList(); };
  $("f-cat").onchange = e => { listFilter.cat = e.target.value; drawList(); };
  $("f-hide").onchange = e => { listFilter.hide = e.target.checked; drawList(); };
  const out = document.createElement("div");
  main.appendChild(out);
  function drawList() {
    out.innerHTML = "";
    const q = listFilter.q.trim().toLowerCase();
    const list = fishList().filter(f => (listFilter.season === "All" || f.ss.includes(listFilter.season)) && (!listFilter.cat || f.c === listFilter.cat) && (!listFilter.hide || !got.has(f.n)) && (!q || (f.n + " " + f.l + " " + f.a).toLowerCase().includes(q)));
    const groups = {};
    for (const f of list) (groups[f.a] ??= []).push(f);
    for (const a of ORDER) if (groups[a]) {
      const allHere = fishList().filter(f => f.a === a && (listFilter.season === "All" || f.ss.includes(listFilter.season)));
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
  const fish = fishList().filter(f => mode === "all" || !got.has(f.n));
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
    const total = fishList().filter(f => f.spots.includes(s.id)).length;
    if (!total) continue;
    const here = f => availableOn(f, ctx, s.id);
    const live = list.filter(here), cleared = mode === "todo" && !list.length, dim = !cleared && !live.length;
    const pin = document.createElementNS(NS, "g");
    pin.setAttribute("class", "pin" + (mapState.spot === s.id ? " sel" : "") + (cleared ? " clear" : "") + (dim ? " dim" : "") + (OFFMAP.has(s.id) ? " off" : ""));
    pin.setAttribute("tabindex", "0");
    pin.setAttribute("role", "button");
    pin.setAttribute("aria-label", `${s.nm}: ${live.length} fish catchable now`);
    // catchable fish first, then the rest faded
    const show = [...live, ...list.filter(f => !here(f))].slice(0, 3), n = show.length, w = Math.max(n * 30 + 8, 46);
    let inner = `<rect x="${s.x - w / 2}" y="${s.y - 20}" width="${w}" height="38" rx="8" class="pinbox"/>`;
    show.forEach((f, i) => { inner += `<image href="${f.img}" x="${s.x - w / 2 + 6 + i * 30}" y="${s.y - 17}" width="30" height="30" class="pix${here(f) ? "" : " off"}${got.has(f.n) ? " got" : ""}"/>`; });
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
    const here = f => availableOn(f, ctx, s.id);
    const live = list.filter(here), later = list.filter(f => !here(f));
    const sec = section(s.nm, `${live.length} catchable now${later.length ? ` · ${later.length} not right now` : ""}`, live.map(f => card(f, { needs: needs[f.n], wx: ctx.rain && f.w === "Rain", gi: s.id === "ginger" && gingerOnly(f, ctx) })));
    if (!live.length) sec.querySelector(".grid").innerHTML = `<p class="empty">${list.length ? "Nothing bites here on " + esc(when) + "." : "All caught here."}</p>`;
    panel.appendChild(sec);
    if (later.length) {
      const sec2 = section("Not right now", "change the season, weather or time to catch these", later.map(f => { const c = card(f, { needs: needs[f.n] }); c.classList.add("later"); c.querySelector(".nm").insertAdjacentHTML("beforeend", `<span class="why">${esc(whyNot(f, ctx, s.id))}</span>`); return c; }));
      panel.appendChild(sec2);
    }
  } else panel.innerHTML = '<p class="empty">Tap a spot on the map to list its fish.</p>';
}

// ---------- BACKUP ----------
// Add progress from `v` into farm `f` (never unticks anything). Returns counts.
function mergeInto(f, v) {
  const known = (Array.isArray(v) ? v : v.caught || []).filter(n => BY_NAME[n]);
  f.caught = [...new Set([...f.caught, ...known])];
  let items = 0;
  if (v.bundles && typeof v.bundles === "object") for (const [id, arr] of Object.entries(v.bundles)) {
    if (!Array.isArray(arr)) continue;
    f.bundles[id] = [...new Set([...(f.bundles[id] || []), ...arr.filter(Number.isInteger)])];
    items += arr.length;
  }
  if (v.done && typeof v.done === "object") for (const id of Object.keys(v.done)) if (v.done[id]) { f.done[id] = true; items++; }
  for (const k of ["museum", "shipping"]) if (v.col && v.col[k]) for (const id in v.col[k]) if (v.col[k][id]) f.col[k][id] = true;
  for (const k of ["cooking", "crafting"]) {
    if (v.made && v.made[k]) for (const id in v.made[k]) if (v.made[k][id]) f.made[k][id] = true;
    if (v.shop && v.shop[k]) for (const id in v.shop[k]) if (v.shop[k][id]) f.shop[k][id] = true;
  }
  if (Array.isArray(v.todos)) {
    const ids = new Set((f.todos || []).map(t => t.id));
    f.todos = [...(f.todos || []), ...v.todos.filter(t => t && t.id && !ids.has(t.id))];
  }
  return { fish: known.length, items };
}

function renderBackup(main) {
  const div = document.createElement("div");
  div.className = "stack";
  div.style.marginTop = "18px";
  const nFarms = Object.keys(store.farms).length;
  div.innerHTML = `
    <div class="panel stack" id="k-cloud" hidden></div>
    <div class="panel stack">
      <h2 style="font-family:var(--display);font-weight:500;margin:0">Save a backup</h2>
      <p class="lede" style="margin:0">Your progress lives in this browser only. The backup file holds all ${nFarms} farm${nFarms === 1 ? "" : "s"}. Download one now and then, or to move to another device.</p>
      <div><button class="btn primary" id="k-export">Download backup file</button></div>
    </div>
    <div class="panel stack">
      <h2 style="font-family:var(--display);font-weight:500;margin:0">Restore or move progress</h2>
      <p class="lede" style="margin:0">A backup file brings back all its farms (a farm with the same name gets merged). A pasted progress code, like the one from the Claude version of this tracker, is added to <b>${esc(state.name)}</b>. Nothing gets unticked.</p>
      <input type="file" id="k-file" accept="application/json,.json">
      <textarea id="k-code" placeholder='Paste a progress code, e.g. {"caught":["Anchovy","Carp"]}'></textarea>
      <div><button class="btn primary" id="k-import">Import code</button></div>
      <p class="msg" id="k-msg" role="status"></p>
    </div>
    <div class="panel stack">
      <h2 style="font-family:var(--display);font-weight:500;margin:0">Start this farm over</h2>
      <p class="lede" style="margin:0">Clears every ticked fish and bundle on <b>${esc(state.name)}</b>. Other farms aren't touched. Download a backup first if you might want it back.</p>
      <div><button class="btn" id="k-reset">Clear this farm</button> <span id="k-confirm"></span></div>
    </div>`;
  main.appendChild(div);
  $("k-export").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "junimo-planner", version: 2, savedAt: new Date().toISOString(), active: store.active, farms: store.farms }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `junimo-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importText = text => {
    let v;
    try { v = JSON.parse(text); } catch (e) { $("k-msg").textContent = "That isn't a valid progress code or backup. Copy the whole code, including the curly brackets."; return; }
    if (v && v.farms && typeof v.farms === "object") {
      let added = 0, merged = 0;
      for (const f of Object.values(v.farms)) {
        const name = String(f.name || "Imported farm").slice(0, 40);
        const same = Object.values(store.farms).find(x => x.name === name);
        if (same) { mergeInto(same, f); merged++; }
        else {
          let n = 1; while (store.farms["farm-" + n]) n++;
          const nf = fixFarm({ ...newFarm(name), today: f.today, qi: !!f.qi }, name);
          mergeInto(nf, f);
          store.farms["farm-" + n] = nf; added++;
        }
      }
      save(); render();
      $("k-msg").textContent = `Restored the backup: ${added} new farm${added === 1 ? "" : "s"}, ${merged} merged.`;
      return;
    }
    const r = mergeInto(state, v);
    save(); render();
    $("k-msg").textContent = `Added ${r.fish} fish${r.items ? ` and ${r.items} bundle entries` : ""} to ${state.name}.`;
  };
  $("k-import").onclick = () => importText($("k-code").value);
  $("k-file").onchange = e => { const f = e.target.files[0]; if (f) f.text().then(importText); };
  $("k-reset").onclick = () => {
    $("k-confirm").innerHTML = '<button class="btn danger" id="k-yes">Yes, clear this farm</button>';
    $("k-yes").onclick = () => { state.caught = []; state.bundles = {}; state.done = {}; save(); render(); };
  };
}

// ---------- farm picker ----------
let farmMode = null; // null | "new" | "rename" | "delete"
function renderFarmBar() {
  const bar = $("farmbar"), ids = Object.keys(store.farms);
  const opts = ids.map(id => `<option value="${id}" ${id === store.active ? "selected" : ""}>${esc(store.farms[id].name)}</option>`).join("");
  let extra = "";
  if (farmMode === "new" || farmMode === "rename") {
    extra = `<form id="fm-form" class="farmform"><input id="fm-name" maxlength="40" required placeholder="Farm name" aria-label="Farm name" value="${farmMode === "rename" ? esc(state.name) : ""}"><button class="btn small primary" type="submit">${farmMode === "new" ? "Create farm" : "Save name"}</button><button class="btn small" type="button" id="fm-cancel">Cancel</button></form>`;
  } else if (farmMode === "delete") {
    extra = `<span class="bulk"><span class="sure">Delete “${esc(state.name)}” and all its progress?</span><button class="btn small danger" id="fm-yes" type="button">Yes, delete</button><button class="btn small" id="fm-cancel" type="button">Cancel</button></span>`;
  } else {
    extra = `<button class="btn small" id="fm-new" type="button">+ New farm</button><button class="btn small ghost" id="fm-rename" type="button">Rename</button>${ids.length > 1 ? '<button class="btn small ghost" id="fm-del" type="button">Delete</button>' : ""}`;
  }
  bar.innerHTML = `<label for="fm-pick">Farm</label><select id="fm-pick">${opts}</select><span class="farmextra${farmMode ? " active" : ""}">${extra}</span>`;
  $("fm-pick").onchange = e => { farmMode = null; switchFarm(e.target.value); };
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("fm-new", () => { farmMode = "new"; renderFarmBar(); $("fm-name").focus(); });
  on("fm-rename", () => { farmMode = "rename"; renderFarmBar(); $("fm-name").select(); });
  on("fm-del", () => { farmMode = "delete"; renderFarmBar(); });
  on("fm-cancel", () => { farmMode = null; renderFarmBar(); });
  on("fm-yes", () => {
    delete store.farms[store.active];
    farmMode = null;
    switchFarm(Object.keys(store.farms)[0]);
  });
  const form = $("fm-form");
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const name = $("fm-name").value.trim();
    if (!name) return;
    if (farmMode === "new") {
      let n = 1; while (store.farms["farm-" + n]) n++;
      store.farms["farm-" + n] = newFarm(name);
      farmMode = null;
      switchFarm("farm-" + n);
    } else {
      state.name = name; farmMode = null; save(); render();
    }
  };
}

// ---------- account (optional Google sign-in) ----------
function renderAccount() {
  const el = $("account");
  if (!el) return;
  el.hidden = !cloud.enabled;
  if (!cloud.enabled) return;
  const u = cloud.currentUser(), s = cloud.syncStatus();
  if (!u) {
    el.innerHTML = s === "error"
      ? '<span class="sync err">Sign-in is unavailable right now. Progress is saved in this browser.</span>'
      : '<button class="btn small google" id="ac-in" type="button"><span aria-hidden="true">G</span> Sign in with Google</button><span class="sync">to keep progress on every device</span>';
    const b = $("ac-in");
    if (b) b.onclick = () => { b.disabled = true; b.textContent = "Opening Google…"; cloud.signIn(); };
  } else {
    const label = { syncing: "Saving…", synced: "Synced", error: "Couldn't sync, saved in this browser" }[s] || "";
    el.innerHTML = `<span class="sync ${s === "error" ? "err" : ""}">☁ ${label}</span><span class="who">${esc(u.email || "Signed in")}</span><button class="btn small ghost" id="ac-out" type="button">Sign out</button>`;
    $("ac-out").onclick = () => cloud.signOut();
  }
  if (route() === "backup") { const p = $("k-cloud"); if (p) renderCloudPanel(p); }
}
function renderCloudPanel(p) {
  const u = cloud.currentUser();
  if (!cloud.enabled) { p.hidden = true; return; }
  p.hidden = false;
  p.innerHTML = `<h2 style="font-family:var(--display);font-weight:500;margin:0">Your account</h2>` + (u
    ? `<p class="lede" style="margin:0">Signed in as <b>${esc(u.email || "")}</b>. Your farms are saved to your account and in this browser. Signing out keeps the copy in this browser.</p>
       <div><button class="btn" id="k-del" type="button">Delete my cloud save</button> <span id="k-delc"></span></div>`
    : `<p class="lede" style="margin:0">Sign in with Google (top of the page) to keep your farms on every device. It's optional: without it, progress stays in this browser.</p>`)
    + `<p class="lede" style="margin:0;font-size:.8rem">Privacy: signing in stores your Google email address and your tracker progress with Supabase, only so it can sync. Nothing else is collected and nothing is shared.</p>`;
  const del = $("k-del");
  if (del) del.onclick = () => {
    $("k-delc").innerHTML = '<button class="btn danger" id="k-dely" type="button">Yes, delete it</button>';
    $("k-dely").onclick = async () => {
      const ok = await cloud.deleteCloudSave();
      $("k-msg").textContent = ok ? "Your cloud save is deleted and you're signed out. The copy in this browser is still here." : "Couldn't delete the cloud save. Check your connection and try again.";
    };
  };
}

// ---------- Game: Vanilla / SVE modded (whole site) ----------
function paintGameSwitch() {
  const box = $("game");
  if (!box) return;
  box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.g === "sve") === sveOn()));
  const sub = document.querySelector("h1 small");
  if (sub) sub.textContent = (sveOn() ? "Stardew Valley Expanded planner" : "Stardew Valley planner") + " · progress saves in your browser, or sign in to sync";
}
if ($("game")) $("game").querySelectorAll("button").forEach(b => b.onclick = () => { store.prefs.sve = b.dataset.g === "sve"; save(); render(); });

// ---------- phone menu: on small screens the less-used header controls fold into ☰ Menu ----------
if ($("menubtn")) $("menubtn").onclick = () => {
  const open = document.querySelector("header").classList.toggle("open");
  $("menubtn").setAttribute("aria-expanded", open);
  $("menubtn").textContent = open ? "✕ Close" : "☰ Menu";
};

// ---------- Day / Night theme (remembered on this device) ----------
const THEME_KEY = "sve-tracker:theme";
function paintThemeButton() {
  const b = $("theme"), dark = document.documentElement.dataset.theme === "dark";
  if (!b) return;
  b.textContent = dark ? "☀ Day" : "🌙 Night";
  b.setAttribute("aria-label", dark ? "Switch to day theme" : "Switch to night theme");
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== "dark";
  if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch (e) {}
  paintThemeButton();
}
if ($("theme")) { $("theme").onclick = toggleTheme; paintThemeButton(); }

// ---------- shell ----------
const ROUTES = { today: renderToday, bundles: renderBundles, villagers: renderVillagers, crops: renderCrops, recipes: renderRecipes, collections: renderCollections, fish: renderFish, map: renderMap, backup: renderBackup };
function route() { const r = location.hash.slice(1); return ROUTES[r] ? r : "today"; }

function render() {
  const r = route(), main = $("view"), y = window.scrollY;
  document.querySelectorAll("nav.main a").forEach(a => { if (a.getAttribute("href") === "#" + r) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  main.innerHTML = "";
  renderFarmBar();
  paintGameSwitch();
  ROUTES[r](main);
  renderAccount();
  window.scrollTo(0, y);
  const got = caught(), shown = fishList(), tot = shown.length;
  $("tot").textContent = tot;
  $("cnt").textContent = shown.filter(f => got.has(f.n)).length;
  $("barfill").style.width = (shown.filter(f => got.has(f.n)).length / tot * 100) + "%";
  $("mini").innerHTML = SEASONS.map(s => { const a = shown.filter(f => f.ss.includes(s)); return `<span style="--c:${SC[s]}">${s} ${a.filter(f => got.has(f.n)).length}/${a.length}</span>`; }).join("");
}
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
window.addEventListener("storage", e => { if (e.key === STORE_KEY) { store = load(); state = store.farms[store.active]; render(); } });

Promise.all([fetch(dataUrl("fish")).then(r => r.json()), fetch(dataUrl("bundles")).then(r => r.json()), fetch(dataUrl("villagers")).then(r => r.json()), fetch(dataUrl("recipes")).then(r => r.json()), fetch(dataUrl("crops")).then(r => r.json()), fetch(dataUrl("collections")).then(r => r.json())])
  .then(([fd, bd, vd, rd, cd, kd]) => {
    COLL = kd;
    CROPS = cd.crops;
    RECIPES = { cooking: [], crafting: [], ...rd, img: rd.img || {} };
    FISH = fd.fish; ORDER = fd.order; SETS = bd.sets; VILLAGERS = vd.villagers; UNIVERSAL = vd.universal; ITEM_IMG = vd.itemImg || {};
    for (const f of FISH) {
      BY_NAME[f.n] = f;
      // check each listed place on its own, so "Sewers, Mutant Bug Lair" puts the fish on both spots
      const parts = f.l.toLowerCase().split(/[,;|]/).map(s => s.trim()).filter(Boolean);
      f.spots = SPOTS.filter(s => parts.some(part => s.t(part))).map(s => s.id);
    }
    render();
    cloud.start({ getStore: () => store, replaceStore, mergeStores, onChange: renderAccount });
  })
  .catch(() => { $("view").innerHTML = '<p class="empty">Couldn\'t load the fish data. If you opened index.html straight from your computer, run it through a local server instead (see README).</p>'; });
