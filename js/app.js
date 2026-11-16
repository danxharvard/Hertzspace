import { Player } from "./player.js";
import { Viz } from "./viz.js";
import { Auth } from "./auth.js";

const CFG = window.HERTZSPACE_CONFIG || {};
const API = (CFG.apiBase || "").replace(/\/$/, "");
const PLUS_KEY = "hz.plus";
const PENDING_KEY = "hz.pendingCheckout";
const VOL_KEY = "hz.volume";
const OFFLINE_CACHE = "hz-offline-v1";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const ACCENT = {
  tinnitus: "#7fc4c2",
  solfeggio: "#e9b872",
  binaural: "#ab9cf0",
  tuning: "#ee917f",
  golden: "#e7a6c8",
};

const state = {
  catalog: null,
  byId: new Map(),
  filter: "all",
  selected: null,
  plus: store.get(PLUS_KEY) === "1",
  timerEnd: 0,
  timerId: 0,
  offline: new Set(),
};

const player = new Player();
const viz = new Viz($(".viz"), () => player.analyser);
const auth = new Auth({ url: CFG.supabaseUrl, anonKey: CFG.supabaseAnonKey });
const isPlus = () => state.plus && !!auth.user;
const isLocked = (item) => item.tier === "plus" && !isPlus();

// ---------- audio sources ----------

async function fetchAudio(item) {
  if ("caches" in window) {
    const hit = await caches.open(OFFLINE_CACHE).then((c) => c.match(offlineKey(item))).catch(() => null);
    if (hit) return hit.arrayBuffer();
  }
  const res = await fetch(sourceUrl(item), await sourceInit(item));
  if (res.status === 401) {
    await auth.signOut();
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (res.status === 403) {
    setPlus(false);
    throw new Error("This one needs Hertzspace Plus.");
  }
  if (!res.ok) throw new Error(`Couldn't load audio (${res.status})`);
  return res.arrayBuffer();
}

function sourceUrl(item) {
  return item.tier === "free" ? `audio/free/${item.id}.flac` : `${API}/stream/${item.id}`;
}
async function sourceInit(item) {
  return item.tier === "free" ? {} : { headers: { Authorization: `Bearer ${await auth.token()}` } };
}
function offlineKey(item) {
  return new Request(new URL(`offline/${item.id}.flac`, location.href));
}

async function refreshOffline() {
  if (!("caches" in window)) return;
  try {
    const keys = await (await caches.open(OFFLINE_CACHE)).keys();
    state.offline = new Set(keys.map((r) => r.url.split("/").pop().replace(".flac", "")));
  } catch {}
}

async function toggleOffline(item, btn) {
  const cache = await caches.open(OFFLINE_CACHE);
  if (state.offline.has(item.id)) {
    await cache.delete(offlineKey(item));
    state.offline.delete(item.id);
    toast(`${item.name} removed from this device`);
  } else {
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const res = await fetch(sourceUrl(item), await sourceInit(item));
      if (!res.ok) throw new Error(res.status);
      await cache.put(offlineKey(item), res);
      state.offline.add(item.id);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      toast(`${item.name} saved. It will play offline.`);
    } catch {
      toast("Couldn't save. Check your connection and try again.");
    }
  }
  renderActions();
  renderLists();
}

// ---------- rendering ----------

function render() {
  const { categories } = state.catalog;
  const chips = $(".chips");
  chips.innerHTML = "";
  [{ id: "all", name: "All" }, ...categories].forEach((c) => {
    const b = document.createElement("button");
    b.textContent = c.name;
    b.dataset.filter = c.id;
    b.setAttribute("aria-pressed", String(state.filter === c.id));
    if (ACCENT[c.id]) b.style.setProperty("--accent", ACCENT[c.id]);
    chips.append(b);
  });
  renderLists();
  renderPlusPill();
}

