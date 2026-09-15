// Playtest tuning patches (Sep 2026 feedback round).
//
// Same exact-match discipline as events-build.mjs: every replacement must hit
// its target exactly once, so a source edit that moves the target fails the
// build instead of silently dropping a feature.
//
//   1. One number, everywhere: RSVPs. Partiful reports the people on the list
//      as `approvedGuestCount` for events that gate on approval and as
//      `goingGuestCount` for open ones — never both — so `rsvp` (their sum) is
//      the only figure that is comparable across the calendar. 295 of the 400
//      crawled events are approval-gated, so ranking on "going" alone would
//      read zero for most of the week. Cards show "N RSVPs · M left"; nothing
//      else.
//   2. The map is for what is busy. Only events above RSVP_MIN — plus the
//      featured host event — get an airship, a venue marker and a chip; the
//      rest stay in the side panel and in search.
//   3. The featured event flies its own oversized ship at the spawn point and
//      never shows a count: it is featured, not measured.
//   4. Covers appear when you fly close, not from across the bay.
//   5. Harbor holding pattern spreads much wider so unplaced events read as a
//      fleet rather than one blob.
//   6. No in-world claim form: the address question goes to Discord.
export const FEATURED_EVENT = 'hgyN4UiBL4s3vA0ATTbr';   // Meshy × Chrona, the host's own event
export const RSVP_MIN = 50;                              // below this an event has no airship of its own — it lives on a wall instead
// The week has an opening act and a host event; a handful of ships fly larger
// so the eye finds them from anywhere. Five is the cap — past that nothing is
// big any more. Matched against host, cohosts and title.
export const SPOTLIGHT = { hosts: ['a16z'], titles: ['official tech week kickoff'] };
export const SPOTLIGHT_MAX = 5;
// San Francisco as this city draws it: the peninsula, its bay shore and the
// Golden Gate Bridge. A coordinate outside this window is somewhere else.
export const CITY = { minLat: 37.70, maxLat: 37.84, minLng: -122.53, maxLng: -122.34 };
export const DISCORD_INVITE = 'https://discord.gg/GPPgjHE7GF';

