// SVE Fish Log — plain JavaScript, no build step.
// Progress lives in localStorage under STORE_KEY; everything else is static data in /data.
// The store holds several farms (one per save file); `state` always points at the active farm.

import * as cloud from "./cloud.js";

const STORE_KEY = "sve-tracker:v1";
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
const SC = { Spring: "var(--sp)", Summer: "var(--su)", Fall: "var(--fa)", Winter: "var(--wi)" };

let FISH = [], ORDER = [], SETS = {}, BY_NAME = {}, VILLAGERS = [], UNIVERSAL = { vanilla: [], sve: [] }, ITEM_IMG = {};
let store = load();
let state = store.farms[store.active];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- storage ----------
function newFarm(name) {
  return { name, bundleSet: "sve", caught: [], bundles: {}, done: {}, todos: [], qi: false, today: { year: 1, season: "Spring", day: 1, rain: false, hour: "" } };
}
function fixFarm(f, name) {
  const b = newFarm(name);
  // farms saved before bundle sets existed used the standard bundles
  return { ...b, bundleSet: "vanilla", ...f, today: { ...b.today, ...(f && f.today) }, done: { ...(f && f.done) }, todos: Array.isArray(f && f.todos) ? f.todos : [] };
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

function availableOn(f, ctx) {
  if (!f.ss.includes(ctx.season)) return false;
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
// A bundle is done when enough items are ticked, or when it was marked "All done" in one go.
const bundleDone = b => !!state.done[b.id] || donated(b.id).size >= b.need;
// Each farm picks a bundle set (standard, SVE Normal or SVE Hard). Bundle ids differ per set,
// so progress in one set is kept if the farm switches to another and back.
const rooms = () => (SETS[state.bundleSet] || SETS.vanilla).rooms;
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
  if (!f.r) return "";
  const list = f.r.map(r => `<b>${esc(r.n)}</b>${r.q > 1 ? ` (×${r.q})` : ""}${r.w ? ` <span class="with">+ ${esc(r.w)}</span>` : ""}${r.sve ? ' <span class="tag sve">SVE</span>' : ""}`).join("; ");
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
function whyNot(f, ctx) {
  if (!f.ss.includes(ctx.season)) return f.ss.length === 4 ? "" : "Only in " + f.ss.join(", ");
  if (f.w === "Rain" && !ctx.rain) return "Needs rain";
  if (f.w === "Sun" && ctx.rain) return "Not in the rain";
  if (f.c === "Night Market" && !(ctx.season === "Winter" && ctx.day >= 15 && ctx.day <= 17)) return "Night Market only (Winter 15–17)";
  if (f.c === "Legendary II" && !state.qi) return "Only during Qi's Extended Family quest";
  if (ctx.hour !== "" && ctx.hour != null && !availableOn(f, ctx)) return "Bites " + f.t;
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
  const avail = FISH.filter(f => availableOn(f, ctx));
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
    <div class="stat"><b>${FISH.filter(f => leavesAfter(f, ctx.season) && !got.has(f.n) && f.c !== "Legendary II").length}</b><span>uncaught fish leave after ${ctx.season} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</span></div>
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
    <div class="setbar panel"><div><b>Bundle set</b><p class="lede" style="margin:2px 0 0">Pick the bundles your save uses. SVE asks for Normal or Hard when you create the save; “Standard” is the unmodded game. Each set keeps its own progress.</p></div>
      <div class="seg" id="b-set">${Object.entries(SETS).map(([id, s]) => `<button type="button" data-set="${id}" aria-pressed="${(SETS[state.bundleSet] ? state.bundleSet : "vanilla") === id}">${esc(s.label)}</button>`).join("")}</div></div>
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
const birthdaysOn = (season, day) => VILLAGERS.filter(v => v.b && v.b.s === season && v.b.d === day);
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
      <div class="ctl"><span>Show</span><div class="seg" id="v-who">${[["all", "Everyone"], ["marry", "Marriage"], ["sve", "SVE only"]].map(([k, l]) => `<button data-w="${k}" aria-pressed="${vilFilter.who === k}">${l}</button>`).join("")}</div></div>
    </div>
    <section><h2>${season} birthdays<span>${season === ctx.season ? `today is ${ctx.season} ${ctx.day} (set on the Today tab)` : "tap a birthday to jump to that villager"}</span></h2><div class="cal" id="v-cal"></div></section>
    <div class="univbox"><b>Everyone loves</b> (almost) these, and a birthday gift counts 8× towards friendship:<div class="gifts" style="margin-top:6px">${UNIVERSAL.vanilla.map(i => giftChip(i, false)).join("")}${UNIVERSAL.sve.map(i => giftChip(i, false)).join("")}</div></div>
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
    let list = VILLAGERS.filter(v => vilFilter.who === "all" || (vilFilter.who === "marry" ? v.marry : v.sve));
    if (q) {
      const byName = list.filter(v => v.n.toLowerCase().includes(q));
      const loves = list.filter(v => !byName.includes(v) && v.l.some(i => i.toLowerCase().includes(q)));
      const likes = list.filter(v => !byName.includes(v) && !loves.includes(v) && v.k.some(i => i.toLowerCase().includes(q)));
      const universal = [...UNIVERSAL.vanilla, ...UNIVERSAL.sve].filter(i => i.toLowerCase().includes(q));
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
    const blob = new Blob([JSON.stringify({ app: "sve-fish-log", version: 2, savedAt: new Date().toISOString(), active: store.active, farms: store.farms }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sve-fish-log-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
  bar.innerHTML = `<label for="fm-pick">Farm</label><select id="fm-pick">${opts}</select>${extra}`;
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

// ---------- shell ----------
const ROUTES = { today: renderToday, bundles: renderBundles, villagers: renderVillagers, fish: renderFish, map: renderMap, backup: renderBackup };
function route() { const r = location.hash.slice(1); return ROUTES[r] ? r : "today"; }

function render() {
  const r = route(), main = $("view"), y = window.scrollY;
  document.querySelectorAll("nav.main a").forEach(a => { if (a.getAttribute("href") === "#" + r) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  main.innerHTML = "";
  renderFarmBar();
  ROUTES[r](main);
  renderAccount();
  window.scrollTo(0, y);
  const got = caught(), tot = FISH.length;
  $("tot").textContent = tot;
  $("cnt").textContent = FISH.filter(f => got.has(f.n)).length;
  $("barfill").style.width = (FISH.filter(f => got.has(f.n)).length / tot * 100) + "%";
  $("mini").innerHTML = SEASONS.map(s => { const a = FISH.filter(f => f.ss.includes(s)); return `<span style="--c:${SC[s]}">${s} ${a.filter(f => got.has(f.n)).length}/${a.length}</span>`; }).join("");
}
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
window.addEventListener("storage", e => { if (e.key === STORE_KEY) { store = load(); state = store.farms[store.active]; render(); } });

Promise.all([fetch("data/fish.json").then(r => r.json()), fetch("data/bundles.json").then(r => r.json()), fetch("data/villagers.json").then(r => r.json())])
  .then(([fd, bd, vd]) => {
    FISH = fd.fish; ORDER = fd.order; SETS = bd.sets; VILLAGERS = vd.villagers; UNIVERSAL = vd.universal; ITEM_IMG = vd.itemImg || {};
    for (const f of FISH) { BY_NAME[f.n] = f; const l = f.l.toLowerCase(); f.spots = SPOTS.filter(s => s.t(l)).map(s => s.id); }
    render();
    cloud.start({ getStore: () => store, replaceStore, mergeStores, onChange: renderAccount });
  })
  .catch(() => { $("view").innerHTML = '<p class="empty">Couldn\'t load the fish data. If you opened index.html straight from your computer, run it through a local server instead (see README).</p>'; });
