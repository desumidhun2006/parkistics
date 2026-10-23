// Google Places API (New) — REAL parking dataset worldwide.
// Queries Google's live Places database for actual parking facilities (garages, lots,
// street parking) near any coordinates on Earth, with rating/price/parking-options metadata.
// Requires GOOGLE_MAPS_API_KEY (or GOOGLE_MAPS_BROWSER_KEY) env var with "Places API (New)" enabled.
// Returns null when unavailable/unconfigured so callers fall back to OpenStreetMap Nominatim.

const PRICE_PER_HOUR = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1.5,
  PRICE_LEVEL_MODERATE: 2.5,
  PRICE_LEVEL_EXPENSIVE: 4.0,
  PRICE_LEVEL_VERY_EXPENSIVE: 6.0
};

function getGoogleKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_BROWSER_KEY || '';
}

function googleKeyConfigured() {
  return getGoogleKey().length > 0;
}

function inferKind(place) {
  const opts = place.parkingOptions || {};
  const name = (place.displayName && place.displayName.text) || '';
  const addr = place.formattedAddress || '';
  if (opts.valetParking || /garage|structure|deck|multi-?level|underground|parking (?:ramp|house)/i.test(`${name} ${addr}`)) {
    return 'garage';
  }
  if (opts.freeStreetParking || opts.paidStreetParking) return 'street';
  return 'lot';
}

function estimateCapacity(kind, rating, ratingsCount) {
  let base = kind === 'garage' ? 280 : kind === 'lot' ? 150 : 40;
  if (typeof rating === 'number' && ratingsCount > 150 && rating >= 4.2) base = Math.round(base * 1.25);
  return base;
}

function pricePerHourFor(place, kind) {
  const opts = place.parkingOptions || {};
  if (opts.freeStreetParking || opts.freeParkingLot) return 0;
  if (PRICE_PER_HOUR[place.priceLevel] != null) return PRICE_PER_HOUR[place.priceLevel];
  return kind === 'garage' ? 3.5 : kind === 'lot' ? 2.5 : 2.0;
}

function poiTagsFor(kind, place) {
  if (kind === 'garage') return ['transit', 'commercial'];
  if (kind === 'street') return ['retail', 'dining'];
  const opts = place.parkingOptions || {};
  return opts.freeParkingLot ? ['park', 'outdoor'] : ['shopping'];
}

function formatGoogleZone(place, destName) {
  const kind = inferKind(place);
  const name = (place.displayName && place.displayName.text) || 'Parking';
  return {
    id: `gp-${place.id}`,
    name,
    kind,
    center: {
      lat: Math.round(place.location.latitude * 100000) / 100000,
      lng: Math.round(place.location.longitude * 100000) / 100000
    },
    capacity: estimateCapacity(kind, place.rating, place.userRatingCount || 0),
    pricePerHour: pricePerHourFor(place, kind),
    walkTo: destName || 'Destination',
    peakHours: kind === 'street' ? 'Metered hours vary by block' : 'Busy near peak commute & lunch',
    poiTags: poiTagsFor(kind, place),
    rating: place.rating || null,
    ratingsCount: place.userRatingCount || 0,
    placeId: place.id,
    source: 'google'
  };
}

// Nearby Search (New): POST /v1/places:searchNearby with circle restriction + parking type.
async function findGoogleParking(lat, lng, radiusKm = 1.0, destName = 'Destination') {
  const key = getGoogleKey();
  if (!key) return null;

  const radiusMeters = Math.min(10000, Math.max(300, Math.round((radiusKm || 1.0) * 1000 * 1.15)));

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.location',
          'places.rating',
          'places.userRatingCount',
          'places.priceLevel',
          'places.businessStatus',
          'places.parkingOptions',
          'places.formattedAddress',
          'places.types'
        ].join(',')
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters
          }
        },
        includedPrimaryTypes: ['parking'],
        maxResultCount: 20
      }),
      signal: AbortSignal.timeout(4000)
    });

    if (!res.ok) return null; // key quota/billing/permission issue → caller falls back to OSM

    const data = await res.json();
    const places = Array.isArray(data.places) ? data.places : [];
    const zones = places
      .filter(p => p && p.location && p.businessStatus !== 'CLOSED_PERMANENTLY')
      .map(p => formatGoogleZone(p, destName));
    return zones; // [] means Google responded but found no parking — authoritative empty
  } catch {
    return null; // timeout / offline → caller falls back to OSM
  }
}

module.exports = {
  findGoogleParking,
  googleKeyConfigured,
  getGoogleKey
};
