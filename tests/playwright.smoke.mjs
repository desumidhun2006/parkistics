// Parkistics Playwright smoke test — operates EVERY interactive element on the Forecast page.
// Run: npm --prefix backend install; node tests/playwright.smoke.mjs
// Serves backend :4000 + frontend :5173, drives Chromium headless, screenshots to frontend-screenshots/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BACKEND_PORT = 4000;
const FRONT_PORT = 5173;
const shots = 'frontend-screenshots';
fs.mkdirSync(shots, { recursive: true });

// Key-aware suite: with GOOGLE_MAPS_API_KEY → Google-only paths; without → graceful no-fallback behavior
const GMAPS = Boolean(process.env.GOOGLE_MAPS_API_KEY);
console.log(`Google Maps key: ${GMAPS ? 'PRESENT (google-only assertions)' : 'ABSENT (asserting graceful key-required behavior)'}`);

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(url, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await wait(500);
  }
  throw new Error('timeout waiting for ' + url);
}

console.log('starting backend + frontend servers...');
const backend = spawn('node', ['src/index.js'], { cwd: 'backend', env: { ...process.env, PORT: String(BACKEND_PORT) } });
const front = spawn('npx', ['serve', '../frontend', '-l', String(FRONT_PORT)], { cwd: 'backend', stdio: 'pipe' });
await waitFor(`http://localhost:${BACKEND_PORT}/health`);
await wait(1500);
try { await waitFor(`http://localhost:${FRONT_PORT}/`, 20000); } catch { console.log('frontend probe failed, continuing (test uses file + api checks)'); }

const results = [];
function check(name, ok, extra = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); }