function renderLists() {
  const { frequencies, plus } = state.catalog;
  const shown = frequencies.filter((f) => state.filter === "all" || f.category === state.filter);
  const free = shown.filter((f) => f.tier === "free");
  const paid = shown.filter((f) => f.tier === "plus");
  const lists = $(".lists");
  lists.innerHTML = "";

  if (free.length) lists.append(section("Free to play", "No account needed", free));
  if (paid.length) {
    const sub = isPlus() ? "Unlocked. Thanks for supporting Hertzspace." : `${plus.price} ${plus.priceNote} · ${paid.length} more frequencies + downloads`;
    const s = section("Hertzspace Plus", sub, paid);
    if (!isPlus()) {
      const cta = document.createElement("button");
      cta.className = "section-cta";
      cta.dataset.action = "open-plus";
      cta.textContent = "Unlock";
      s.querySelector(".section-head").append(cta);
    }
    lists.append(s);
  }
}

function section(title, sub, items) {
  const s = document.createElement("section");
  s.className = "group";
  s.innerHTML = `<div class="section-head"><div><h3></h3><p></p></div></div><ul class="cards" role="list"></ul>`;
  s.querySelector("h3").textContent = title;
  s.querySelector("p").textContent = sub;
  const ul = s.querySelector("ul");
  items.forEach((item) => ul.append(card(item)));
  return s;
}

function card(item) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.className = "card";
  b.dataset.id = item.id;
  b.style.setProperty("--accent", ACCENT[item.category]);
  if (state.selected?.id === item.id) b.classList.add("selected");
  if (state.selected?.id === item.id && player.playing) b.classList.add("playing");
  const locked = isLocked(item);
  b.innerHTML = `
    <span class="glyph" aria-hidden="true">${glyph(item)}</span>
    <span class="card-text"><b></b><span class="sub"></span></span>
    <span class="card-end">
      ${state.offline.has(item.id) ? '<svg class="saved" viewBox="0 0 24 24" aria-label="Saved offline"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/></svg>' : ""}
      ${locked ? '<svg class="lock" viewBox="0 0 24 24" aria-label="Plus"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>' : '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>'}
    </span>`;
  b.querySelector("b").textContent = item.name;
  b.querySelector(".sub").textContent = item.name === item.hz ? item.short : `${item.hz} · ${item.short}`;
  li.append(b);
  return li;
}

function glyph(item) {
  // Tiny waveform icon that differs per type.
  const paths = {
    noise: "M2 12l1.5-3 1.5 6 1.5-8 1.5 9 1.5-5 1.5 4 1.5-7 1.5 8 1.5-4 1.5 3 1.5-5 1.5 4 1.5-2",
    swell: "M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0",
    tone: "M2 12c1.7-6 3.3-6 5 0s3.3 6 5 0 3.3-6 5 0 3.3 6 5 0",
    bath: "M2 12c1.7-6 3.3-6 5 0s3.3 6 5 0 3.3-6 5 0 3.3 6 5 0M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 2.5-1.5 5-1",
    cascade: "M3 4h18M5 8h14M7 12h10M9 16h6M11 20h2",
    binaural: "M2 9c1.7-4 3.3-4 5 0s3.3 4 5 0 3.3-4 5 0 3.3 4 5 0M2 15c2-4 4-4 6 0s4 4 6 0 4-4 6 0",
  };
  return `<svg viewBox="0 0 24 24"><path d="${paths[item.type]}"/></svg>`;
}

function renderPlusPill() {
  const pill = $(".plus-pill");
  pill.hidden = false;
  pill.classList.toggle("active", isPlus());
  pill.textContent = isPlus() ? "Plus ✓" : "Go Plus";
}

