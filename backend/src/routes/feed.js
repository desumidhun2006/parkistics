const express = require('express');
const router = express.Router();
const {
  getPastWeekParkingFeed,
  updateDailyParkingFeed,
  get7DayFeedStats,
  pruneOldFeed,
  RETENTION_DAYS
} = require('../services/feedService');
const { ParkingFeed } = require('../models/schemas');
const { isDBConnected } = require('../db');

// Graceful empty response when no database is attached (e.g. serverless without MONGO_URI)
function emptyFeed(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=15');
  res.json({
    success: true,
    count: 0,
    daysRequested: 7,
    dailySummaries: [],
    feed: [],
    source: 'no-database'
  });
}

/**
 * GET /api/feed
 * Retrieves the parking feed of the past 1 week (recent 7 days) from MongoDB.
 * Optional Query params:
 *   - days: number of days (1-7, default 7, capped at 7)
 *   - zoneId: filter by specific parking zone ID
 *   - date: filter by date string 'YYYY-MM-DD'
 */
router.get('/', async (req, res) => {
  if (!isDBConnected()) return emptyFeed(req, res);
  try {
    const { zoneId, days, date } = req.query;
    const result = await getPastWeekParkingFeed({ zoneId, days, date });
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json(result);
  } catch (err) {
    console.error('[API /api/feed] Error querying MongoDB feed:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve parking feed from MongoDB',
      message: err.message
    });
  }
});

/**
 * GET /api/feed/stats
 * Aggregated 7-day statistical trends from MongoDB.
 */
router.get('/stats', async (req, res) => {
  if (!isDBConnected()) return res.json({ success: true, source: 'no-database', topZonesByAvailability: [], totalTurnover: 0, avgOccupancyRate: 0 });
  try {
    const stats = await get7DayFeedStats();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=180');
    res.json({ success: true, ...stats });
  } catch (err) {
    console.error('[API /api/feed/stats] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/feed/retention
 * Audits the 7-day retention policy to verify that ONLY the recent 7 days are stored.
 */
router.get('/retention', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const totalCount = await ParkingFeed.countDocuments();
    const validRecentCount = await ParkingFeed.countDocuments({ timestamp: { $gte: cutoff } });
    const expiredCount = await ParkingFeed.countDocuments({ timestamp: { $lt: cutoff } });

    const oldest = await ParkingFeed.findOne().sort({ timestamp: 1 }).select('timestamp dateStr zoneName').lean();
    const newest = await ParkingFeed.findOne().sort({ timestamp: -1 }).select('timestamp dateStr zoneName').lean();

    res.json({
      policy: 'Strict 7-Day Rolling Retention Only',
      retentionDays: RETENTION_DAYS,
      cutoffTimestamp: cutoff.toISOString(),
      totalRecordsInMongoDB: totalCount,
      validRecent7DaysRecords: validRecentCount,
      expiredRecordsAwaitingPrune: expiredCount,
      isRetentionStrictlyCompliant: expiredCount === 0,
      oldestRecordDate: oldest ? oldest.dateStr : null,
      oldestRecordTimestamp: oldest ? oldest.timestamp : null,
      newestRecordDate: newest ? newest.dateStr : null,
      newestRecordTimestamp: newest ? newest.timestamp : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/feed/sync
 * Triggers a daily feed update and runs the 7-day retention prune immediately.
 */
router.post('/sync', async (req, res) => {
  if (!isDBConnected()) return res.json({ success: true, message: 'No database attached — sync skipped', updatedZones: 0, prunedRecords: 0 });
  try {
    const targetDate = req.body && req.body.date ? new Date(req.body.date) : new Date();
    const updateResult = await updateDailyParkingFeed(targetDate);
    res.json({
      success: true,
      message: 'Daily parking feed updated and 7-day retention pruned successfully',
      ...updateResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/feed/zones/:zoneId
 * Retrieves past 1 week feed for a specific zone.
 */
router.get('/zones/:zoneId', async (req, res) => {
  if (!isDBConnected()) return emptyFeed(req, res);
  try {
    const { zoneId } = req.params;
    const result = await getPastWeekParkingFeed({ zoneId, days: 7 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
