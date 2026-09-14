// Fill in building coordinates for data/venue-overrides.json without ever
// committing a door. The full addresses live only in the gitignored
// .local/venue-doors.json ({ "<eventId or eventUrl>": "375 11th St, San
// Francisco, CA 94103", ... }); this script geocodes them and writes back
// lat/lng plus the street with its house number and any unit stripped.
//
//   node scripts/geocode-venue-overrides.mjs [--doors .local/venue-doors.json] [--dry-run]
//
// Same lookup order as the game's own address search: DataSF address points
// (exact match, then number + street), then OpenStreetMap Nominatim at one
// request per second. Coarse results (a road or district centre) are refused —
// a sign has to hang on a building. Behind a proxy run with NODE_USE_ENV_PROXY=1.
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const doorsPath = args.includes('--doors') ? args[args.indexOf('--doors') + 1] : '.local/venue-doors.json';
const dryRun = args.includes('--dry-run');
const overridesUrl = new URL('../data/venue-overrides.json', import.meta.url);
const UA = 'sf-tech-week-city/1.0 (venue overrides; contact via the project Discord)';

const DOOR = /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\s*[-–/]\s*\d+[a-z]?)?\s+/i;
const UNIT = /[,(]?\s*(?:\b(?:suite|ste|apt|apartment|unit|floor|fl|room|rm)\b|#)\s*[\w-]+\)?/gi;
const streetOnly = (address) => String(address || '').replace(UNIT, '').replace(DOOR, '').replace(/,.*$/, '').replace(/\s{2,}/g, ' ').trim();
const inSF = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 37.6 && lat < 37.86 && lng > -122.55 && lng < -122.33;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The game's normaliser (source: geocodeSF), so DataSF sees the same key.
function normalizeSF(text) {
  let e = text.normalize('NFKC').toUpperCase().replace(/[，,.#]/g, ' ').replace(/\s+/g, ' ').trim();
  e = e.replace(/\s+(?:APT|APARTMENT|UNIT|STE|SUITE)\s+[A-Z0-9-]+.*$/, '').trim();
  e = e.replace(/\s+(?:SAN FRANCISCO|SF)(?:\s+CA(?:LIFORNIA)?)?(?:\s+94\d{3})?.*$/, '').trim();
  e = e.replace(/\s+CA(?:LIFORNIA)?(?:\s+94\d{3})?.*$/, '').trim();
  for (const [from, to] of [[/\bSTREET\b/g, 'ST'], [/\bAVENUE\b/g, 'AVE'], [/\bBOULEVARD\b/g, 'BLVD'], [/\bROAD\b/g, 'RD'], [/\bDRIVE\b/g, 'DR'], [/\bCOURT\b/g, 'CT'], [/\bPLACE\b/g, 'PL'], [/\bTERRACE\b/g, 'TER'], [/\bHIGHWAY\b/g, 'HWY'], [/\bLANE\b/g, 'LN']]) e = e.replace(from, to);
  return e.replace(/\s+/g, ' ').trim();
}

async function dataSF(address) {
  const key = normalizeSF(address);
  if (!key) return null;
  const select = 'address,longitude,latitude';
  const get = async (where, extra = {}) => {
    const q = new URLSearchParams({ $select: select, $where: where, $limit: '4', ...extra });
    const r = await fetch(`https://data.sfgov.org/resource/3mea-di5p.json?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`DataSF ${r.status}`);
    return r.json();
  };
  let rows = await get(`address='${key.replaceAll("'", "''")}'`);
  if (!rows.length) {
    const m = key.match(/^(\d+)\s+(.+)$/);
    if (m) rows = await get(`address_number=${Number(m[1])} AND street_full_street_name like '${m[2].replaceAll("'", "''").replaceAll('%', '').replaceAll('_', '')}%'`, { $order: 'address' });
  }
  const row = rows[0];
  if (!row) return null;
  const lat = Number(row.latitude), lng = Number(row.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, source: 'DataSF address points', match: row.address } : null;
}

async function nominatim(address) {
  const q = new URLSearchParams({ format: 'jsonv2', q: address, limit: '1', addressdetails: '1' });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const [hit] = await r.json();
  if (!hit) return null;
  // A road or district centre is not a building.
  if (['road', 'suburb', 'city', 'town', 'neighbourhood', 'quarter', 'postcode', 'county', 'state'].includes(hit.addresstype)) return null;
  const lat = Number(hit.lat), lng = Number(hit.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, source: 'OpenStreetMap Nominatim', match: hit.display_name } : null;
}

const overrides = JSON.parse(await readFile(overridesUrl, 'utf8'));
let doors = {};
try { doors = JSON.parse(await readFile(new URL(doorsPath, `file://${process.cwd()}/`), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; console.warn(`no ${doorsPath}; nothing to geocode`); }

let done = 0, kept = 0, missing = 0, refused = 0;
for (const entry of overrides.addresses) {
  if (Number.isFinite(entry.lat) && Number.isFinite(entry.lng)) { kept += 1; continue; }
  const door = doors[entry.eventId] || (entry.eventUrl && doors[entry.eventUrl]);
  if (!door) { missing += 1; continue; }
  let hit = null;
  try { hit = await dataSF(door); } catch (error) { console.warn(`  DataSF failed for ${entry.eventId}: ${error.message}`); }
  if (!hit) { await sleep(1100); try { hit = await nominatim(door); } catch (error) { console.warn(`  Nominatim failed for ${entry.eventId}: ${error.message}`); } }
  if (!hit || !inSF(hit.lat, hit.lng)) { refused += 1; console.warn(`  ! ${entry.eventId}: no building-level match inside San Francisco; left unplaced`); continue; }
  entry.lat = hit.lat; entry.lng = hit.lng;
  // An entry whose door is already public keeps the address the event page
  // shows; only a withheld door is published as a street without its number.
  if (entry.doorWithheld !== false) entry.street = streetOnly(entry.street || door);
  entry.geocodedAt = new Date().toISOString();
  entry.geocodeSource = hit.source;
  done += 1;
  console.log(`  ✓ ${entry.eventId} → ${entry.venue || ''} ${entry.street} (${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}) via ${hit.source}`);
}
overrides.updatedAt = new Date().toISOString();
if (!dryRun && done) await writeFile(overridesUrl, JSON.stringify(overrides, null, 2) + '\n');
console.log(`${done} geocoded, ${kept} already placed, ${missing} without a door in ${doorsPath}, ${refused} refused${dryRun ? ' (dry run, nothing written)' : ''}`);
