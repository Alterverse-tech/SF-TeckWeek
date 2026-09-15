import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('events-sync.js', root), 'utf8');
const manifest = JSON.parse(await readFile(new URL('data/tech-week-enriched.parts.json', root), 'utf8'));
const fullText = (await Promise.all(manifest.parts.map(name => readFile(new URL(`data/${name}`, root), 'utf8')))).join('');
const full = JSON.parse(fullText);

// events-sync lists the Bay Area only: one saved listing carries a New York
// address, so the programme the game is handed is the saved feed minus any
// listing outside the region. Mirrors BAY_AREA in events-sync.js — if that
// window moves, these counts move with it and say so.
const inBayArea = (e) => e.lat == null || e.lng == null
  || !Number.isFinite(Number(e.lat)) || !Number.isFinite(Number(e.lng))
  || (Number(e.lat) > 36.9 && Number(e.lat) < 38.4 && Number(e.lng) > -123.2 && Number(e.lng) < -121.5);
const listed = full.events.filter(inBayArea);

const baseline = JSON.parse(await readFile(new URL('data/tech-week-first.json', root), 'utf8'));
const cut = Math.floor(fullText.length / 2);
const parts = [fullText.slice(0, cut), fullText.slice(cut)];
const partNames = ['tech-week-enriched.part-000.json', 'tech-week-enriched.part-001.json'];
const base = 'https://chrona.world/project-runtime/world/37/key/events-sync.js';
const seed = { events: [{ id: 'sample', title: 'Sample programme' }], citizens: [] };
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

function harness(route = () => undefined) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), calls = [], warnings = [], refreshes = [];
  const setTimeout = (fn, delay) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + delay, fn });
    return id;
  };
  const clearTimeout = id => timers.delete(id);
  const delayed = (value, delay, signal) => new Promise((resolve, reject) => {
    let timer;
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(value); };
    if (delay === 0) finish();
    else if (Number.isFinite(delay)) timer = setTimeout(finish, delay);
  });
  const defaults = name => {
    const part = partNames.indexOf(name);
    if (part >= 0) return { text: parts[part] };
    if (name === 'tech-week-enriched.parts.json') return { data: { parts: partNames, events: full.events.length } };
    if (name === 'tech-week-first.json') return { data: baseline };
    return { status: 404, text: 'Missing' };
  };
  const fetch = async (input, init = {}) => {
    const url = new URL(input, base), name = url.pathname.split('/').pop();
    const call = { url: url.href, name, init, at: now };
    calls.push(call);
    const number = calls.filter(item => item.name === name).length;
    const result = route(name, number, init) ?? defaults(name);
    const text = result.text ?? JSON.stringify(result.data);
    const status = result.status ?? 200;
    const response = {
      ok: status >= 200 && status < 300, status,
      text: () => delayed(text, result.bodyAfter ?? 0, init.signal),
      json: async () => JSON.parse(await delayed(text, result.bodyAfter ?? 0, init.signal)),
    };
    return delayed(response, result.after ?? 0, init.signal);
  };
  const badge = { dataset: {} };
  const window = { __SF_HOST_READY__: Promise.resolve() };
  class ClockDate extends Date { static now() { return 1_800_000_000_000 + now; } }
  const context = {
    window, URL, Date: ClockDate, fetch, setTimeout, clearTimeout,
    AbortSignal: { timeout(ms) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
      return controller.signal;
    } },
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
    document: { getElementById: () => badge },
  };
  // Only adapt module syntax; execute the production loading/merge lifecycle.
  runInNewContext(source.replace('export function mergePublicFeeds', 'function mergePublicFeeds')
    .replaceAll('import.meta.url', JSON.stringify(base)), context, { filename: 'events-sync.js' });
  const read = () => window.__sfEventFeed.read(seed);
  const ready = () => { window.TW = { state: { ready: true }, async refreshEvents() { refreshes.push(await read()); } }; };
  const advance = async ms => {
    await flush();
    const target = now + ms;
    for (let count = 0; count < 10000; count++) {
      const entry = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) { now = target; await flush(); return; }
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await flush();
    }
    throw new Error('Runaway timer loop');
  };
  return { read, ready, advance, calls, warnings, refreshes, count: name => calls.filter(call => call.name === name).length };
}