function select(item, { autoplay = false, openSheet = true } = {}) {
  state.selected = item;
  const accent = ACCENT[item.category];
  document.documentElement.style.setProperty("--accent", accent);
  viz.setColor(accent);
  const cat = state.catalog.categories.find((c) => c.id === item.category);
  $(".p-cat").textContent = cat.name + (item.tier === "plus" ? " · Plus" : "");
  $(".p-name").textContent = item.name;
  $(".p-hz").textContent = item.hz;
  $(".p-about").textContent = item.about;
  $(".p-phones").hidden = item.type !== "binaural";
  $(".play-btn").disabled = isLocked(item);
  $(".player").classList.toggle("locked", isLocked(item));
  $(".mini-name").textContent = item.name;
  $(".mini-hz").textContent = item.hz;
  $(".mini").style.setProperty("--accent", accent);
  if (history.replaceState) history.replaceState(null, "", `#${item.id}`);
  renderActions();
  $$(".card").forEach((c) => c.classList.toggle("selected", c.dataset.id === item.id));
  if (openSheet) openPlayer();
  if (autoplay && !isLocked(item)) start(item);
}

function renderActions() {
  const item = state.selected;
  const box = $(".p-actions");
  box.innerHTML = "";
  if (!item) return;
  if (isLocked(item)) {
    const b = button("Unlock with Plus", "primary");
    b.dataset.action = "open-plus";
    box.append(b);
    return;
  }
  if (!isPlus()) {
    const b = button("Download for offline · Plus", "ghost");
    b.dataset.action = "open-plus";
    box.append(b);
    return;
  }
  const save = button(state.offline.has(item.id) ? "Saved offline ✓" : "Save offline", "ghost");
  save.addEventListener("click", () => toggleOffline(item, save));
  box.append(save);
  ["mp3", "flac"].forEach((fmt) => {
    const b = button(`Download ${fmt.toUpperCase()}`, "ghost");
    b.addEventListener("click", async () => {
      const t = await auth.token();
      if (!t) return openAccount();
      location.href = `${API}/download/${item.id}.${fmt}?token=${encodeURIComponent(t)}`;
    });
    box.append(b);
  });
}

