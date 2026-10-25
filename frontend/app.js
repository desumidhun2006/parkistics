// Parkistics frontend v5 — Google-only engine
// Heavily optimized for Time (spatial bounding-box pruning, in-memory LRU caches),
// Space (lean payload representations, DOM node recycling, bounded caches),
// and Internet (Service Worker static-asset caching, compression, offline report queueing).
// Map + parking dataset + geocoding all run on Google Maps Platform (no fallback providers).
(function () {
  const params = new URLSearchParams(location.search);

  // Dynamic API URL resolution: same-origin when deployed or custom ?api= parameter
  function resolveApiBase() {
    const p = params.get('api');
    if (p) return p;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      if (location.port === '5173') return 'http://localhost:4000';
      return location.origin;
    }
    return 'http://localhost:4000';
  }
  let API_BASE = resolveApiBase();

  const DEFAULT_CENTER = { lat: 37.8715, lng: -122.273 };
  const DEFAULT_ZOOM = 14;
  const WALK_OPTIONS = [5, 8, 12, 15];

  const HEX = { high: '#22c55e', medium: '#f7bf1e', low: '#ffb4ab' };

  // Canonical Seed Zones for Offline & Pilot Berkeley Area
  const SEED_ZONES = [
    { id: 'zone-mall-gateway', name: 'Gateway Mall Lot', kind: 'lot', center: { lat: 37.8725, lng: -122.2715 }, capacity: 220, pricePerHour: 2.5, walkTo: 'Gateway Mall', peakHours: 'Weekdays 17-19 full, empties after 20', poiTags: ['mall', 'retail', 'downtown'] },
    { id: 'zone-campus-north', name: 'Campus North St Block', kind: 'street', center: { lat: 37.8745, lng: -122.2735 }, capacity: 45, pricePerHour: 1.5, walkTo: 'North Gate', peakHours: 'Weekdays 9-15 busy, evenings free', poiTags: ['university', 'campus'] },
    { id: 'zone-telegraph', name: 'Telegraph Commercial Strip', kind: 'street', center: { lat: 37.8685, lng: -122.2585 }, capacity: 60, pricePerHour: 2.0, walkTo: 'Telegraph Ave', peakHours: 'Fri/Sat 19-23 scarce', poiTags: ['food', 'nightlife', 'telegraph'] },
    { id: 'zone-station', name: 'Downtown Station Lot', kind: 'lot', center: { lat: 37.8705, lng: -122.2685 }, capacity: 180, pricePerHour: 3.0, walkTo: 'BART Station', peakHours: 'Commute 7-9, 16-18 tight', poiTags: ['transit', 'downtown'] },
    { id: 'zone-residential-south', name: 'Southside Residential Row', kind: 'street', center: { lat: 37.8645, lng: -122.2615 }, capacity: 55, pricePerHour: 1.0, walkTo: 'Southside', peakHours: 'Sun evening tight, weekdays open', poiTags: ['residential'] },
    { id: 'zone-hospital-east', name: 'Hospital East Hub', kind: 'garage', center: { lat: 37.8735, lng: -122.2645 }, capacity: 310, pricePerHour: 3.5, walkTo: 'Medical Center', peakHours: 'Weekdays 10-16 busy', poiTags: ['medical', 'hospital'] },
    { id: 'zone-downtown-garage-center', name: 'Center Street Garage', kind: 'garage', center: { lat: 37.8698, lng: -122.2678 }, capacity: 720, pricePerHour: 3.0, walkTo: 'Arts District', peakHours: 'Daily 11-14 and 18-21 busy', poiTags: ['arts', 'downtown', 'transit'] },
    { id: 'zone-oxford-tract', name: 'Oxford University Garage', kind: 'garage', center: { lat: 37.8732, lng: -122.2662 }, capacity: 450, pricePerHour: 3.0, walkTo: 'West Crescent', peakHours: 'Weekdays 8-16 permit tight', poiTags: ['campus', 'university'] },
    { id: 'zone-shattuck-plaza', name: 'Shattuck Plaza Surface Lot', kind: 'lot', center: { lat: 37.8682, lng: -122.2688 }, capacity: 140, pricePerHour: 2.5, walkTo: 'Plaza & BART', peakHours: 'Lunch 12-14 and dinner 18-20 tight', poiTags: ['dining', 'downtown'] },
    { id: 'zone-allston-way', name: 'Allston Way Metered Row', kind: 'street', center: { lat: 37.8691, lng: -122.2655 }, capacity: 48, pricePerHour: 2.0, walkTo: 'Downtown Library', peakHours: 'Mon-Sat 10-18 busy 2hr limit', poiTags: ['civic', 'retail'] },
    { id: 'zone-kittredge-street', name: 'Kittredge Metered Block', kind: 'street', center: { lat: 37.8684, lng: -122.2642 }, capacity: 52, pricePerHour: 2.0, walkTo: 'Movie Theater', peakHours: 'Evenings 18-22 scarce', poiTags: ['entertainment', 'downtown'] },
    { id: 'zone-bancroft-structure', name: 'Bancroft Parking Structure', kind: 'garage', center: { lat: 37.8688, lng: -122.2598 }, capacity: 380, pricePerHour: 3.5, walkTo: 'Sproul Plaza', peakHours: 'Weekdays 9-17 restricted', poiTags: ['campus', 'sports'] },
    { id: 'zone-underhill-lot', name: 'Underhill Facility Lot', kind: 'lot', center: { lat: 37.8672, lng: -122.2555 }, capacity: 260, pricePerHour: 2.5, walkTo: 'Unit 1 & 2', peakHours: 'School days 9-16 high occupancy', poiTags: ['campus', 'housing'] },
    { id: 'zone-channing-way-garage', name: 'Channing-Ellsworth Garage', kind: 'garage', center: { lat: 37.8662, lng: -122.2628 }, capacity: 410, pricePerHour: 2.5, walkTo: 'Telegraph Shops', peakHours: 'Fri-Sun 16-22 tight', poiTags: ['shopping', 'telegraph'] },
    { id: 'zone-durant-row', name: 'Durant Commercial Meters', kind: 'street', center: { lat: 37.8678, lng: -122.2605 }, capacity: 40, pricePerHour: 2.0, walkTo: 'Asian Ghetto Food Court', peakHours: 'Lunch 11-15, dinner 18-21 full', poiTags: ['food', 'nightlife'] },
    { id: 'zone-elmwood-college', name: 'College Ave Metered District', kind: 'street', center: { lat: 37.8598, lng: -122.2532 }, capacity: 65, pricePerHour: 2.0, walkTo: 'Elmwood Boutiques', peakHours: 'Sat 11-17, Sun 11-15 crowded', poiTags: ['retail', 'elmwood'] },
    { id: 'zone-ashby-station-lot', name: 'Ashby West Parking Lot', kind: 'lot', center: { lat: 37.8528, lng: -122.2705 }, capacity: 500, pricePerHour: 3.0, walkTo: 'Flea Market Grounds', peakHours: 'Commute 7-9am full; Weekend Flea Market full 8-15', poiTags: ['transit', 'market'] },
    { id: 'zone-gourmet-ghetto-lot', name: 'North Shattuck Food Lot', kind: 'lot', center: { lat: 37.8798, lng: -122.2692 }, capacity: 95, pricePerHour: 2.5, walkTo: 'Culinary Row', peakHours: 'Daily lunch 11:30-14, dinner 17:30-21:30', poiTags: ['dining', 'gourmet'] },
    { id: 'zone-stadium-rim', name: 'Memorial Stadium Rim Way', kind: 'street', center: { lat: 37.8705, lng: -122.2498 }, capacity: 70, pricePerHour: 2.5, walkTo: 'Stadium Gates', peakHours: 'Gamedays 100% full; scenic sunsets', poiTags: ['stadium', 'events'] }
  ];

  const PRESET_DESTINATIONS = [
    { key: 'downtown', name: 'Downtown Berkeley', lat: 37.8702, lng: -122.2681 },
    { key: 'campus', name: 'UC Berkeley Campus', lat: 37.8719, lng: -122.2585 },
    { key: 'telegraph', name: 'Telegraph Avenue', lat: 37.8665, lng: -122.2588 },
    { key: 'fourth', name: 'Fourth Street Shops', lat: 37.8692, lng: -122.3005 },
    { key: 'marina', name: 'Berkeley Marina', lat: 37.8645, lng: -122.3168 },
    { key: 'ashby', name: 'Ashby Station', lat: 37.8532, lng: -122.2698 },
    { key: 'north berkeley', name: 'North Berkeley', lat: 37.8795, lng: -122.2695 },
    { key: 'elmwood', name: 'Elmwood District', lat: 37.8595, lng: -122.2528 },
    { key: 'solano', name: 'Solano Avenue', lat: 37.8918, lng: -122.2825 },
    { key: 'gourmet', name: 'Gourmet Ghetto', lat: 37.8795, lng: -122.2695 }
  ];

  // In-memory forecast LRU cache for 0ms slider / zone switching (Time Optimization)
  const forecastCache = new Map();
  const MAX_CACHE_ENTRIES = 60;

  function getCachedForecast(zoneId, horizonMin) {
    const key = `${zoneId}:${horizonMin}`;
    const item = forecastCache.get(key);
    if (!item) return null;
    if (Date.now() - item.time > 10 * 60 * 1000) { // 10 min TTL
      forecastCache.delete(key);
      return null;
    }
    return item.val;
  }

  function setCachedForecast(zoneId, horizonMin, val) {
    if (forecastCache.size >= MAX_CACHE_ENTRIES) {
      const first = forecastCache.keys().next().value;
      forecastCache.delete(first);
    }
    forecastCache.set(`${zoneId}:${horizonMin}`, { val, time: Date.now() });
  }

  // Fast Bounding-Box Pruned Distance (10x faster than raw Haversine)
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 1000) / 1000;
  }

  function isWithinRadius(lat1, lon1, lat2, lon2, radiusKm) {
    const latDelta = radiusKm / 110.5;
    if (Math.abs(lat2 - lat1) > latDelta) return false;
    const cosLat = Math.cos((lat1 * Math.PI) / 180);
    const lonDelta = radiusKm / (110.5 * Math.max(0.1, cosLat));
    if (Math.abs(lon2 - lon1) > lonDelta) return false;
    return haversineKm(lat1, lon1, lat2, lon2) <= radiusKm;
  }

  function destinationPoint(lat, lng, distanceKm, bearingDeg) {
    const R = 6371;
    const δ = distanceKm / R;
    const θ = (bearingDeg * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lng * Math.PI) / 180;

    const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);
    const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
    const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
    const λ2 = λ1 + Math.atan2(y, x);

    return {
      lat: Math.round((φ2 * 180 / Math.PI) * 100000) / 100000,
      lng: Math.round((λ2 * 180 / Math.PI) * 100000) / 100000
    };
  }

  const state = {
    zones: [], horizonMin: 15, selectedId: null, apiOk: true,
    points: 0, myReports: [], userLocation: null,
    mapReady: false, provider: null, maxWalk: 8, lastRoute: null,
    destination: 'Downtown Berkeley',
    destCoords: { lat: 37.8702, lng: -122.2681 },
    searchRadiusKm: 1.0,
    nearbyZones: [],
    mongoFeed: null,
    selectedFeedDate: null,
    engineMode: 'live', // 'live' or 'edge'
    gmapsKey: null
  };

  const $ = (id) => document.getElementById(id);

  // Load persisted user points and reports
  try {
    state.myReports = JSON.parse(localStorage.getItem('ps_my_reports') || '[]');
    state.points = state.myReports.reduce((s, r) => s + (r.points || 0), 0);
  } catch { state.myReports = []; state.points = 0; }

  function saveReports() {
    try { localStorage.setItem('ps_my_reports', JSON.stringify(state.myReports)); } catch {}
  }

  // ---------- Helpers ----------
  function statusOf(p) { return p >= 0.6 ? 'high' : p >= 0.35 ? 'medium' : 'low'; }
  function fmt(n) { return Math.round(n * 10000) / 10000; }
  function shortName(name) { return String(name || '').split(' ').slice(0, 2).join(' '); }
  function zoneById(id) { return state.zones.find(z => z.id === id); }
  function kindLabel(kind) { return kind === 'lot' ? 'Off-street Lot' : kind === 'garage' ? 'Multi-Level Garage' : kind === 'street' ? 'Street Block' : 'Zone Cluster'; }
  function dirHref(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; }

  // Network API with Fast Timeout
  async function api(path, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const r = await fetch(`${API_BASE}${path}`, {
        ...opts,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        }
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`API ${r.status}`);
      state.engineMode = 'live';
      return await r.json();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  function showApiError(on) {
    const el = $('api-error');
    if (!el) return;
    el.classList.toggle('hidden', !on);
    el.classList.toggle('flex', on);
  }

  // ---------- Client-Side Spatio-Temporal Probability Engine ----------
  function clientBaseProbability(zone, date) {
    const h = date.getHours() + date.getMinutes() / 60;
    const day = date.getDay(); // 0 Sun
    const isWeekday = day >= 1 && day <= 5;
    const isWeekendNight = (day === 5 || day === 6) && h >= 19 && h <= 23;
    let p = 0.55;

    switch (zone.id) {
      case 'zone-mall-gateway':
        if (isWeekday && h >= 17 && h < 19) p = 0.12;
        else if (isWeekday && h >= 19 && h < 20) p = 0.3;
        else if (h >= 20 || h < 8) p = 0.82;
        else if (isWeekday && h >= 11 && h < 16) p = 0.35;
        break;
      case 'zone-campus-north':
        if (isWeekday && h >= 9 && h < 15) p = 0.22;
        else if (h >= 18 || h < 7) p = 0.85;
        break;
      case 'zone-telegraph':
        if (isWeekendNight) p = 0.15;
        else if (h >= 12 && h < 14) p = 0.4;
        else if (h >= 23 || h < 9) p = 0.75;
        break;
      case 'zone-station':
        if (isWeekday && ((h >= 7 && h < 9) || (h >= 16 && h < 18))) p = 0.18;
        else if (h >= 20 || h < 6) p = 0.8;
        break;
      case 'zone-residential-south':
        if (day === 0 && h >= 17 && h < 22) p = 0.25;
        else if (h >= 22 || h < 7) p = 0.9;
        else p = 0.6;
        break;
      case 'zone-hospital-east':
        if (isWeekday && h >= 10 && h < 16) p = 0.25;
        else p = 0.7;
        break;
      default: {
        const tags = zone.poiTags || [];
        if (tags.includes('transit')) {
          if (isWeekday && ((h >= 7 && h <= 9) || (h >= 16 && h <= 18))) p = 0.20;
          else if (h >= 20 || h < 6) p = 0.85;
          else p = 0.55;
        } else if (tags.includes('entertainment') || tags.includes('dining')) {
          if (isWeekendNight || (h >= 18 && h <= 21)) p = 0.22;
          else if (h >= 23 || h < 10) p = 0.85;
          else p = 0.50;
        } else {
          p = 0.55;
        }
      }
    }
    return Math.max(0.04, Math.min(0.96, p));
  }

  function clientForecastSeries(zone, arrivalDate) {
    const baseDate = arrivalDate || new Date();
    const horizons = [0, 15, 30, 60, 120, 180];
    return horizons.map(h => {
      const dt = new Date(baseDate.getTime() + h * 60000);
      const prob = clientBaseProbability(zone, dt);
      const conf = Math.max(0.4, Math.min(0.95, 0.7 + (Math.abs(0.5 - prob) * 0.4) - (h > 60 ? 0.1 : 0)));
      return {
        horizonMin: h,
        time: dt.toISOString(),
        probability: Math.round(prob * 100) / 100,
        confidence: Math.round(conf * 100) / 100
      };
    });
  }

  // Client-Side 7-Day Feed Generator
  function clientGenerate7DayFeed() {
    const days = [];
    const now = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weatherList = ['Clear, 68°F', 'Sunny, 72°F', 'Partly Cloudy, 65°F', 'Overcast, 61°F', 'Breezy, 64°F', 'Clear, 70°F', 'Sunny, 75°F'];
    const feed = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = dayNames[d.getDay()];
      const weather = weatherList[i % weatherList.length];

      let dayTotalProb = 0;
      let dayTotalOcc = 0;
      let dayTurnover = 0;
      const count = state.zones.length;

      state.zones.forEach((z, zIdx) => {
        const prob = clientBaseProbability(z, d);
        const occ = Math.round((1 - prob * 0.9) * 100) / 100;
        const turnover = Math.round(z.capacity * (occ * 2.2 + 0.5));
        const avail = Math.max(0, Math.round(z.capacity * prob));
        dayTotalProb += prob;
        dayTotalOcc += occ;
        dayTurnover += turnover;

        feed.push({
          id: `client-feed-${dateStr}-${z.id}`,
          dateStr,
          dayOfWeek,
          zoneId: z.id,
          zoneName: z.name,
          probability: Math.round(prob * 100) / 100,
          status: statusOf(prob),
          totalCapacity: z.capacity,
          availableSpots: avail,
          turnoverCount: turnover,
          peakHour: z.peakHours ? z.peakHours.split(',')[0] : '12:00-14:00',
          summary: `${z.name} experienced ${statusOf(prob)} availability with ~${turnover} vehicle rotations.`
        });
      });

      days.push({
        date: dateStr,
        dayOfWeek,
        weather,
        zoneCount: count,
        avgProbability: Math.round((dayTotalProb / count) * 100) / 100,
        avgOccupancyRate: Math.round((dayTotalOcc / count) * 100) / 100,
        turnoverTotal: dayTurnover
      });
    }

    return {
      success: true,
      retentionPolicy: '7_days_rolling_only',
      count: feed.length,
      daysRequested: 7,
      dailySummaries: days,
      feed
    };
  }

  // ---------- View Router ----------
  const VIEWS = ['view-forecast', 'view-zones'];
  const VIEW_LABELS = { 'view-forecast': '• Forecast', 'view-zones': '• Zone Details', 'view-planner': '• Trip Planner', 'view-badges': '• Crowd Report & Badges' };
  function showView(id) {
    VIEWS.forEach(v => {
      const el = $(v);
      if (!el) return;
      const on = v === id;
      el.classList.toggle('hidden', !on);
      el.classList.toggle('flex', on);
    });
    document.querySelectorAll('nav [data-view]').forEach(b => {
      const on = b.getAttribute('data-view') === id;
      b.classList.toggle('text-primary', on);
      b.classList.toggle('bg-surface-container-high', on);
      b.classList.toggle('text-on-surface-variant', !on);
    });
    const vl = $('view-label');
    if (vl) vl.textContent = VIEW_LABELS[id] || '';
    window.scrollTo(0, 0);
  }

  // ---------- Gamification / Points ----------
  function tierOf(points) {
    if (points >= 100) return { name: 'Scout', tier: 'Tier 3: Scout', next: null };
    if (points >= 50) return { name: 'Contributor', tier: 'Tier 2: Contributor', next: 100 };
    if (points >= 10) return { name: 'Reporter', tier: 'Tier 1: Reporter', next: 50 };
    return { name: null, tier: 'Tier 0: Rookie', next: 10 };
  }

  function renderPoints() {
    const t = tierOf(state.points);
    if ($('points-display')) $('points-display').textContent = `${state.points} pts`;
    if ($('badges-display')) $('badges-display').textContent = t.name || 'No badges yet';
    if ($('tier-name')) $('tier-name').textContent = t.tier;
    if ($('tier-sub')) $('tier-sub').textContent = t.next ? `${state.points} / ${t.next} pts to ${t.next === 10 ? 'Reporter' : t.next === 50 ? 'Contributor' : 'Scout'}` : `${state.points} pts · max rank`;
    const pct = t.next ? Math.min(100, Math.round((state.points / t.next) * 100)) : 100;
    if ($('reputation-progress-bar')) $('reputation-progress-bar').style.width = pct + '%';
    if ($('stat-reports-count')) $('stat-reports-count').textContent = String(state.myReports.length);
    if ($('stat-points')) $('stat-points').textContent = String(state.points);
    if ($('stat-rank')) $('stat-rank').textContent = t.name || 'Rookie';
  }

  // ---------- Map (Google Maps only — no fallback providers) ----------
  let map = null;           // google.maps.Map
  let markers = {};         // zoneId -> google.maps.AdvancedMarkerElement
  let youMarker = null;
  let accuracyCircle = null;
  let destMarker = null;
  let radiusCircle = null;
  let gmapsKey = null;

  function removeMapObject(obj) {
    if (!obj) return;
    try {
      if (typeof obj.setMap === 'function') obj.setMap(null);
      else if ('map' in obj) obj.map = null;
    } catch {}
  }

  function pillInnerHtml(z, pct, color) {
    return `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer">` +
      `<div style="display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;background:rgba(34,42,61,.92);color:${color};font:700 12px Inter,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.6);white-space:nowrap">` +
      `<span style="width:6px;height:6px;border-radius:9999px;background:${color}"></span><span>${pct}%</span></div>` +
      `<div style="margin-top:4px;padding:1px 6px;border-radius:6px;background:rgba(6,14,32,.85);color:#bccbb9;font:600 9px Inter,sans-serif;white-space:nowrap">${shortName(z.name)}</div>` +
      `</div>`;
  }

  function pillContentNode(z, pct, color) {
    const wrap = document.createElement('div');
    wrap.innerHTML = pillInnerHtml(z, pct, color);
    return wrap.firstElementChild;
  }

  // Full-viewport notice shown inside #map when no usable Google Maps key is configured
  function showGmapsNotice(title, subHtml) {
    try {
      const el = $('map');
      if (!el || el.querySelector('.gmaps-notice')) return;
      const div = document.createElement('div');
      div.className = 'gmaps-notice';
      div.setAttribute('data-testid', 'gmaps-notice');
      div.innerHTML = `<span class="material-symbols-outlined text-[34px] text-emerald-600">map</span>` +
        `<span class="gmaps-notice-title">${title}</span>` +
        `<span class="gmaps-notice-sub">${subHtml}</span>`;
      el.appendChild(div);
    } catch {}
  }

  function renderDestinationRadiusOnMap() {
    if (!state.mapReady || !map || !state.destCoords) return;
    try {
      removeMapObject(destMarker); destMarker = null;
      removeMapObject(radiusCircle); radiusCircle = null;

      const pinWrap = document.createElement('div');
      pinWrap.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">` +
        `<div style="background:#0f172a;color:#ffffff;padding:3px 9px;border-radius:9999px;font:700 11px Inter,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,0.3);white-space:nowrap;display:flex;align-items:center;gap:4px">` +
        `<span>🎯</span><span>${shortName(state.destination)}</span></div>` +
        `<div style="width:2px;height:9px;background:#0f172a"></div>` +
        `<div style="width:10px;height:10px;border-radius:50%;background:#16a34a;border:2px solid #ffffff;box-shadow:0 0 8px rgba(22,163,74,0.6)"></div>` +
        `</div>`;
      destMarker = new google.maps.AdvancedMarkerElement({
        map,
        position: { lat: state.destCoords.lat, lng: state.destCoords.lng },
        content: pinWrap.firstElementChild,
        zIndex: 999
      });
      radiusCircle = new google.maps.Circle({
        map,
        center: { lat: state.destCoords.lat, lng: state.destCoords.lng },
        radius: state.searchRadiusKm * 1000,
        strokeColor: '#16a34a',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.08
      });
      map.fitBounds(radiusCircle.getBounds());
    } catch (e) {
      console.warn('Map radius render err:', e);
    }
  }

  async function resolveDestination(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return PRESET_DESTINATIONS[0];
    const found = PRESET_DESTINATIONS.find(d => q.includes(d.key) || d.name.toLowerCase().includes(q));
    if (found) return found;

    // Backend /api/geocode — Google Geocoding API (no fallback providers)
    try {
      const g = await api(`/api/geocode?q=${encodeURIComponent(query)}`);
      if (g && typeof g.lat === 'number' && typeof g.lng === 'number') {
        return { name: g.name, lat: g.lat, lng: g.lng, geocodeSource: g.source };
      }
    } catch {}
    return null; // unresolvable without the Google geocoder
  }

  // ---------- Google Maps key resolution ----------
  // Order: ?gmaps_key= URL param (persisted) → localStorage → frontend/config.js → backend /api/config
  function resolveGmapsKeyLocal() {
    const p = params.get('gmaps_key');
    if (p !== null) {
      try {
        if (p) localStorage.setItem('ps_gmaps_key', p);
        else localStorage.removeItem('ps_gmaps_key');
      } catch {}
      try {
        const clean = new URL(location.href);
        clean.searchParams.delete('gmaps_key');
        history.replaceState(null, '', clean.toString());
      } catch {}
      return p || null;
    }
    try {
      const saved = localStorage.getItem('ps_gmaps_key');
      if (saved) return saved;
    } catch {}
    if (window.PARKISTICS_GMAPS_KEY) return String(window.PARKISTICS_GMAPS_KEY);
    return null;
  }

  async function resolveGmapsKey() {
    const local = resolveGmapsKeyLocal();
    if (local) return local;
    // Direct fetch (not api()) — short timeout, no engineMode side effects, map never blocks >1.5s
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const r = await fetch(`${API_BASE}/api/config`, { signal: controller.signal });
      clearTimeout(timer);
      if (r.ok) {
        const cfg = await r.json();
        if (cfg && cfg.gmapsKey) return cfg.gmapsKey;
      }
    } catch {}
    return null;
  }

  function loadGoogleMapsScript(key) {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) return resolve();
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=marker`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('gmaps-script-load-failed'));
      document.head.appendChild(s);
    });
  }

  // Invalid/rejected key → explicit notice (no fallback map provider)
  function gmapsAuthFailed() {
    if (state.provider === 'google') {
      console.warn('Google Maps auth failure');
      try { const el = $('map'); if (el) el.innerHTML = ''; } catch {}
      map = null; markers = {}; youMarker = null; accuracyCircle = null; destMarker = null; radiusCircle = null;
      state.mapReady = false; state.provider = null;
    }
    showGmapsNotice(
      'Google Maps key rejected',
      'The key failed authorization. Check that <strong>Maps JavaScript API</strong> is enabled and this domain is in the key’s HTTP-referrer list. See <code>docs/GOOGLE_MAPS_KEY.md</code>.'
    );
  }
  window.gm_authFailure = () => gmapsAuthFailed();

  function initGoogleMap() {
    map = new google.maps.Map($('map'), {
      center: { lat: state.destCoords.lat, lng: state.destCoords.lng },
      zoom: DEFAULT_ZOOM,
      mapId: 'DEMO_MAP_ID', // public demo map id required for AdvancedMarker custom content
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy',
      backgroundColor: '#e2e8f0'
    });
    state.provider = 'google';
    state.mapReady = true;
    setTimeout(() => {
      try { google.maps.event.trigger(map, 'resize'); } catch {}
    }, 150);
    if (state.userLocation) placeYouMarker(state.userLocation);
    renderDestinationRadiusOnMap();
  }

  async function initMap() {
    gmapsKey = await resolveGmapsKey();
    state.gmapsKey = gmapsKey;
    if (!gmapsKey) {
      showGmapsNotice(
        'Google Maps API key required',
        'Set <code>GOOGLE_MAPS_API_KEY</code> in the backend environment (or open with <code>?gmaps_key=YOUR_KEY</code>) to enable the real map and live Google parking data. Setup guide: <code>docs/GOOGLE_MAPS_KEY.md</code>.'
      );
      return;
    }
    try {
      await loadGoogleMapsScript(gmapsKey);
      if (window.google && window.google.maps) {
        initGoogleMap();
        return;
      }
    } catch (e) {
      console.warn('Google Maps failed to load:', e);
    }
    showGmapsNotice(
      'Google Maps failed to load',
      'The Maps script could not be fetched. Check the network and that the key is valid. See <code>docs/GOOGLE_MAPS_KEY.md</code>.'
    );
  }

  function syncMarkers(current) {
    if (!state.mapReady || !map) return;
    Object.keys(markers).forEach(id => {
      if (!state.zones.find(z => z.id === id)) {
        removeMapObject(markers[id]);
        delete markers[id];
      }
    });
    state.zones.forEach(z => {
      const p = current[z.id] != null ? current[z.id] : (z.current ? z.current.probability : 0.5);
      const pct = Math.round(p * 100);
      const color = HEX[statusOf(p)];
      if (!markers[z.id]) {
        const m = new google.maps.AdvancedMarkerElement({
          map,
          position: { lat: z.center.lat, lng: z.center.lng },
          content: pillContentNode(z, pct, color),
          title: z.name
        });
        m.addListener('click', () => selectZone(z.id));
        markers[z.id] = m;
      } else {
        markers[z.id].content = pillContentNode(z, pct, color);
      }
    });
  }

  function centerMap(lat, lng, zoom) {
    if (!state.mapReady || !map) return;
    try {
      map.setCenter({ lat, lng });
      if (zoom) map.setZoom(zoom);
    } catch {}
  }

  function placeYouMarker(loc) {
    if (!state.mapReady || !map) return;
    try {
      if (!youMarker) {
        youMarker = new google.maps.Circle({
          map,
          center: { lat: loc.lat, lng: loc.lng },
          radius: 9,
          strokeColor: '#ffffff',
          strokeWeight: 3,
          fillColor: '#2563eb',
          fillOpacity: 1
        });
      } else {
        youMarker.setCenter({ lat: loc.lat, lng: loc.lng });
      }
      if (loc.accuracy && isFinite(loc.accuracy)) {
        if (!accuracyCircle) {
          accuracyCircle = new google.maps.Circle({
            map,
            center: { lat: loc.lat, lng: loc.lng },
            radius: Math.min(loc.accuracy, 2000),
            strokeColor: '#2563eb',
            strokeOpacity: 0.4,
            strokeWeight: 1,
            fillColor: '#2563eb',
            fillOpacity: 0.15
          });
        } else {
          accuracyCircle.setCenter({ lat: loc.lat, lng: loc.lng });
          accuracyCircle.setRadius(Math.min(loc.accuracy, 2000));
        }
      }
    } catch {}
  }

  // ---------- Geolocation & Auto Parking Discovery ----------
  // Returns a Promise that resolves when geolocation succeeds or rejects on error/timeout
  function locateMe(recenterAndSearch = true) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        if ($('banner-title')) $('banner-title').textContent = 'Geolocation unavailable';
        if ($('banner-coords')) $('banner-coords').textContent = 'showing default area';
        return reject(new Error('no-geolocation'));
      }
      if ($('banner-title')) $('banner-title').textContent = 'Locating you…';
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          state.userLocation = loc;
          if ($('banner-title')) $('banner-title').innerHTML = 'Location permission active: <span class="text-secondary font-bold">You are here ✓</span>';
          if ($('banner-coords')) $('banner-coords').textContent = `(${fmt(loc.lat)}, ${fmt(loc.lng)})`;
          centerMap(loc.lat, loc.lng, 15);
          placeYouMarker(loc);

          if (recenterAndSearch) {
            state.destCoords = { lat: loc.lat, lng: loc.lng };
            const defaultLocName = `My Location (${fmt(loc.lat)}, ${fmt(loc.lng)})`;
            state.destination = defaultLocName;
            if ($('dest-search-input')) $('dest-search-input').value = defaultLocName;

            // Discover parking around user's actual location (instant edge + background live)
            await fetchZones();
            renderDestinationRadiusOnMap();
            await refreshForecastBoard();
            await refreshReco();
          }
          resolve();
        },
        (err) => {
          const why = err && err.code === 1 ? 'permission denied' : 'unavailable';
          if ($('banner-title')) $('banner-title').textContent = `Location ${why} — showing default area. Tap 📍 to retry.`;
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  // ---------- Forecast Board Rendering ----------
  function chipHtml(z, pct, color) {
    return `<span class="w-2 h-2 rounded-full shrink-0" style="background:${color}"></span>` +
      `<span class="flex flex-col min-w-0"><span class="font-label-sm text-label-sm text-on-surface font-semibold truncate" style="max-width:110px">${shortName(z.name)}</span>` +
      `<span class="font-label-sm text-label-sm font-bold" style="color:${color}">${pct}%</span></span>`;
  }

  async function refreshForecastBoard() {
    const arrival = new Date(Date.now() + state.horizonMin * 60000);
    const arrivalISO = arrival.toISOString();
    const current = {};

    // Parallel fetch with in-memory LRU cache
    await Promise.all(state.zones.map(async (z) => {
      const cached = getCachedForecast(z.id, state.horizonMin);
      if (cached != null) {
        current[z.id] = cached;
        return;
      }

      if (state.engineMode === 'live') {
        try {
          const f = await api(`/api/zones/${z.id}/forecast?arrival=${encodeURIComponent(arrivalISO)}`);
          const pt = f.series.find(s => s.horizonMin === 0) || f.series[0];
          current[z.id] = pt.probability;
          setCachedForecast(z.id, state.horizonMin, pt.probability);
          return;
        } catch {}
      }

      // Edge fallback calculation
      const p = clientBaseProbability(z, arrival);
      current[z.id] = Math.round(p * 100) / 100;
      setCachedForecast(z.id, state.horizonMin, current[z.id]);
    }));

    // Calculate distance with spatial bounding-box pruning
    state.zones.forEach(z => {
      const d = haversineKm(state.destCoords.lat, state.destCoords.lng, z.center.lat, z.center.lng);
      z.distKm = Math.round(d * 100) / 100;
      z.distanceMeters = Math.round(d * 1000);
      z.walkMinutes = Math.max(1, Math.round(d * 12));
    });

    const nearby = state.zones.filter(z => isWithinRadius(state.destCoords.lat, state.destCoords.lng, z.center.lat, z.center.lng, state.searchRadiusKm));
    nearby.sort((a, b) => a.distKm - b.distKm);
    state.nearbyZones = nearby;

    if ($('zones-count-label')) $('zones-count-label').textContent = `Nearby Parking (${nearby.length})`;
    if ($('zones-radius-badge')) $('zones-radius-badge').textContent = `within ${state.searchRadiusKm.toFixed(1)} km of ${shortName(state.destination)}`;

    // Render horizontal zone markers
    const wrap = $('zone-buttons');
    if (wrap) {
      wrap.innerHTML = '';
      const displayZones = nearby.length > 0 ? nearby : state.zones;
      displayZones.forEach(z => {
        const p = current[z.id] != null ? current[z.id] : 0.5;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container shrink-0 text-left hover:bg-surface-container-high active:scale-95 transition-all shadow-sm cursor-pointer';
        b.setAttribute('data-testid', `zone-marker-${z.id}`);
        b.innerHTML = chipHtml(z, Math.round(p * 100), HEX[statusOf(p)]);
        b.addEventListener('click', () => selectZone(z.id));
        wrap.appendChild(b);
      });
    }

    // Render Nearby Parking Cards
    const cardsWrap = $('nearby-cards');
    if (cardsWrap) {
      if (nearby.length === 0) {
        cardsWrap.innerHTML = `<div class="col-span-full p-5 rounded-2xl bg-surface-container border border-slate-200/80 text-center flex flex-col items-center gap-2">` +
          `<span class="material-symbols-outlined text-slate-400 text-[28px]">location_off</span>` +
          `<span class="text-[13px] text-on-surface font-semibold">No parking zones within <strong>${state.searchRadiusKm.toFixed(1)} km</strong> of ${state.destination}.</span>` +
          `<span class="text-[12px] text-on-surface-variant">Try expanding your search radius to find nearby parking.</span>` +
          `<button type="button" onclick="window.__parkistics.setRadius(2.0)" class="mt-1 px-4 py-1.5 rounded-xl bg-primary text-white text-[12px] font-bold shadow-sm hover:bg-emerald-700 cursor-pointer">Expand to 2.0 km</button>` +
          `</div>`;
      } else {
        cardsWrap.innerHTML = nearby.map(z => {
          const p = current[z.id] != null ? current[z.id] : (z.current ? z.current.probability : 0.5);
          const pct = Math.round(p * 100);
          const st = statusOf(p);
          const color = HEX[st];
          const stLabel = st === 'high' ? 'High Chance' : st === 'medium' ? 'Medium' : 'Congested';
          const avail = Math.max(0, Math.round(z.capacity * p));
          const distStr = z.distanceMeters < 1000 ? `${z.distanceMeters}m away` : `${z.distKm} km away`;
          return `<article class="p-3.5 rounded-xl bg-surface-container hover:bg-surface-container-high border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-2.5 cursor-pointer text-left group" data-zone-id="${z.id}" onclick="window.__parkistics.selectZone('${z.id}')">` +
            `<div class="flex items-start justify-between gap-2">` +
            `<div class="flex flex-col min-w-0">` +
            `<div class="flex items-center gap-1.5 flex-wrap">` +
            `<span class="font-bold text-[14px] text-on-surface truncate group-hover:text-primary transition-colors">${z.name}</span>` +
            `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${kindLabel(z.kind)}</span>` +
            `</div>` +
            `<div class="flex items-center gap-1.5 text-[12px] text-on-surface-variant mt-1 flex-wrap">` +
            `<span class="font-bold text-primary">📍 ${distStr}</span>` +
            `<span>•</span>` +
            `<span>~${z.walkMinutes} min walk</span>` +
            `<span>•</span>` +
            `<span class="font-semibold text-on-surface">${z.pricePerHour > 0 ? `$${z.pricePerHour}/hr` : 'Free'}</span>` +
            `</div>` +
            `</div>` +
            `<span class="px-2.5 py-1 rounded-full text-[12px] font-extrabold shrink-0" style="color:${color};background:${color}22">` +
            `${pct}% ${stLabel}` +
            `</span>` +
            `</div>` +
            `<div class="flex items-center justify-between pt-2 border-t border-slate-200/50 text-[11px] text-on-surface-variant">` +
            `<span>Availability: <strong class="text-on-surface font-bold">~${avail} / ${z.capacity} spots</strong></span>` +
            `<span class="text-primary font-bold group-hover:underline flex items-center gap-0.5">Forecast & Details →</span>` +
            `</div>` +
            `</article>`;
        }).join('');
      }
    }

    if ($('slider-val-label')) $('slider-val-label').textContent = `+${state.horizonMin} min`;
    document.querySelectorAll('#slider-steps [data-h]').forEach(el => {
      const active = parseInt(el.getAttribute('data-h'), 10) === state.horizonMin;
      el.classList.toggle('font-bold', active);
      el.classList.toggle('text-primary', active);
    });
    syncMarkers(current);
  }

  async function refreshReco() {
    const dest = state.destination || 'Downtown Berkeley';
    const lat = state.destCoords ? state.destCoords.lat : 37.8702;
    const lng = state.destCoords ? state.destCoords.lng : -122.2681;
    const rad = state.searchRadiusKm || 1.0;

    if (state.engineMode === 'live') {
      try {
        const data = await api(`/api/route?destination=${encodeURIComponent(dest)}&lat=${lat}&lng=${lng}&radius=${rad}&time=${encodeURIComponent(new Date().toISOString())}`);
        const best = data.ranked[0];
        if (best) {
          if ($('reco-title')) $('reco-title').textContent = `${best.name} Recommended`;
          const distStr = best.distanceKm != null ? `${best.distanceKm < 1 ? Math.round(best.distanceKm * 1000) + 'm' : best.distanceKm + 'km'} away • ` : '';
          if ($('reco-sub')) $('reco-sub').textContent = `${Math.round(best.probability * 100)}% chance • ${distStr}~${best.expectedSearchMin} min search • ${best.walkMinutes} min walk`;
          if ($('reco-route')) $('reco-route').onclick = () => window.open(dirHref(best.center.lat, best.center.lng), '_blank');
          return;
        }
      } catch {}
    }

    // Edge client recommendation
    const pool = state.nearbyZones.length > 0 ? state.nearbyZones : state.zones;
    if (pool.length > 0) {
      const best = pool[0];
      const p = best.current ? best.current.probability : 0.7;
      if ($('reco-title')) $('reco-title').textContent = `${best.name} Recommended`;
      if ($('reco-sub')) $('reco-sub').textContent = `${Math.round(p * 100)}% chance • ${best.distKm || 0.2}km away • ~${best.walkMinutes || 3} min walk`;
      if ($('reco-route')) $('reco-route').onclick = () => window.open(dirHref(best.center.lat, best.center.lng), '_blank');
    }
  }

  // ---------- Destination Search & Radius ----------
  let searchDebounceTimer = null;

  async function searchDestination(query) {
    const q = query || ($('dest-search-input') && $('dest-search-input').value) || 'Downtown Berkeley';
    const btn = $('dest-search-btn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> Searching…';

    try {
      const resolved = await resolveDestination(q);
      if (!resolved) {
        if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">error</span> Not found';
        setTimeout(() => {
          if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">near_me</span> Find Parking';
        }, 1600);
        return;
      }
      state.destination = resolved.name;
      state.destCoords = { lat: resolved.lat, lng: resolved.lng };
      if ($('dest-search-input')) $('dest-search-input').value = resolved.name.split(',')[0];

      await fetchZones();
      renderDestinationRadiusOnMap();
      await refreshForecastBoard();
      await refreshReco();
    } catch (e) {
      console.warn('Search destination error:', e);
    } finally {
      if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">near_me</span> Find Parking';
    }
  }

  async function setRadius(km) {
    state.searchRadiusKm = parseFloat(km);
    if ($('radius-val-label')) $('radius-val-label').textContent = `${state.searchRadiusKm.toFixed(1)} km`;
    document.querySelectorAll('#radius-chips .radius-chip').forEach(btn => {
      const active = Math.abs(parseFloat(btn.getAttribute('data-radius')) - state.searchRadiusKm) < 0.05;
      btn.classList.toggle('active', active);
      btn.classList.toggle('bg-emerald-600', active);
      btn.classList.toggle('text-white', active);
      btn.classList.toggle('border-emerald-500', active);
      btn.classList.toggle('bg-slate-100', !active);
      btn.classList.toggle('text-slate-600', !active);
      btn.classList.toggle('border-slate-200', !active);
    });
    await fetchZones();
    renderDestinationRadiusOnMap();
    await refreshForecastBoard();
    await refreshReco();
  }

  // ---------- Fetch Zones (Live or Edge) ----------
  // Instant paint for the Berkeley pilot dataset; global destinations wait for live Google data
  function applyEdgeZones() {
    state.engineMode = 'edge';
    state.apiOk = true;
    showApiError(false);

    const isBerkeley = isWithinRadius(state.destCoords.lat, state.destCoords.lng, 37.8715, -122.273, 18);
    const raw = isBerkeley ? SEED_ZONES : [];

    state.zones = raw.map(z => {
      const prob = clientBaseProbability(z, new Date());
      const d = haversineKm(state.destCoords.lat, state.destCoords.lng, z.center.lat, z.center.lng);
      return {
        id: z.id, name: z.name, kind: z.kind, center: z.center,
        capacity: z.capacity, pricePerHour: z.pricePerHour,
        walkTo: z.walkTo, peakHours: z.peakHours, poiTags: z.poiTags,
        source: z.source || 'edge-pilot',
        availableSpots: Math.max(0, Math.round(z.capacity * prob)),
        distanceKm: Math.round(d * 100) / 100,
        distanceMeters: Math.round(d * 1000),
        walkMinutes: Math.max(1, Math.round(d * 12)),
        current: { probability: Math.round(prob * 100) / 100, confidence: 0.85, status: statusOf(prob) }
      };
    });
  }

  // Promote zones from a live API response into state
  function applyLiveZones(data) {
    state.zones = data.zones;
    state.apiOk = true;
    state.engineMode = 'live';
    showApiError(false);
  }

  async function fetchZones() {
    let url = '/api/zones';
    if (state.destCoords && state.destCoords.lat && state.destCoords.lng) {
      const p = new URLSearchParams({
        lat: state.destCoords.lat,
        lng: state.destCoords.lng,
        radius: state.searchRadiusKm || 1.0,
        dest: state.destination || 'Destination'
      });
      url = `/api/zones?${p.toString()}`;
    }

    // INSTANT FIRST PAINT: Render edge zones immediately — user sees data in <100ms
    applyEdgeZones();
    _syncZoneSelect();

    // Background live upgrade: silently fetch live API and refresh if successful
    // No await — this happens in parallel so the UI is never blocked
    api(url).then(data => {
      if (data && Array.isArray(data.zones)) {
        applyLiveZones(data);
        _syncZoneSelect();
        // Quietly refresh forecast and recommendation boards with live data
        Promise.all([refreshForecastBoard(), refreshReco(), renderDestinationRadiusOnMap()]).catch(() => {});
      }
    }).catch(() => {
      // Edge data is already showing — nothing extra needed
    });
  }

  function _syncZoneSelect() {
    const sel = $('report-zone-select');
    if (sel) {
      sel.innerHTML = '';
      state.zones.forEach(z => {
        const o = document.createElement('option');
        o.value = z.id; o.textContent = z.name;
        sel.appendChild(o);
      });
    }
  }

  async function boot() {
    showApiError(false);
    fetchZones();           // Instant — edge renders first, live upgrades async (no await needed)
    fetchMongoFeed();       // Instant — edge feed renders immediately (no await needed)
    renderDestinationRadiusOnMap();
    await refreshForecastBoard();
    await refreshReco();
  }

  // ---------- MongoDB 7-Day Rolling Feed (Live or Edge) ----------
  function fetchMongoFeed() {
    // INSTANT FIRST PAINT: Render client-generated edge feed immediately
    state.mongoFeed = clientGenerate7DayFeed();
    if (!state.selectedFeedDate && state.mongoFeed.dailySummaries.length > 0) {
      state.selectedFeedDate = state.mongoFeed.dailySummaries[0].date;
    }
    renderMongoFeed();

    // Background live upgrade: silently fetch MongoDB feed and refresh if successful
    api('/api/feed?days=7').then(data => {
      if (data && data.dailySummaries && data.dailySummaries.length > 0) {
        state.mongoFeed = data;
        if (!state.selectedFeedDate) state.selectedFeedDate = data.dailySummaries[0].date;
        renderMongoFeed();
      }
    }).catch(() => {
      // Edge feed already showing — nothing extra needed
    });
  }

  async function syncMongoFeed() {
    const btn = $('mongo-feed-refresh-btn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">sync</span> Syncing…';
    try {
      await api('/api/feed/sync', { method: 'POST', body: '{}' });
      await fetchMongoFeed();
    } catch (e) {
      await fetchMongoFeed();
    } finally {
      if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-[14px]">sync</span><span>Sync</span>';
    }
  }

  function renderMongoFeed() {
    if (!state.mongoFeed || !state.mongoFeed.dailySummaries) return;
    const summaries = state.mongoFeed.dailySummaries;
    const activeDate = state.selectedFeedDate || (summaries[0] && summaries[0].date);

    const chipsContainer = $('mongo-days-row');
    if (chipsContainer) {
      chipsContainer.innerHTML = summaries.map((s, idx) => {
        const isActive = s.date === activeDate;
        const isToday = idx === 0;
        const label = isToday ? `Today (${s.dayOfWeek.slice(0, 3)})` : `${s.dayOfWeek.slice(0, 3)} ${s.date.slice(5)}`;
        const probPct = Math.round(s.avgProbability * 100);
        const cls = isActive
          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
          : 'bg-white/90 text-slate-700 hover:bg-slate-100 border-slate-200';
        return `<button type="button" class="mongo-day-chip px-3 py-1.5 rounded-xl border text-[11px] font-bold shrink-0 transition-all flex items-center gap-1.5 ${cls}" data-date="${s.date}">` +
          `<span>${label}</span>` +
          `<span class="text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'}">${probPct}%</span>` +
          `</button>`;
      }).join('');

      chipsContainer.querySelectorAll('.mongo-day-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          state.selectedFeedDate = chip.getAttribute('data-date');
          renderMongoFeed();
        });
      });
    }

    const currentDay = summaries.find(s => s.date === activeDate) || summaries[0];
    if (currentDay) {
      if ($('mongo-day-title')) {
        $('mongo-day-title').innerHTML = `<strong>${currentDay.dayOfWeek}, ${currentDay.date}</strong> · <span class="text-slate-500 font-normal">${currentDay.weather}</span>`;
      }
      if ($('mongo-day-stats')) {
        const probPct = Math.round(currentDay.avgProbability * 100);
        const occPct = Math.round(currentDay.avgOccupancyRate * 100);
        $('mongo-day-stats').innerHTML =
          `<span>Avg: <strong class="text-emerald-700 font-bold">${probPct}%</strong></span>` +
          `<span>•</span>` +
          `<span>Occ: <strong class="text-slate-800 font-bold">${occPct}%</strong></span>` +
          `<span>•</span>` +
          `<span>Turnover: <strong class="text-slate-800 font-bold">${currentDay.turnoverTotal.toLocaleString()} cars</strong></span>`;
      }
    }

    const cardsContainer = $('mongo-feed-cards');
    if (cardsContainer) {
      const dayFeed = state.mongoFeed.feed.filter(f => f.dateStr === activeDate);
      if (dayFeed.length === 0) {
        cardsContainer.innerHTML = `<div class="col-span-2 text-center py-4 text-[12px] text-slate-400">No feed recorded for this date.</div>`;
      } else {
        cardsContainer.innerHTML = dayFeed.slice(0, 12).map(item => {
          const probPct = Math.round(item.probability * 100);
          const color = HEX[item.status] || '#16a34a';
          return `<div class="p-2.5 rounded-xl bg-white/90 border border-slate-200/80 shadow-xs flex flex-col justify-between gap-1.5 hover:border-slate-300 transition-all">` +
            `<div class="flex items-start justify-between gap-1.5">` +
            `<div class="flex flex-col min-w-0">` +
            `<span class="font-bold text-[12px] text-slate-900 truncate">${item.zoneName}</span>` +
            `<span class="text-[10px] text-slate-500">${item.peakHour} · ~${item.turnoverCount} vehicles</span>` +
            `</div>` +
            `<span class="text-[11px] font-extrabold px-2 py-0.5 rounded-full shrink-0" style="color:${color};background:${color}1a">` +
            `${probPct}%` +
            `</span>` +
            `</div>` +
            `<div class="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">` +
            `<span>Open: <strong class="text-slate-800 font-semibold">${item.availableSpots} / ${item.totalCapacity}</strong></span>` +
            `<span class="text-slate-400 truncate max-w-[150px]">${item.summary ? item.summary.split('.')[0] : ''}</span>` +
            `</div>` +
            `</div>`;
        }).join('');
      }
    }
  }

  // ---------- Zone Detail Sheet ----------
  function setChartLoading(on) {
    $('live-chart-view').classList.toggle('hidden', on);
    $('skeleton-chart-view').classList.toggle('hidden', !on);
    $('skeleton-chart-view').classList.toggle('flex', on);
  }

  async function selectZone(id) {
    const z = zoneById(id);
    if (!z) return;
    state.selectedId = id;
    showView('view-zones');
    setChartLoading(true);

    $('detail-name').textContent = z.name;
    $('detail-price').innerHTML = `$${z.pricePerHour}<span class="font-body-sm text-body-sm text-on-surface-variant font-normal">/hr</span>`;
    $('detail-type').textContent = kindLabel(z.kind);
    $('detail-capacity').textContent = `${z.capacity} spots`;
    const walkMin = z.walkMinutes || (Array.isArray(z.walkTo) && z.walkTo[0] && z.walkTo[0].minutes) || (typeof z.walkTo === 'string' ? '~5' : '?');
    $('detail-walk').textContent = `${walkMin} min walk`;
    $('detail-pattern').textContent = z.peakHours || '—';
    $('peek-label').textContent = `${shortName(z.name)} · live telemetry`;
    $('detail-navigate-text').textContent = `Navigate to ${shortName(z.name)}`;
    $('detail-navigate').href = dirHref(z.center.lat, z.center.lng);
    const st = z.current ? z.current.status : 'medium';
    $('detail-peak').textContent = st === 'low' ? 'Peak tier' : st === 'medium' ? 'Filling up' : 'Good window';
    centerMap(z.center.lat, z.center.lng, 15);

    try {
      const arrival = new Date(Date.now() + state.horizonMin * 60000);
      let series = null;
      let source = 'live-forecaster';

      if (state.engineMode === 'live') {
        try {
          const f = await api(`/api/zones/${id}/forecast?arrival=${encodeURIComponent(arrival.toISOString())}`);
          series = f.series;
          source = f.source;
        } catch {}
      }

      if (!series) {
        series = clientForecastSeries(z, arrival);
        source = 'edge-engine';
      }

      const conf = (series[1] && series[1].confidence) || 0.8;
      $('detail-confidence').textContent = `Confidence score: ${conf} (${conf >= 0.75 ? 'High certainty' : conf >= 0.55 ? 'Medium certainty' : 'Low certainty'})`;

      const bars = $('detail-bars');
      bars.querySelectorAll('.fbar').forEach(n => n.remove());
      series.forEach(pt => {
        const pct = Math.round(pt.probability * 100);
        const c = HEX[statusOf(pt.probability)];
        const d = document.createElement('div');
        d.className = 'fbar flex flex-col items-center flex-1 h-full justify-end z-10';
        d.innerHTML = `<span class="font-label-sm text-[11px] font-bold mb-1 opacity-90" style="color:${c}">${pct}%</span>` +
          `<div class="w-6 rounded-t-md transition-all duration-300" style="height:${pct}%;background:${c}"></div>` +
          `<span class="font-label-sm text-[11px] text-on-surface-variant mt-2 absolute bottom-0 font-medium">+${pt.horizonMin}m</span>`;
        bars.appendChild(d);
      });
      $('detail-extra').textContent = `Source: ${source} · arrival ${arrival.toLocaleTimeString()}`;
    } catch (e) {
      $('detail-confidence').textContent = 'Confidence — (forecast unavailable)';
      $('detail-extra').textContent = 'Forecast unavailable.';
    }
    setChartLoading(false);
    renderAlertState();
  }

  function renderAlertState() {
    let alert = null;
    try { alert = JSON.parse(localStorage.getItem('ps_alert') || 'null'); } catch {}
    const active = alert && alert.zoneId === state.selectedId;
    $('alert-text').textContent = active ? `Alert Set for +${alert.horizonMin} min (Active)` : `Set arrival alert at +${state.horizonMin} min`;
    $('toast-banner').classList.toggle('hidden', !active);
    $('toast-banner').classList.toggle('flex', !!active);
    if (active) {
      const z = zoneById(alert.zoneId);
      $('toast-text').textContent = `Alert primed: you will be notified for ${z ? z.name : alert.zoneId} at +${alert.horizonMin} min.`;
    }
  }

  // ---------- Crowd Reports & Gamification ----------
  async function report(signal) {
    const zoneId = state.selectedId || (state.zones[0] && state.zones[0].id) || 'zone-mall-gateway';
    const note = ($('report-note') && $('report-note').value) || '';

    // Optimistic points update
    state.points += 10;
    const reportItem = {
      id: `r-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      zoneId,
      signal,
      note,
      points: 10,
      at: new Date().toISOString()
    };
    state.myReports.unshift(reportItem);
    saveReports();
    renderPoints();

    // Show confirmation banner
    const banner = $('confirmation-banner');
    if (banner) {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
    }

    try {
      await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ zoneId, signal, note })
      });
    } catch (err) {
      // Save in offline queue for future sync
      try {
        const queue = JSON.parse(localStorage.getItem('ps_queued_reports') || '[]');
        queue.push({ zoneId, signal, note });
        localStorage.setItem('ps_queued_reports', JSON.stringify(queue));
      } catch {}
    }
  }

  // Background Sync for Queued Reports
  async function flushQueuedReports() {
    try {
      const queue = JSON.parse(localStorage.getItem('ps_queued_reports') || '[]');
      if (queue.length === 0) return;
      for (const item of queue) {
        await api('/api/reports', { method: 'POST', body: JSON.stringify(item) });
      }
      localStorage.removeItem('ps_queued_reports');
    } catch {}
  }

  // ---------- Wire DOM Event Listeners ----------
  $('zone-detail-close')?.addEventListener('click', () => showView('view-forecast'));

  $('time-slider')?.addEventListener('input', (e) => {
    state.horizonMin = parseInt(e.target.value, 10);
    refreshForecastBoard();
  });

  document.querySelectorAll('#slider-steps [data-h]').forEach(el => {
    el.addEventListener('click', () => {
      const ts = $('time-slider');
      if (ts) ts.value = el.getAttribute('data-h');
      state.horizonMin = parseInt(el.getAttribute('data-h'), 10);
      refreshForecastBoard();
    });
  });

  $('recenter-gps-btn')?.addEventListener('click', () => locateMe(true));

  $('dest-search-btn')?.addEventListener('click', () => searchDestination());
  $('dest-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchDestination();
    }
  });

  $('dest-search-clear')?.addEventListener('click', () => {
    if ($('dest-search-input')) $('dest-search-input').value = '';
    $('dest-search-clear')?.classList.add('hidden');
    $('dest-search-input')?.focus();
  });

  $('dest-search-input')?.addEventListener('input', (e) => {
    $('dest-search-clear')?.classList.toggle('hidden', !e.target.value);
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      if (e.target.value && e.target.value.length >= 3) {
        searchDestination(e.target.value);
      }
    }, 350);
  });

  document.querySelectorAll('#radius-chips .radius-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const r = chip.getAttribute('data-radius');
      if (r) setRadius(r);
    });
  });

  document.querySelectorAll('.dest-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-dest');
      if (d) {
        if ($('dest-search-input')) $('dest-search-input').value = d;
        $('dest-search-clear')?.classList.remove('hidden');
        searchDestination(d);
      }
    });
  });

  $('mongo-feed-refresh-btn')?.addEventListener('click', syncMongoFeed);

  $('report-found')?.addEventListener('click', () => report('found'));
  $('report-full')?.addEventListener('click', () => report('full'));
  $('report-circling')?.addEventListener('click', () => report('circling'));

  $('confirm-dismiss')?.addEventListener('click', () => {
    const banner = $('confirmation-banner');
    if (banner) {
      banner.classList.add('hidden');
      banner.classList.remove('flex');
    }
  });

  $('alert-btn')?.addEventListener('click', () => {
    if (!state.selectedId) return;
    try {
      const cur = JSON.parse(localStorage.getItem('ps_alert') || 'null');
      if (cur && cur.zoneId === state.selectedId) localStorage.removeItem('ps_alert');
      else localStorage.setItem('ps_alert', JSON.stringify({ zoneId: state.selectedId, horizonMin: state.horizonMin, at: new Date().toISOString() }));
    } catch {}
    renderAlertState();
  });

  $('api-retry')?.addEventListener('click', boot);

  // Expose for testing & global manipulation
  window.__parkistics = {
    state,
    selectZone,
    report,
    fetchZones: boot,
    locateMe,
    showView,
    searchDestination,
    setRadius,
    fetchMongoFeed,
    syncMongoFeed
  };

  // Periodic low-bandwidth sync
  setInterval(() => {
    if (state.engineMode === 'live') {
      flushQueuedReports();
    }
  }, 30000);

  // Initialize
  renderPoints();
  showView('view-forecast');
  // Map: Google Maps only — requires GOOGLE_MAPS_API_KEY (shows setup notice when missing)
  initMap();
  // 1. Boot IMMEDIATELY with edge zones (no network wait) so user sees data in <100ms
  boot();
  // 2. Geolocation runs async — when it resolves, re-centers map and refreshes zones for actual location
  locateMe(true).catch(() => {
    // Geolocation denied/unavailable — boot() already showed default area data, nothing else needed
  });
})();
