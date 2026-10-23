# Google Maps + Real Parking Dataset Setup

Parkistics uses Google for three things when a key is present:

1. **Real parking dataset** — the backend queries the **Places API (New) Nearby Search**
   for actual parking facilities (garages, lots, street parking with ratings, prices,
   parking options) near any destination worldwide.
2. **Map view** — the frontend renders the **Maps JavaScript API** map with custom
   availability pill markers (Advanced Markers).
3. **Geocoding** — destination search resolves place names via the **Geocoding API**
   (server-side `/api/geocode`), falling back to OpenStreetMap Nominatim.

Without a key everything still works: parking discovery falls back to the free
OpenStreetMap dataset and the map falls back to Leaflet + OSM tiles.

## Setup (≈5 minutes)

You need a Google account. Billing must be enabled, but Google Maps Platform includes
a recurring **$200/month free credit** that covers far more than local development.

### 1. Create a project

https://console.cloud.google.com/ → project dropdown → **New Project** → name it
(e.g. `parkistics`) → **Create** → select it.

### 2. Enable billing

☰ → **Billing** → link a billing account to the project (card required, free credit applies).

### 3. Enable these three APIs

☰ → **APIs & Services → Library** → search each name → **Enable**:

- **Maps JavaScript API** (map view)
- **Places API (New)** (real parking dataset)
- **Geocoding API** (destination search)

### 4. Create + restrict the key

☰ → **APIs & Services → Credentials** → **+ Create Credentials → API key**.

On the key page:

- **Application restrictions → HTTP referrers**: add `http://localhost:*/*`,
  `http://127.0.0.1:*/*`, and your deployed domain later.
- **API restrictions → Restrict key** → select the three APIs from step 3.
- **Save.**

### 5. Give the key to Parkistics (any of these)

| Method | How | Best for |
|---|---|---|
| Backend env (recommended) | `backend/.env`: `GOOGLE_MAPS_API_KEY=AIza...` | full stack: real dataset + map + geocode |
| URL param | open `http://localhost:4000/?gmaps_key=AIza...` once (saved in browser) | quick try |
| Browser file | `cp frontend/config.example.js frontend/config.js`, paste key (gitignored) | frontend-only |

The frontend fetches the key from the backend via `GET /api/config` automatically, so
setting the backend env var alone is usually enough. `GOOGLE_MAPS_BROWSER_KEY` may be
set to a *separate* referrer-restricted key for the map view; otherwise the backend key
is reused for the browser (keep it referrer-restricted!).

Key resolution order in the frontend: `?gmaps_key=` URL param → browser localStorage →
`frontend/config.js` → backend `/api/config`. Clear a stored key with `?gmaps_key=`
(empty). If the key is invalid or unauthorized, `gm_authFailure` silently falls back to
the free Leaflet/OSM map.

## Verify

- `curl http://localhost:4000/api/config` → `"parkingDataset": "google-places"` and a non-null `gmapsKey`.
- `curl 'http://localhost:4000/api/zones?lat=48.8584&lng=2.2945&radius=1.0&dest=Eiffel'` → zones with `"source": "google"` and real facility names.
- `curl 'http://localhost:4000/api/geocode?q=Eiffel+Tower'` → `"source": "google"`.
- The page map shows Google Maps tiles (check `state.provider === 'google'` in console).

## Troubleshooting

| What you see | Cause → Fix |
|---|---|
| Map shows Leaflet/OSM tiles, zones say `source: osm` | No key configured or fetch failed → check env + `/api/config` |
| `RefererNotAllowedMapError` | Current URL not in key's referrer list → step 4 |
| `ApiNotActivatedMapError` | One of the three APIs not enabled → step 3 |
| `InvalidKeyMapError` / `REQUEST_DENIED` on Places | Typo in key, billing, or API restriction → steps 2–4 |
| Zones come back `synthesized` | Both Google and OSM unreachable (offline) → edge mode |
| Billing error on enable | Project not linked to a billing account → step 2 |
| Location stays on default area | Location permission denied → click 📍 and Allow |
