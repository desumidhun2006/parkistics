const express = require('express');

const router = express.Router();

// GET /api/geocode?q= — geocode any place name to coordinates.
// Primary: Google Geocoding API (when key configured). Fallback: OpenStreetMap Nominatim.
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'q (query) parameter required' });

  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_BROWSER_KEY || '';

  // 1. Google Geocoding API — real global geocoder, works for any address/place worldwide
  if (key) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const data = await r.json();
        if (data.status === 'OK' && data.results && data.results[0]) {
          const top = data.results[0];
          const g = top.geometry.location;
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.json({
            name: top.formatted_address.split(',').slice(0, 2).join(','),
            lat: g.lat,
            lng: g.lng,
            formattedAddress: top.formatted_address,
            source: 'google'
          });
        }
      }
    } catch {
      // timeout / quota — fall through to Nominatim
    }
  }

  // 2. OpenStreetMap Nominatim fallback — free, works without any key
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'ParkisticsApp/1.0 (https://github.com/desumidhun2006/parkistics)' },
      signal: AbortSignal.timeout(3000)
    });
    if (r.ok) {
      const data = await r.json();
      if (data && data[0]) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.json({
          name: data[0].display_name.split(',').slice(0, 2).join(','),
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          formattedAddress: data[0].display_name,
          source: 'osm'
        });
      }
    }
  } catch {
    // offline
  }

  res.status(404).json({ error: 'location not found', q });
});

module.exports = router;
