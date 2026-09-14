// Reconcile the current archive against the previous snapshot. A refresh that
// only re-read the calendar listing (title, host, start, image, status,
// neighborhood, url) must not lose facts a detail page already gave us, and
// must not replace a poster a hosted player can load with one nobody can.
// Every reading kept over the newer one is written to the event's
// sourceConflicts, so the archive still says which reading won and why.
//
//   node scripts/reconcile-snapshot.mjs <previous-snapshot.json> [--data <dir>]
//
// Rules (an event matches by calendarId, then id):
//   image   a URL on a host without the CORS header never replaces one on a
//           host with it (feed-slim.mjs, CORS_POSTER_ORIGINS)
//   status  the listing knows only open and closed; its "open" does not
//           overturn a detail page's approval or waitlist. Its "closed" does.
//   detail  an event whose registration link moved loses its detail match; if
//           the previous snapshot had read that page, its detail fields return
//           with their own provenance (the listing carries none of them)
import { readFile, writeFile } from 'node:fs/promises';
import { readFeedText, writeArchiveParts, corsPoster, posterOriginReport } from '../feed-slim.mjs';

const args = process.argv.slice(2);
const previousFile = args.find(a => !a.startsWith('--'));
const dataFlag = args.indexOf('--data');
if (!previousFile) throw new Error('usage: node scripts/reconcile-snapshot.mjs <previous-snapshot.json> [--data <dir>]');
const dataDir = dataFlag >= 0 ? new URL(args[dataFlag + 1].replace(/\/?$/, '/'), `file://${process.cwd()}/`) : new URL('../data/', import.meta.url);
const base = 'tech-week-enriched';

const previous = JSON.parse(await readFile(previousFile, 'utf8'));
const feed = JSON.parse((await readFeedText(dataDir, base)).text);
const key = e => e.calendarId || e.id;
const before = new Map(previous.events.map(e => [key(e), e]));
const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);

// What a detail page contributes and the listing never does.
const DETAIL_FIELDS = ['description', 'descriptionKind', 'end', 'tags', 'rsvp', 'capacity', 'remainingCapacity', 'cohosts', 'speakers',
  'category', 'categoryMethod', 'detailFetchedAt', 'sourceUpdatedAt', 'venue', 'address', 'mapUrl', 'lat', 'lng', 'geocodeMatch',
  'locationVisibility', 'imageUsage', 'registrationAccess'];
const FINER = new Set(['approval', 'waitlist']);

const conflict = (ev, record) => {
  ev.sourceConflicts = (ev.sourceConflicts || []).filter(c => c.field !== record.field);
  ev.sourceConflicts.push(record);
};
const carrySource = (ev, prev, field) => { if (prev.fieldSources?.[field]) (ev.fieldSources ||= {})[field] = prev.fieldSources[field]; };

let posters = 0, statuses = 0, details = 0, detailFields = 0;
for (const ev of feed.events) {
  const prev = before.get(key(ev));
  if (!prev) continue;

  if (!empty(ev.image) && !corsPoster(ev.image) && corsPoster(prev.image)) {
    conflict(ev, { field: 'image', calendar: ev.image, detail: prev.image, selected: 'detail',
      reason: 'the calendar host sends no CORS header, so a hosted player can only load the poster the detail page gave' });
    ev.image = prev.image; carrySource(ev, prev, 'image'); posters += 1;
  }

  if (ev.status === 'open' && FINER.has(prev.status) && /calendar/i.test(ev.fieldSources?.status?.method || '')) {
    conflict(ev, { field: 'status', calendar: 'open', detail: prev.status, selected: 'detail',
      reason: 'the calendar listing distinguishes only open from closed; its open does not overturn the detail page reading' });
    ev.status = prev.status; carrySource(ev, prev, 'status'); statuses += 1;
  }

  if (empty(ev.detailFetchedAt) && !empty(prev.detailFetchedAt)) {
    let restored = 0;
    for (const field of DETAIL_FIELDS) {
      if (!empty(ev[field]) || empty(prev[field])) continue;
      ev[field] = prev[field]; carrySource(ev, prev, field); restored += 1;
    }
    if (restored) {
      conflict(ev, { field: 'detail', calendar: ev.url, detail: prev.url, selected: 'detail',
        reason: 'the registration link moved; the detail page read under the previous link still describes this calendar entry' });
      details += 1; detailFields += restored;
    }
  }
}

// Keep the coverage block honest about what the archive now carries. A literal
// "unknown" is the crawl saying it could not read the field, not a value.
const sourced = v => !empty(v) && v !== 'unknown';
const counts = feed.coverage?.fieldCounts;
if (counts) for (const field of Object.keys(counts)) counts[field] = feed.events.filter(e => sourced(e[field])).length;
if (feed.coverage && 'detailPages' in feed.coverage) feed.coverage.detailPages = feed.events.filter(e => !empty(e.detailFetchedAt)).length;
feed.reconciled = { at: new Date().toISOString(), against: previous.fetchedAt, posters, statuses, details, detailFields };

// The saved coverage report repeats those counts; refresh the rows it has.
try {
  const reportUrl = new URL('tech-week-coverage.md', dataDir);
  let report = await readFile(reportUrl, 'utf8');
  if (counts) for (const [field, n] of Object.entries(counts)) report = report.replace(new RegExp(`^\\| ${field} \\| \\d+ / (\\d+) \\|$`, 'm'), `| ${field} | ${n} / $1 |`);
  if (feed.coverage?.detailPages != null) report = report.replace(/(\d+) successfully read detail pages/, `${feed.coverage.detailPages} successfully read detail pages`);
  await writeFile(reportUrl, report);
} catch (error) { if (error.code !== 'ENOENT') throw error; }

const written = await writeArchiveParts(dataDir, base, feed);
const report = posterOriginReport(feed.events);
console.log(`reconciled against ${previous.fetchedAt}: ${posters} posters kept, ${statuses} statuses kept, ${details} events regained ${detailFields} detail fields; ` +
  `${report.withImage - report.blocked} of ${report.withImage} posters load in the hosted page; ${written.parts} archive parts`);
