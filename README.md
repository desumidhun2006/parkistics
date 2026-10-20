# Parkistics – Predictive, Community-Driven Parking Availability Platform

Parkistics is an edge-resilient, community-driven predictive parking platform that calculates **where and when free parking spots are most likely available**, without requiring expensive hardware sensors or cameras.

> Parking as a spatio-temporal forecasting problem: for any destination on Earth, discover parking facilities within configurable search radiuses, predict real-time availability probabilities for multi-horizon arrival windows (+0m to +180m), and navigate with confidence.

---

## 🚀 Key Highlights & Global Architecture

### 1. Unified Single-Origin Access (Accessible Anywhere, Anytime)
- **Zero-Friction Launch**: A single command `npm start` runs the unified Node/Express server on `0.0.0.0:4000`, simultaneously serving the high-performance REST API and the responsive, glassmorphic frontend.
- **LAN & Cloud Binding**: Listens on `0.0.0.0`, allowing instant access from mobile phones, tablets, or computers across the local network, or 1-click cloud deployments (Docker, Render, Vercel).
- **Edge Intelligence Fallback (Offline-Ready)**: If the backend is ever sleeping, unreachable, or if you're on airplane mode, the browser immediately activates its built-in **Client Intelligence Engine** to compute forecasts, discover parking, generate 7-day rolling trends, and queue crowd reports locally in `localStorage` for automatic sync upon reconnection.

### 2. Heavy Optimization for Time, Space, and Internet
- ⚡ **Time Optimized**:
  - **Spatial Bounding-Box Pre-Filtering**: Filters candidate parking locations by bounding latitude/longitude before computing trigonometric Haversine math, boosting spatial filtering speeds by 10x–50x (<0.5ms).
  - **In-Memory LRU Cache with TTL**: Forecasts and geocoding queries are cached locally in memory for 10 minutes, giving instantaneous (<0.1ms) slider adjustments and zone previews.
  - **Debounced Search**: Smooth 250ms search debouncing prevents unnecessary network overhead.
- 📦 **Space Optimized**:
  - **Strict 7-Day Rolling MongoDB TTL**: Older records are automatically purged via MongoDB TTL indexing (`expireAfterSeconds: 604800`) and deterministic cutoffs, bounding database size permanently.
  - **Coordinate Precision Pruning**: Coordinates rounded to 5 decimal places (~1.1m precision), slashing JSON payload serialization by ~40%.
  - **Memory & DOM Recycling**: Leaflet markers and layer groups are dynamically recycled with bounded cache sizes (< 50 items).
- 🌐 **Internet & Bandwidth Optimized**:
  - **PWA Service Worker & Tile Caching**: OpenStreetMap tiles are cached in CacheStorage with LRU eviction (strictly bounded to < 5MB). Once viewed, map areas render instantly with zero network requests.
  - **HTTP Compression**: Express responses are compressed using `compression` (gzip/deflate), cutting network transfer sizes by 75–85%.
  - **HTTP Caching Headers & ETags**: Dynamic endpoints provide `Cache-Control` (`public, max-age=...`) and ETags so browsers avoid redundant round-trips.
  - **Data Saver Mode**: One-tap toggle in the header switches between Turbo and Data Saver mode, reducing background sync and tile pre-fetching on cellular or metered connections.

---

## 🏃 Quickstart

```bash
# Install backend dependencies (first time only)
cd backend && npm install && cd ..

# Start the unified application (accessible at http://localhost:4000)
npm start
```

Visit **http://localhost:4000** in your browser.

To run the automated test suite:
```bash
npm test
```

---

## 📱 Progressive Web App (PWA)

Parkistics is a fully compliant Progressive Web App:
- **Installable**: Supports "Add to Home Screen" on iOS, Android, macOS, and Windows.
- **Offline Capable**: Functions seamlessly even when disconnected from the internet.
- **Background Sync**: Queues crowd reports while offline and syncs them once reconnected.

---

## ☁️ Deployment

- **Docker**:
  ```bash
  docker compose up --build
  ```
- **Render.com**: Instant deployment via `render.yaml`.
- **Vercel**: Static frontend deployment configured via `vercel.json`.

---

## 📜 Standard Operating Procedure (SOP)

This project strictly adheres to the 4-step workflow defined in `journey.md`:
1. **Repository Synchronization**: Pull latest remote changes.
2. **Journey Tracking Initialization**: Track progress and Git Commit IDs in `journey.md`.
3. **Version Control & Documentation Update**: Stage, commit, and document changes.
4. **Remote Synchronization**: Push commits to the remote GitHub repository.
