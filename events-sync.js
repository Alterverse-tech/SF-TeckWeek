let lastGood = null;
const coverCache = new Map(), coverQueue = [];
let activeCovers = 0;
const coverOrigins = new Set(['https://partiful.imgix.net','https://partiful-posters.imgix.net','https://cdn.tech-week.com','https://firebasestorage.googleapis.com']);
function coverUrl(source) {
  if(!coverOrigins.has(new URL(source).origin))return Promise.reject(new Error('Unsupported public cover origin'));
  if(coverCache.has(source))return coverCache.get(source);
  const promise=new Promise((resolve,reject)=>coverQueue.push({source,resolve,reject}));
  coverCache.set(source,promise); drainCovers(); return promise;
}
function drainCovers() {
  while(activeCovers<4 && coverQueue.length){
    const job=coverQueue.shift(); activeCovers++;
    (async()=>{
      const response=await fetch(job.source,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok || !response.headers.get('content-type')?.startsWith('image/'))throw new Error('Public cover unavailable');
      const blob=await response.blob();if(blob.size>8*1024*1024)throw new Error('Public cover exceeds size limit');
      return URL.createObjectURL(blob);
    })().then(job.resolve,job.reject).finally(()=>{activeCovers--;drainCovers();});
  }
}

const validFeed = data => data?.fetchedAt && Array.isArray(data.events) && data.events.length;
const eventKey = e => e.url?.match(/^https:\/\/partiful\.com\/e\/([\w-]+)/)?.[1] || e.id;

