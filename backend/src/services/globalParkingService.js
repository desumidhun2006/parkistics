// Global Parking Discovery Service for Parkistics
// Discovers REAL parking facilities anywhere on Earth:
//   1. Google Places API (New) — primary live parking dataset (real garages/lots/street parking with ratings & prices)
//   2. OpenStreetMap Nominatim — free global fallback dataset
//   3. Intelligent contextual spatial parking synthesis — offline last resort
// Heavily optimized for Time (spatial bounding-box pruning + LRU cache), Space (lean representation), and Internet (fast failover & cached queries).
const { findGoogleParking, googleKeyConfigured } = require('./googleParkingService');

// In-memory LRU query cache (max 100 entries, 10 min TTL)
const queryCache = new Map();
const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCached(key) {
  const item = queryCache.get(key);
  if (!item) return null;
  if (Date.now() - item.cachedAt > CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  if (queryCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = queryCache.keys().next().value;
    queryCache.delete(oldestKey);
  }
  queryCache.set(key, { data, cachedAt: Date.now() });
}

// Optimized Haversine with fast bounding-box early exit
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1000) / 1000; // 3 decimal places (~1 meter)
}

// Fast bounding-box check before expensive trigonometric haversine
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

const BERKELEY_CENTER = { lat: 37.8715, lng: -122.273 };
function isNearBerkeley(lat, lng) {
  return isWithinRadius(lat, lng, BERKELEY_CENTER.lat, BERKELEY_CENTER.lng, 18);
}

function formatOsmZone(item, destName) {
  let rawName = item.name;
  if (!rawName || rawName.trim().length === 0) {
    const parts = (item.display_name || '').split(',');
    const street = parts[0] || 'Local';
    rawName = `${street.trim()} Parking`;
  }
  const cleanName = rawName.replace(/parking/i, '').trim();
  const name = cleanName ? `${cleanName} Parking` : 'Public Parking';

  const isGarage = /garage|multi-level|covered|underground|deck/i.test(item.display_name || '') || /garage|deck/i.test(name);
  const isStreet = /street|avenue|road|boulevard|drive|way|row/i.test(name) && !isGarage;
  const kind = isGarage ? 'garage' : isStreet ? 'street' : 'lot';
  const capacity = kind === 'garage' ? 260 : kind === 'lot' ? 140 : 45;
  const pricePerHour = kind === 'garage' ? 3.5 : kind === 'lot' ? 2.5 : 2.0;

  return {
    id: `osm-${item.place_id || item.osm_id}`,
    name,
    kind,
    center: {
      lat: Math.round(parseFloat(item.lat) * 100000) / 100000,
      lng: Math.round(parseFloat(item.lon) * 100000) / 100000
    },
    capacity,
    pricePerHour,
    walkTo: destName || 'Destination',
    poiTags: isGarage ? ['transit', 'commercial'] : isStreet ? ['retail', 'dining'] : ['shopping'],
    source: 'osm'
  };
}

function generateContextualParking(lat, lng, radiusKm, destName, existingCount = 0) {
  const cleanDest = (destName || 'Destination').split(',')[0].trim();
  const archetypes = [
    { title: 'Central Public Garage', kind: 'garage', cap: 340, price: 4.0, bearing: 25, distPct: 0.15, tags: ['transit', 'shopping'] },
    { title: 'Plaza Surface Lot', kind: 'lot', cap: 180, price: 2.5, bearing: 115, distPct: 0.30, tags: ['commercial', 'dining'] },
    { title: 'Station Deck', kind: 'garage', cap: 290, price: 3.5, bearing: 205, distPct: 0.45, tags: ['transit'] },
    { title: 'Commercial Strip Metered Row', kind: 'street', cap: 50, price: 2.0, bearing: 300, distPct: 0.25, tags: ['retail', 'dining'] },
    { title: 'Market Square Lot', kind: 'lot', cap: 150, price: 2.5, bearing: 70, distPct: 0.60, tags: ['shopping'] },
    { title: 'East District Garage', kind: 'garage', cap: 260, price: 3.0, bearing: 160, distPct: 0.75, tags: ['commercial'] },
    { title: 'Northside Metered Row', kind: 'street', cap: 42, price: 1.5, bearing: 345, distPct: 0.50, tags: ['residential'] },
    { title: 'West Hub Parking Lot', kind: 'lot', cap: 190, price: 2.5, bearing: 255, distPct: 0.85, tags: ['transit', 'civic'] }
  ];

  const needed = Math.max(0, 8 - existingCount);
  const items = [];
  for (let i = 0; i < needed; i++) {
    const arch = archetypes[i % archetypes.length];
    const distKm = Math.max(0.06, radiusKm * arch.distPct);
    const coords = destinationPoint(lat, lng, distKm, arch.bearing);
    items.push({
      id: `gz-${Math.round(lat * 1000)}-${Math.round(lng * 1000)}-${i + 1}`,
      name: `${cleanDest} ${arch.title}`,
      kind: arch.kind,
      center: coords,
      capacity: arch.cap,
      pricePerHour: arch.price,
      walkTo: cleanDest,
      poiTags: arch.tags,
      source: 'synthesized'
    });
  }
  return items;
}

