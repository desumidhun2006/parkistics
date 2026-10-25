// Global Parking Discovery Service for Parkistics
// Discovers REAL parking facilities anywhere on Earth via the Google Places API (New).
// No fallback data providers — Google Places is the single real parking dataset.
// Berkeley pilot area keeps its canonical curated seed zones.
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

async function findGlobalParking(lat, lng, radiusKm = 1.0, destName = 'Destination') {
  // Check in-memory cache first for instant sub-millisecond return
  const cacheKey = `g1:${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm.toFixed(1)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // 1. Berkeley pilot area → canonical curated seed zones
  if (isNearBerkeley(lat, lng)) {
    const { seedZones } = require('../data/seedZones');
    setCache(cacheKey, seedZones);
    return seedZones;
  }

  // 2. Google Places API (New) — the real live parking dataset (no fallback providers)
  //    Returns [] when Google answers with no nearby parking or when no key is configured.
  const googleZones = await findGoogleParking(lat, lng, radiusKm, destName);
  const combined = (googleZones || []).slice(0, 20);
  setCache(cacheKey, combined);
  return combined;
}

module.exports = {
  haversineKm,
  isWithinRadius,
  destinationPoint,
  isNearBerkeley,
  findGlobalParking,
  googleKeyConfigured
};
