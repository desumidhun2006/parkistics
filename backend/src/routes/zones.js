const express = require('express');
const { forecastAt, forecastSeries, currentStatus, confidenceFor, registerGlobalZones, seedZones } = require('../services/forecastService');
const { findGlobalParking, haversineKm } = require('../services/globalParkingService');
const { mlPredict } = require('../services/mlClient');

const router = express.Router();

// GET /api/zones?lat=&lng=&radius=&dest= — nearby zones anywhere on earth with current + predicted status
router.get('/', async (req, res) => {
  const now = new Date();
  const { lat, lng, radius, dest } = req.query;
  const targetLat = lat !== undefined && lat !== '' ? parseFloat(lat) : null;
  const targetLng = lng !== undefined && lng !== '' ? parseFloat(lng) : null;
  const searchRadius = radius !== undefined && radius !== '' ? parseFloat(radius) : 1.0; // default 1 km
  const destinationName = dest || 'Destination';

  let rawZones = seedZones;
  if (targetLat !== null && targetLng !== null && !isNaN(targetLat) && !isNaN(targetLng)) {
    rawZones = await findGlobalParking(targetLat, targetLng, searchRadius, destinationName);
    registerGlobalZones(rawZones);
  }

  let zones = rawZones.map(z => {
    const f = forecastAt(z, now);
    const confidence = confidenceFor(z, now, 15);
    const availableSpots = Math.max(0, Math.round(z.capacity * f.probability));
    const obj = {
      id: z.id, name: z.name, kind: z.kind, center: z.center,
      capacity: z.capacity, pricePerHour: z.pricePerHour, walkTo: z.walkTo,
      peakHours: z.peakHours, poiTags: z.poiTags,
      availableSpots,
      source: z.source || 'seed',
      current: { probability: f.probability, confidence: Math.round(confidence * 100) / 100, status: currentStatus(f.probability) }
    };
    if (targetLat !== null && targetLng !== null && !isNaN(targetLat) && !isNaN(targetLng)) {
      const d = haversineKm(targetLat, targetLng, z.center.lat, z.center.lng);
      obj.distanceKm = Math.round(d * 100) / 100;
      obj.distanceMeters = Math.round(d * 1000);
      obj.walkMinutes = Math.max(1, Math.round(d * 12));
    }
    return obj;
  });

  if (targetLat !== null && targetLng !== null && !isNaN(targetLat) && !isNaN(targetLng)) {
    zones = zones.filter(z => z.distanceKm <= searchRadius);
    zones.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  // Cache-Control header: optimize bandwidth and internet latency
  res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');

  res.json({
    count: zones.length,
    at: now.toISOString(),
    searchRadius: (targetLat !== null && targetLng !== null) ? searchRadius : null,
    target: (targetLat !== null && targetLng !== null) ? { lat: targetLat, lng: targetLng } : null,
    destination: destinationName,
    zones
  });
});

// GET /api/zones/:id/forecast?arrival=ISO — time-series for planned arrival
router.get('/:id/forecast', async (req, res) => {
  const { id } = req.params;
  const { arrival } = req.query;
  // Prefer ML microservice when available, else local forecaster.
  const ml = await mlPredict(id, arrival || new Date().toISOString());
  const local = forecastSeries(id, arrival);
  if (!local) return res.status(404).json({ error: 'unknown zone', id });
  
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  if (ml && ml.series) return res.json({ ...local, series: ml.series, source: 'ml-service' });
  res.json({ ...local, source: 'local-v0-forecaster' });
});

module.exports = router;