export function mergePublicFeeds(saved, cache) {
  if (!validFeed(saved)) return validFeed(cache) ? cache : null;
  if (!validFeed(cache)) return saved;
  const [older, newer] = [saved, cache].sort((a,b) => Date.parse(a.fetchedAt)-Date.parse(b.fetchedAt));
  // A partial refresh must not erase events absent from that partial response.
  const map = new Map((newer.coverage?.complete ? [] : older.events).map(e => [eventKey(e), e]));
  // Enrichment can add a Partiful URL to an existing calendar ID. Match that
  // ID too, so moving from the baseline to richer data cannot duplicate it.
  const ids = new Map([...map].filter(([, event]) => event.id != null).map(([key, event]) => [event.id, key]));
  for (const event of newer.events) {
    const key = eventKey(event), previousKey = map.has(key) ? key : ids.get(event.id), previous = map.get(previousKey);
    if (!previous) { map.set(key,event); if (event.id != null) ids.set(event.id, key); continue; }
    const patch = Object.fromEntries(Object.entries(event).filter(([field,value]) =>
      event.fieldSources?.[field] || (value != null && value !== '' && value !== 'unknown' && (!Array.isArray(value) || value.length))));
    if (previousKey !== key) map.delete(previousKey);
    map.set(key, {...previous,...patch,id:previous.id,fieldSources:{...previous.fieldSources,...event.fieldSources}});
    if (previous.id != null) ids.set(previous.id, key);
    if (event.id != null) ids.set(event.id, key);
  }
  const events = [...map.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  return {...newer,events,publicSnapshot:true,coverage:{...newer.coverage,events:events.length,complete:newer.coverage?.complete===true}};
}

async function readJson(url) {
  const response = await fetch(url, {cache:'no-store',signal:AbortSignal.timeout(6000)});
  if(!response.ok) throw new Error(`Calendar HTTP ${response.status}`);
  return response.json();
}

// These URLs belong to this published game revision. Keep completed (and
// in-flight) parts when another part retries, and let the browser reuse them.
// Geometry downloads share the connection, so a part gets 90 seconds; this
// background download never holds up the initial saved programme below.
const savedTexts = new Map();
function readSavedText(url, timeout = 90000) {
  const key = url.href;
  if (savedTexts.has(key)) return savedTexts.get(key);
  const request = (async () => {
    try {
      const response = await fetch(url, { cache: 'default', signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      throw new Error(`Saved feed ${url.pathname.split('/').pop()}: ${error.name}: ${error.message}`);
    }
  })();
  savedTexts.set(key, request);
  request.catch(() => { if (savedTexts.get(key) === request) savedTexts.delete(key); });
  return request;
}
async function readSavedJson(url, timeout) {
  const text = await readSavedText(url, timeout);
  try { return JSON.parse(text); }
  catch (error) { savedTexts.delete(url.href); throw error; }
}
async function readBaseline() {
  try {
    const data = await readSavedJson(new URL('./data/tech-week-first.json', import.meta.url), 6000);
    return validFeed(data) ? data : null;
  } catch { return null; }
}

// A snapshot too large for the host's per-file limit ships as ordered raw text
// parts. Join them back into the one document; an incomplete set is an error,
// never a smaller snapshot.
async function readParts(base) {
  const manifest = await readSavedJson(new URL(`./data/${base}.parts.json`, import.meta.url));
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('Snapshot part manifest is empty');
  const urls = manifest.parts.map(name => {
    if (!/^[\w.-]+$/.test(name)) throw new Error('Unexpected snapshot part name');
    return new URL('./data/' + name, import.meta.url);
  });
  const texts = await Promise.all(urls.map(url => readSavedText(url)));
  try {
    const data = JSON.parse(texts.join(''));
    if (manifest.events != null && data.events?.length !== manifest.events) throw new Error('Snapshot parts are incomplete');
    return data;
  } catch (error) {
    // A successful HTTP response can still have a truncated/corrupt body.
    // Refetch that set rather than retaining a permanently broken document.
    for (const url of urls) savedTexts.delete(url.href);
    throw error;
  }
}

// Retry the full programme in the background while the smaller saved baseline
// makes the city usable. Only a complete document can replace that baseline.
async function readSaved() {
  const load = async (file) => {
    const data = await readSavedJson(new URL('./data/' + file, import.meta.url));
    return validFeed(data) ? data : null;
  };
  const full = async () => {
    // Parts are the current on-disk form; the single file is the older one.
    try { const data = await readParts('tech-week-enriched'); if (validFeed(data)) return data; }
    catch (error) { console.warn('[events] full snapshot attempt failed', error); }
    return load('tech-week-enriched.json');
  };
  for (const attempt of [0, 1, 2]) {
    try { const data = await full(); if (data) return data; } catch { /* retry below */ }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  console.warn('[events] the full snapshot did not load; keeping the saved baseline until the next refresh');
  return null;
}

let fullSaved = null, fullRequest = null, savedRetryAt = 0, initialReadDelivered = false;
let refreshTimer = null;
function refreshWhenReady() {
  if (!initialReadDelivered || refreshTimer !== null) return;
  const until = Date.now() + 90000;
  const refresh = () => {
    refreshTimer = null;
    if (window.TW?.state?.ready && typeof window.TW.refreshEvents === 'function') {
      Promise.resolve().then(() => window.TW.refreshEvents()).catch(error => console.warn('[events] refresh failed', error));
    } else if (Date.now() < until) refreshTimer = setTimeout(refresh, 250);
    // The game's existing 60-second refresh also picks up the completed feed.
  };
  refreshTimer = setTimeout(refresh, 0);
}
function readFullInBackground() {
  if (fullSaved || Date.now() < savedRetryAt) return Promise.resolve(fullSaved);
  if (fullRequest) return fullRequest;
  fullRequest = readSaved().then(data => {
    if (validFeed(data)) { fullSaved = data; refreshWhenReady(); }
    else savedRetryAt = Date.now() + 60000;
    return fullSaved;
  }).finally(() => { fullRequest = null; });
  return fullRequest;
}

let liveCache = null, liveRequest = null, liveCheckedAt = -Infinity, liveSignature = '';
function readLiveInBackground() {
  if (liveRequest || Date.now() - liveCheckedAt < 60000) return;
  liveRequest = readJson(window.__SF_HOST_READY__ ? 'https://chrona.world/integrations/city-in-ink/events.json' : '/events.json')
    .catch(() => ({ status: 'unavailable', error: 'Calendar updater is unreachable; using saved public data.' }))
    .then(data => {
      liveCache = data && typeof data === 'object' ? data : { status: 'unavailable' };
      const signature = JSON.stringify(liveCache);
      const changed = signature !== liveSignature;
      liveSignature = signature;
      liveCheckedAt = Date.now();
      if (changed) refreshWhenReady();
    }).finally(() => { liveRequest = null; });
}

const NEIGHBORHOOD_HINTS = {
  'fidi': { lat: 37.7937, lng: -122.4008 },
  'financial district': { lat: 37.7937, lng: -122.4008 },
  'downtown': { lat: 37.79, lng: -122.4025 },
  'downtown sf': { lat: 37.79, lng: -122.4025 },
  'soma': { lat: 37.7838, lng: -122.4011 },
  'south of market': { lat: 37.7838, lng: -122.4011 },
  'mission': { lat: 37.7596, lng: -122.4148 },
  'mission bay': { lat: 37.7706, lng: -122.3912 },
  'dogpatch': { lat: 37.7590, lng: -122.3919 },
  'nob hill': { lat: 37.7930, lng: -122.4160 },
  'embarcadero': { lat: 37.7951, lng: -122.3935 },
  'jackson square': { lat: 37.7963, lng: -122.3991 },
  'hayes valley': { lat: 37.7767, lng: -122.4292 },
  'civic center': { lat: 37.7786, lng: -122.4156 },
  'golden gate park': { lat: 37.7690, lng: -122.4827 },
  'fi di': { lat: 37.7937, lng: -122.4008 },
  // The districts the city itself already names and places (NEIGHBORHOODS in
  // the game source), with its own coordinates. Without them an event in the
  // Marina or on Russian Hill had nothing to fall back to, so it went
  // unplaced — or worse, read its own street number as a latitude.
  'chinatown': { lat: 37.7941, lng: -122.4078 },
  'north beach': { lat: 37.8060, lng: -122.4103 },
  'russian hill': { lat: 37.8014, lng: -122.4189 },
  'marina': { lat: 37.8030, lng: -122.4360 },
  'presidio': { lat: 37.7989, lng: -122.4662 },
  'potrero hill': { lat: 37.7605, lng: -122.4005 },
  // The same hill, named for its lower slope on the public calendar.
  'lower nob hill': { lat: 37.7930, lng: -122.4161 },
  // Districts resolved by scripts/geocode-neighborhoods.mjs, which rewrites
  // everything between these two markers. Run it where the network allows;
  // the calendar names districts this file would otherwise have to guess.
  /* districts:start */
  /* districts:end */
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function stripNeighborhoodSuffix(value) {
  return normalizeText(value)
    .replace(/\([^\)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCoordsFromText(value) {
  if (!value) return null;
  // A coordinate pair written out looks like "37.7749, -122.4194": decimal
  // degrees, with a separator between them. Both used to be optional, so
  // "300 Grant St" parsed as 30 and 0 and "735 Montgomery St" as 73 and 5 —
  // house numbers read as latitudes, which planted San Francisco events
  // thousands of kilometres out to sea and stretched the city's bounds with
  // them. A house number is not a coordinate.
  const match = String(value).match(/(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)/);
  if (!match) return null;

  const lat = toNumber(match[1]);
  const lng = toNumber(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, source: 'text' };
}

function getCoordsFromNeighborhood(value) {
  if (!value) return null;

  const direct = NEIGHBORHOOD_HINTS[normalizeText(value)] || NEIGHBORHOOD_HINTS[stripNeighborhoodSuffix(value)];
  if (direct) return { ...direct, source: 'neighborhood' };

  const cleaned = stripNeighborhoodSuffix(value).replace(/\s*-\s*/g, ' ').trim();
  return NEIGHBORHOOD_HINTS[cleaned] ? { ...NEIGHBORHOOD_HINTS[cleaned], source: 'neighborhood' } : null;
}

function inferCoords(event) {
  const lat = toNumber(event?.lat ?? event?.latitude);
  const lng = toNumber(event?.lng ?? event?.lon ?? event?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, source: 'event-field' };
  }

  const fromText = getCoordsFromText(event?.locationText ?? event?.address ?? event?.venue ?? event?.neighborhood);
  if (fromText) return fromText;

  return getCoordsFromNeighborhood(event?.neighborhood ?? event?.venue ?? event?.address) || null;
}

function enrichWithFallbackCoordinates(events) {
  if (!Array.isArray(events)) return [];

  return events.map(event => {
    const source = inferCoords(event);
    if (!source) return event;

    const enriched = {
      ...event,
      lat: source.lat,
      lng: source.lng,
      // A neighbourhood centroid is a hint, not an address. The city layer
      // spreads these across the district and never pins them to a building.
      approxLocation: source.source !== 'event-field',
      __inferredLocation: true,
      __inferredLocationSource: source.source
    };

    if (!enriched.locationText && event.neighborhood) {
      enriched.locationText = event.neighborhood;
    }

    return enriched;
  });
}

function showStatus(data, live) {
  let badge = document.getElementById('tw-sync-status');
  if (!badge) {
    badge = document.createElement('div'); badge.id = 'tw-sync-status';
    badge.setAttribute('role', 'status');
    document.body.append(badge);
  }
  const next = data.nextAttemptAt ? new Date(data.nextAttemptAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null;
  badge.textContent = live
    ? `Public snapshot · ${data.events.length} events · ${data.coverage?.complete ? 'full calendar · partial details' : 'partial calendar'} · updater every 30 min`
    : `Sample events · official sync unavailable${next ? ' · retry ' + next : ''}`;
  badge.dataset.state = live ? (data.status || 'stale') : 'unavailable';
  badge.title = [data.error, data.fetchedAt ? `Snapshot saved: ${data.fetchedAt}. Individual fields retain their own source timestamps.` : 'No official data has been imported yet.'].filter(Boolean).join('\n');
}

// Addresses that a moderator approved in Discord (or in-world claims that were
// reviewed there). The service publishes approved entries only.
const ADDRESS_URL = window.__SF_HOST_READY__
  ? 'https://chrona.world/integrations/city-in-ink/addresses.json'
  : '/addresses.json';
let addressCache = { at: 0, list: [] }, addressRequest = null;
function readApprovedAddresses() {
  if (Date.now() - addressCache.at < 60000) return Promise.resolve(addressCache.list);
  if (addressRequest) return addressRequest;
  addressRequest = (async () => {
    try {
      const data = await readJson(ADDRESS_URL);
      const list = Array.isArray(data?.addresses) ? data.addresses : [];
      const changed = JSON.stringify(list) !== JSON.stringify(addressCache.list);
      addressCache = { at: Date.now(), list };
      if (changed) refreshWhenReady();
    } catch { addressCache = { at: Date.now(), list: addressCache.list }; }
    return addressCache.list;
  })().finally(() => { addressRequest = null; });
  return addressRequest;
}

// Venue supplements the project owner curates by hand (data/venue-overrides.json):
// building-level addresses with the door withheld, and listings the public
// crawl has not reached yet. Read like the approved addresses — in the
// background, never holding up readiness — and applied on every read().
const OVERRIDES_URL = new URL('./data/venue-overrides.json', import.meta.url);
let overrideCache = { at: 0, data: { addresses: [], events: [] } }, overrideRequest = null;
function readVenueOverrides() {
  if (Date.now() - overrideCache.at < 60000) return Promise.resolve(overrideCache.data);
  if (overrideRequest) return overrideRequest;
  overrideRequest = (async () => {
    try {
      const raw = await readJson(OVERRIDES_URL);
      const data = { addresses: Array.isArray(raw?.addresses) ? raw.addresses : [], events: Array.isArray(raw?.events) ? raw.events : [] };
      const changed = JSON.stringify(data) !== JSON.stringify(overrideCache.data);
      overrideCache = { at: Date.now(), data };
      if (changed) refreshWhenReady();
    } catch { overrideCache = { at: Date.now(), data: overrideCache.data }; }
    return overrideCache.data;
  })().finally(() => { overrideRequest = null; });
  return overrideRequest;
}

// A moderator-approved entry outranks the owner's supplement for the same
// event, field by field; the supplement fills whatever the approval left blank.
function mergeAddressEntries(supplements, approved) {
  const out = supplements.map(entry => ({ ...entry }));
  for (const entry of approved) {
    const patch = Object.fromEntries(Object.entries(entry).filter(([, value]) => value != null && value !== ''));
    const hit = out.find(item => (entry.eventId && item.eventId === entry.eventId) || (entry.eventUrl && item.eventUrl === entry.eventUrl));
    if (hit) Object.assign(hit, patch); else out.push(patch);
  }
  return out;
}

// Listings the crawl has not reached yet: appended once, never duplicated, and
// superseded the moment the public snapshot carries the same event.
function appendSupplementalEvents(events, extra) {
  if (!extra.length) return events;
  const seen = new Set(events.flatMap(event => [eventKey(event), event.id].filter(Boolean)));
  const added = extra.filter(event => event && event.id && !seen.has(event.id) && !seen.has(eventKey(event))).map(event => ({ ...event, supplemental: true }));
  return added.length ? [...events, ...added] : events;
}
// The San Francisco calendar covers the Bay Area, and the city itself draws
// only part of it. A listing whose coordinate is outside the region entirely
// is mis-filed rather than out of town — one New York address in the SF feed
// put the edge of the city 11,500 km out — so it is not in this calendar.
const BAY_AREA = { minLat: 36.9, maxLat: 38.4, minLng: -123.2, maxLng: -121.5 };
function inTheBayArea(event) {
  // `Number(null)` is 0, which is a perfectly finite point off West Africa:
  // an event without coordinates has to be recognised as such, not placed.
  if (event.lat == null || event.lng == null) return true;
  const lat = Number(event.lat), lng = Number(event.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;   // no coordinate, no claim either way
  return lat > BAY_AREA.minLat && lat < BAY_AREA.maxLat && lng > BAY_AREA.minLng && lng < BAY_AREA.maxLng;
}
function dropDistantListings(events) {
  const kept = [];
  for (const event of events) {
    if (inTheBayArea(event)) kept.push(event);
    else console.warn('[TW] outside the Bay Area, not listed:', event.title, event.address);
  }
  return kept;
}

function applyApprovedAddresses(events, addresses) {
  if (!addresses.length) return events;
  const byId = new Map(), byUrl = new Map();
  for (const entry of addresses) {
    if (entry.eventId) byId.set(entry.eventId, entry);
    if (entry.eventUrl) byUrl.set(entry.eventUrl, entry);
  }
  return events.map(event => {
    const entry = byId.get(event.id) || byUrl.get(event.url) || byUrl.get(event.sourceUrl);
    if (!entry) return event;
    // The queue publishes the building, never the door: `street` has the house
    // number and any floor/suite stripped out, and that is all the world shows.
    // Whoever wants the exact door asks in the Discord.
    const patched = { ...event, addressSource: entry.source || 'community-approved', approvedAddressAt: entry.approvedAt || entry.enteredAt };
    const street = entry.street || entry.address;
    if (street) patched.address = street;
    if (entry.venue) patched.venue = entry.venue;
    // The crawl reads an event page once. When the host renames the event
    // afterwards, the owner's reading of the live page is the newer one.
    if (entry.title) patched.title = entry.title;
    if (entry.neighborhood) patched.neighborhood = entry.neighborhood;
    if (Number.isFinite(entry.lat) && Number.isFinite(entry.lng)) {
      // A reviewed address is exact: drop the neighbourhood approximation.
      patched.lat = entry.lat; patched.lng = entry.lng; patched.approxLocation = false;
    }
    // The building is public, the door is not: the card keeps its Discord
    // link and carries no map link to the exact address.
    patched.doorWithheld = entry.doorWithheld !== false;
    if (patched.doorWithheld) delete patched.mapUrl;
    return patched;
  });
}

// Send an in-world claim to the moderation queue. Nothing is published until a
// moderator approves it in Discord; the claim stays visible locally meanwhile.
async function submitClaim(claim) {
  const response = await fetch(ADDRESS_URL.replace(/addresses\.json$/, 'addresses'), {
    method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claim),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Address queue returned ' + response.status);
  return response.json();
}


// Host-authored detail for our own event. The public calendar carries no
// speaker list for it, and this is the host telling us rather than something
// crawled — so it lives in code, not in the saved snapshot, which is
// regenerated from public sources and would drop it.
const HOST_EVENT_DETAIL = {
  'hgyN4UiBL4s3vA0ATTbr': {
    // The host's own event was retitled on Partiful after the crawl read it;
    // the crawl catches up on its next pass, and these agree with it when it does.
    title: 'Meshy \u00d7 Chrona: Build Multiplayer 3D Worlds With AI',
    description: 'What comes after AI-generated video? Meshy turns text and images into 3D models; Chrona turns them into AI-native persistent multiplayer worlds you co-build with Claude Code and Codex, where nothing resets. Live demos, hands-on co-building and fireside chats with the Meshy core team and Yiqi Zhao (Product Design Lead, Meta) \u2014 plus a creator live demo show, with $10,000+ in 3D model credits for everyone on site. Sponsored by Seedance. Bring a laptop.',
    cohosts: ['meshy.ai'],
    speakers: [
      { name: 'Meshy core team', role: 'the frontier of AI 3D generation' },
      { name: 'Yiqi Zhao', role: 'Product Design Lead, Meta \u00b7 spatial intelligence and AI at the edge' },
    ],
    speakerBio: [
      'Speaker \u2014 Yiqi Zhao, Product Design Lead at Meta, driving spatial intelligence and AI at the edge: AI that understands you and the world, not just words.',
      'Her team has delivered human-centric innovations for all modality AI experiences across wearable devices, personal agents, and generative platforms \u2014 shipping AI-native OS systems, runtime engine, world models, coding agent, and agentic media creation to 4B+ users from Meta AI mobile, web, desktop, Meta Quest and Meta AI Glasses.',
      'With a research background at Harvard and MIT Media Lab, Yiqi began her journey in brain-computer interfaces (EEG) and wearable AI with hardware. Previously, she led Unity\u2019s AI and XR platforms, including the visionOS deal for Apple Vision Pro. She also made her mark in the gaming sector with Destiny 2. Additionally, she leads Deepcake, an AI media institute with 200 million monthly views and 30+ awards.',
    ].join('\n\n'),
  },
};
function applyHostDetail(events) {
  return events.map(event => {
    const key = Object.keys(HOST_EVENT_DETAIL).find(slug => `${event.url || ''}${event.sourceUrl || ''}${event.id || ''}`.includes(slug));
    if (!key) return event;
    const detail = HOST_EVENT_DETAIL[key];
    const speakers = (event.speakers && event.speakers.length) ? event.speakers : detail.speakers;
    return { ...event, cohosts: detail.cohosts, speakers, title: detail.title || event.title, description: detail.description || event.description };
  });
}

window.__sfEventFeed = {
  coverUrl,
  submitClaim,
  async read(seed) {
    const full = readFullInBackground();
    // Live updates and optional community enrichment must not hold up readiness.
    readLiveInBackground();
    void readApprovedAddresses();
    void readVenueOverrides();
    const saved = fullSaved || await Promise.race([full.then(data => data || readBaseline()), readBaseline()]);
    const cache = liveCache || { status: 'unavailable' };
    const approvedAddresses = addressCache.list;
    const overrides = overrideCache.data;
    // Late/failed refreshes must never replace a newer complete programme with
    // the startup baseline. Keep the unmodified public feed separate from the
    // optional address and host-detail presentation patches.
    const data = mergePublicFeeds(lastGood, mergePublicFeeds(fullSaved || saved, cache));
    if (data) lastGood = data;
    const live = lastGood && { ...lastGood, events: dropDistantListings(applyHostDetail(applyApprovedAddresses(appendSupplementalEvents(lastGood.events, overrides.events), mergeAddressEntries(overrides.addresses, approvedAddresses)))) };
    showStatus(live ? {...live,error:cache.error} : cache, !!live);
    initialReadDelivered = true;
    if (live) return { list: enrichWithFallbackCoordinates(live.events), citizens: [], official: true,
      source: `Official public sources · ${live.events.length} events · ${live.coverage?.complete ? 'full calendar, partial details' : 'partial snapshot'} · saved ${live.fetchedAt}` };
    return { list: enrichWithFallbackCoordinates(dropDistantListings(applyHostDetail(seed.events || []))), citizens: seed.citizens || [], official: !!seed.publicSnapshot,
      source: seed.publicSnapshot ? 'Public Tech Week startup snapshot · live sync pending' : 'Sample programme · live sync pending' };
  },
};
