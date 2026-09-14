import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Same shape as event-loading.test.mjs: the production module runs in a vm
// context against stubbed fetches, so the whole read() lifecycle is exercised.
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('events-sync.js', root), 'utf8');
const manifest = JSON.parse(await readFile(new URL('data/tech-week-enriched.parts.json', root), 'utf8'));
const fullText = (await Promise.all(manifest.parts.map(name => readFile(new URL(`data/${name}`, root), 'utf8')))).join('');
const full = JSON.parse(fullText);
const baseline = JSON.parse(await readFile(new URL('data/tech-week-first.json', root), 'utf8'));
const shipped = JSON.parse(await readFile(new URL('data/venue-overrides.json', root), 'utf8'));
const partText = new Map(await Promise.all(manifest.parts.map(async name => [name, await readFile(new URL(`data/${name}`, root), 'utf8')])));
// Same door test as scripts/merge-approved-addresses.mjs: a leading house number, not an ordinal street like 11th St.
const DOOR = /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\s*[-–/]\s*\d+[a-z]?)?\s+/i;
const base = 'https://chrona.world/project-runtime/world/37/key/events-sync.js';
const seed = { events: [{ id: 'sample', title: 'Sample programme' }], citizens: [] };
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

const DNA = 'partiful-IDX1j40sjTDhK6Pp5ewl';                       // has a venue, no coordinates in the crawl
const JETTISON = 'techweek-7f6a896c-2f6b-49fe-bc6a-7e9485e1c13c';  // crawl already holds coordinates and a mapUrl
const overrides = {
  addresses: [
    { eventId: DNA, venue: 'DNA Lounge', street: '11th St', neighborhood: 'SOMA', lat: 37.7710, lng: -122.4128, doorWithheld: true, source: 'public event page, entered by the project owner' },
    { eventId: JETTISON, street: 'Jeff Adachi Way', doorWithheld: true },
  ],
  events: [{ id: 'supplement-test', title: 'Supplemental listing', start: '2026-10-07T22:00:00.000Z', venue: 'AGI House SF', address: 'St Germain Ave', doorWithheld: true, url: null }],
};

function harness(route = () => undefined) {
  const timers = new Map(); let nextTimer = 0; const refreshes = [];
  const setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, fn); return id; };
  const clearTimeout = id => timers.delete(id);
  const fetch = async (input) => {
    const name = new URL(input, base).pathname.split('/').pop();
    const part = manifest.parts.indexOf(name);
    const result = route(name)
      ?? (part >= 0 ? { text: partText.get(name) }
        : name === 'tech-week-enriched.parts.json' ? { data: manifest }
        : name === 'tech-week-first.json' ? { data: baseline }
        : { status: 404, text: 'Missing' });
    const text = result.text ?? JSON.stringify(result.data), status = result.status ?? 200;
    return { ok: status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
  };
  const window = { __SF_HOST_READY__: Promise.resolve() };
  const context = { window, URL, Date, fetch, setTimeout, clearTimeout,
    AbortSignal: { timeout: () => new AbortController().signal },
    console: { warn() {}, error() {} }, document: { getElementById: () => ({ dataset: {} }) } };
  runInNewContext(source.replace('export function mergePublicFeeds', 'function mergePublicFeeds').replaceAll('import.meta.url', JSON.stringify(base)), context, { filename: 'events-sync.js' });
  window.TW = { state: { ready: true }, async refreshEvents() { refreshes.push(await window.__sfEventFeed.read(seed)); } };
  // Run whatever the module scheduled (refreshWhenReady polls on a timer).
  const settle = async () => {
    for (let round = 0; round < 200; round++) {
      await flush();
      for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
      await flush();
      if (refreshes.some(r => r.list.length >= full.events.length)) return;
    }
  };
  return { read: async () => { await window.__sfEventFeed.read(seed); await settle(); return window.__sfEventFeed.read(seed); }, refreshes };
}

test('the shipped venue-overrides.json is well formed and publishes no door', () => {
  assert.ok(Array.isArray(shipped.addresses) && shipped.addresses.length);
  assert.ok(Array.isArray(shipped.events));
  for (const entry of shipped.addresses) {
    assert.ok(entry.eventId || entry.eventUrl, 'every entry names its event');
    assert.equal(typeof entry.doorWithheld, 'boolean', `doorWithheld is stated in ${entry.eventId}`);
    // The file never carries a door, whichever kind of entry it is.
    assert.doesNotMatch(String(entry.street || ''), DOOR, `no house number in ${entry.eventId}`);
    // An event whose address the event page already publishes is here only to
    // gain a building coordinate: it must not carry a `street`, which would
    // replace that public address with a street without its number.
    if (entry.doorWithheld === false) {
      assert.equal(entry.street, undefined, `${entry.eventId} publishes its door, so it states no street`);
    }
  }
  for (const event of shipped.events) assert.doesNotMatch(String(event.address || ''), DOOR);
});