function button(text, kind) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn ${kind}`;
  b.textContent = text;
  return b;
}

// ---------- playback ----------

async function start(item) {
  try {
    await player.play(item, fetchAudio);
    mediaSession(item);
  } catch (e) {
    toast(e.message || "Something went wrong loading that sound.");
  }
}

function toggle() {
  const item = state.selected;
  if (!item || isLocked(item)) return;
  if (player.playing && player.current?.id === item.id) player.pause();
  else start(item);
}

player.addEventListener("state", () => {
  const on = player.playing;
  document.body.classList.toggle("is-playing", on);
  viz.setActive(on);
  $$(".play-btn, .mini-play").forEach((b) => b.setAttribute("aria-label", on ? "Pause" : "Play"));
  $$(".card").forEach((c) => c.classList.toggle("playing", on && c.dataset.id === player.current?.id));
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = on ? "playing" : "paused";
  if (!on) clearTimer(false);
});
player.addEventListener("loading", (e) => document.body.classList.toggle("is-loading", !!e.detail));

function mediaSession(item) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.name,
    artist: item.hz,
    album: "Hertzspace",
    artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
  navigator.mediaSession.setActionHandler("play", () => start(state.selected));
  navigator.mediaSession.setActionHandler("pause", () => player.pause());
  navigator.mediaSession.setActionHandler("stop", () => player.pause());
}

// ---------- sleep timer ----------

function setTimer(min) {
  clearTimer(false);
  $$(".timer button").forEach((b) => b.classList.toggle("on", +b.dataset.timer === min));
  if (!min) return;
  if (!player.playing && state.selected && !isLocked(state.selected)) start(state.selected);
  state.timerEnd = Date.now() + min * 60000;
  state.timerId = setInterval(tickTimer, 1000);
  tickTimer();
}

function tickTimer() {
  const left = state.timerEnd - Date.now();
  if (left <= 0) {
    player.fadeOutAndStop(8);
    clearTimer(true);
    return;
  }
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $(".timer-left").textContent = `${m}:${String(s).padStart(2, "0")}`;
}

function clearTimer(resetButtons = true) {
  clearInterval(state.timerId);
  state.timerId = 0;
  state.timerEnd = 0;
  $(".timer-left").textContent = "";
  if (resetButtons || !player.playing) $$(".timer button").forEach((b) => b.classList.toggle("on", b.dataset.timer === "0"));
}

// ---------- sheet (mobile) ----------

const desktop = matchMedia("(min-width: 900px)");
function openPlayer() {
  if (desktop.matches) return;
  document.body.classList.add("player-open");
  $(".player").setAttribute("aria-hidden", "false");
}
function closePlayer() {
  document.body.classList.remove("player-open");
  if (!desktop.matches) $(".player").setAttribute("aria-hidden", "true");
}
function syncLayout() {
  $(".player").setAttribute("aria-hidden", String(!desktop.matches && !document.body.classList.contains("player-open")));
  $(".mini").hidden = desktop.matches || !state.selected;
}
desktop.addEventListener("change", syncLayout);

// Swipe the sheet down to close.
(() => {
  const sheet = $(".player");
  let y0 = null, dy = 0;
  sheet.addEventListener("touchstart", (e) => {
    if (desktop.matches || sheet.scrollTop > 0 || e.target.closest("input")) return;
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener("touchend", () => {
    if (y0 == null) return;
    sheet.style.transform = "";
    if (dy > 110) closePlayer();
    y0 = null;
  });
})();

// ---------- Plus / payments ----------

const dialog = $(".plus-sheet");

function openPlus() {
  const { plus } = state.catalog;
  const perks = $(".perks", dialog);
  perks.innerHTML = "";
  plus.perks.forEach((p) => { const li = document.createElement("li"); li.textContent = p; perks.append(li); });
  $(".amount", dialog).textContent = plus.price;
  $(".note", dialog).textContent = plus.priceNote;
  const buy = $(".buy-btn", dialog);
  const ready = !!(CFG.stripePaymentLink && API && auth.enabled);
  const user = auth.user;
  buy.hidden = isPlus();
  buy.classList.toggle("disabled", !ready);
  if (ready && user) {
    const u = new URL(CFG.stripePaymentLink);
    u.searchParams.set("client_reference_id", user.id);
    u.searchParams.set("prefilled_email", user.email);
    buy.href = u.toString();
    buy.textContent = "Unlock Plus";
  } else {
    buy.href = "#";
    buy.textContent = ready ? "Sign in to unlock" : "Unlock Plus";
  }
  $(".signin-link", dialog).hidden = !!user || !auth.enabled;
  $(".plus-status", dialog).textContent = isPlus()
    ? "Plus is unlocked on your account."
    : ready ? "" : "Checkout opens soon.";
  $("#plus-title").textContent = isPlus() ? "You're on Plus" : "Unlock the full library";
  if (accountDialog.open) accountDialog.close();
  if (!dialog.open) dialog.showModal();
}

function setPlus(on) {
  state.plus = !!on;
  store.set(PLUS_KEY, on ? "1" : null);
  renderLists();
  renderPlusPill();
  renderAccountBtn();
  if (state.selected) select(state.selected, { openSheet: false });
}

/** Ask the API whether this account has Plus. Keeps the last known answer when offline. */
async function refreshMe() {
  if (!auth.user || !API) return setPlus(false);
  try {
    const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${await auth.token()}` } });
    if (res.status === 401) return auth.signOut();
    if (res.ok) setPlus((await res.json()).plus);
  } catch {
    setPlus(state.plus);
  }
}

async function redeemCheckout(sessionId) {
  const res = await fetch(`${API}/unlock`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await auth.token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error === "unpaid" ? "That payment hasn't completed yet." : data.error || "We couldn't confirm that purchase.");
  store.set(PENDING_KEY, null);
  setPlus(true);
  toast("Welcome to Plus. Everything is unlocked.");
}

