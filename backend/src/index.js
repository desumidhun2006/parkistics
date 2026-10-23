require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { connectDB, isDBConnected, disconnectDB } = require('./db');
const { initializePastWeekFeedIfEmpty, startDailyFeedScheduler } = require('./services/feedService');

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

// Compression for massive internet & bandwidth optimization (gzip/deflate)
app.use(compression({
  threshold: 512, // Compress anything above 512 bytes
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Path to frontend directory
const frontendDir = path.resolve(__dirname, '../../frontend');

// Serve static frontend assets with intelligent caching headers for internet and speed optimization
app.use(express.static(frontendDir, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // Service Worker must always check for updates
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.match(/\.(html|json)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day for static assets
    }
  }
}));

app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'parkistics-backend',
  mongoConnected: isDBConnected(),
  at: new Date().toISOString()
}));

// API Routes
app.use('/api/zones', require('./routes/zones'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/route', require('./routes/route'));
app.use('/api/feed', require('./routes/feed'));
app.use('/api/config', require('./routes/config'));
app.use('/api/geocode', require('./routes/geocode'));

app.get('/api', (req, res) => res.json({
  service: 'Parkistics backend v0',
  mongoConnected: isDBConnected(),
  parkingDataset: (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_BROWSER_KEY) ? 'google-places' : 'openstreetmap',
  endpoints: [
    'GET /health',
    'GET /api/zones',
    'GET /api/zones/:id/forecast?arrival=',
    'POST /api/reports',
    'GET /api/route?destination=&time=',
    'GET /api/feed?days=7&zoneId=&date=',
    'GET /api/feed/stats',
    'GET /api/feed/retention',
    'POST /api/feed/sync',
    'GET /api/config',
    'GET /api/geocode?q='
  ]
}));

// Fallback to index.html for client-side routing and direct web access
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

async function startServer() {
  try {
    await connectDB();
    await initializePastWeekFeedIfEmpty();
    startDailyFeedScheduler();
  } catch (err) {
    console.error('[Startup] MongoDB setup warning:', err.message);
  }

  if (require.main === module) {
    app.listen(PORT, HOST, () => {
      console.log(`Parkistics unified server running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      console.log(`Accessible from local network at http://0.0.0.0:${PORT}`);
    });
  }
}

// Graceful cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('[Server] Gracefully shutting down...');
  await disconnectDB();
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

module.exports = app;

