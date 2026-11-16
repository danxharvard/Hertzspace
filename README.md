# Hertzspace

Calming noise, Solfeggio tones and binaural beats that play in the browser on mobile and desktop. Built with plain HTML, CSS and JavaScript: no frameworks and no build step. It installs to the home screen as an app (PWA).

- **6 free frequencies** stream straight from this repo (`audio/free/`).
- **Hertzspace Plus** (one-off payment) unlocks 16 more, plus downloads and offline listening.

## Library

| Free | Plus |
|---|---|
| White noise, Pink noise, Brown noise | Ocean swell |
| 528 Hz, 432 Hz | 174, 396, 639, 741, 852, 963 Hz, 528 Hz sound bath |
| Calm focus (10 Hz alpha binaural) | Deep sleep (2 Hz), Meditation (6 Hz), Schumann (7.83 Hz), Deep focus (40 Hz) |
| | Golden ratio cascades: Golden 528, Golden 432, Golden 396, Golden drift |

The whole catalogue (names, descriptions, free/paid tier) lives in `data/catalog.json`.

## How it works

- **Gapless playback.** Each sound is a 20-second FLAC loop, built so it repeats with no click, and played through the Web Audio API.
- **Generated, not recorded.** `tools/generate.py` renders every sound from the catalogue (needs `numpy` and `ffmpeg`):
  ```sh
  python3 tools/generate.py               # streaming loops
  python3 tools/generate.py --downloads   # + 30-minute MP3/FLAC downloads for Plus
  ```
  Free loops go to `audio/free/` (committed). Everything paid goes to `premium/`, which is **git-ignored on purpose**: anything in a public repo is free to anyone.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → `main` / root. The site will be at `https://danxharvard.github.io/Hertzspace/`.

## Accounts and payments

The free site works without any of this. Accounts use **Supabase** (sign-in by emailed 6-digit code, no passwords). Plus is stored against the account, so it works on every device the buyer signs in on.

1. **Supabase** (free tier). Create a project, then:
   - SQL Editor → run `server/schema.sql`.
   - Authentication → Sign In / Providers → Email: enabled. Turn **off** "Confirm email" (the code itself confirms it).
   - Authentication → Emails → **Magic Link** template: replace the link with the code, e.g. `<h2>Your Hertzspace code</h2><p>{{ .Token }}</p>`.
   - Authentication → URL Configuration → Site URL: `https://danxharvard.github.io/Hertzspace/`.
   - For real launch, add your own SMTP (e.g. Resend) under Authentication → Emails, because Supabase's built-in email is rate-limited.
2. **Stripe.** Create a product "Hertzspace Plus" and a **Payment Link**. Under *After payment*, redirect to
   `https://danxharvard.github.io/Hertzspace/?session_id={CHECKOUT_SESSION_ID}`.
   Add a webhook (Developers → Webhooks) pointing at `https://<your-worker>/stripe-webhook` for `checkout.session.completed`.
3. **Cloudflare (free tier is enough).** Create an R2 bucket `hertzspace-audio` and upload:
   - `premium/stream/*.flac` → `stream/`
   - `premium/downloads/*` → `downloads/`
4. **Deploy the API** in `server/`. Set `SUPABASE_URL` in `wrangler.toml`, then:
   ```sh
   cd server
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler deploy
   ```
5. Fill in `js/config.js` (Supabase URL + anon key, Payment Link, Worker URL) and commit.

How a purchase works: buyers sign in first, the Payment Link carries their account id to Stripe, and Plus is granted when they return to the site (or by the webhook if they close the tab). Users can sign out or delete their account (and data) from the account screen.

## Wording

Hertzspace is a wellbeing product, not a medical device. Keep claims to relaxation, focus and sleep, and avoid "cure" or "heal" (UK ASA / CAP code). The footer and catalogue copy already follow this.
