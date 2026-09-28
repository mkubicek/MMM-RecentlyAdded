# Changelog

## 1.1.0 — 2026-09-27

- Radarr/Sonarr API keys can live in `~/.config/MMM-RecentlyAdded/secrets.json` on the
  mirror instead of `config.js`, which MagicMirror sends to every browser.
- A title that wraps to two lines takes the overview's second line, so the text always fits
  beside the poster.
- Demo (`npm run demo`) with made-up titles and generated covers; screenshots in `docs/`.
- Tests and CI.
- `sleep` defaults to `null` (always cycle); set it to match your screen's off hours.

## 1.0.0 — 2026-09-25

- Recent Radarr movies and Sonarr shows in one cover flow, newest first, one cover per show.
- Posters proxied and cached by the helper; the page never calls Radarr or Sonarr directly.
- Pauses while the screen is off.
