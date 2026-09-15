#!/usr/bin/env node
// Fill in the district centroids the calendar names but events-sync.js cannot
// place. An event with no address of its own falls back to its district, so a
// district with no coordinate leaves the event nowhere — Union Square alone
// labels sixty-one listings.
//
//   node scripts/geocode-neighborhoods.mjs [--dry-run] [--only "union square,castro"]
//   node scripts/geocode-neighborhoods.mjs --from districts.json
//
// `--from` takes coordinates you already have instead of asking the network:
// { "union square": { "lat": 37.7880, "lng": -122.4074 }, ... }. Same checks,
// same rewrite, no requests.
//
// It reads the saved programme for the district names actually in use, asks
// OpenStreetMap for each one at one request per second, refuses anything that
// lands outside the mapped city, and rewrites the block between the
// `districts:start` / `districts:end` markers in events-sync.js. Existing
// hints are never touched. Behind a proxy run with NODE_USE_ENV_PROXY=1.
//
// Districts the feed names but this script skips on purpose:
//   · "Other" and "Virtual (SF)" are not places — a virtual event has no venue.
//   · Palo Alto, Stanford, East Bay, Mountain View, San Mateo, Hillsborough are
//     not San Francisco. An event there with real coordinates already moors at
//     the Golden Gate; one without is a listing, not a location.
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromPath = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const only = args.includes('--only')
  ? new Set(args[args.indexOf('--only') + 1].split(',').map(name => name.trim().toLowerCase()).filter(Boolean))
  : null;

const root = new URL('../', import.meta.url);
const syncUrl = new URL('events-sync.js', root);
const UA = 'sf-tech-week-city/1.0 (district centroids; contact via the project Discord)';
const START = '/* districts:start */', END = '/* districts:end */';

// San Francisco as the city draws it — the same window tuning-build.mjs uses.
const CITY = { minLat: 37.70, maxLat: 37.84, minLng: -122.53, maxLng: -122.34 };
const inCity = (lat, lng) => lat > CITY.minLat && lat < CITY.maxLat && lng > CITY.minLng && lng < CITY.maxLng;

const NOT_A_PLACE = new Set(['other', 'virtual', 'tba', 'online']);
const NOT_SAN_FRANCISCO = new Set(['palo alto', 'stanford', 'east bay', 'mountain view', 'san mateo',
  'hillsborough', 'berkeley', 'oakland', 'menlo park', 'half moon bay', 'walnut creek', 'alameda']);

const normalize = (value) => String(value || '').trim().toLowerCase()
  .replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function nominatim(district) {
  const query = new URLSearchParams({ format: 'jsonv2', q: `${district}, San Francisco, California`,
    limit: '1', addressdetails: '1' });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  const [hit] = await response.json();
  if (!hit) return null;
  // A district, a park or a square is a place; a single building or a shop is
  // not the centre of a neighbourhood.
  const kind = hit.addresstype || hit.type;
  if (!['suburb', 'neighbourhood', 'quarter', 'city_district', 'square', 'park', 'residential'].includes(kind)) {
    return { refused: `resolved to a ${kind}, not a district` };
  }
  const lat = Number(hit.lat), lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inCity(lat, lng)) return { refused: `resolved outside the mapped city (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
  return { lat, lng, label: hit.display_name };
}

const manifest = JSON.parse(await readFile(new URL('data/tech-week-enriched.parts.json', root), 'utf8'));
const feed = JSON.parse((await Promise.all(manifest.parts.map(name =>
  readFile(new URL(`data/${name}`, root), 'utf8')))).join(''));
const events = feed.list || feed.events || [];

let sync = await readFile(syncUrl, 'utf8');
const startAt = sync.indexOf(START), endAt = sync.indexOf(END);
if (startAt < 0 || endAt < startAt) throw new Error(`events-sync.js has no ${START} … ${END} block`);
const known = new Set([...sync.matchAll(/^\s*'([^']+)':\s*\{\s*lat:/gm)].map(match => match[1]));

const wanted = new Map();
for (const event of events) {
  const label = event.neighborhood;
  if (!label) continue;
  const key = normalize(label);
  if (!key || known.has(key) || NOT_A_PLACE.has(key) || NOT_SAN_FRANCISCO.has(key)) continue;
  if (only && !only.has(key)) continue;
  wanted.set(key, (wanted.get(key) || 0) + 1);
}
const order = [...wanted.entries()].sort((a, b) => b[1] - a[1]);
if (!order.length) { console.log('every district the calendar names already has a coordinate'); process.exit(0); }
console.log(`${order.length} districts to resolve, ${order.reduce((sum, [, n]) => sum + n, 0)} listings behind them`);

const supplied = fromPath
  ? Object.fromEntries(Object.entries(JSON.parse(await readFile(new URL(fromPath, `file://${process.cwd()}/`), 'utf8')))
    .map(([name, point]) => [normalize(name), point]))
  : null;

const found = [];
let refused = 0, missed = 0;
for (const [district, listings] of order) {
  let hit = null;
  if (supplied) {
    const point = supplied[district];
    const lat = Number(point?.lat), lng = Number(point?.lng);
    if (!point) hit = null;
    else if (!Number.isFinite(lat) || !Number.isFinite(lng)) hit = { refused: 'lat and lng must be numbers' };
    else if (!inCity(lat, lng)) hit = { refused: `outside the mapped city (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
    else hit = { lat, lng, label: 'supplied' };
  } else {
    try { hit = await nominatim(district); }
    catch (error) { console.warn(`  ! ${district}: ${error.message}`); }
    await sleep(1100);
  }
  if (hit?.refused) { refused += 1; console.warn(`  ! ${district} (${listings}): ${hit.refused}`); continue; }
  if (!hit) { missed += 1; console.warn(`  ? ${district} (${listings}): no match`); continue; }
  found.push({ district, listings, lat: hit.lat, lng: hit.lng });
  console.log(`  ✓ ${district} (${listings}) → ${hit.lat.toFixed(4)}, ${hit.lng.toFixed(4)}  ${hit.label.slice(0, 60)}`);
}

const block = found.length
  ? found.map(entry => `  '${entry.district}': { lat: ${entry.lat.toFixed(4)}, lng: ${entry.lng.toFixed(4)} },`).join('\n')
  : '';
const rewritten = `${sync.slice(0, startAt + START.length)}\n${block}${block ? '\n' : ''}  ${sync.slice(endAt)}`;
if (!dryRun && found.length) await writeFile(syncUrl, rewritten);
console.log(`${found.length} placed, ${refused} refused, ${missed} without a match${dryRun ? ' (dry run, nothing written)' : ''}`);
if (found.length && !dryRun) console.log('run `npm test` and `npm run build:local`, then open the city and look');