test('the saved baseline permits startup while a 45-second full snapshot loads, then upgrades after TW is ready', async () => {
  const h = harness(name => partNames.includes(name) ? { text: parts[partNames.indexOf(name)], bodyAfter: 45000 } : undefined);
  const initial = await h.read();
  assert.equal(initial.list.length, 48);
  assert.equal(initial.official, true);
  await h.advance(45000);
  assert.equal(h.refreshes.length, 0, 'background completion must not race TW.init');
  h.ready();
  await h.advance(250);
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.refreshes[0].list.length, listed.length);
  assert.deepEqual(Array.from(h.refreshes[0].list, item => item.id), listed.map(item => item.id));
  const again = await h.read();
  assert.equal(again.list.length, listed.length);
  for (const name of partNames) assert.equal(h.count(name), 1, 'completed versioned parts are reused');
  assert.ok(h.calls.filter(call => call.name.startsWith('tech-week')).every(call => call.init.cache === 'default'));
});

test('a failed part retries without restarting another still-downloading part', async () => {
  const h = harness((name, number) => {
    if (name === partNames[0]) return number === 1 ? { status: 503, text: 'Busy' } : { text: parts[0] };
    if (name === partNames[1]) return { text: parts[1], bodyAfter: 1500 };
  });
  h.ready();
  assert.equal((await h.read()).list.length, 48);
  await h.advance(1500);
  assert.equal(h.refreshes.at(-1).list.length, listed.length);
  assert.equal(h.count(partNames[0]), 2);
  assert.equal(h.count(partNames[1]), 1);
  assert.ok(h.warnings.some(args => String(args[1]).includes(`${partNames[0]}: Error: HTTP 503`)));
});

test('hanging parts have a bounded 90-second attempt, three attempts, and a later refresh can recover', async () => {
  const h = harness((name, number) => name === partNames[0] && number <= 3 ? { after: Infinity } : undefined);
  h.ready();
  assert.equal((await h.read()).list.length, 48, 'a stalled full download never delays initial readiness');
  await h.advance(89999);
  assert.equal(h.count(partNames[0]), 1);
  await h.advance(1 + 400);
  assert.equal(h.count(partNames[0]), 2);
  await h.advance(90000 + 800 + 90000);
  assert.equal(h.count(partNames[0]), 3);
  assert.equal(h.count(partNames[1]), 1, 'successful parts survive all failed attempts');
  assert.equal(h.refreshes.length, 0, 'a partial document never becomes a replacement feed');
  assert.ok(h.warnings.some(args => String(args[1]).includes('TimeoutError')));
  assert.ok(h.warnings.some(args => String(args[0]).includes('keeping the saved baseline')));
  await h.advance(60000);
  await h.read();
  await h.advance(0);
  assert.equal((await h.read()).list.length, listed.length);
  assert.equal(h.count(partNames[0]), 4);
});

test('a corrupt or incomplete 200 response is discarded as a whole and can be fetched again', async () => {
  const short = JSON.stringify({ fetchedAt: full.fetchedAt, events: full.events.slice(0, 1) });
  const h = harness((name, number) => {
    if (name === partNames[0] && number === 1) return { text: short };
    if (name === partNames[1] && number === 1) return { text: '' };
  });
  h.ready();
  assert.equal((await h.read()).list.length, 48);
  await h.advance(400);
  assert.equal(h.refreshes.at(-1).list.length, listed.length);
  for (const name of partNames) assert.equal(h.count(name), 2);
  assert.ok(h.warnings.some(args => String(args[1]).includes('Snapshot parts are incomplete')));
});

test('the older complete single-file snapshot remains a valid fallback', async () => {
  const h = harness(name => {
    if (name === 'tech-week-enriched.parts.json') return { status: 404, text: 'Missing' };
    if (name === 'tech-week-enriched.json') return { text: fullText };
  });
  h.ready();
  await h.read();
  await h.advance(0);
  assert.equal((await h.read()).list.length, listed.length);
  assert.equal(h.count('tech-week-enriched.json'), 1);
  assert.equal(h.count(partNames[0]), 0);
});

test('optional address enrichment neither delays startup nor discards approved data when unavailable later', async () => {
  const event = baseline.events[0];
  const h = harness((name, number) => {
    if (partNames.includes(name)) return { after: Infinity };
    if (name === 'addresses.json') return number === 1 ? { after: 5000, data: { addresses: [{ eventId: event.id, street: 'Market Street', lat: 37.79, lng: -122.4 }] } } : { status: 403, text: 'Unavailable' };
  });
  h.ready();
  const initial = await h.read();
  assert.equal(initial.list.length, 48);
  assert.equal(h.refreshes.length, 0);
  await h.advance(5000);
  const patched = h.refreshes.at(-1).list.find(item => item.id === event.id);
  assert.equal(patched.address, 'Market Street');
  assert.equal(patched.addressSource, 'community-approved');
  await h.advance(60000);
  const next = await h.read();
  assert.equal(next.list.find(item => item.id === event.id).address, 'Market Street');
});

