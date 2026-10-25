const express = require('express');
const { googleKeyConfigured } = require('../services/googleParkingService');

const router = express.Router();

// GET /api/config — safe browser config for the frontend (Maps JS key, provider flags).
// The key is intended for HTTP-referrer-restricted browser use (Places JS + geocoding via backend).
router.get('/', (req, res) => {
  const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    gmapsKey: browserKey || null,
    parkingDataset: googleKeyConfigured() ? 'google-places' : 'unconfigured',
    at: new Date().toISOString()
  });
});

module.exports = router;