export function wireTuning(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Tuning patch target changed: ' + from.slice(0, 78));
    html = html.replace(from, to);
  };

  // ---- 1. one number: RSVPs -------------------------------------------------
  // The host's own event is never measured, only featured, so every place a
  // count is printed asks `ev.featured` first.
  once('  const rsvpTotalDisplay = list =>', `  // The featured event carries a label where every other event carries a count.
  const FEATURED_TAG = 'FEATURED';
  // The host's event is never measured in public, however its own RSVPs move:
  // it is the fixture the week is built around, not an entry in the ranking.
  const tagOnly = (ev) => ev.featured;
  const rsvpTotalDisplay = list =>`);

  // Ranking is the RSVP count, with the host's own event pinned to the front.
  once('  const heat = (ev) => rsvpCount(ev) + (ev.status === \'waitlist\' || ev.status === \'full\' ? 0.5 : 0);',
    '  const heat = (ev) => (ev.featured ? 1e6 : 0) + rsvpCount(ev) + (ev.status === \'waitlist\' || ev.status === \'full\' ? 0.5 : 0);');

  // Card headline: RSVPs and seats left — nothing else. The featured event
  // shows its tag and sends people to Partiful instead of showing a number.
  once('<p class="tw-reg"><b>${rsvpDisplay(ev)}</b> RSVPs${st.leftText ? ` <span class="tw-dim">· ${esc(st.leftText)}</span>` : \'\'}',
    '<p class="tw-reg">${tagOnly(ev) ? `<b>${FEATURED_TAG}</b> <span class="tw-dim">· RSVP on Partiful</span>` : `<b>${rsvpDisplay(ev)}</b> RSVPs${st.leftText ? ` <span class="tw-dim">· ${esc(st.leftText)}</span>` : \'\'}`}');
  once('${ev.cobuilders.length ? ` · ${ev.cobuilders.length} builder${ev.cobuilders.length > 1 ? \'s\' : \'\'}` : \'\'}</p>', '</p>');

  // List rows.
  once('<span class="tw-sub tw-going"><strong>${rsvpDisplay(ev)}</strong> RSVPs',
    '<span class="tw-sub tw-going">${tagOnly(ev) ? `<strong>${FEATURED_TAG}</strong>` : `<strong>${rsvpDisplay(ev)}</strong> RSVPs`}');

  // Poster block: the big number and its label.
  once("const num = `${rsvpDisplay(ev)}`; g.fillText(num, x, H - 92);",
    "const num = `${tagOnly(ev) ? '' : rsvpDisplay(ev)}`; g.fillText(num, x, H - 92);");
  once("g.fillText('RSVPS', x + nw + 10, H - 94);",
    "g.fillText(tagOnly(ev) ? FEATURED_TAG : 'RSVPS', x + nw + 10, H - 94);");

  // Nav chip while flying.
  once("`${t.active ? `Cruise ${t.i + 1}/${t.queue.length} → ` : '→ '}${dest(ev)} · ${rsvpDisplay(ev)} RSVPs · ${tail}`",
    "`${t.active ? `Cruise ${t.i + 1}/${t.queue.length} → ` : '→ '}${dest(ev)} · ${tagOnly(ev) ? FEATURED_TAG : `${rsvpDisplay(ev)} RSVPs`} · ${tail}`");

  // The add-on layer needs the building probe to hang signs on facades rather
  // than float them above roofs. Function declarations hoist, so this is safe
  // even though roofHeightAt is defined further down the file.
  once('window.TW = { version: VERSION, CFG, CATS, BIRDS };',
    'window.TW = { version: VERSION, CFG, CATS, BIRDS, roofHeightAt };');

  // ---- 2 & 3. who gets a ship ----------------------------------------------
  once("  function normalizeEvent(raw, i) {",
    `  const FEATURED_EVENT = ${JSON.stringify(FEATURED_EVENT)};
  const SPOTLIGHT = ${JSON.stringify(SPOTLIGHT)};
  function normalizeEvent(raw, i) {`);
  once("    if (!CATS[ev.category] || ev.category === 'unclaimed') ev.category = guessCategory(ev); return ev;",
    `    ev.featured = !!FEATURED_EVENT && \`\${ev.url || ''}\${ev.sourceUrl || ''}\${ev.id || ''}\`.includes(FEATURED_EVENT);
    ev.spotlight = ev.featured
      || SPOTLIGHT.hosts.some((h) => \`\${ev.host || ''}\`.toLowerCase().startsWith(h))
      || SPOTLIGHT.titles.some((s) => \`\${ev.title || ''}\`.toLowerCase().includes(s));
    if (!CATS[ev.category] || ev.category === 'unclaimed') ev.category = guessCategory(ev); return ev;`);

  // The fleet is "everything hot enough", not a fixed top-N; quiet events keep
  // their listing but leave the sky and the streets empty.
  const rank = `state.events.slice().sort((a, b) => heat(b) - heat(a)).forEach((ev, i) => { ev.rank = i; ev.wantsVehicle = i < CFG.fleet; });`;
  const rankNew = `(() => { let spotlightSeen = 0;
    state.events.slice().sort((a, b) => heat(b) - heat(a)).forEach((ev, i) => {
      ev.rank = i;
      // Spotlight is a shortlist, not a label: the busiest few of the week's
      // official events get the big ship, the rest are ranked like everyone.
      ev.spotlightPick = !!ev.spotlight && spotlightSeen < ${SPOTLIGHT_MAX} && ++spotlightSeen > 0;
      // Three tiers, and each event is in exactly one of them: the host's own
      // ship; a facade billboard for every event whose address is known; an
      // airship for the busy events that have no address yet. An addressed
      // event never also gets a ship — that is what used to crowd the sky over
      // SOMA and the Financial District.
      // Out of town is its own tier: no building to stand on, so it flies —
      // and it flies at the Golden Gate, where the city ends.
      ev.wantsVehicle = ev.featured || ev.outOfTown || ((ev.spotlightPick || rsvpCount(ev) > CFG.rsvpMin) && !ev.claimed);
      // A district is a place too: an event that names its neighbourhood gets a
      // sign on a building there, once anyone has RSVP'd. Finding it is the point.
      ev.onMap = ev.wantsVehicle || ev.claimed || (ev.approxLocation && rsvpCount(ev) > 0);
    }); })();`;
  if (html.split(rank).length !== 3) throw new Error('Tuning patch target changed: fleet ranking (expected twice)');
  html = html.replaceAll(rank, rankNew);

  // Placement order matters: the host's own ship first, then buildings for real
  // addresses, then a spread across the district for neighbourhood-only events,
  // and the harbour for everything with no location at all.
  once("    for (const ev of state.events) {\n      if (ev.claimed) {",
    `    for (const ev of state.events) {
      // Not in the world, not in the placement: no berth, no district spot,
      // nothing for "fly there" to aim at. The old grid gave every quiet
      // event a harbour slot, and the slots ran so far down the bay that a
      // flight to one left the city.
      if (!ev.onMap) { ev.venueKey = 'unplaced'; ev.world = null; ev.ship = null; ev.venueGroup = null; ev.speakerSpots = null; continue; }
      if (ev.featured) {
        const p = GEO.Hn(CFG.featured.lng, CFG.featured.lat, 0); ev.venueKey = 'featured';
        ev.world = V3(p.x, 0, p.z); ev.ground = c.sampleTerrain(CFG.featured.lng, CFG.featured.lat) || 0;
        ev.roof = ev.ground; ev.shipY = CFG.featured.y; ev.anchorY = ev.ground + 8;
        continue;
      }
      // The gateway. An event out at Stanford or Berkeley is a real Tech Week
      // event that simply is not in this city, so it waits in the air by the
      // Golden Gate Bridge — the way out of town — anchored on the bridge's
      // own surveyed south tower rather than on a coordinate off the map.
      if (ev.outOfTown) {
        const k = gatewayIndex++, cols = Math.max(1, Math.ceil(Math.sqrt(gatewayTotal)));
        const col = k % cols, row = Math.floor(k / cols);
        const lng = GATEWAY.lng + 0.0024 + col * 0.0021, lat = GATEWAY.lat - 0.0015 - row * 0.0017;
        const p = GEO.Hn(lng, lat, 0);
        ev.venueKey = 'gateway'; ev.world = V3(p.x, 0, p.z);
        ev.ground = c.sampleTerrain(lng, lat) || 0; ev.roof = ev.ground;
        ev.shipY = 152 + row * 24 + (col % 2) * 15; ev.anchorY = ev.ground + 8;
        continue;
      }
      // A neighbourhood centroid is not an address: fan these out over the
      // district on a golden-angle spiral so no two share a rooftop.
      if (ev.approxLocation) {
        const seed = hash(ev.id), p = GEO.Hn(+ev.lng, +ev.lat, 0);
        // Fan out across the district, but land on a block: a spot with no
        // building within thirty metres is a park or the water, so try the
        // next turn of the spiral instead.
        let x = p.x, z = p.z, roof = -Infinity;
        for (let j = 0; j < 8 && !Number.isFinite(roof); j++) { const a = seed * 2.399963229 + j * 1.1, r = 110 + (seed % 23) * 12 + j * 30; x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r; roof = roofHeightAt(x, z, 28); }
        ev.venueKey = 'approx:' + ev.id; ev.world = V3(x, 0, z);
        ev.ground = c.sampleTerrain(+ev.lng, +ev.lat) || 0;
        ev.roof = Number.isFinite(roof) && roof > ev.ground + 2 ? roof : ev.ground + 4;
        ev.shipY = (ev.wantsVehicle ? ev.roof + CFG.shipAltitude : ev.roof + 40) + (seed % 9) * 16;
        ev.anchorY = ev.roof + 12;
        continue;
      }
      if (ev.claimed) {`);

  // Stacking at one address is capped: after four events the ring widens
  // instead of climbing out of the sky.
  once("const ang = n * 2.1, off = n ? 34 : 0;", "const ang = n * 2.1, off = n ? 34 + Math.floor(n / 6) * 22 : 0;");
  once("ev.shipY = ev.wantsVehicle ? ev.roof + CFG.shipAltitude + n * 26 : ev.roof + 36 + n * 9;",
    "ev.shipY = ev.wantsVehicle ? ev.roof + CFG.shipAltitude + Math.min(n, 4) * 26 : ev.roof + 36 + Math.min(n, 4) * 9;");

  // Only events that will actually be drawn take a harbour slot, so the grid
  // stays the size of the visible fleet.
  once("const slots = new Map(); let harborIndex = 0; const unclaimed = state.events.filter((e) => !e.claimed).length;",
    "const slots = new Map(); let harborIndex = 0; let gatewayIndex = 0; const GATEWAY = { lat: 37.8140068361, lng: -122.4778722111 }; const gatewayTotal = Math.max(1, state.events.filter((e) => e.outOfTown).length); const unclaimed = Math.max(1, state.events.filter((e) => !e.claimed && !e.approxLocation && !e.outOfTown && !e.featured && e.onMap).length);");

  // An approximate location is never presented as a verified address, and a
  // coordinate this city does not cover is not an address in this city at all.
  // Tech Week fills Berkeley, Palo Alto, Stanford and Half Moon Bay too; those
  // events used to be planted at their real coordinate, tens of kilometres
  // past the edge of the drawn world, where nothing renders — and they
  // stretched the city's own bounds out with them. They gather at the Golden
  // Gate instead. The window is San Francisco as this city draws it: the
  // peninsula, its bay shore, and the bridge.
  once("ev.claimed = ev.lat != null && ev.lng != null && Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng);",
    `ev.outOfTown = ev.lat != null && ev.lng != null && Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng)
      && !(+ev.lat > ${CITY.minLat} && +ev.lat < ${CITY.maxLat} && +ev.lng > ${CITY.minLng} && +ev.lng < ${CITY.maxLng});
    ev.claimed = !ev.approxLocation && !ev.outOfTown && ev.lat != null && ev.lng != null && Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng);`);

  // A wider, sparser holding pattern: the grid step grows with the fleet size.
  once("const cols = Math.ceil(Math.sqrt(unclaimed)); const lng = CFG.harbor.lng + (unclaimed <= 24 ? k - (unclaimed - 1) / 2 : k % cols - (cols - 1) / 2) * 0.00125, lat = CFG.harbor.lat + (unclaimed <= 24 ? k % 2 : Math.floor(k / cols) - (Math.ceil(unclaimed / cols) - 1) / 2) * 0.0009;",
    "const cols = Math.max(1, Math.ceil(Math.sqrt(unclaimed))); const stepLng = 0.0052, stepLat = 0.0039; const lng = CFG.harbor.lng + (k % cols - (cols - 1) / 2) * stepLng, lat = CFG.harbor.lat + (Math.floor(k / cols) - (Math.ceil(unclaimed / cols) - 1) / 2) * stepLat;");

  // Only mapped events take up space in the world, the chip layer and the clusters.
  once("    for (const ev of state.events) {\n      ev.posterCanvas = null; ev.tex = null;",
    "    for (const ev of state.events) {\n      if (!ev.onMap) { ev.ship = null; ev.venueGroup = null; continue; }\n      ev.posterCanvas = null; ev.tex = null;");
  once("  function buildChips() {", "  function buildChips() {\n    // chips follow the fleet: quiet events stay in the panel only");
  once("    const vg = new Map(); for (const ev of state.events) { if (!vg.has(ev.venueKey)) vg.set(ev.venueKey, []); vg.get(ev.venueKey).push(ev); }",
    "    const vg = new Map(); for (const ev of state.events) { if (!ev.onMap) continue; if (!vg.has(ev.venueKey)) vg.set(ev.venueKey, []); vg.get(ev.venueKey).push(ev); }");
  once("    for (const ev of state.events) { const k = ev.claimed ? (ev.neighborhood || ev.venue || 'Downtown') : 'Harbor · unclaimed'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ev); }",
    "    for (const ev of state.events) { if (!ev.onMap) continue; const k = ev.claimed ? (ev.neighborhood || ev.venue || 'Downtown') : 'Harbor · unclaimed'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ev); }");
  once("    if (state.events.length) { const xs = state.events.map((e) => e.world.x), zs = state.events.map((e) => e.world.z);",
    "    const fenced = state.events.filter((e) => e.onMap && e.world);\n    if (fenced.length) { const xs = fenced.map((e) => e.world.x), zs = fenced.map((e) => e.world.z);");

  // Guards: everything that assumes an event owns a ship or a chip.
  once("  function refreshChip(ev) {", "  function refreshChip(ev) {\n    if (!ev || !ev.chip) return;");
  once("  function moveShip(ev) {", "  function moveShip(ev) {\n    if (!ev.ship) return;");
  once("  function rebuildVenue(ev) { ROOT.remove(ev.venueGroup);", "  function rebuildVenue(ev) { if (!ev.onMap) return; ROOT.remove(ev.venueGroup);");
  once("      if (ev.venueChip && ev.venueChip._show) { hide(ev.chip); continue; }",
    "      if (!ev.onMap || !ev.chip) { if (ev.chip) hide(ev.chip); continue; }   // an event with no place in the world has no tag either — otherwise 1,400 of them pile up in the corner\n      if (ev.venueChip && ev.venueChip._show) { hide(ev.chip); continue; }");
  once("  function buildVenueChips() {", "  function buildVenueChips() {\n    // one chip per building among the mapped events");
  // The cruise is a tour of the city, so the harbour holding pattern — ships
  // parked over the bay because nobody knows their address — is not on the
  // route. That is what used to fly people out to sea.
  once("      const q = state.events.filter((e) => e.claimed).sort((a, b) => heat(b) - heat(a)); if (!q.length) return;",
    "      const q = state.events.filter((e) => e.onMap && e.ship && !String(e.venueKey || '').startsWith('harbor:')).sort((a, b) => heat(b) - heat(a)); if (!q.length) return;");
  once("  function look(ev) { lookAt(", "  function look(ev) { if (!ev.ship) return; lookAt(");
  once("    if (buildingsMesh) {\n      const a = buildingsMesh.geometry.attributes.position.array, s = buildingsMesh.scale.x; const lx = x / s, lz = z / s, lr = radius / s, lr2 = lr * lr;\n      for (let i = 0; i < a.length; i += 3) { const dx = a[i] - lx; if (dx > lr || dx < -lr) continue; const dz = a[i + 2] - lz; if (dz > lr || dz < -lr) continue; if (dx * dx + dz * dz < lr2) { const y = a[i + 1] * s; if (y > best) best = y; } }\n    }", "    if (buildingsMesh) {\n      // One pass over the mesh builds a 10 m grid of the highest vertex per\n      // cell; every query after that is a handful of cells. The old scan of\n      // 2.5 million vertices per call cost placeEvents() a second and a half.\n      const g = roofGrid || (roofGrid = buildRoofGrid(buildingsMesh));\n      const c0 = Math.max(0, Math.floor((x - radius - g.x0) / g.cell)), c1 = Math.min(g.cols - 1, Math.floor((x + radius - g.x0) / g.cell));\n      const r0 = Math.max(0, Math.floor((z - radius - g.z0) / g.cell)), r1 = Math.min(g.rows - 1, Math.floor((z + radius - g.z0) / g.cell));\n      for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) { const y = g.h[cz * g.cols + cx]; if (y > best) best = y; }\n    }");
  once("  function roofHeightAt(x, z, radius) {",
    `  let roofGrid = null;
  function buildRoofGrid(mesh) {
    const a = mesh.geometry.attributes.position.array, s = mesh.scale.x || 1, cell = 10;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < a.length; i += 3) { const x = a[i], z = a[i + 2]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    const x0 = minX * s - cell, z0 = minZ * s - cell, cols = Math.ceil((maxX * s - x0) / cell) + 2, rows = Math.ceil((maxZ * s - z0) / cell) + 2;
    const h = new Float32Array(cols * rows).fill(-Infinity);
    for (let i = 0; i < a.length; i += 3) { const k = Math.floor((a[i + 2] * s - z0) / cell) * cols + Math.floor((a[i] * s - x0) / cell); const y = a[i + 1] * s; if (y > h[k]) h[k] = y; }
    return { x0, z0, cell, cols, rows, h };
  }
  function roofHeightAt(x, z, radius) {`);
  once("      const err = wrapAngle(desired - H), inp = c.flightInput, aligned = Math.abs(err) < 0.5;", "      // The add-on layer knows the roofs (window.__twTerrain); a flight that\n      // would cut through a tower climbs over it instead.\n      if (window.__twTerrain) { const lift = window.__twTerrain.roofAhead(P.x, P.z, desired, 140) + 24; if (lift > cruiseY) cruiseY = lift; }\n      const err = wrapAngle(desired - H), inp = c.flightInput, aligned = Math.abs(err) < 0.5;");
  once("        const k = harborIndex++; ev.venueKey = 'harbor:' + k; const cols = Math.max(1, Math.ceil(Math.sqrt(unclaimed))); const stepLng = 0.0052, stepLat = 0.0039; const lng = CFG.harbor.lng + (k % cols - (cols - 1) / 2) * stepLng, lat = CFG.harbor.lat + (Math.floor(k / cols) - (Math.ceil(unclaimed / cols) - 1) / 2) * stepLat;\n        const p = GEO.Hn(lng, lat, 0); ev.world = V3(p.x, 0, p.z); ev.ground = 0; ev.roof = 0; ev.shipY = ev.wantsVehicle ? 86 + (k % 2) * 18 : 40 + (k % 2) * 8; ev.anchorY = 4;", "        // No district and no address, but a crowd: the ship flies over the\n        // downtown core on a spiral, always above a building \u2014 never parked\n        // out on the bay, where a third of the fleet used to sit.\n        const k = harborIndex++; ev.venueKey = 'core:' + k; const seed = hash(ev.id);\n        const centre = GEO.Hn(CFG.core.lng, CFG.core.lat, 0); let px = centre.x, pz = centre.z, roof = -Infinity;\n        for (let j = 0; j < 8 && !Number.isFinite(roof); j++) { const a = k * 2.399963229 + j * 0.9, r = 150 + 46 * Math.sqrt(k) + j * 25; px = centre.x + Math.cos(a) * r; pz = centre.z + Math.sin(a) * r; roof = roofHeightAt(px, pz, 40); }\n        ev.world = V3(px, 0, pz); ev.ground = c.sampleTerrain(CFG.core.lng, CFG.core.lat) || 0; ev.roof = Number.isFinite(roof) ? roof : ev.ground + 40;\n        ev.shipY = ev.roof + CFG.shipAltitude + (seed % 3) * 24; ev.anchorY = ev.roof + 12;");

  // ---- 8. nothing is "unclaimed" ------------------------------------------
  // An event without a public address is still a party, a demo night or an
  // investor dinner: it keeps its own category, colour and poster. The grey
  // "Unclaimed" livery stamped on every such card, chip and banner is gone.
  once("  const catOf = (ev) => (ev.claimed ? CATS[ev.category] || CATS.founders : CATS.unclaimed);",
    "  const catOf = (ev) => CATS[ev.category] || CATS.founders;");
  once("const k = ev.claimed ? (ev.neighborhood || ev.venue || 'Downtown') : 'Harbor · unclaimed'",
    "const k = ev.claimed ? (ev.neighborhood || ev.venue || 'Downtown') : ev.outOfTown ? (ev.neighborhood || 'Out of town') : ev.approxLocation ? (ev.neighborhood || 'Downtown') : 'Venue to be announced'");
  once("name: m0.claimed ? (m0.venue || m0.address) : 'Harbor'",
    "name: m0.claimed ? (m0.venue || m0.address) : m0.outOfTown ? 'Out of town · Golden Gate' : m0.approxLocation ? (m0.neighborhood || 'District') : 'Downtown'");
  once("ev.chip.classList.toggle('unclaimed', !ev.claimed)", "ev.chip.classList.toggle('unclaimed', false)");
  // The sky is for the ships. A signed building wears its posters on the wall;
  // the little kite that used to fly from its roof is not drawn (it still
  // anchors the event's position for flights and chips).
  once("ev.hasVehicle = false; return g; }", "ev.hasVehicle = false; g.visible = false; return g; }");
  // A signed building is marked by its posters, not by a roof ring, a flag
  // pole and floating speaker chips — those read as clutter next to a poster
  // painted on the glass, and the ring often sat around the wrong tower
  // because the roof estimate came from a neighbour. Only ships parked over
  // the bay keep their buoy.
  once("      ev.venueGroup = ev.claimed ? venueMarker(ev) : harborBuoy(ev); ev.venueGroup.position.set(ev.world.x, 0, ev.world.z); ROOT.add(ev.venueGroup);",
    "      ev.venueGroup = String(ev.venueKey || '').startsWith('harbor:') ? harborBuoy(ev) : null; ev.speakerSpots = null; if (ev.venueGroup) { ev.venueGroup.position.set(ev.world.x, 0, ev.world.z); ROOT.add(ev.venueGroup); }");
  once("ROOT.remove(ev.venueGroup); ev.venueGroup = ev.claimed ? venueMarker(ev) : harborBuoy(ev); ev.venueGroup.position.set(ev.world.x, 0, ev.world.z); ROOT.add(ev.venueGroup); buildSpeakerChips(ev); }",
    "if (ev.venueGroup) ROOT.remove(ev.venueGroup); ev.venueGroup = String(ev.venueKey || '').startsWith('harbor:') ? harborBuoy(ev) : null; ev.speakerSpots = null; if (ev.venueGroup) { ev.venueGroup.position.set(ev.world.x, 0, ev.world.z); ROOT.add(ev.venueGroup); } buildSpeakerChips(ev); }");
  // The add-on layer lights up wall posters as you fly in, so it needs the
  // cover loader.
  once("Object.assign(TW, { select, flyTo, look, lookAt, applyBird, toast, drawPoster,",
    "Object.assign(TW, { select, flyTo, look, lookAt, applyBird, toast, drawPoster, loadCover,");
  // Clicking in the world walks every event, and an event that is not in the
  // world has no ship — the walk used to throw on the first one, which is why
  // a tap on a ship or a kite never selected anything.
  once("      for (const ev of state.events) { test(ev.ship.position, ev, ev.hasVehicle ? 24 : 9); if (ev.venueGroup) test(V3(ev.world.x, ev.roof + 8, ev.world.z), ev, 14); }",
    "      for (const ev of state.events) { if (!ev.onMap || !ev.ship || !ev.world) continue; if (ev.hasVehicle) test(ev.ship.position, ev, 24); if (ev.venueGroup) test(V3(ev.world.x, ev.roof + 8, ev.world.z), ev, 14); }");
  // Fly to where the thing actually is: an airship is circled at its own
  // altitude, a wall sign just above its roof. The old target (18 m over the
  // ground for anything unclaimed) put the bird under every ship.
  once("    start(ev) { this.ev = ev; this.target = V3(ev.world.x, (ev.claimed ? ev.roof : 0) + 18, ev.world.z);",
    "    start(ev) { if (!ev || !ev.world) return; this.ev = ev; this.target = V3(ev.world.x, ev.ship && Number.isFinite(ev.shipY) ? Math.max(18, ev.shipY - 56) : (ev.claimed || ev.approxLocation ? ev.roof : 0) + 18, ev.world.z);");
  // The card offers a flight only when there is somewhere to fly; an event
  // that is not in the world has no button rather than a dead one, and the
  // label no longer says "harbor" for a ship over a district or a sign on a wall.
  once("        <button type=\"button\" data-act=\"fly\">${nav.ev === ev ? (nav.phase === 'circle' ? '◌ Circling' : '→ En route') : (ev.claimed ? 'Fly there' : 'Fly to harbor')}</button>",
    "        ${ev.world ? `<button type=\"button\" data-act=\"fly\">${nav.ev === ev ? (nav.phase === 'circle' ? '◌ Circling' : '→ En route') : ev.wantsVehicle ? 'Fly to the ship' : 'Fly there'}</button>` : ''}");

  // Honest wording for the three location tiers.
  once("`${esc([ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · '))} <em>Map location unverified.</em> Harbor placement is a game placeholder.`",
    "`${esc([ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · '))} ${ev.featured ? '<em>Venue announced closer to the day.</em> Seats are limited — RSVP early.' : ev.approxLocation ? (ev.wantsVehicle ? '<em>District only — the exact address is not public yet.</em> Its ship flies over the neighbourhood; the door is in the Discord.' : ev.onMap ? '<em>District only — the exact address is not public yet.</em> Its poster hangs on a building somewhere in the neighbourhood; the door is in the Discord.' : '<em>District only — the exact address is not public yet.</em> Ask in the Discord — someone there usually knows the venue.') : '<em>No public address yet.</em> Ask in the Discord — someone there usually knows the venue.'}`");

  // ---- 9. who a speaker is, right in the list ------------------------------
  // The card spells out each speaker's role; the list row only gave the name.
  // Show the identity there too, trimmed to what precedes the tagline.
  once("<span class=\"tw-sub tw-spk\">${sp.length ? esc(sp.map((x) => x.name).join(', ')) : 'Speakers TBA'}</span>",
    "<span class=\"tw-sub tw-spk\">${sp.length ? esc(sp.map((x) => x.role ? `${x.name} · ${String(x.role).split(' · ')[0]}` : x.name).join(', ')) : 'Speakers TBA'}</span>");

  // ---- 7. the address question goes to Discord -----------------------------
  // Asking a stranger in a form was the wrong shape: the people who know a
  // venue are in the Discord, so the card sends you straight there. The exact
  // door number is deliberately never published in the world (see the bot).
  once('\'<button type="button" data-act="claim">Claim address</button>\'',
    `\`<a class="tw-btn" href="\${${JSON.stringify(DISCORD_INVITE)}}" target="_blank" rel="noopener" title="Ask in the Discord — someone there usually knows the venue">Find the venue ↗</a>\``);

  // The in-world claim dialog is no longer reachable from the card, but if it
  // is opened another way the submission still goes to the moderation queue.
  once("needName(() => { Object.assign(ev, { address: place.address, lat: place.lat, lng: place.lng,",
    `needName(() => { window.__sfEventFeed?.submitClaim?.({
          eventId: ev.id, eventTitle: ev.title, eventUrl: ev.url || ev.sourceUrl || '',
          address: place.address, lat: place.lat, lng: place.lng,
          venue: $('#tw-m-venue').value.trim(), submittedBy: state.user.name || 'a citizen',
        }).then(() => toast('Sent to the Discord moderators — it goes live for everyone once approved.'))
          .catch(() => toast('Placed for you locally; the shared queue is unreachable right now.'));
        Object.assign(ev, { address: place.address, lat: place.lat, lng: place.lng,`);

  // ---- 6. the co-build entry point goes away -------------------------------
  once('        <button type="button" data-act="cobuild">${cob ? \'Edit the space\' : \'Claim & build the space\'}</button>\n', '');


  // ---- 8. fewer words in the sky -------------------------------------------
  // 154 floating labels over downtown read as noise, not as a city. Buildings
  // now carry their own signage, so the sign is the label: an addressed event
  // only gets a text chip when you are almost on top of it or it is selected.
  // Ships keep their chips, because a ship has nothing else to say who it is.
  once("      const keep = sel || level === 'near' || (level === 'mid' && ev.rank < 10) || (level === 'far' && !clustered && ev.rank < 3);",
    `      const signed = (ev.claimed || ev.approxLocation) && !ev.wantsVehicle;   // it wears a sign on a wall
      const onScreen = p.x > 30 && p.x < W - 30 && p.y > 64 && p.y < H - 64;   // a half-visible chip at an edge is only clutter
      // An event on a wall is found by flying, the board and the card — never by a
      // sticker in the sky. Only ships get a tag, and only while you can read it.
      const keep = sel || (!signed && onScreen && (!ev.ship || ev.ship.visible !== false) && (level === 'near' || (level === 'mid' && ev.rank < 6) || (level === 'far' && !clustered && ev.rank < 2)));`);

  // The card already opens on the event's poster; the wall of text under it goes.
  once("      ${ev.description ? `<p class=\"tw-desc\">${esc(ev.description)}</p>` : ''}", "");

  // The leaderboard row for the host's event says FEATURED, not 0.
  // (events-build.mjs has already turned rsvpCount into rsvpDisplay on this row.)
  once("<em>${rsvpDisplay(ev)}<small>RSVPs</small></em></li>`; }).join('') : '<li class=\"tw-empty\">Nothing upcoming.</li>';",
    "<em>${tagOnly(ev) ? FEATURED_TAG : rsvpDisplay(ev)}<small>${tagOnly(ev) ? '' : 'RSVPs'}</small></em></li>`; }).join('') : '<li class=\"tw-empty\">Nothing upcoming.</li>';");

  // The list row for the host's event names its district and says the venue
  // is coming, rather than "no address yet" beside FEATURED.
  once("${ev.claimed ? esc(ev.venue || ev.neighborhood || ev.address) : 'no address yet'}</span><b>",
    "${ev.claimed ? esc(ev.venue || ev.neighborhood || ev.address) : ev.featured ? esc((ev.neighborhood || 'FiDi') + ' · venue soon') : 'no address yet'}</span><b>");

  // No building tags, no district clusters: the walls and the signage are the map.
  once("vg._show = !!p && !(cl && cl._far && cl.members.length > 1) && (p.d < mid || vg.members.includes(state.selected));",
    "vg._show = false;");
  once("for (const cl of state.clusters) { if (cl._p && cl._far && cl.members.length > 1 && !cl.members.some((e) => e === state.selected)) shown.push({ el: cl.el, p: cl._p, pri: 0 }",
    "for (const cl of state.clusters) { if (false) shown.push({ el: cl.el, p: cl._p, pri: 0 }");

  // The mother ship's tag names the week, not a running total.
  once("`<i></i><span>Oct 5–11 · ${rsvpTotalDisplay(state.events)} RSVPs in the city</span><b>SF Tech Week 2026</b>`",
    "`<i></i><span>Oct 5–11 · San Francisco</span><b>SF Tech Week 2026</b>`");

  // The bird is yours from the first frame: no cruise starts on its own. T still
  // starts one when you ask for it.
  once("      setView(state.view); nav.startTour(0); toast(`Welcome, @${state.user.name || 'you'}. Cruising the most-RSVP’d events in order — any flight key takes over, T resumes.`);",
    "      setView(state.view); toast(`Welcome, @${state.user.name || 'you'}. The bird tours the city on its own — any key takes over, P pauses, T cruises the busiest events.`);");

  // ---- 4. covers only when you are close -----------------------------------
  return applyCoverProximity(html);
}

