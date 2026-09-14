// The saved snapshot in data/ is the archive: every field, plus per-field
// provenance (fieldSources) and crawl bookkeeping. The game reads a fraction of
// it, and the rest is dead weight on every player's first load — provenance
// alone is half the file. Builds serve this slimmed copy; data/ stays complete.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// sourceConflicts is provenance of the same kind as fieldSources: it records
// which reading of a fact the merge kept and which it replaced. The game shows
// the kept value and never the audit trail, so it belongs with the archive.
const DROP = ['fieldSources', 'sourceConflicts', 'imageUsage', 'calendarUrl', 'calendarId', 'locationVisibility', 'source', 'sourceLabel', 'acquisition'];

// A poster reaches the player only when its host answers cross-origin: the
// hosted page fetches covers into a blob (its img-src admits blob: alone) and
// the wall texture loads them with crossOrigin 'anonymous'. These hosts send
// Access-Control-Allow-Origin: *. cdn.tech-week.com serves the same images
// without it, so a URL there is a poster nobody sees. events-sync.js carries
// the same list for the runtime merge; a test keeps the two identical.
export const CORS_POSTER_ORIGINS = Object.freeze(['https://partiful.imgix.net', 'https://partiful-posters.imgix.net', 'https://firebasestorage.googleapis.com', 'https://media0.giphy.com', 'https://media1.giphy.com', 'https://media2.giphy.com', 'https://media3.giphy.com']);
export function corsPoster(url) {
  try { return CORS_POSTER_ORIGINS.includes(new URL(url).origin); } catch { return false; }
}

// How many posters in a feed a hosted player can actually load.
export function posterOriginReport(events) {
  const byOrigin = new Map();
  let withImage = 0, blocked = 0;
  for (const event of events) {
    if (!event.image) continue;
    withImage += 1;
    let origin = '(unparseable)';
    try { origin = new URL(event.image).origin; } catch {}
    byOrigin.set(origin, (byOrigin.get(origin) || 0) + 1);
    if (!corsPoster(event.image)) blocked += 1;
  }
  return { withImage, blocked, share: withImage ? blocked / withImage : 0, byOrigin: Object.fromEntries([...byOrigin].sort((a, b) => b[1] - a[1])) };
}

// The build refuses a feed most of whose posters cannot load, the way it
// refuses a moved patch target. The September listing moved 98% of them to a
// host without the header and every wall in the live city went blank before
// anyone noticed; the handful that were already there stay under the bar.
export const MAX_BLOCKED_POSTER_SHARE = 0.10;
export function assertPosterOrigins(feed, { maxBlockedShare = MAX_BLOCKED_POSTER_SHARE } = {}) {
  const report = posterOriginReport(feed.events || []);
  if (report.share <= maxBlockedShare) return report;
  const hosts = Object.entries(report.byOrigin).filter(([origin]) => !CORS_POSTER_ORIGINS.includes(origin)).map(([origin, n]) => `${origin} ×${n}`).join(', ');
  throw new Error(`Poster origins changed: ${report.blocked} of ${report.withImage} posters (${(report.share * 100).toFixed(1)}%) sit on hosts that send no CORS header — ${hosts}. A hosted player cannot load them. Keep the previous CORS-capable URLs (node scripts/reconcile-snapshot.mjs <previous-snapshot.json>) or add the host to CORS_POSTER_ORIGINS once it sends Access-Control-Allow-Origin.`);
}

