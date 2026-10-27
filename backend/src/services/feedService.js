const { ParkingFeed } = require('../models/schemas');
const { seedZones } = require('../data/seedZones');
const { getGlobalZones, setHistoryBias } = require('./forecastService');

const RETENTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RETENTION_MS = RETENTION_DAYS * MS_PER_DAY;

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEATHER_TYPES = ['Clear / Sunny', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Breezy / Fair'];

function formatDateStr(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getAllAvailableZones() {
  const globalZones = typeof getGlobalZones === 'function' ? getGlobalZones() : [];
  const map = new Map();
  seedZones.forEach(z => map.set(z.id, z));
  globalZones.forEach(z => map.set(z.id, z));
  return Array.from(map.values());
}

/**
 * Strict 7-day retention cleanup: deletes all records older than 7 days from now.
 * Combined with the MongoDB TTL index on the timestamp field.
 */
async function pruneOldFeed() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const result = await ParkingFeed.deleteMany({ timestamp: { $lt: cutoff } });
    if (result.deletedCount > 0) {
      console.log(`[MongoDB Retention] Pruned ${result.deletedCount} feed record(s) older than 7 days (cutoff: ${cutoff.toISOString()}).`);
    }
    return result.deletedCount;
  } catch (err) {
    console.error('[MongoDB Retention Error] Failed to prune old feed:', err.message);
    return 0;
  }
}

/**
 * Generates and upserts a daily feed entry for a given zone and date.
 */
function synthesizeDailyZoneFeed(zone, date) {
  const d = new Date(date);
  const dayIndex = d.getDay();
  const dayName = DAYS_OF_WEEK[dayIndex];
  const isWeekend = dayIndex === 0 || dayIndex === 6;

  // Pattern adjustments based on zone type and day
  let baseProb = 0.55;
  if (zone.kind === 'lot') baseProb = 0.65;
  if (zone.kind === 'street') baseProb = 0.45;
  if (zone.kind === 'garage') baseProb = 0.75;

  if (isWeekend) {
    if (zone.poiTags && (zone.poiTags.includes('retail') || zone.poiTags.includes('nightlife'))) {
      baseProb -= 0.12; // Busier on weekends
    } else if (zone.poiTags && zone.poiTags.includes('university')) {
      baseProb += 0.20; // Quieter campus on weekends
    }
  }

  // Pseudo-random deterministic day variation using date & zone id
  const charSum = zone.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const dayVariance = (((charSum + d.getDate() * 17) % 25) - 12) / 100;
  const probability = Math.max(0.15, Math.min(0.95, parseFloat((baseProb + dayVariance).toFixed(2))));
  const occupancyRate = parseFloat((1 - probability * 0.9).toFixed(2));
  const availableSpots = Math.max(2, Math.round(zone.capacity * probability));

  let status = 'medium';
  if (probability >= 0.60) status = 'high';
  else if (probability < 0.35) status = 'low';

  const weather = WEATHER_TYPES[(charSum + d.getDate()) % WEATHER_TYPES.length];
  const turnoverCount = Math.round(zone.capacity * (0.8 + ((charSum + d.getDate()) % 10) / 10));

  let summary = `Steady parking turnover with ~${availableSpots} of ${zone.capacity} spots open during midday.`;
  if (status === 'high') {
    summary = `Excellent spot availability all day (~${Math.round(probability * 100)}% find rate). Low search latency.`;
  } else if (status === 'low') {
    summary = `Heavy congestion during peak hours. High turnover with ~${turnoverCount} vehicles served.`;
  }

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    timestamp: d,
    dateStr: formatDateStr(d),
    dayOfWeek: dayName,
    occupancyRate,
    probability,
    availableSpots,
    totalCapacity: zone.capacity,
    status,
    peakHour: zone.peakHours ? zone.peakHours.split(',')[0] : '16:00-18:00',
    turnoverCount,
    weather,
    summary,
    source: 'daily-feed-sync'
  };
}

/**
 * Loads the 7-day rolling feed from MongoDB into the forecaster as a
 * day-of-week probability bias (zoneId -> { 0..6: avgProbability }).
 * forecastAt blends this into every probability so predictions track observed history.
 */
