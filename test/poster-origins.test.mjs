import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { CORS_POSTER_ORIGINS, corsPoster, assertPosterOrigins, posterOriginReport, writeArchiveParts, readFeedText, ARCHIVE_PART_BYTES } from '../feed-slim.mjs';

const root = new URL('../', import.meta.url);
const run = promisify(execFile);
const IMGIX = 'https://partiful.imgix.net/external/user/a/b?w=500', CDN = 'https://cdn.tech-week.com/events/x/y-800.webp';
const feedOf = (events, fetchedAt = '2026-09-11T09:00:00.000Z') => ({ fetchedAt, coverage: { complete: true }, events });

test('the runtime merge and the build share one list of CORS-capable poster hosts', async () => {
  const source = await readFile(new URL('events-sync.js', root), 'utf8');
  const match = source.match(/const coverCorsOrigins = new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'events-sync.js declares coverCorsOrigins');
  const runtime = match[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  assert.deepEqual(runtime, [...CORS_POSTER_ORIGINS].sort());
  assert.equal(corsPoster(IMGIX), true);
  assert.equal(corsPoster(CDN), false);
  assert.equal(corsPoster('not a url'), false);
});

test('the build refuses a feed whose posters mostly sit on hosts without the CORS header', () => {
  const fine = feedOf([...Array(95)].map((_, i) => ({ id: `a${i}`, image: IMGIX })).concat([...Array(5)].map((_, i) => ({ id: `b${i}`, image: CDN }))));
  const report = assertPosterOrigins(fine);
  assert.equal(report.blocked, 5);
  assert.equal(report.withImage, 100);
  const moved = feedOf([...Array(98)].map((_, i) => ({ id: `a${i}`, image: CDN })).concat([{ id: 'x', image: IMGIX }, { id: 'y' }]));
  assert.throws(() => assertPosterOrigins(moved), /Poster origins changed: 98 of 99 posters \(99\.0%\).*cdn\.tech-week\.com ×98/);
  assert.equal(posterOriginReport(moved.events).byOrigin['https://cdn.tech-week.com'], 98);
});

function loadMerge() {
  const source = readFileSyncText(new URL('events-sync.js', root));
  const window = { __SF_HOST_READY__: Promise.resolve() };
  const context = { window, URL, Date, fetch: async () => ({ ok: false, status: 404, text: async () => '', json: async () => { throw new Error('none'); } }),
    setTimeout: () => 0, clearTimeout: () => {}, AbortSignal: { timeout: () => new AbortController().signal },
    console: { warn() {}, error() {} }, document: { getElementById: () => ({ dataset: {} }) } };
  runInNewContext(source.replace('export function mergePublicFeeds', 'function mergePublicFeeds').replaceAll('import.meta.url', '"https://example.test/events-sync.js"')
    + '\n;globalThis.__merge = mergePublicFeeds;', context, { filename: 'events-sync.js' });
  return context.__merge;
}
import { readFileSync } from 'node:fs';
const readFileSyncText = url => readFileSync(url, 'utf8');

test('a newer feed cannot replace a loadable poster with one on a host without the header', () => {
  const merge = loadMerge();
  const older = feedOf([{ id: 'e1', title: 'Old title', image: IMGIX, fieldSources: { image: { url: 'https://partiful.com/e/1', method: 'public Partiful event details' } } }], '2026-09-11T09:00:00.000Z');
  const newer = feedOf([{ id: 'e1', title: 'New title', image: CDN, fieldSources: { image: { url: 'https://www.tech-week.com/calendar/sf', method: 'official public paginated calendar' } } }], '2026-09-14T08:00:00.000Z');
  const merged = merge(older, newer).events[0];
  assert.equal(merged.title, 'New title', 'other fields still follow the newer reading');
  assert.equal(merged.image, IMGIX);
  assert.equal(merged.fieldSources.image.method, 'public Partiful event details', 'provenance stays with the kept URL');
  // The other direction is an upgrade and goes through.
  const upgraded = merge(feedOf([{ id: 'e1', image: CDN }]), feedOf([{ id: 'e1', image: IMGIX }], '2026-09-14T08:00:00.000Z')).events[0];
  assert.equal(upgraded.image, IMGIX);
  // The same holds when the newer feed is partial and patches the older one.
  const partial = merge(older, { ...newer, coverage: { complete: false } }).events[0];
  assert.equal(partial.image, IMGIX); assert.equal(partial.title, 'New title');
  // No previous poster at all: the new one is taken, header or not.
  assert.equal(merge(feedOf([{ id: 'e1' }]), feedOf([{ id: 'e1', image: CDN }], '2026-09-14T08:00:00.000Z')).events[0].image, CDN);
});

test('archive parts round-trip byte-exactly under the per-file limit', async t => {
  const dir = new URL(`file://${await mkdtemp(join(tmpdir(), 'archive-'))}/`);
  const feed = feedOf([...Array(2000)].map((_, i) => ({ id: `e${i}`, title: `活动 ${i} 🎈`, description: 'x'.repeat(2000), image: IMGIX })));
  const written = await writeArchiveParts(dir, 'tech-week-enriched', feed);
  assert.ok(written.parts >= 2, 'a 4 MB feed needs more than one part');
  const { text, manifest } = await readFeedText(dir, 'tech-week-enriched');
  assert.equal(text, JSON.stringify(feed));
  assert.equal(manifest.events, 2000);
  assert.equal(manifest.bytes, Buffer.byteLength(text));
  for (const name of manifest.parts) assert.ok(Buffer.byteLength(await readFile(new URL(name, dir), 'utf8')) <= ARCHIVE_PART_BYTES);
});

test('reconcile-snapshot keeps loadable posters, finer statuses and moved-link details, and records each in sourceConflicts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reconcile-'));
  const dirUrl = new URL(`file://${dir}/`);
  const calendar = { url: 'https://www.tech-week.com/calendar/sf', method: 'official public paginated calendar', fetchedAt: '2026-09-14T08:13:24.769Z' };
  const detail = { url: 'https://partiful.com/e/one', method: 'public Partiful event details', fetchedAt: '2026-09-11T09:08:19.919Z' };
  const previous = feedOf([
    { id: 'one', calendarId: 'c1', title: 'One', image: IMGIX, status: 'approval', url: 'https://partiful.com/e/one', detailFetchedAt: detail.fetchedAt, description: 'A talk', end: '2026-10-06T03:00:00.000Z', tags: ['AI'],
      fieldSources: { image: detail, status: detail, description: detail, end: detail, tags: detail } },
    { id: 'two', calendarId: 'c2', title: 'Two', image: IMGIX, status: 'open', url: 'https://partiful.com/e/two', fieldSources: { image: detail } },
    { id: 'three', calendarId: 'c3', title: 'Three', image: IMGIX, status: 'approval', fieldSources: { image: detail, status: detail } },
  ]);
  const current = feedOf([
    // moved registration link: the detail match is gone, the poster moved to the CDN, the listing says open
    { id: 'one', calendarId: 'c1', title: 'One (renamed)', image: CDN, status: 'open', url: 'https://www.tech-week.com/go/event/abc', calendarRegistrationStatus: 'open',
      fieldSources: { image: calendar, status: calendar, title: calendar }, sourceConflicts: [{ field: 'status', calendar: 'open', detail: 'approval', selected: 'calendar', reason: 'most recent reading' }] },
    // the listing closed registration: that is a real change and wins
    { id: 'two', calendarId: 'c2', title: 'Two', image: CDN, status: 'closed', url: 'https://partiful.com/e/two', fieldSources: { image: calendar, status: calendar } },
    // a detail page re-read said open with a finer method: not the listing, so it stands
    { id: 'three', calendarId: 'c3', title: 'Three', image: IMGIX, status: 'open', fieldSources: { image: detail, status: { ...detail, method: 'public event registration configuration' } } },
    { id: 'new', calendarId: 'c9', title: 'Brand new', image: CDN, status: 'unknown', fieldSources: { image: calendar } },
  ], '2026-09-14T08:13:41.733Z');
  current.coverage = { complete: true, detailPages: 0, fieldCounts: { description: 0, end: 0, tags: 0, image: 4, status: 4 } };
  await writeArchiveParts(dirUrl, 'tech-week-enriched', current);
  await writeFile(join(dir, 'previous.json'), JSON.stringify(previous));
  await writeFile(join(dir, 'tech-week-coverage.md'), '4 unique events; 0 successfully read detail pages.\n\n| description | 0 / 4 |\n| end | 0 / 4 |\n| image | 4 / 4 |\n');

  const { stdout } = await run(process.execPath, [new URL('scripts/reconcile-snapshot.mjs', root).pathname, join(dir, 'previous.json'), '--data', dir]);
  assert.match(stdout, /2 posters kept, 1 statuses kept, 1 events regained 4 detail fields; 3 of 4 posters load/);

  const after = JSON.parse((await readFeedText(dirUrl, 'tech-week-enriched')).text);
  const [one, two, three, brandNew] = after.events;
  assert.equal(one.image, IMGIX); assert.equal(one.fieldSources.image.method, detail.method);
  assert.equal(one.status, 'approval'); assert.equal(one.fieldSources.status.method, detail.method);
  assert.equal(one.calendarRegistrationStatus, 'open', 'the listing reading itself is kept in its own field');
  assert.equal(one.title, 'One (renamed)', 'listing fields still follow the newer reading');
  assert.equal(one.url, 'https://www.tech-week.com/go/event/abc');
  assert.equal(one.description, 'A talk'); assert.equal(one.end, '2026-10-06T03:00:00.000Z'); assert.deepEqual(one.tags, ['AI']);
  assert.equal(one.detailFetchedAt, detail.fetchedAt);
  assert.deepEqual(one.sourceConflicts.map(c => [c.field, c.selected]), [['image', 'detail'], ['status', 'detail'], ['detail', 'detail']]);
  assert.equal(two.image, IMGIX); assert.equal(two.status, 'closed', 'closed from the listing is a real change');
  assert.equal(three.status, 'open', 'a finer re-read of the detail page is not overturned');
  assert.equal(brandNew.image, CDN, 'no previous poster: nothing to keep');
  assert.deepEqual(after.coverage.fieldCounts, { description: 1, end: 1, tags: 1, image: 4, status: 3 }, 'a literal unknown is not a sourced status');
  assert.equal(after.coverage.detailPages, 1);
  assert.equal(after.reconciled.against, previous.fetchedAt);
  const report = await readFile(join(dir, 'tech-week-coverage.md'), 'utf8');
  assert.match(report, /1 successfully read detail pages/);
  assert.match(report, /\| description \| 1 \/ 4 \|/);
  assert.match(report, /\| image \| 4 \/ 4 \|/);
});