test('supplements append missing listings and apply building-level venues with the door withheld', async () => {
  const h = harness(name => name === 'venue-overrides.json' ? { data: overrides } : undefined);
  const result = await h.read();
  assert.equal(result.list.length, full.events.length + 1, 'one supplemental listing appended');
  const extra = result.list.find(e => e.id === 'supplement-test');
  assert.equal(extra.supplemental, true);
  assert.equal(extra.venue, 'AGI House SF');

  const dna = result.list.find(e => e.id === DNA);
  assert.equal(dna.venue, 'DNA Lounge');
  assert.equal(dna.address, '11th St');
  assert.equal(dna.neighborhood, 'SOMA');
  assert.equal(dna.lat, 37.7710); assert.equal(dna.lng, -122.4128);
  assert.equal(dna.approxLocation, false, 'an exact building is not a district guess');
  assert.equal(dna.doorWithheld, true);
  assert.equal(dna.addressSource, 'public event page, entered by the project owner');
  assert.equal(dna.mapUrl, undefined, 'no map link to the exact address');

  const jettison = result.list.find(e => e.id === JETTISON);
  const before = full.events.find(e => e.id === JETTISON);
  assert.equal(jettison.address, 'Jeff Adachi Way', 'house number withheld');
  assert.equal(jettison.lat, before.lat, 'coordinates already in the crawl are kept when the entry has none');
  assert.equal(jettison.venue, before.venue);
  assert.equal(jettison.mapUrl, undefined);
});

test('a moderator-approved entry outranks the supplement for the same event, field by field', async () => {
  const approved = { addresses: [{ eventId: DNA, venue: 'DNA Lounge (approved)', street: '11th St', lat: 37.7711, lng: -122.4129, approvedAt: '2026-09-12T00:00:00.000Z' }] };
  const h = harness(name => name === 'venue-overrides.json' ? { data: overrides } : name === 'addresses.json' ? { data: approved } : undefined);
  const dna = (await h.read()).list.find(e => e.id === DNA);
  assert.equal(dna.venue, 'DNA Lounge (approved)');
  assert.equal(dna.lat, 37.7711);
  assert.equal(dna.neighborhood, 'SOMA', 'the supplement still fills what the approval left blank');
  assert.equal(dna.doorWithheld, true);
  assert.equal(dna.approvedAddressAt, '2026-09-12T00:00:00.000Z');
});

test('no overrides file leaves the public feed exactly as the crawl published it', async () => {
  const h = harness();
  const result = await h.read();
  assert.equal(result.list.length, full.events.length);
  assert.deepEqual(Array.from(result.list, e => e.id), full.events.map(e => e.id));  // Array.from: the list is a vm-realm array
});

import { slimFeed, streetOnly } from '../feed-slim.mjs';

test('the served feed withholds the door for overridden venues at build time', () => {
  const feed = { fetchedAt: '2026-09-11T00:00:00.000Z', events: [
    { id: 'x', venue: 'DNA Lounge', address: '375 11th St, San Francisco, CA 94103', mapUrl: 'https://www.google.com/maps/search/?api=1&query=375%2011th%20St' },
    { id: 'y', address: '1 Market St, San Francisco, CA', mapUrl: 'https://www.google.com/maps/search/?api=1&query=1%20Market%20St' },
    { id: 'z', url: 'https://partiful.com/e/abc', address: '47 Jeff Adachi Way, Suite 2, San Francisco, CA 94103' },
  ] };
  const slim = slimFeed(feed, { doorWithheld: [{ eventId: 'x', street: '11th St' }, { eventUrl: 'https://partiful.com/e/abc' }] });
  const [x, y, z] = ['x', 'y', 'z'].map(id => slim.events.find(e => e.id === id));
  assert.equal(x.address, '11th St', 'the entry’s street wins');
  assert.equal(x.mapUrl, undefined, 'no map link to the door');
  assert.equal(y.address, '1 Market St, San Francisco, CA', 'events without an entry are untouched');
  assert.ok(y.mapUrl);
  assert.equal(z.address, 'Jeff Adachi Way, San Francisco, CA 94103', 'without a street the crawl address loses its number and unit');
  assert.equal(streetOnly('1868 Floribunda Ave, Hillsborough, CA 94010'), 'Floribunda Ave, Hillsborough, CA 94010');
  assert.equal(streetOnly('11th St'), '11th St', 'an ordinal street is not a house number');
});

test('the shipped overrides strip the door from the real snapshot at build time', () => {
  const before = full.events.find(e => e.id === JETTISON);
  assert.match(before.address, DOOR, 'the crawl publishes the full address');
  const after = slimFeed({ fetchedAt: full.fetchedAt, events: [before] }).events[0];
  assert.doesNotMatch(after.address, DOOR);
  assert.equal(after.address, 'Jeff Adachi Way');
  assert.equal(after.mapUrl, undefined);
});
