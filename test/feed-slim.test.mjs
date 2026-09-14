import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { FEED_PART_BYTES, splitUtf8, slimFeed, readFeedText, slimFeedParts } from '../feed-slim.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const data = new URL('../data/', import.meta.url), base = 'tech-week-enriched';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sf-feed-parts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return pathToFileURL(directory + '/');
}

test('UTF-8 chunks obey byte limits at every Chinese and emoji boundary without changing text', () => {
  const text = 'A街道🕊️ San Francisco café 汉字 🙂𠮷'.repeat(40);
  for (const limit of [4, 5, 7, 13, 64]) {
    const chunks = splitUtf8(text, limit);
    assert.equal(chunks.join(''), text);
    for (const chunk of chunks) {
      const bytes = Buffer.from(chunk);
      assert.ok(bytes.length > 0 && bytes.length <= limit);
      assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes), chunk);
    }
  }
  const boundary = 'a'.repeat(FEED_PART_BYTES - 1) + '🕊中文';
  assert.equal(splitUtf8(boundary).join(''), boundary);
  assert.equal(Buffer.byteLength(splitUtf8(boundary)[0]), FEED_PART_BYTES - 1);
  assert.throws(() => splitUtf8(text, 3), /at least four bytes/);
})

test('the real event snapshot becomes eight bounded parts with the exact existing slim payload', async t => {
  const directory = await fixture(t);
  const originalManifest = await readFile(new URL(`${base}.parts.json`, data));
  const manifest = JSON.parse(originalManifest);
  const originals = new Map(await Promise.all(manifest.parts.map(async name => [name, await readFile(new URL(name, data))])));
  for (const name of [`${base}.parts.json`, ...manifest.parts]) await cp(new URL(name, data), new URL(name, directory));
  const original = (await readFeedText(data, base)).text;
  const expected = JSON.stringify(slimFeed(JSON.parse(original)));
  const result = await slimFeedParts(directory, base);
  const built = JSON.parse(await readFile(new URL(`${base}.parts.json`, directory), 'utf8'));
  assert.equal(result.parts, 8);
  assert.equal(built.parts.length, 8);
  assert.equal(result.before, Buffer.byteLength(original));
  assert.equal(result.after, Buffer.byteLength(expected));
  const buffers = await Promise.all(built.parts.map(name => readFile(new URL(name, directory))));
  for (const bytes of buffers) {
    assert.ok(bytes.length <= FEED_PART_BYTES);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  assert.equal(Buffer.concat(buffers).toString('utf8'), expected);
  assert.equal(built.bytes, Buffer.byteLength(expected));
  assert.equal(built.sha256, digest(expected));
  assert.equal(built.events, JSON.parse(expected).events.length);
  assert.equal((await readFeedText(directory, base)).text, expected);
  assert.deepEqual(await readFile(new URL(`${base}.parts.json`, data)), originalManifest);
  for (const [name, bytes] of originals) assert.deepEqual(await readFile(new URL(name, data)), bytes);
})

test('a large single-file feed is converted without retaining a stale full-file fallback', async t => {
  const directory = await fixture(t);
  const feed = { fetchedAt: '2026-09-10', events: [{ id: 'one', description: '活动🕊'.repeat(35000), rsvp: 0 }] };
  await writeFile(new URL('events.json', directory), JSON.stringify(feed));
  const result = await slimFeedParts(directory, 'events');
  assert.ok(result.parts > 1);
  assert.equal((await readdir(directory)).includes('events.json'), false);
  assert.equal((await readFeedText(directory, 'events')).text, JSON.stringify(slimFeed(feed)));
})

test('smaller rebuilds remove obsolete copied parts and retain all event values', async t => {
  const directory = await fixture(t), feed = { events: [{ id: 'zero', title: '零🕊', rsvp: 0, full: false }] };
  const names = ['events.part-000.json', 'events.part-001.json', 'events.part-002.json'];
  await writeFile(new URL(names[0], directory), JSON.stringify(feed));
  for (const name of names.slice(1)) await writeFile(new URL(name, directory), '');
  await writeFile(new URL('events.parts.json', directory), JSON.stringify({ parts: names, events: 999 }));
  await writeFile(new URL('events.json', directory), 'stale fallback');
  const result = await slimFeedParts(directory, 'events');
  assert.equal(result.parts, 1);
  assert.deepEqual((await readdir(directory)).sort(), ['events.part-000.json', 'events.parts.json']);
  const built = await readFeedText(directory, 'events');
  assert.equal(built.manifest.events, 1);
  assert.equal(built.text, JSON.stringify(slimFeed(feed)));
  assert.equal(JSON.parse(built.text).events[0].rsvp, 0);
  assert.equal(JSON.parse(built.text).events[0].full, false);
})

test('small single-file feeds remain a small single file', async t => {
  const directory = await fixture(t), feed = { events: [{ id: 'one', title: '社区活动' }] };
  await writeFile(new URL('events.json', directory), JSON.stringify(feed));
  const result = await slimFeedParts(directory, 'events');
  assert.equal(result.parts, 0);
  assert.deepEqual(await readdir(directory), ['events.json']);
  assert.equal((await readFeedText(directory, 'events')).text, JSON.stringify(slimFeed(feed)));
})