// The cover gate that events-build.mjs installs is replaced with a proximity
// test: the ink stand-in is what you see from the air, and the real poster
// resolves once you fly up to the ship (or open the card).
function applyCoverProximity(html) {
  const from = 'if (!ev.image || ev.coverImg || ev.coverFailed || ev.coverPending || (window.__SF_HOST_READY__ && !ev.wantsVehicle && state.selected !== ev)) return;';
  const to = 'if (!ev.image || ev.coverImg || ev.coverFailed || ev.coverPending) return;\n    if (!ev.coverNear && state.selected !== ev) return;';
  if (html.split(from).length !== 2) throw new Error('Tuning patch target changed: cover gate (run wireTuning after wireEventFeed)');
  html = html.replace(from, to);

  // updateChips already knows every ship's distance to the camera each frame.
  const mark = 'const sel = state.selected === ev, level = p.d < near ? \'near\' : p.d < mid ? \'mid\' : \'far\';';
  if (html.split(mark).length !== 2) throw new Error('Tuning patch target changed: chip level');
  // The featured ship is the one poster that is always the real one — you are
  // meant to see it from across the bay.
  html = html.replace(mark, 'if (!ev.coverNear && (ev.featured || p.d < CFG.posterReveal)) { ev.coverNear = true; loadCover(ev); }\n      ' + mark);
  return html;
}

// CFG additions used above. Applied first so the keys exist before anything
// reads them.
export function wireTuningConfig(html) {
  const from = '    lod: { near: 900, mid: 2600 },                           // chip detail bands (metres from the camera)';
  // A tighter near band: text only crowds in when you are genuinely close.
  const to = `    lod: { near: 420, mid: 2600 },                           // chip detail bands (metres from the camera)
    rsvpMin: ${RSVP_MIN},                                          // RSVPs an event needs before it gets an airship of its own
    posterReveal: 620,                                       // metres: closer than this the real poster loads onto the banner
    featured: { lat: 37.7969, lng: -122.3931, y: 196 },      // the host's own event, parked over the spawn point
    core: { lat: 37.7915, lng: -122.4005 },                  // downtown: where ships with no address of their own fly`;
  if (html.split(from).length !== 2) throw new Error('Tuning patch target changed: CFG.lod');
  return html.replace(from, to);
}