// Same door test as scripts/merge-approved-addresses.mjs: a leading house
// number (not an ordinal street like 11th St) and any floor, suite or unit.
const DOOR = /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\s*[-–/]\s*\d+[a-z]?)?\s+/i;
const UNIT = /[,(]?\s*(?:\b(?:suite|ste|apt|apartment|unit|floor|fl|room|rm)\b|#)\s*[\w-]+\)?/gi;
export const streetOnly = (address) => String(address || '').replace(UNIT, '').replace(DOOR, '').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');

// Venues whose door is withheld (data/venue-overrides.json). The runtime hides
// the door on the card; this makes the served feed itself carry the building
// only, whatever the crawl recorded, so a downloaded feed reveals no more.
let shippedDoorWithheld = null;
function doorWithheldEntries() {
  if (shippedDoorWithheld) return shippedDoorWithheld;
  try {
    const raw = JSON.parse(readFileSync(new URL('./data/venue-overrides.json', import.meta.url), 'utf8'));
    shippedDoorWithheld = (raw.addresses || []).filter(entry => entry.doorWithheld !== false);
  } catch { shippedDoorWithheld = []; }
  return shippedDoorWithheld;
}

export function slimFeed(feed, { doorWithheld = doorWithheldEntries() } = {}) {
  const byId = new Map(), byUrl = new Map();
  for (const entry of doorWithheld) { if (entry.eventId) byId.set(entry.eventId, entry); if (entry.eventUrl) byUrl.set(entry.eventUrl, entry); }
  const events = feed.events.map(event => {
    const out = {};
    for (const [key, value] of Object.entries(event)) {
      if (DROP.includes(key)) continue;
      if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
      out[key] = value;
    }
    const entry = byId.get(event.id) || byUrl.get(event.url) || byUrl.get(event.sourceUrl);
    if (entry) {
      delete out.mapUrl;
      if (out.address) out.address = entry.street || streetOnly(out.address);
    }
    return out;
  });
  const { failures, acquisition, ...rest } = feed;
  return { ...rest, events, slim: true };
}

// Rewrite a copied feed in place (used by the local and hosted builds).
export async function slimFeedFile(path) {
  const before = await readFile(path, 'utf8');
  const after = JSON.stringify(slimFeed(JSON.parse(before)));
  await writeFile(path, after);
  return { before: before.length, after: after.length };
}

// A snapshot over the importer's per-file text limit ships as ordered raw text
// parts of one JSON document (data/<base>.parts.json lists them). Join them in
// order; a partial set is not a smaller snapshot.
export async function readFeedText(dir, base) {
  const manifestUrl = new URL(`${base}.parts.json`, dir);
  let manifest = null;
  try { manifest = JSON.parse(await readFile(manifestUrl, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!manifest) return { text: await readFile(new URL(`${base}.json`, dir), 'utf8'), manifest: null };
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('Snapshot part manifest is empty');
  const texts = await Promise.all(manifest.parts.map(name => {
    if (!/^[\w.-]+$/.test(name)) throw new Error('Unexpected snapshot part name');
    return readFile(new URL(name, dir), 'utf8');
  }));
  return { text: texts.join(''), manifest, manifestUrl };
}

export const FEED_PART_BYTES = 200 * 1024;

// Each fetched part is decoded separately. Count bytes, not UTF-16 characters,
// and move a cut back to the start of a code point so Chinese/emoji survive it.
export function splitUtf8(text, maxBytes = FEED_PART_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) throw new Error('UTF-8 part size must be at least four bytes');
  const bytes = Buffer.from(text), parts = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + maxBytes, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts;
}

// Only the copied hosted/local build data is rewritten. Small parallel parts
// avoid putting an entire event snapshot behind a single slow response; the
// JSON payload and its ordered reconstruction remain exactly the same.
export async function slimFeedParts(dir, base) {
  const { text, manifest, manifestUrl } = await readFeedText(dir, base);
  const slim = slimFeed(JSON.parse(text)), after = JSON.stringify(slim);
  assertPosterOrigins(slim);
  const beforeBytes = Buffer.byteLength(text), afterBytes = Buffer.byteLength(after);
  if (!manifest && afterBytes <= FEED_PART_BYTES) {
    await writeFile(new URL(`${base}.json`, dir), after);
    return { before: beforeBytes, after: afterBytes, parts: 0 };
  }
  const contents = splitUtf8(after);
  const parts = contents.map((_, index) => `${base}.part-${String(index).padStart(3, '0')}.json`);
  await Promise.all(parts.map((name, index) => writeFile(new URL(name, dir), contents[index])));
  await writeFile(manifestUrl || new URL(`${base}.parts.json`, dir), JSON.stringify({
    ...manifest,
    file: `${base}.json`, parts, bytes: afterBytes, events: slim.events.length,
    sha256: createHash('sha256').update(after).digest('hex'),
    note: 'Parts are ordered raw UTF-8 slices of one JSON document, each at most 200 KiB. Join every part before parsing.',
  }, null, 2) + '\n');
  // Do not ship stale fallback data or leftover parts after a smaller rebuild.
  await Promise.all([`${base}.json`, ...(manifest?.parts || []).filter(name => !parts.includes(name))]
    .map(name => rm(new URL(name, dir), { force: true })));
  return { before: beforeBytes, after: afterBytes, parts: parts.length };
}

// The archive in data/ is one JSON document stored as raw slices under the
// importer's per-file text limit. Scripts write it; builds only read it.
export const ARCHIVE_PART_BYTES = 3 * 1024 * 1024;
export async function writeArchiveParts(dir, base, feed) {
  const text = JSON.stringify(feed);
  const { manifest } = await readFeedText(dir, base).catch(() => ({ manifest: null }));
  const contents = splitUtf8(text, ARCHIVE_PART_BYTES);
  const parts = contents.map((_, index) => `${base}.part-${String(index).padStart(3, '0')}.json`);
  await Promise.all(parts.map((name, index) => writeFile(new URL(name, dir), contents[index])));
  await writeFile(new URL(`${base}.parts.json`, dir), JSON.stringify({
    file: `${base}.json`, parts, bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'), events: feed.events.length,
    note: "The snapshot exceeds the importer's per-file text limit. Parts are raw slices of one JSON document and must be joined in order; a partial set is not a smaller snapshot.",
  }, null, 2) + '\n');
  await Promise.all([`${base}.json`, ...(manifest?.parts || []).filter(name => !parts.includes(name))].map(name => rm(new URL(name, dir), { force: true })));
  return { bytes: Buffer.byteLength(text), parts: parts.length };
}