// OpenStreetMap Nominatim — free real-world parking dataset (fallback / gap filler)
async function findOsmParking(lat, lng, radiusKm, destName) {
  const osmZones = [];
  try {
    const rad = Math.max(0.5, Math.min(10.0, radiusKm || 1.0));
    const latDelta = rad / 111.0;
    const lngDelta = rad / (111.0 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
    const minLat = lat - latDelta;
    const maxLat = lat + latDelta;
    const minLng = lng - lngDelta;
    const maxLng = lng + lngDelta;

    const url = `https://nominatim.openstreetmap.org/search?amenity=parking&format=json&limit=20&viewbox=${minLng.toFixed(4)},${maxLat.toFixed(4)},${maxLng.toFixed(4)},${minLat.toFixed(4)}&bounded=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ParkisticsApp/1.0 (https://github.com/desumidhun2006/parkistics)' },
      signal: AbortSignal.timeout(2500) // Fast 2.5s network timeout
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach(item => {
          const itemLat = parseFloat(item.lat);
          const itemLng = parseFloat(item.lon);
          if (!isNaN(itemLat) && !isNaN(itemLng)) {
            if (isWithinRadius(lat, lng, itemLat, itemLng, rad * 1.2)) {
              osmZones.push(formatOsmZone(item, destName));
            }
          }
        });
      }
    }
  } catch (err) {
    // Network timeout or offline — caller falls back to contextual synthesis
  }
  return osmZones;
}

async function findGlobalParking(lat, lng, radiusKm = 1.0, destName = 'Destination') {
  // Check in-memory cache first for instant sub-millisecond return
  const cacheKey = `v2:${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm.toFixed(1)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // 1. If near Berkeley pilot area, keep canonical curated seed zones
  if (isNearBerkeley(lat, lng)) {
    const { seedZones } = require('../data/seedZones');
    setCache(cacheKey, seedZones);
    return seedZones;
  }

  // 2. Google Places API (New) — REAL live parking dataset (garages, lots, street parking)
  //    Returns [] when Google answered but found nothing; null when unavailable (no key / quota / offline)
  const googleZones = await findGoogleParking(lat, lng, radiusKm, destName);

  // 3. OpenStreetMap Nominatim — free global dataset (fills gaps / works without a Google key)
  let osmZones = [];
  if (!googleZones || googleZones.length === 0) {
    osmZones = await findOsmParking(lat, lng, radiusKm, destName);
  }

  // 4. Real dataset wins; contextual synthesis only as offline last resort
  const realZones = googleZones && googleZones.length > 0 ? googleZones : osmZones;
  const combined = realZones.length > 0
    ? realZones.slice(0, 20)
    : generateContextualParking(lat, lng, radiusKm, destName, 0);
  setCache(cacheKey, combined);
  return combined;
}

module.exports = {
  haversineKm,
  isWithinRadius,
  destinationPoint,
  isNearBerkeley,
  findGlobalParking,
  findOsmParking,
  googleKeyConfigured
};
