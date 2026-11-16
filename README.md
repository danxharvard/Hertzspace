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

## Switching on payments

The free site works without any of this. To sell Plus:

1. **Stripe.** Create a product "Hertzspace Plus" and a **Payment Link**. Under *After payment*, redirect to
   `https://danxharvard.github.io/Hertzspace/?session_id={CHECKOUT_SESSION_ID}`.
2. **Cloudflare (free tier is enough).** Create an R2 bucket `hertzspace-audio` and upload:
   - `premium/stream/*.flac` → `stream/`
   - `premium/downloads/*` → `downloads/`
3. **Deploy the API** in `server/`:
   ```sh
   cd server
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put TOKEN_SECRET     # any long random string
   npx wrangler deploy
   ```
4. Put the Payment Link and the Worker URL into `js/config.js`, then commit.

After paying, buyers return to the site and Plus unlocks on that device. They're shown an unlock code to use on their other devices.

## Wording

Hertzspace is a wellbeing product, not a medical device. Keep claims to relaxation, focus and sleep, and avoid "cure" or "heal" (UK ASA / CAP code). The footer and catalogue copy already follow this.