async function handleCheckoutReturn() {
  const sid = new URLSearchParams(location.search).get("session_id") || store.get(PENDING_KEY);
  if (!sid) return;
  history.replaceState(null, "", location.pathname + location.hash);
  if (!auth.user) {
    // e.g. checkout finished in a different browser: sign in, then we'll finish up.
    store.set(PENDING_KEY, sid);
    toast("Payment received. Sign in to finish unlocking Plus.");
    openAccount();
    return;
  }
  try { await redeemCheckout(sid); } catch (e) { toast(e.message); }
}

async function clearOfflineAudio() {
  if (!("caches" in window)) return;
  await caches.delete(OFFLINE_CACHE).catch(() => {});
  state.offline.clear();
}

// ---------- account ----------

const accountDialog = $(".account-sheet");
let pendingEmail = "";
let deleteArmed = false;

function showStep(step) {
  $$("section[data-step]", accountDialog).forEach((sec) => (sec.hidden = sec.dataset.step !== step));
  status("");
  deleteArmed = false;
  $(".delete-note", accountDialog).hidden = true;
  const focus = { email: "input[name=email]", code: "input[name=code]" }[step];
  if (focus) setTimeout(() => $(focus, accountDialog).focus(), 50);
}

function status(msg, ok = false) {
  const el = $(".form-status", accountDialog);
  el.textContent = msg;
  el.classList.toggle("ok", ok);
}

function openAccount() {
  if (dialog.open) dialog.close();
  if (!auth.enabled) showStep("off");
  else if (auth.user) renderAccount();
  else showStep(pendingEmail ? "code" : "email");
  if (!accountDialog.open) accountDialog.showModal();
}

function renderAccount() {
  showStep("account");
  $(".acct-email", accountDialog).textContent = auth.user.email;
  const badge = $(".plan-badge", accountDialog);
  badge.textContent = isPlus() ? "Hertzspace Plus" : "Free plan";
  badge.classList.toggle("plus", isPlus());
  $(".acct-plan [data-action=open-plus]", accountDialog).hidden = isPlus();
}

function renderAccountBtn() {
  const btn = $(".account-btn");
  const initial = $(".account-initial");
  const u = auth.user;
  btn.classList.toggle("signed-in", !!u);
  btn.classList.toggle("plus", isPlus());
  initial.hidden = !u;
  $("svg", btn).style.display = u ? "none" : "";
  initial.textContent = u ? u.email[0].toUpperCase() : "";
  btn.setAttribute("aria-label", u ? `Account (${u.email})` : "Sign in");
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { status(friendly(e)); } finally { btn.disabled = false; }
}

