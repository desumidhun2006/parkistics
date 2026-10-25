const express = require('express');

const router = express.Router();

// GET /api/geocode?q= — geocode any place name to coordinates via the Google Geocoding API.
// No fallback geocoders — Google is the single geocoding provider.
router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'q (query) parameter required' });

  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_BROWSER_KEY || '';
  if (!key) {
    return res.status(404).json({ error: 'google-geocoder-unconfigured', message: 'GOOGLE_MAPS_API_KEY is not set — see docs/GOOGLE_MAPS_KEY.md' });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
      if (data.status === 'ZERO_RESULTS') {
        return res.status(404).json({ error: 'not-found', q });
      }
    }
  } catch (err) {
    console.warn('[Geocode] Google Geocoding error:', err.message);
  }

  res.status(502).json({ error: 'geocoder-unavailable', q });
});

module.exports = router;
