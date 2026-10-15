// Optional cloud save: "Sign in with Google" through Supabase.
// The site always saves in the browser first; when someone is signed in, the same
// data is also kept in their row of the `progress` table (see supabase/schema.sql).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const SYNCED_KEY = "sve-tracker:synced-user"; // which account this browser last synced with

let sb = null, user = null, hooks = null, pushTimer = null;
let status = "off"; // off | signed-out | syncing | synced | error

export const currentUser = () => user;
export const syncStatus = () => status;

function setStatus(s) { status = s; hooks?.onChange(); }

// hooks: { getStore(), replaceStore(data), mergeStores(cloud, local), onChange() }
export async function start(h) {
  hooks = h;
  if (!enabled) return;
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm");
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  } catch (e) {
    setStatus("error");
    return;
  }
  sb.auth.onAuthStateChange((event, session) => {
    const next = session?.user || null;
    const changed = next?.id !== user?.id;
    user = next;
    if (!user) { setStatus("signed-out"); return; }
    if (changed) setTimeout(pull, 0); // outside the auth callback, as Supabase recommends
  });
  // after the Google redirect the URL carries ?code=…; tidy it away once Supabase has used it
  if (new URLSearchParams(location.search).has("code")) {
    await sb.auth.getSession();
    history.replaceState(null, "", location.pathname + location.hash);
  }
  const { data } = await sb.auth.getSession();
  if (!data.session) setStatus("signed-out");
  // coming back to the tab: pick up changes made on another device
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && user) pull(); });
}

export async function signIn() {
  if (!sb) return;
  await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
}

export async function signOut() {
  if (!sb) return;
  clearTimeout(pushTimer);
  await sb.auth.signOut();
}

// Fetch the cloud copy and reconcile it with this browser's copy.
async function pull() {
  if (!user) return;
  setStatus("syncing");
  const { data: row, error } = await sb.from("progress").select("data, updated_at").eq("user_id", user.id).maybeSingle();
  if (error) { setStatus("error"); return; }
  let synced = null;
  try { synced = localStorage.getItem(SYNCED_KEY); } catch (e) {}
  const local = hooks.getStore();
  if (!row) {
    await push(true); // first sign-in anywhere: this browser's progress becomes the account's
  } else if (synced !== user.id) {
    // first time this browser meets this account: combine both, nothing gets lost
    hooks.replaceStore(hooks.mergeStores(row.data, local));
    await push(true);
  } else if ((local.updatedAt || 0) > Date.parse(row.updated_at)) {
    await push(true); // this browser has newer changes (e.g. made while offline)
  } else {
    hooks.replaceStore(row.data);
    setStatus("synced");
  }
  try { localStorage.setItem(SYNCED_KEY, user.id); } catch (e) {}
}

// Called after every local save; sends the whole store a moment later.
export function queuePush() {
  if (!user) return;
  clearTimeout(pushTimer);
  setStatus("syncing");
  pushTimer = setTimeout(() => push(false), 800);
}

async function push() {
  if (!user) return;
  const store = hooks.getStore();
  const { error } = await sb.from("progress").upsert({ user_id: user.id, data: store, updated_at: new Date(store.updatedAt || Date.now()).toISOString() });
  setStatus(error ? "error" : "synced");
}

// Remove this account's cloud save (the copy in this browser stays).
export async function deleteCloudSave() {
  if (!user) return false;
  const { error } = await sb.from("progress").delete().eq("user_id", user.id);
  if (error) return false;
  try { localStorage.removeItem(SYNCED_KEY); } catch (e) {}
  await signOut();
  return true;
}

// Send a message from the Feedback window. Works without signing in; the table only allows inserts
// (see supabase/feedback.sql), so nothing can be read back from the site.
export async function sendFeedback(row) {
  if (!sb) return "offline";
  try {
    const { error } = await sb.from("feedback").insert(row);
    if (!error) return "ok";
    return error.code === "42P01" || error.code === "PGRST205" ? "setup" : "error";
  } catch (e) {
    return "offline";
  }
}
