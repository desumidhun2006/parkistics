// v0 transparent forecaster — rule-based prior blended with observed 7-day MongoDB
// feed history (day-of-week averages). Encodes patterns like "mall full weekdays 17-19"
// + traffic-congestion proxy + real rolling-window history. Returns probability + confidence.
const { seedZones } = require('../data/seedZones');

// In-memory crowd adjustments: zoneId -> score (-1..1). Positive = more availability reported.
const crowdAdjust = new Map();

// 7-day rolling feed history bias: zoneId -> { 0..6: avgProbability } (0=Sunday).
// Fed by feedService via setHistoryBias after every daily sync/init. Null = rules only.
let historyBias = null;

function setHistoryBias(bias) {
  historyBias = bias && bias.size ? bias : null;
}

function historyProbabilityFor(zone, date) {
  if (!historyBias) return null;
  const zoneBias = historyBias.get(zone.id);
  if (!zoneBias) return null;
  const dowAvg = zoneBias[date.getDay()];
  return typeof dowAvg === 'number' ? dowAvg : null;
}

function addCrowdSignal(zoneId, signal) {
  const delta = signal === 'found' ? 0.12 : signal === 'full' ? -0.15 : signal === 'circling' ? -0.08 : 0;
  crowdAdjust.set(zoneId, (crowdAdjust.get(zoneId) || 0) * 0.8 + delta);
}

function clamp01(x) { return Math.max(0.02, Math.min(0.97, x)); }

function baseProbability(zone, date) {
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
      } else if (tags.includes('theatre') || tags.includes('stadium') || tags.includes('events')) {
        if ((day === 5 || day === 6) && h >= 17 && h <= 23) p = 0.15;
        else if (h >= 23 || h < 10) p = 0.88;
        else p = 0.60;
      } else if (tags.includes('dining') || tags.includes('culinary') || tags.includes('nightlife')) {
        if (h >= 18 && h <= 21) p = 0.25;
        else if (h >= 12 && h <= 14) p = 0.38;
        else if (h >= 22 || h < 11) p = 0.80;
        else p = 0.58;
      } else if (tags.includes('shopping') || tags.includes('retail')) {
        if (!isWeekday && h >= 11 && h <= 17) p = 0.22;
        else if (isWeekday && h >= 12 && h <= 18) p = 0.45;
        else p = 0.78;
      } else if (tags.includes('campus') || tags.includes('university') || tags.includes('student-union')) {
        if (isWeekday && h >= 9 && h <= 16) p = 0.24;
        else if (h >= 18 || h < 8) p = 0.82;
        else p = 0.52;
      } else if (tags.includes('park') || tags.includes('waterfront') || tags.includes('outdoor')) {
        if (!isWeekday && h >= 12 && h <= 17) p = 0.35;
        else p = 0.85;
      } else if (tags.includes('civic')) {
        if (isWeekday && h >= 10 && h <= 15) p = 0.30;
        else p = 0.75;
      } else {
        p = 0.60;
      }
      if (zone.kind === 'garage') p += 0.08;
    }
  }
  // Traffic proxy: congestion 8-9, 17-19 reduces availability.
  const rush = (h >= 8 && h < 9.5) || (h >= 17 && h < 19) ? 0.12 : 0;
  p -= rush * (zone.poiTags.includes('transit') || zone.poiTags.includes('mall') ? 1.2 : 0.6);
  return p;
}

function confidenceFor(zone, date, horizonMin) {
  // More confidence near peak patterns + short horizons; less for far horizons.
  let c = 0.82 - horizonMin / 240; // 15m→0.76, 60m→0.57 baseline adjusted below
  c = 0.55 + (0.85 - 0.55) * Math.min(1, Math.abs(0.5 - baseProbability(zone, date)) * 2);
  if (horizonMin > 30) c -= 0.1;
  const reports = Math.abs(crowdAdjust.get(zone.id) || 0);
  c = Math.min(0.92, c + reports);
  // Observed history for this zone+weekday raises confidence.
  if (historyProbabilityFor(zone, date) !== null) c = Math.min(0.95, c + 0.08);
  return clamp01(c);
}

function forecastAt(zone, date) {
  const base = baseProbability(zone, date);
  const hist = historyProbabilityFor(zone, date);
  const adj = crowdAdjust.get(zone.id) || 0;
  // Blend: when 7-day feed history exists for this zone+day-of-week, it carries
  // 60% weight over the rule-based prior — probabilities track the rolling window.
  const prior = hist !== null ? clamp01(base * 0.4 + hist * 0.6) : base;
  const probability = clamp01(prior + adj);
  return {
    probability: Math.round(probability * 100) / 100,
    base: Math.round(base * 100) / 100,
    crowdAdj: Math.round(adj * 100) / 100,
    historyAdj: hist !== null ? Math.round((prior - base) * 100) / 100 : 0
  };
}

const globalZonesCache = new Map();

function registerGlobalZones(zones) {
  if (!Array.isArray(zones)) return;
  zones.forEach(z => {
    if (z && z.id) globalZonesCache.set(z.id, z);
  });
}

function getGlobalZone(zoneId) {
  return globalZonesCache.get(zoneId) || null;
}

function fallbackZone(zoneId) {
  return {
    id: zoneId,
    name: 'Parking Facility',
    kind: 'garage',
    capacity: 200,
    pricePerHour: 3.5,
    poiTags: ['transit', 'commercial'],
    center: { lat: 37.8715, lng: -122.273 }
  };
}

function forecastSeries(zoneId, arrivalISO) {
  const zone = seedZones.find(z => z.id === zoneId) || getGlobalZone(zoneId) || fallbackZone(zoneId);
  const arrival = arrivalISO ? new Date(arrivalISO) : new Date();
  const horizons = [0, 15, 30, 60, 120, 180];
  const series = horizons.map(h => {
    const t = new Date(arrival.getTime() + h * 60000);
    const f = forecastAt(zone, t);
    return { horizonMin: h, time: t.toISOString(), probability: f.probability, confidence: Math.round(confidenceFor(zone, t, h) * 100) / 100 };
  });
  return { zone, arrival: arrival.toISOString(), series };
}

function currentStatus(probability) {
  if (probability >= 0.6) return 'high';
  if (probability >= 0.35) return 'medium';
  return 'low';
}

module.exports = {
  forecastAt,
  forecastSeries,
  currentStatus,
  confidenceFor,
  addCrowdSignal,
  setHistoryBias,
  seedZones,
  registerGlobalZones,
  getGlobalZone
};
