import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Run the real location helpers out of events-sync.js. They decide where an
// event stands in the city, and a wrong answer there is not a cosmetic bug:
// it moves a party across the planet and drags the world's own bounds with it.
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('events-sync.js', root), 'utf8');

const context = {
  window: {}, URL, fetch: async () => { throw new Error('no network in this test'); },
  setTimeout, clearTimeout, AbortSignal: { timeout: () => undefined },
  console: { warn() {}, error() {} },
  document: { getElementById: () => ({ dataset: {} }) },
};
runInNewContext(`${source.replace('export function mergePublicFeeds', 'function mergePublicFeeds')
  .replaceAll('import.meta.url', JSON.stringify(String(new URL('events-sync.js', root))))}
  globalThis.api = { getCoordsFromText, inferCoords, enrichWithFallbackCoordinates, inTheBayArea, dropDistantListings };`,
context, { filename: 'events-sync.js' });
const { getCoordsFromText, inferCoords, enrichWithFallbackCoordinates, inTheBayArea, dropDistantListings } = context.api;

test('a house number is not a latitude', () => {
  // Both the separator and the decimal point used to be optional, so the
  // street number in "300 Grant St" read as 30, 0 — a point in the Gulf of
  // Guinea — and "735 Montgomery St" as 73, 5, in the Norwegian Sea.
  for (const text of ['Hanwha AI Center, 300 Grant St', '735 Montgomery St, San Francisco, CA 94111',
    '300 Grant Ave', '2128 Folsom St, San Francisco, CA 94110', 'Pier 39', 'Suite 200, 101 Main']) {
    assert.equal(getCoordsFromText(text), null, `${text} carries no coordinate`);
  }
});

test('a written-out coordinate pair is still read', () => {
  // Spread: the helpers return objects from the vm realm, whose prototype is
  // not this realm's Object.prototype.
  assert.deepEqual({ ...getCoordsFromText('37.7749, -122.4194') }, { lat: 37.7749, lng: -122.4194, source: 'text' });
  assert.deepEqual({ ...getCoordsFromText('37.7749,-122.4194') }, { lat: 37.7749, lng: -122.4194, source: 'text' });
  assert.equal(getCoordsFromText('120.5, 200.5'), null, 'outside the globe is not a coordinate');
});

test('an address without coordinates falls back to its district, not to its street number', () => {
  const [event] = enrichWithFallbackCoordinates([
    { id: 'a', title: 'Demo', address: '735 Montgomery St, San Francisco, CA 94111', neighborhood: 'Jackson Square' },
  ]);
  assert.equal(event.approxLocation, true, 'a district centroid is an approximation');
  assert.ok(event.lat > 37.7 && event.lat < 37.84, `latitude ${event.lat} is in San Francisco`);
  assert.ok(event.lng > -122.53 && event.lng < -122.34, `longitude ${event.lng} is in San Francisco`);
});

test("an event's own coordinates are kept as exact", () => {
  const found = inferCoords({ lat: 37.7866671, lng: -122.40505, address: '760 Market St' });
  assert.deepEqual({ ...found }, { lat: 37.7866671, lng: -122.40505, source: 'event-field' });
});

test('the calendar lists the Bay Area, and says so when it drops something', () => {
  const sf = { id: 'sf', title: 'In the city', lat: 37.7749, lng: -122.4194 };
  const paloAlto = { id: 'pa', title: 'Down the peninsula', lat: 37.4419, lng: -122.143 };
  const berkeley = { id: 'bk', title: 'Across the bay', lat: 37.8715, lng: -122.273 };
  const newYork = { id: 'ny', title: 'A different Tech Week', lat: 40.7027153, lng: -74.0107265 };
  const noCoords = { id: 'tbd', title: 'Venue to be announced' };

  for (const event of [sf, paloAlto, berkeley, noCoords]) {
    assert.equal(inTheBayArea(event), true, `${event.id} belongs to this calendar`);
  }
  assert.equal(inTheBayArea(newYork), false, 'a New York address is not an SF Tech Week venue');

  const warnings = [];
  const listed = runInNewContext('drop(events)', {
    drop: dropDistantListings, events: [sf, paloAlto, berkeley, newYork, noCoords],
    console: { warn: (...args) => warnings.push(args) },
  });
  assert.deepEqual(Array.from(listed, event => event.id), ['sf', 'pa', 'bk', 'tbd']);
});