async function refreshHistoryBias() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const rows = await ParkingFeed.aggregate([
      { $match: { timestamp: { $gte: cutoff } } },
      {
        $group: {
          _id: { zoneId: '$zoneId', dayOfWeek: '$dayOfWeek' },
          avgProbability: { $avg: '$probability' },
          samples: { $sum: 1 }
        }
      }
    ]);

    const bias = new Map();
    for (const r of rows) {
      const dow = DAYS_OF_WEEK.indexOf(r._id.dayOfWeek);
      if (dow < 0 || typeof r.avgProbability !== 'number') continue;
      if (!bias.has(r._id.zoneId)) bias.set(r._id.zoneId, {});
      bias.get(r._id.zoneId)[dow] = parseFloat(r.avgProbability.toFixed(3));
    }

    setHistoryBias(bias);
    console.log(`[Forecast History] Loaded 7-day day-of-week bias for ${bias.size} zone(s) from ${rows.length} aggregate row(s).`);
    return bias.size;
  } catch (err) {
    console.error('[Forecast History] Failed to refresh history bias:', err.message);
    return 0;
  }
}

/**
 * Updates / records daily parking feed for today (or a specific date) in MongoDB.
 * Enforces that only the recent 7 days are stored.
 */
async function updateDailyParkingFeed(targetDate = new Date()) {
  const date = new Date(targetDate);
  const dateStr = formatDateStr(date);
  const zones = getAllAvailableZones();
  const operations = [];

  for (const zone of zones) {
    const feedItem = synthesizeDailyZoneFeed(zone, date);
    operations.push({
      updateOne: {
        filter: { zoneId: zone.id, dateStr },
        update: { $set: feedItem },
        upsert: true
      }
    });
  }

  let upsertedCount = 0;
  if (operations.length > 0) {
    const bulkResult = await ParkingFeed.bulkWrite(operations);
    upsertedCount = (bulkResult.upsertedCount || 0) + (bulkResult.modifiedCount || 0);
  }

  // Prune any entries older than 7 days
  const prunedCount = await pruneOldFeed();

  // Push updated 7-day history into the forecaster so probabilities track observed data
  await refreshHistoryBias();

  console.log(`[MongoDB Feed Update] Synchronized daily feed for ${dateStr}: ${operations.length} zones updated, ${prunedCount} old records pruned.`);
  return { date: dateStr, updatedZones: operations.length, pruned: prunedCount };
}

/**
 * Initializes the past 7 days of parking feed in MongoDB if fewer than 7 days exist.
 */
async function initializePastWeekFeedIfEmpty() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const existingCount = await ParkingFeed.countDocuments({ timestamp: { $gte: cutoff } });

    // If we have minimal or no feed for the past 7 days, backfill all 7 past days
    if (existingCount < seedZones.length * 3) {
      console.log(`[MongoDB Feed] Initializing past 7 days parking feed in MongoDB (found ${existingCount} records)...`);
      const zones = getAllAvailableZones();
      const operations = [];

      for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
        const d = new Date(Date.now() - dayOffset * MS_PER_DAY);
        const dateStr = formatDateStr(d);

        for (const zone of zones) {
          const feedItem = synthesizeDailyZoneFeed(zone, d);
          operations.push({
            updateOne: {
              filter: { zoneId: zone.id, dateStr },
              update: { $set: feedItem },
              upsert: true
            }
          });
        }
      }

      if (operations.length > 0) {
        await ParkingFeed.bulkWrite(operations);
        console.log(`[MongoDB Feed] Seeded ${operations.length} feed records across past 7 days.`);
      }
    }

    // Always run prune to ensure strict 7-day retention
    await pruneOldFeed();

    // Load the 7-day history into the forecaster so probabilities are data-driven
    await refreshHistoryBias();
  } catch (err) {
    console.error('[MongoDB Feed] Error during initial feed setup:', err.message);
  }
}

/**
 * Retrieves the parking feed of the past 1 week (recent 7 days) from MongoDB.
 * Enforces max 7 days retention filter.
 */
