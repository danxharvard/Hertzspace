// Hertzspace Plus API: a Cloudflare Worker.
//
//   GET /unlock?session_id=cs_...   -> checks the Stripe Checkout session is paid, returns { token }
//   GET /unlock?code=<token>        -> validates an unlock code from another device, returns { token }
//   GET /stream/<id>                -> premium 20 s loop      (R2: stream/<id>.flac)   needs token
//   GET /download/<id>.<mp3|flac>   -> 30-minute download     (R2: downloads/<file>)   needs token
//
// The token is an HMAC-signed Stripe session id, so no database is needed.
//
// Secrets / vars (see wrangler.toml):
//   STRIPE_SECRET_KEY   Stripe secret key (sk_live_... or sk_test_...)
//   TOKEN_SECRET        any long random string
//   ALLOWED_ORIGIN      your site's origin, e.g. https://danxharvard.github.io
//   AUDIO               R2 bucket binding

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

async function makeToken(env, sessionId) {
  return `${sessionId}.${await hmac(env.TOKEN_SECRET, sessionId)}`;
}

async function verifyToken(env, token) {
  if (!token || !token.includes(".")) return false;
  const i = token.lastIndexOf(".");
  const id = token.slice(0, i), sig = token.slice(i + 1);
  const good = await hmac(env.TOKEN_SECRET, id);
  if (good.length !== sig.length) return false;
  let diff = 0;
  for (let k = 0; k < good.length; k++) diff |= good.charCodeAt(k) ^ sig.charCodeAt(k);
  return diff === 0;
}

function cors(env, res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN || "*");
  h.set("Access-Control-Allow-Headers", "Authorization");
  h.set("Vary", "Origin");
  return new Response(res.body, { status: res.status, headers: h });
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const SAFE = /^[a-z0-9-]+$/;

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  if (path === "/unlock") {
    const code = url.searchParams.get("code");
    if (code) return (await verifyToken(env, code)) ? json({ token: code }) : json({ error: "invalid" }, 401);

    const sid = url.searchParams.get("session_id");
    if (!sid || !/^cs_[A-Za-z0-9_]+$/.test(sid)) return json({ error: "missing session" }, 400);
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!r.ok) return json({ error: "unknown session" }, 404);
    const session = await r.json();
    if (session.payment_status !== "paid") return json({ error: "unpaid" }, 402);
    return json({ token: await makeToken(env, sid) });
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token");
  if (!(await verifyToken(env, token))) return json({ error: "Plus required" }, 401);

  let m;
  if ((m = path.match(/^\/stream\/([^/]+)$/)) && SAFE.test(m[1])) {
    const obj = await env.AUDIO.get(`stream/${m[1]}.flac`);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: { "Content-Type": "audio/flac", "Cache-Control": "private, max-age=86400" },
    });
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

export default {
  async fetch(req, env) {
    try {
      return cors(env, await handle(req, env));
    } catch (e) {
      return cors(env, json({ error: "server error" }, 500));
    }
  },
};
