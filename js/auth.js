// Minimal Supabase Auth client over plain fetch: email one-time codes,
// session storage and token refresh. No SDK needed.

const KEY = "hz.session";

export class Auth extends EventTarget {
  constructor({ url, anonKey }) {
    super();
    this.url = (url || "").replace(/\/$/, "");
    this.anonKey = anonKey || "";
    this.session = null;
    this._refreshing = null;
    try { this.session = JSON.parse(localStorage.getItem(KEY)); } catch {}
  }

  get enabled() { return !!(this.url && this.anonKey); }
  get user() { return this.session?.user || null; }

  async _req(path, { method = "POST", body, token } = {}) {
    const res = await fetch(`${this.url}/auth/v1${path}`, {
      method,
      headers: {
        apikey: this.anonKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.msg || data.error_description || data.message || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  _save(data) {
    if (!data) {
      this.session = null;
      try { localStorage.removeItem(KEY); } catch {}
    } else {
      this.session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user: { id: data.user.id, email: data.user.email },
      };
      try { localStorage.setItem(KEY, JSON.stringify(this.session)); } catch {}
    }
    this.dispatchEvent(new Event("change"));
  }

  /** Step 1: email a sign-in code (creates the account if it's new). */
  sendCode(email) {
    const back = encodeURIComponent(location.origin + location.pathname);
    return this._req(`/otp?redirect_to=${back}`, { body: { email, create_user: true } });
  }

  /** Finish sign-in when the user arrives from the link in the email (#access_token=...). */
  async fromLink() {
    const h = new URLSearchParams(location.hash.slice(1));
    const q = new URLSearchParams(location.search);
    const clean = () => history.replaceState(null, "", location.pathname);
    if (h.get("error_description") || q.get("error_description")) {
      clean();
      throw new Error("That sign-in link has expired or was already used. Request a new one.");
    }
    const access = h.get("access_token");
    if (!access) return false;
    clean();
    const user = await this._req("/user", { method: "GET", token: access });
    this._save({
      access_token: access,
      refresh_token: h.get("refresh_token"),
      expires_at: Number(h.get("expires_at")) || undefined,
      expires_in: Number(h.get("expires_in")) || 3600,
      user,
    });
    return true;
  }

  /** Step 2: exchange the emailed code for a session. */
  async verify(email, code) {
    const data = await this._req("/verify", { body: { type: "email", email, token: code } });
    this._save(data);
    return this.user;
  }

  /** A fresh access token, refreshing first if it expires within a minute. */
  async token() {
    if (!this.session) return null;
    if (this.session.expires_at - 60 > Date.now() / 1000) return this.session.access_token;
    if (!this._refreshing) {
      this._refreshing = this._req("/token?grant_type=refresh_token", { body: { refresh_token: this.session.refresh_token } })
        .then((d) => this._save(d))
        .catch((e) => { if (e.status === 400 || e.status === 401) this._save(null); else throw e; })
        .finally(() => { this._refreshing = null; });
    }
    await this._refreshing;
    return this.session?.access_token || null;
  }

  async signOut() {
    const t = this.session?.access_token;
    this._save(null);
    if (t) this._req("/logout", { token: t }).catch(() => {});
  }

  /** Clear the local session without contacting the server (e.g. after account deletion). */
  forget() { this._save(null); }
}