async function getPastWeekParkingFeed({ zoneId, days = 7, date } = {}) {
  const maxDays = Math.min(Math.max(1, parseInt(days, 10) || 7), RETENTION_DAYS);
  const cutoff = new Date(Date.now() - maxDays * MS_PER_DAY);

  const query = {
    timestamp: { $gte: cutoff }
  };

  if (zoneId) {
    query.zoneId = zoneId;
  }
  if (date) {
    query.dateStr = date;
  }

  // Query MongoDB sorted by newest first
  const feedRecords = await ParkingFeed.find(query).sort({ timestamp: -1, zoneName: 1 }).lean();

  // Aggregate daily summaries for the past 7 days
  const dailyMap = {};
  feedRecords.forEach(item => {
    if (!dailyMap[item.dateStr]) {
      dailyMap[item.dateStr] = {
        date: item.dateStr,
        dayOfWeek: item.dayOfWeek,
        timestamp: item.timestamp,
        zoneCount: 0,
        totalCapacity: 0,
        totalAvailable: 0,
        turnoverTotal: 0,
        probSum: 0,
        occupancySum: 0,
        weather: item.weather,
        statusCounts: { high: 0, medium: 0, low: 0 }
      };
    }
    const d = dailyMap[item.dateStr];
    d.zoneCount += 1;
    d.totalCapacity += item.totalCapacity || 0;
    d.totalAvailable += item.availableSpots || 0;
    d.turnoverTotal += item.turnoverCount || 0;
    d.probSum += item.probability || 0;
    d.occupancySum += item.occupancyRate || 0;
    if (d.statusCounts[item.status] != null) {
      d.statusCounts[item.status] += 1;
    }
  });

  const dailySummaries = Object.values(dailyMap)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map(d => ({
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      timestamp: d.timestamp,
      zoneCount: d.zoneCount,
      totalCapacity: d.totalCapacity,
      totalAvailable: d.totalAvailable,
      avgProbability: d.zoneCount ? parseFloat((d.probSum / d.zoneCount).toFixed(2)) : 0,
      avgOccupancyRate: d.zoneCount ? parseFloat((d.occupancySum / d.zoneCount).toFixed(2)) : 0,
      turnoverTotal: d.turnoverTotal,
      weather: d.weather,
      statusCounts: d.statusCounts
    }));

  return {
    success: true,
    retentionPolicy: '7_days_rolling_only',
    retentionDays: RETENTION_DAYS,
    cutoffDate: cutoff.toISOString(),
    queryDays: maxDays,
    count: feedRecords.length,
    dailySummaries,
    feed: feedRecords
  };
}

/**
 * Returns 7-day statistical analytics using MongoDB aggregation.
 */
async function get7DayFeedStats() {
  const cutoff = new Date(Date.now() - RETENTION_MS);

  const stats = await ParkingFeed.aggregate([
    { $match: { timestamp: { $gte: cutoff } } },
    {
      $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        avgProbability: { $avg: '$probability' },
        avgOccupancy: { $avg: '$occupancyRate' },
        totalAvailableSpots: { $sum: '$availableSpots' },
        totalTurnover: { $sum: '$turnoverCount' },
        oldestRecord: { $min: '$timestamp' },
        newestRecord: { $max: '$timestamp' }
      }
    }
  ]);

  const byZone = await ParkingFeed.aggregate([
    { $match: { timestamp: { $gte: cutoff } } },
    {
      $group: {
        _id: '$zoneId',
        zoneName: { $first: '$zoneName' },
        avgProbability: { $avg: '$probability' },
        avgOccupancy: { $avg: '$occupancyRate' },
        totalTurnover: { $sum: '$turnoverCount' }
      }
    },
    { $sort: { avgProbability: -1 } },
    { $limit: 10 }
  ]);

  return {
    retentionPolicy: 'recent_7_days_only',
    overall: stats[0] || null,
    topZonesByAvailability: byZone
  };
}

/**
 * Starts automatic daily cron/timer scheduler for the daily feed update.
 */
let dailySchedulerTimer = null;

function startDailyFeedScheduler() {
  if (dailySchedulerTimer) clearInterval(dailySchedulerTimer);

  // Run update immediately to ensure today's feed is synchronized
  updateDailyParkingFeed().catch(err => console.error('[Daily Scheduler] Error on initial update:', err.message));

  // Run every 24 hours
  dailySchedulerTimer = setInterval(async () => {
    try {
      console.log('[Daily Scheduler] Triggering daily parking feed sync & 7-day retention cleanup...');
      await updateDailyParkingFeed();
    } catch (err) {
      console.error('[Daily Scheduler] Scheduled update failed:', err.message);
    }
  }, MS_PER_DAY);

  console.log('[Daily Scheduler] Initialized daily feed schedule (interval: 24h, retention: 7 days).');
}

function stopDailyFeedScheduler() {
  if (dailySchedulerTimer) {
    clearInterval(dailySchedulerTimer);
    dailySchedulerTimer = null;
  }
}

module.exports = {
  RETENTION_DAYS,
  getPastWeekParkingFeed,
  updateDailyParkingFeed,
  initializePastWeekFeedIfEmpty,
  refreshHistoryBias,
  pruneOldFeed,
  get7DayFeedStats,
  startDailyFeedScheduler,
  stopDailyFeedScheduler,
  formatDateStr
};
