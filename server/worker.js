// Hertzspace API: a Cloudflare Worker.
//
// Accounts are Supabase Auth users. The browser sends its Supabase access
// token as "Authorization: Bearer <token>" (or ?token= for download links).
//
//   GET    /me                      -> { id, email, plus }
//   POST   /unlock  {session_id}    -> confirm a Stripe Checkout session, grant Plus to this user
//   POST   /stripe-webhook          -> Stripe calls this on checkout.session.completed (backup to /unlock)
//   GET    /stream/<id>             -> premium 20 s loop      (R2: stream/<id>.flac)    Plus only
//   GET    /download/<id>.<mp3|flac>-> 30-minute download     (R2: downloads/<file>)    Plus only
//   DELETE /account                 -> delete the signed-in user and their data
//
// Secrets / vars (see wrangler.toml):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//   ALLOWED_ORIGIN, AUDIO (R2 bucket binding)

const enc = new TextEncoder();
const SAFE = /^[a-z0-9-]+$/;
const userCache = new Map(); // token -> { user, at }
const plusCache = new Map(); // userId -> { plus, at }
const TTL = 60_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// ---------- Supabase ----------

function sb(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function getUser(env, token) {
  if (!token) return null;
  const hit = userCache.get(token);
  if (hit && Date.now() - hit.at < TTL) return hit.user;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  const user = { id: u.id, email: u.email };
  userCache.set(token, { user, at: Date.now() });
  if (userCache.size > 5000) userCache.clear();
  return user;
}

async function hasPlus(env, userId) {
  const hit = plusCache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.plus;
  const r = await sb(env, `/rest/v1/entitlements?user_id=eq.${userId}&select=plus`);
  const rows = r.ok ? await r.json() : [];
  const plus = !!rows[0]?.plus;
  plusCache.set(userId, { plus, at: Date.now() });
  return plus;
}

async function grantPlus(env, userId, session) {
  const r = await sb(env, "/rest/v1/entitlements?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      plus: true,
      stripe_session: session.id,
      stripe_customer: session.customer || null,
    }),
  });
  if (!r.ok) throw new Error(`entitlement write failed: ${r.status}`);
  plusCache.set(userId, { plus: true, at: Date.now() });
}

// ---------- Stripe ----------

async function stripeSession(env, id) {
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  return r.ok ? r.json() : null;
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function verifyStripe(env, header, body) {
  const parts = Object.fromEntries((header || "").split(",").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = (header || "").split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${parts.t}.${body}`);
  return sigs.some((s) => safeEqual(s, expected));
}

// ---------- routes ----------

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  if (path === "/stripe-webhook" && req.method === "POST") {
    const body = await req.text();
    if (!(await verifyStripe(env, req.headers.get("Stripe-Signature"), body))) return json({ error: "bad signature" }, 400);
    const event = JSON.parse(body);
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object;
      if (s.payment_status === "paid" && s.client_reference_id) await grantPlus(env, s.client_reference_id, s);
    }
    return json({ received: true });
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token");
  const user = await getUser(env, token);
  if (!user) return json({ error: "Sign in required" }, 401);

  if (path === "/me" && req.method === "GET") {
    return json({ id: user.id, email: user.email, plus: await hasPlus(env, user.id) });
  }

  if (path === "/unlock" && req.method === "POST") {
    const { session_id: sid } = await req.json().catch(() => ({}));
    if (!sid || !/^cs_[A-Za-z0-9_]+$/.test(sid)) return json({ error: "missing session" }, 400);
    const s = await stripeSession(env, sid);
    if (!s) return json({ error: "unknown session" }, 404);
    if (s.payment_status !== "paid") return json({ error: "unpaid" }, 402);
    if (s.client_reference_id && s.client_reference_id !== user.id) return json({ error: "This purchase belongs to another account" }, 403);
    await grantPlus(env, user.id, s);
    return json({ plus: true });
  }

  if (path === "/account" && req.method === "DELETE") {
    const r = await sb(env, `/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    if (!r.ok) return json({ error: "delete failed" }, 500);
    userCache.delete(token);
    plusCache.delete(user.id);
    return json({ deleted: true });
  }

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!(await hasPlus(env, user.id))) return json({ error: "Plus required" }, 403);

  let m;
  if ((m = path.match(/^\/stream\/([^/]+)$/)) && SAFE.test(m[1])) {
    const obj = await env.AUDIO.get(`stream/${m[1]}.flac`);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": "audio/flac", "Cache-Control": "private, max-age=86400" } });
  }

  if ((m = path.match(/^\/download\/([^/]+)\.(mp3|flac)$/)) && SAFE.test(m[1])) {
    const obj = await env.AUDIO.get(`downloads/${m[1]}.${m[2]}`);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "Content-Type": m[2] === "mp3" ? "audio/mpeg" : "audio/flac",
        "Content-Disposition": `attachment; filename="Hertzspace - ${m[1]}.${m[2]}"`,
        "Content-Length": String(obj.size),
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new Response("Not found", { status: 404 });
}

function cors(env, res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN || "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  h.set("Vary", "Origin");
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(req, env) {
    try {
      return cors(env, await handle(req, env));
    } catch (e) {
      return cors(env, json({ error: "server error" }, 500));
    }
  },
};
