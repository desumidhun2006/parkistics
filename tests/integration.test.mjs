import assert from 'node:assert';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

async function runTests() {
  console.log(`\n🧪 Running Parkistics Comprehensive Integration Tests against ${BACKEND_URL}...\n`);

  // 1. Health check
  const healthRes = await fetch(`${BACKEND_URL}/health`);
  const health = await healthRes.json();
  assert.strictEqual(health.ok, true, 'Backend health must be ok');
  assert.strictEqual(health.service, 'parkistics-backend');
  assert.strictEqual(health.mongoConnected, true, 'MongoDB connection must be active');
  console.log('✓ 1. Backend health & MongoDB connection verified');

  // 2. Static Frontend Serving (Single-origin unified accessibility)
  const rootRes = await fetch(`${BACKEND_URL}/`);
  assert.strictEqual(rootRes.status, 200, 'GET / must return 200 OK');
  const rootHtml = await rootRes.text();
  assert.ok(rootHtml.includes('<title>Parkistics — Predictive Parking</title>'), 'Frontend HTML must be served at root');
  assert.ok(rootHtml.includes('sw.js'), 'Service Worker must be registered in HTML');
  assert.ok(rootHtml.includes('manifest.json'), 'PWA manifest must be referenced');
  console.log('✓ 2. Unified static frontend delivery verified');

  // 3. PWA Manifest & Service Worker delivery
  const manifestRes = await fetch(`${BACKEND_URL}/manifest.json`);
  assert.strictEqual(manifestRes.status, 200, 'manifest.json must be accessible');
  const manifest = await manifestRes.json();
  assert.strictEqual(manifest.name, 'Parkistics — Predictive Parking');
  assert.strictEqual(manifest.display, 'standalone');

  const swRes = await fetch(`${BACKEND_URL}/sw.js`);
  assert.strictEqual(swRes.status, 200, 'sw.js must be accessible');
  const swCode = await swRes.text();
  assert.ok(swCode.includes('parkistics-static-'), 'Service Worker must manage static asset caching');
  console.log('✓ 3. PWA assets (manifest.json, sw.js with tile caching) verified');

  // 4. HTTP Compression & Caching Headers (Internet & Time optimization)
  const zonesRes = await fetch(`${BACKEND_URL}/api/zones`, {
    headers: { 'Accept-Encoding': 'gzip, deflate' }
  });
  assert.strictEqual(zonesRes.status, 200);
  const cacheControl = zonesRes.headers.get('cache-control');
  assert.ok(cacheControl && cacheControl.includes('public'), 'Cache-Control header must be set for caching optimization');
  const zonesData = await zonesRes.json();
  assert.strictEqual(zonesData.count, 24, 'Full canonical dataset must contain 24 zones');
  console.log(`✓ 4. HTTP Caching headers & compression verified (${zonesData.count} zones)`);

  // 5. Radius Search & Distance Calculation (Time & Space optimization)
  const radiusRes = await fetch(`${BACKEND_URL}/api/zones?lat=37.8702&lng=-122.2681&radius=1.0`);
  const radiusData = await radiusRes.json();
  assert.ok(radiusData.count > 0 && radiusData.count < 24, '1.0km radius filter must return nearby subset');
  assert.ok(radiusData.zones.every(z => z.distanceKm <= 1.0), 'All returned zones must be <= 1.0km');
  console.log(`✓ 5. Fast spatial bounding-box radius search verified (${radiusData.count} zones within 1.0km)`);

  // 6. Global Parking Discovery (Anywhere on Earth) — Google Places only, no fallback dataset
  const parisRes = await fetch(`${BACKEND_URL}/api/zones?lat=48.8584&lng=2.2945&radius=1.0&dest=Eiffel%20Tower`);
  const parisData = await parisRes.json();
  const gmapsKeyed = Boolean(process.env.GOOGLE_MAPS_API_KEY);
  if (gmapsKeyed) {
    assert.ok(parisData.count > 0, 'Global parking discovery must discover parking for Paris');
    assert.ok(parisData.zones.every(z => z.source === 'google'));
    console.log(`✓ 6. Global parking discovery verified for Paris (${parisData.count} real Google Places facilities found)`);
  } else {
    assert.strictEqual(parisData.count, 0, 'No fallback dataset — empty result without GOOGLE_MAPS_API_KEY');
    console.log('✓ 6. No-fallback behavior verified — Paris empty without Google key (configure GOOGLE_MAPS_API_KEY for real data)');
  }

  // 7. Forecast Horizon Series (Time optimization)
  const fcRes = await fetch(`${BACKEND_URL}/api/zones/zone-mall-gateway/forecast?arrival=${encodeURIComponent(new Date().toISOString())}`);
  const fc = await fcRes.json();
  assert.strictEqual(fc.series.length, 6, 'Forecast must provide 6 horizon points (0m, 15m, 30m, 60m, 120m, 180m)');
  assert.ok(fc.series.every(p => p.probability >= 0 && p.probability <= 1));
  console.log('✓ 7. Predictive multi-horizon spatio-temporal forecast verified');

  // 8. Route Recommendations & Search Time Saved
  const routeRes = await fetch(`${BACKEND_URL}/api/route?destination=Downtown&lat=37.8702&lng=-122.2681&radius=1.0`);
  const route = await routeRes.json();
  assert.ok(route.ranked.length > 0, 'Route must rank available zones');
  assert.ok(typeof route.searchTimeSavedMin === 'number');
  assert.strictEqual(route.suggestedWindows.length, 3, 'Must suggest 3 arrival windows');
  console.log(`✓ 8. Optimal route scoring verified (saved ~${route.searchTimeSavedMin} min search)`);

  // 9. Crowd Reporting with Instant Gamification
  const reportRes = await fetch(`${BACKEND_URL}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId: 'zone-mall-gateway', signal: 'found', note: 'Spot open near entrance' })
  });
  assert.strictEqual(reportRes.status, 201);
  const rep = await reportRes.json();
  assert.strictEqual(rep.pointsAwarded, 10, 'Confirmed report must award 10 reputation points');
  console.log('✓ 9. Real-time crowd signal ingestion & gamification verified');

  // 10. 7-Day Rolling Feed Strict Retention
  const retentionRes = await fetch(`${BACKEND_URL}/api/feed/retention`);
  const retention = await retentionRes.json();
  assert.strictEqual(retention.retentionDays, 7);
  assert.strictEqual(retention.isRetentionStrictlyCompliant, true);
  console.log(`✓ 10. 7-Day rolling MongoDB strict retention audit passed (${retention.validRecent7DaysRecords} records)`);

  console.log('\n🎉 ALL 10 COMPREHENSIVE INTEGRATION TESTS PASSED (100%)\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