test('unavailable saved files keep the existing seed fallback and a live public feed still works', async () => {
  const unavailable = name => name.startsWith('tech-week') ? { status: 404, text: 'Missing' } : undefined;
  const noFeeds = harness(unavailable);
  const sample = await noFeeds.read();
  assert.equal(sample.official, false);
  assert.equal(sample.list[0].id, 'sample');
  const live = harness(name => name === 'events.json' ? { data: baseline } : unavailable(name));
  const result = await live.read();
  assert.equal(result.official, true);
  assert.equal(result.list.length, 48);
});

test('an unreachable live updater never delays startup or causes a refresh request loop', async () => {
  const h = harness(name => name === 'events.json' || name === 'addresses.json' || partNames.includes(name) ? { after: Infinity } : undefined);
  h.ready();
  const initial = await h.read();
  assert.equal(initial.list.length, 48);
  assert.equal(h.count('events.json'), 1);
  await h.read();
  assert.equal(h.count('events.json'), 1, 'overlapping reads share the live request');
  await h.advance(6000);
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.count('events.json'), 1, 'the error refresh uses the cached response');
  await h.advance(60000);
  assert.equal((await h.read()).list.length, 48);
  await h.advance(6000);
  assert.equal(h.count('events.json'), 2);
  assert.equal(h.refreshes.length, 1, 'the same unavailable response does not refresh again');
});

test('a complete live feed survives later updater failures while static parts are still pending', async () => {
  const h = harness((name, number) => {
    if (partNames.includes(name)) return { after: Infinity };
    if (name === 'events.json') return number === 1 ? { data: full, after: 1000 } : { status: 503, text: 'Unavailable' };
  });
  h.ready();
  assert.equal((await h.read()).list.length, 48);
  await h.advance(1000);
  assert.equal(h.refreshes.at(-1).list.length, listed.length);
  await h.advance(60000);
  assert.equal((await h.read()).list.length, listed.length);
  await h.advance(0);
  assert.equal(h.refreshes.at(-1).list.length, listed.length);
  assert.equal(h.count('events.json'), 2);
  assert.equal(h.count(partNames[0]), 1);
});

test('a newer partial live update and then an older response preserve the newest complete programme', async () => {
  const id = full.events[0].id;
  const partial = { fetchedAt: new Date(Date.parse(full.fetchedAt) + 60000).toISOString(), coverage: { complete: false },
    events: [{ ...full.events[0], title: 'Updated public title' }] };
  const h = harness((name, number) => {
    if (partNames.includes(name)) return { after: Infinity };
    if (name === 'events.json') return { data: number === 1 ? full : number === 2 ? partial : baseline };
  });
  h.ready();
  assert.equal((await h.read()).list.length, listed.length);
  await h.advance(60000);
  await h.read();
  await h.advance(0);
  assert.equal(h.refreshes.at(-1).list.length, listed.length);
  assert.equal(h.refreshes.at(-1).list.find(event => event.id === id).title, 'Updated public title');
  await h.advance(60000);
  await h.read();
  await h.advance(0);
  const final = await h.read();
  assert.equal(final.list.length, listed.length);
  assert.equal(final.list.find(event => event.id === id).title, 'Updated public title');
});

test('withdrawing approved enrichment restores the saved public address without mutating the full feed', async () => {
  const event = full.events.find(item => typeof item.address === 'string' && item.address !== 'Market Street');
  assert.ok(event, 'the real archive supplies an address to restore');
  const h = harness((name, number) => name === 'addresses.json' ? { data: { addresses: number === 1
    ? [{ eventId: event.id, street: 'Market Street', lat: 37.79, lng: -122.4 }] : [] } } : undefined);
  h.ready();
  await h.read();
  await h.advance(0);
  assert.equal((await h.read()).list.find(item => item.id === event.id).address, 'Market Street');
  await h.advance(60000);
  await h.read();
  await h.advance(0);
  const restored = (await h.read()).list.find(item => item.id === event.id);
  assert.equal(restored.address, event.address);
  assert.equal(restored.addressSource, event.addressSource);
  for (const name of partNames) assert.equal(h.count(name), 1);
});