function friendly(e) {
  if (e.status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (/expired|invalid/i.test(e.message)) return "That code is wrong or has expired. Try again or resend.";
  if (e instanceof TypeError) return "Couldn't connect. Check your internet connection.";
  return e.message || "Something went wrong.";
}

async function sendCode(btn) {
  const input = $("input[name=email]", accountDialog);
  const email = input.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return status("Enter a valid email address.");
  await busy(btn, async () => {
    await auth.sendCode(email);
    pendingEmail = email;
    $(".sent-to", accountDialog).textContent = email;
    $("input[name=code]", accountDialog).value = "";
    showStep("code");
  });
}

async function verifyCode(btn) {
  const code = $("input[name=code]", accountDialog).value.replace(/\D/g, "");
  if (code.length < 6) return status("Enter the code from your email.");
  await busy(btn, async () => {
    await auth.verify(pendingEmail, code);
    pendingEmail = "";
    await refreshMe();
    if (store.get(PENDING_KEY)) await handleCheckoutReturn();
    if (isPlus()) { renderAccount(); toast("Signed in. Plus is unlocked."); }
    else { accountDialog.close(); toast("You're signed in."); if (state.wantPlus) openPlus(); }
    state.wantPlus = false;
  });
}

async function deleteAccount(btn) {
  if (!deleteArmed) {
    deleteArmed = true;
    $(".delete-note", accountDialog).hidden = false;
    btn.textContent = "Confirm delete";
    return;
  }
  await busy(btn, async () => {
    const res = await fetch(`${API}/account`, { method: "DELETE", headers: { Authorization: `Bearer ${await auth.token()}` } });
    if (!res.ok) throw new Error("We couldn't delete your account. Please try again.");
    auth.forget();
    accountDialog.close();
    toast("Your account has been deleted.");
  });
  btn.textContent = "Delete account";
}

auth.addEventListener("change", async () => {
  if (!auth.user) {
    await clearOfflineAudio();
    setPlus(false);
  }
  renderAccountBtn();
});

// ---------- misc ----------

let toastTimer;
function toast(msg) {
  const t = $(".toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action], [data-filter], [data-timer], .card");
  if (!el) return;
  if (el.matches(".card")) {
    const item = state.byId.get(el.dataset.id);
    const same = state.selected?.id === item.id;
    select(item, { autoplay: !same || !player.playing });
    syncLayout();
    return;
  }
  if (el.dataset.filter) {
    state.filter = el.dataset.filter;
    $$(".chips button").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
    renderLists();
    return;
  }
  if (el.dataset.timer != null) return setTimer(+el.dataset.timer);
  switch (el.dataset.action) {
    case "toggle": e.stopPropagation(); toggle(); break;
    case "open-player": openPlayer(); break;
    case "close-player": closePlayer(); break;
    case "open-plus": openPlus(); break;
    case "open-account": openAccount(); break;
    case "send-code": sendCode(el); break;
    case "resend-code": $("input[name=email]", accountDialog).value = pendingEmail; sendCode(el); break;
    case "verify-code": verifyCode(el); break;
    case "change-email": pendingEmail = ""; showStep("email"); break;
    case "sign-out": auth.signOut(); accountDialog.close(); toast("Signed out."); break;
    case "delete-account": deleteAccount(el); break;
  }
});

$(".buy-btn").addEventListener("click", (e) => {
  if (e.currentTarget.classList.contains("disabled")) return e.preventDefault();
  if (!auth.user) {
    e.preventDefault();
    state.wantPlus = true;
    openAccount();
  }
});
[dialog, accountDialog].forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
// Enter key submits the current step.
accountDialog.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const step = $("section[data-step]:not([hidden])", accountDialog)?.dataset.step;
  const btn = { email: "[data-action=send-code]", code: "[data-action=verify-code]" }[step];
  if (btn) { e.preventDefault(); $(btn, accountDialog).click(); }
});
// Auto-submit once a full code is typed or pasted.
$("input[name=code]").addEventListener("input", (e) => {
  if (e.target.value.replace(/\D/g, "").length === 6) $("[data-action=verify-code]", accountDialog).click();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.target.closest("input, button, a, textarea, dialog")) {
    e.preventDefault();
    toggle();
  }
  if (e.key === "Escape") closePlayer();
});

const vol = $(".volume input");
vol.value = store.get(VOL_KEY) ?? 0.35;
player.setVolume(+vol.value);
const paintVol = () => vol.style.setProperty("--fill", `${vol.value * 100}%`);
paintVol();
vol.addEventListener("input", () => { player.setVolume(+vol.value); store.set(VOL_KEY, vol.value); paintVol(); });

$("[data-year]").textContent = new Date().getFullYear();

// ---------- boot ----------

(async function boot() {
  state.catalog = await fetch("data/catalog.json").then((r) => r.json());
  state.catalog.frequencies.forEach((f) => state.byId.set(f.id, f));
  await refreshOffline();
  render();
  try {
    if (await auth.fromLink()) toast("You're signed in.");
  } catch (e) { toast(e.message); }
  renderAccountBtn();
  await refreshMe();
  const fromHash = state.byId.get(location.hash.slice(1));
  select(fromHash || state.catalog.frequencies.find((f) => f.tier === "free"), { openSheet: false });
  syncLayout();
  handleCheckoutReturn();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