// 1. Backend API checks
try {
  const z = await (await fetch(`http://localhost:${BACKEND_PORT}/api/zones`)).json();
  check('GET /api/zones returns full dataset', z.count === 24 && z.zones.length === 24, `count=${z.count}`);
  check('zones have probability+status', z.zones.every(x => x.current && typeof x.current.probability === 'number' && ['high','medium','low'].includes(x.current.status)));
  const zRad = await (await fetch(`http://localhost:${BACKEND_PORT}/api/zones?lat=37.8702&lng=-122.2681&radius=1.0`)).json();
  check('GET /api/zones with 1km radius filters nearby', zRad.count > 0 && zRad.count < z.count && zRad.zones.every(x => x.distanceKm <= 1.0), `nearby count=${zRad.count}`);
  const f = await (await fetch(`http://localhost:${BACKEND_PORT}/api/zones/zone-mall-gateway/forecast?arrival=${encodeURIComponent(new Date().toISOString())}`)).json();
  check('GET /forecast returns 6 horizons', f.series && f.series.length === 6, `source=${f.source}`);
  check('forecast has probability+confidence', f.series.every(p => typeof p.probability === 'number' && typeof p.confidence === 'number'));
  const rp = await fetch(`http://localhost:${BACKEND_PORT}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zoneId: 'zone-mall-gateway', signal: 'found' }) });
  check('POST /reports 201 + points', rp.status === 201 && (await rp.json()).pointsAwarded === 10);
  const rt = await (await fetch(`http://localhost:${BACKEND_PORT}/api/route?destination=Mall&lat=37.8702&lng=-122.2681&radius=1.0&time=${encodeURIComponent(new Date().toISOString())}`)).json();
  check('GET /route ranked + saved time', rt.ranked && rt.ranked.length > 0 && typeof rt.searchTimeSavedMin === 'number');

  // Google Maps config + geocode endpoints (Google-only — no fallback providers)
  const cfg = await (await fetch(`http://localhost:${BACKEND_PORT}/api/config`)).json();
  check('GET /config returns gmapsKey + parkingDataset', 'gmapsKey' in cfg && (cfg.parkingDataset === 'google-places' || cfg.parkingDataset === 'unconfigured'), `dataset=${cfg.parkingDataset}, key=${cfg.gmapsKey ? 'set' : 'null'}`);
  const gcRes = await fetch(`http://localhost:${BACKEND_PORT}/api/geocode?q=Eiffel%20Tower%2C%20Paris`);
  if (GMAPS) {
    const gc = await gcRes.json();
    check('GET /geocode resolves Eiffel Tower (google)', gcRes.ok && typeof gc.lat === 'number' && typeof gc.lng === 'number' && Math.abs(gc.lat - 48.8584) < 0.5 && gc.source === 'google', `lat=${gc.lat}, source=${gc.source}`);
  } else {
    check('GET /geocode returns 404 without key (no fallback geocoder)', gcRes.status === 404, `status=${gcRes.status}`);
  }

  // Global parking discovery test (Paris — Eiffel Tower) — Google Places only
  const gpRes = await fetch(`http://localhost:${BACKEND_PORT}/api/zones?lat=48.8584&lng=2.2945&radius=1.0&dest=Eiffel%20Tower`);
  const gp = await gpRes.json();
  if (GMAPS) {
    check('global parking discovery returns zones for Paris', gp.count > 0 && gp.zones.length > 0, `count=${gp.count}`);
    check('global zones sourced from google', gp.zones.every(z => z.source === 'google'), [...new Set(gp.zones.map(z => z.source))].join(','));
  } else {
    check('global discovery returns empty without key (no fallback dataset)', gp.count === 0 && Array.isArray(gp.zones), `count=${gp.count}`);
  }
  check('global zones have probability+status', gp.zones.every(z => z.current && typeof z.current.probability === 'number'));
} catch (e) { check('backend API suite', false, e.message); }

// 2. Playwright browser checks (Forecast page + Zone details in Light Theme)
let playwrightOk = false;
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${FRONT_PORT}/?api=http://localhost:${BACKEND_PORT}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="time-slider"]', { timeout: 15000 });

  // light theme check
  const isLight = await page.evaluate(() => document.documentElement.classList.contains('light'));
  check('light theme active on html element', isLight);

  // sidebar removed check (only forecast page exists)
  const navCount = await page.locator('nav').count();
  check('sidebar navigation removed', navCount === 0);

  // forecast page is main view
  const isForecastVisible = await page.locator('#view-forecast:not(.hidden)').isVisible();
  check('forecast page is the active primary view', isForecastVisible);

  // points and badges display removed
  check('points display removed from header', await page.locator('#points-display').count() === 0);
  check('badges display removed from header', await page.locator('#badges-display').count() === 0);
  check('api status text removed from header', await page.locator('#api-status').count() === 0);
  check('Live API engine badge removed', await page.locator('#engine-status-badge').count() === 0);
  check('Turbo / Data Saver button removed', await page.locator('#data-saver-btn').count() === 0);

  // destination search input & default radius check
  await page.waitForSelector('[data-testid="dest-search-input"]', { timeout: 8000 });
  const destVal = await page.locator('[data-testid="dest-search-input"]').inputValue();
  check('destination search input has default value', destVal.length > 2, destVal);

  const radVal = await page.locator('[data-testid="radius-val-label"]').innerText();
  check('default search radius is 1.0 km', radVal.includes('1.0'), radVal);

  // test changing radius to 2.0 km
  await page.locator('#radius-chips [data-radius="2.0"]').click();
  await page.waitForTimeout(1500);
  const radVal2 = await page.locator('[data-testid="radius-val-label"]').innerText();
  check('changing radius updates label to 2.0 km', radVal2.includes('2.0'), radVal2);

  // test typing a location
  await page.locator('[data-testid="dest-search-input"]').fill('Telegraph');
  await page.locator('[data-testid="dest-search-btn"]').click();
  await page.waitForTimeout(2000);
  const newDest = await page.evaluate(() => window.__parkistics.state.destination);
  check('typing destination updates state', newDest.toLowerCase().includes('telegraph'), newDest);

  // test nearby parking cards display probability and availability
  const nearbyCards = await page.locator('#nearby-cards article').count();
  check('nearby parking cards rendered for destination', nearbyCards > 0, `${nearbyCards} cards`);
  const firstCardText = await page.locator('#nearby-cards article').first().innerText();
  check('nearby card shows probability & availability', firstCardText.includes('%') && firstCardText.includes('spots'), firstCardText.slice(0, 60));

  // test global parking discovery via UI (search for Paris)
  await page.locator('[data-testid="dest-search-input"]').fill('Eiffel Tower, Paris');
  await page.locator('[data-testid="dest-search-btn"]').click();
  await page.waitForTimeout(3000);
  const globalDest = await page.evaluate(() => window.__parkistics.state.destination);
  const globalCoords = await page.evaluate(() => window.__parkistics.state.destCoords);
  if (GMAPS) {
    check('global search resolves Eiffel Tower (google geocode)', globalDest.toLowerCase().includes('eiffel') || globalDest.toLowerCase().includes('paris') || globalDest.toLowerCase().includes('tour'), globalDest);
    const globalCards = await page.locator('#nearby-cards article').count();
    check('global parking cards rendered for Paris', globalCards > 0, `${globalCards} cards`);
    check('destination coords moved to Paris', Math.abs(globalCoords.lat - 48.85) < 1 && Math.abs(globalCoords.lng - 2.3) < 1, `lat=${globalCoords.lat}, lng=${globalCoords.lng}`);
  } else {
    check('unresolvable search rejected without geocoder (no fallback)', !globalDest.toLowerCase().includes('eiffel') && !globalDest.toLowerCase().includes('paris'), globalDest);
    check('coords unchanged after failed search', Math.abs(globalCoords.lat - 37.87) < 0.1, `lat=${globalCoords.lat}`);
  }

  // reset to 1.0 km and Downtown for subsequent checks
  await page.locator('#radius-chips [data-radius="1.0"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="dest-search-input"]').fill('Downtown Berkeley');
  await page.locator('[data-testid="dest-search-btn"]').click();
  await page.waitForTimeout(2000);

  // time slider
  await page.locator('[data-testid="time-slider"]').fill('60');
  await page.waitForTimeout(600);
  const label60 = await page.locator('[data-testid="time-label"]').innerText();
  check('time slider updates label', label60.includes('60'), label60);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/01-slider-60-light.png`, fullPage: true });
  await page.locator('[data-testid="time-slider"]').fill('15');

  // slider quick-step buttons
  await page.locator('#slider-steps [data-h="30"]').click();
  await page.waitForTimeout(400);
  const label30 = await page.locator('[data-testid="time-label"]').innerText();
  check('quick step button updates slider', label30.includes('30'), label30);

  // location toolbar
  check('locate-me button visible', await page.locator('[data-testid="locate-me"]').isVisible());
  const locText = await page.locator('[data-testid="location-status"]').innerText();
  check('location status shown', locText.length > 3, locText.slice(0, 70));

  if (GMAPS) {
    await page.waitForFunction(() => window.__parkistics && window.__parkistics.state.mapReady, { timeout: 20000 });
    const provider = await page.evaluate(() => window.__parkistics.state.provider);
    check('google maps is the map provider', provider === 'google', provider);
    check('google map element initialized', await page.locator('#map .gm-style').isVisible());
  } else {
    await page.waitForSelector('[data-testid="gmaps-notice"]', { timeout: 15000 });
    check('key-required notice shown (no fallback map)', await page.locator('[data-testid="gmaps-notice"]').isVisible());
    const provider = await page.evaluate(() => window.__parkistics.state.provider);
    check('no map provider without key', provider === null, String(provider));
    check('leaflet fully removed from page', (await page.locator('#map.leaflet-container').count()) === 0 && (await page.evaluate(() => Boolean(window.L))) === false);
  }

  // zone buttons rendered live
  await page.waitForSelector('[data-testid^="zone-marker-"]', { timeout: 15000 });
  const zoneBtns = await page.locator('[data-testid^="zone-marker-"]').count();
  check('zone buttons rendered', zoneBtns > 0, `${zoneBtns} found`);
  const ids = ['zone-mall-gateway','zone-campus-north','zone-telegraph','zone-station'];
  for (const id of ids) {
    const el = page.locator(`[data-testid="zone-marker-${id}"]`);
    if (await el.count() > 0) {
      await el.click();
      await page.waitForSelector('#view-zones:not(.hidden)', { timeout: 8000 });
      const name = await page.locator('#detail-name').innerText();
      check(`zone detail opens (${id})`, name.length > 2, name);
      if (id === ids[0]) {
        await page.screenshot({ path: `${shots}/02-zone-detail-light.png`, fullPage: true });
      }
      await page.locator('[data-testid="zone-detail-close"]').click();
      await page.waitForSelector('#view-forecast:not(.hidden)', { timeout: 8000 });
    }
  }
  check('zone detail closes back to forecast', await page.locator('#view-forecast:not(.hidden)').count() === 1);

  // recommendation card
  const recoText = await page.locator('#reco-title').innerText();
  check('recommendation card shows best zone', recoText.length > 2, recoText);

  // geolocation granted → map centers where the person is
  const geoCtx = await browser.newContext({ viewport: { width: 1400, height: 900 }, geolocation: { latitude: 37.7749, longitude: -122.4194 }, permissions: ['geolocation'] });
  const geoPage = await geoCtx.newPage();
  await geoPage.goto(`http://localhost:${FRONT_PORT}/?api=http://localhost:${BACKEND_PORT}`, { waitUntil: 'networkidle' });
  await geoPage.locator('[data-testid="locate-me"]').click();
  await geoPage.waitForFunction(() => {
    const el = document.getElementById('banner-title');
    return el && el.textContent.includes('You are here');
  }, { timeout: 8000 });
  const ulo = await geoPage.evaluate(() => window.__parkistics.state.userLocation);
  check('geolocation centers on user', Math.abs(ulo.lat - 37.7749) < 0.001 && Math.abs(ulo.lng + 122.4194) < 0.001, `${ulo.lat},${ulo.lng}`);
  const uloText = await geoPage.locator('[data-testid="location-status"]').innerText();
  check('location status shows you-are-here', /you are here/i.test(uloText), uloText.slice(0, 70));
  await geoPage.screenshot({ path: `${shots}/03-forecast-light.png`, fullPage: true });
  await geoCtx.close();

  check('no page errors', errors.length === 0, errors.slice(0,2).join(' | '));
  await browser.close();
} catch (e) {
  check('playwright browser suite', false, e.message);
}

try { backend.kill(); } catch {}
try { front.kill(); } catch {}
const nPass = results.filter(r => r.ok).length;
const nTotal = results.length;
console.log(`\n========================================`);
console.log(`SMOKE SUMMARY: ${nPass}/${nTotal} PASS (${Math.round(nPass/nTotal*100)}%)`);
console.log(`========================================`);
process.exit(nPass === nTotal ? 0 : 1);
