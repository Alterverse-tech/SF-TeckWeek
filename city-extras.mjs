// Add-on layer, loaded after the game: everything that can sit on top of the
// public TW API instead of patching the original file.
//
//   · Discord entry in the top-right corner
//   · links still work where a new tab cannot open (Chrona's sandboxed frame)
//   · flight school: the first minute, one move at a time, ticked off as it is done
//   · solid buildings, and a chase camera that settles behind the bird once it flies
//   · camera clearance, nearby-player cards and venue signage
//   · fly close to another player and a small card offers to follow them on X
//
// Nothing here throws if the game is missing a hook; each feature checks for
// what it needs and quietly stays off.
const DISCORD_INVITE = 'https://discord.gg/GPPgjHE7GF';
const DOWNTOWN = { lat: 37.7915, lng: -122.4005, radius: 620 };  // Financial District / Downtown core
const NEAR_PLAYER = 90;      // metres: close enough to read someone's handle
const LEAVE_PLAYER = 150;    // metres: hysteresis so the card does not blink

const styles = `
#tw-discord { position: fixed; top: 12px; right: 14px; z-index: 64; display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; padding: 0; border: 1px solid #34262f55; border-radius: 2px; background: #f6ecd8ee; color: #34262f;
  font: 700 12px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; text-transform: uppercase;
  text-decoration: none; cursor: pointer; backdrop-filter: blur(6px); }
#tw-discord:hover { background: #fff; border-color: #34262f; }
#tw-discord svg { width: 22px; height: 22px; flex: none; }
#tw-discord small { display: block; font: 500 10px/1.3 ui-monospace, monospace; text-transform: none; letter-spacing: 0; opacity: .72; }
html.tw-fpv #tw-discord { opacity: .35; }
@media (max-width: 720px) { #tw-discord span.tw-dc-text { display: none; } }

#tw-neighbour { position: fixed; left: 50%; bottom: 108px; transform: translateX(-50%); z-index: 66;
  display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid #34262f55; border-radius: 2px;
  background: #f6ecd8f2; color: #34262f; font: 500 13px/1.35 "Avenir Next", "PingFang SC", sans-serif;
  box-shadow: 0 6px 22px #34262f22; animation: tw-neighbour-in .18s ease-out; }
@keyframes tw-neighbour-in { from { opacity: 0; transform: translateX(-50%) translateY(6px); } }
#tw-neighbour i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
#tw-neighbour b { font: 700 14px/1.2 ui-monospace, Menlo, monospace; }
#tw-neighbour small { display: block; opacity: .66; font-size: 11px; }
#tw-neighbour a.tw-follow { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 1px solid #34262f;
  background: #34262f; color: #f6ecd8; text-decoration: none; font: 700 12px/1 ui-monospace, monospace; }
#tw-neighbour a.tw-follow:hover { background: #12060c; }
#tw-neighbour a.tw-follow svg { width: 12px; height: 12px; fill: currentColor; }
#tw-neighbour button.tw-dismiss { border: 0; background: none; color: #34262f88; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.tw-cover { display: block; width: 100%; max-height: 220px; object-fit: cover; margin: 10px 0 12px; border: 1px solid #34262f33; background: #34262f11; }

#tw-who { position: fixed; top: 12px; right: 62px; height: 40px; box-sizing: border-box; z-index: 64; display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 12px; border: 1px solid #34262f55; border-radius: 2px; background: #f6ecd8ee; color: #34262f;
  font: 700 12px/1.2 ui-monospace, Menlo, Consolas, monospace; cursor: pointer; backdrop-filter: blur(6px); }
#tw-who:hover { background: #fff; border-color: #34262f; }
#tw-who i { width: 8px; height: 8px; border-radius: 50%; background: #4e8a5a; flex: none; }
#tw-who[data-online="false"] i { background: #9a8c92; }
#tw-who-list { position: fixed; top: 58px; right: 62px; z-index: 65; min-width: 190px; max-height: 46vh; overflow: auto;
  padding: 8px 0; border: 1px solid #34262f55; background: #f6ecd8f5; color: #34262f;
  font: 500 13px/1.5 "Avenir Next", "PingFang SC", sans-serif; box-shadow: 0 8px 24px #34262f26; }
#tw-who-list li { display: flex; align-items: center; gap: 9px; padding: 5px 14px; list-style: none; }
#tw-who-list li i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
#tw-who-list li small { margin-left: auto; opacity: .6; font-size: 11px; }
#tw-who-list p { margin: 4px 14px; opacity: .7; font-size: 12px; }

/* The address box (top 72px) and the events panel (top 142px) overlapped by a
   line; give the panel the room it needs. */
.tw-panel { top: 176px !important; max-height: calc(100vh - 296px) !important; }
/* A quieter screen: the name, its one line, and the controls. Everything that
   merely counted things — events listed, buildings, streets, coordinates, the
   snapshot caption, the data-source note — is gone. */
.tw-masthead > p, #tw-clock, #tw-digest, .tw-masthead .eyebrow, .tw-masthead .tw-brand,
#tw-sync-status, #tw-source, .data-note, .address-search small, #tw-count, .world-label { display: none !important; }
/* The key hints stay for the first while, then get out of the way. */
.flight-hint.tw-hint-fade { opacity: 0 !important; }
/* Our two buttons sit in the free row between the address box and the panel,
   clear of the game's own status chip in the top-right corner. */
#tw-discord { top: 124px !important; right: 28px !important; }
#tw-who { top: 124px !important; right: 76px !important; }
#tw-pause { position: fixed; top: 124px; right: 190px; z-index: 64; height: 40px; padding: 0 12px; border: 1px solid #34262f55; border-radius: 2px;
  background: #f6ecd8ee; color: #34262f; font: 700 12px/1 ui-monospace, Menlo, Consolas, monospace; cursor: pointer; backdrop-filter: blur(6px); }
#tw-pause:hover { background: #fff; border-color: #34262f; }
#tw-who-list { top: 170px !important; right: 76px !important; }
#tw-who-list li small { margin-left: auto; }
#tw-who-list .tw-fly-beside { margin-left: 8px; padding: 4px 8px; border: 1px solid #34262f; background: #34262f; color: #f6ecd8;
  font: 700 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .04em; cursor: pointer; }
#tw-who-list .tw-fly-beside:hover { background: #12060c; }

/* Flight school: one move at a time, above the toast, below nothing else. */
#tw-guide { position: fixed; left: 50%; bottom: 152px; transform: translateX(-50%); z-index: 66; width: min(440px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 10px 14px 12px; border: 1px solid #34262f55; border-radius: 2px; background: #f6ecd8f2; color: #34262f;
  font: 500 14px/1.45 "Avenir Next", "PingFang SC", sans-serif; box-shadow: 0 8px 24px #34262f26;
  animation: tw-neighbour-in .18s ease-out; transition: border-color .2s, opacity .5s; }
#tw-guide .tw-guide-head { display: flex; align-items: center; gap: 10px; margin-bottom: 5px;
  font: 700 10px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .08em; text-transform: uppercase; opacity: .8; }
#tw-guide .tw-guide-dots { letter-spacing: .2em; font-size: 9px; }
#tw-guide .tw-guide-skip { margin-left: auto; border: 0; background: none; color: inherit; font: inherit; letter-spacing: inherit; opacity: .7; cursor: pointer; padding: 2px 0; text-decoration: underline; }
#tw-guide .tw-guide-skip:hover { opacity: 1; }
#tw-guide p { margin: 0; }
#tw-guide kbd { display: inline-block; min-width: 1.3em; padding: 0 6px; border: 1px solid #34262f; border-bottom-width: 2px; border-radius: 3px; background: #fff;
  font: 700 12px/1.55 ui-monospace, Menlo, Consolas, monospace; text-align: center; }
#tw-guide.tw-guide-tick { border-color: #4e8a5a; }
#tw-guide.tw-guide-tick p::before { content: '✓  '; color: #4e8a5a; font-weight: 700; }
#tw-guide.tw-guide-finished { opacity: 0; transition: opacity .6s 5.5s; }
html.tw-fpv #tw-guide { opacity: .92; }

/* Shown when a link cannot open a new tab (Chrona's game frame refuses pop-ups). */
#tw-linkbox { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 90; width: min(480px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 16px 18px 14px; border: 1px solid #34262f55; border-radius: 2px; background: #f6ecd8f8; color: #34262f;
  font: 500 13px/1.4 "Avenir Next", "PingFang SC", sans-serif; box-shadow: 0 10px 30px #34262f33; }
#tw-linkbox h4 { margin: 0 0 6px; font: 700 13px/1.2 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .04em; text-transform: uppercase; }
#tw-linkbox p { margin: 0 0 10px; opacity: .82; }
#tw-linkbox .tw-linkrow { display: flex; gap: 8px; }
#tw-linkbox code { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #34262f55; background: #fff; color: #34262f; font: 600 13px/1.2 ui-monospace, Menlo, Consolas, monospace;
  overflow-wrap: anywhere; user-select: all; cursor: text; }
#tw-linkbox button { padding: 8px 12px; border: 1px solid #34262f; background: #34262f; color: #f6ecd8; font: 700 12px/1 ui-monospace, Menlo, Consolas, monospace; cursor: pointer; }
#tw-linkbox button:hover { background: #12060c; }
#tw-linkbox button.tw-linkclose { background: none; color: #34262f; border-color: #34262f55; }
#tw-linkbox button.tw-linkclose:hover { background: #fff; }
`;

const X_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L6 22H2.9l7.5-8.6L2.5 2H9l4.5 6.7L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z"/></svg>';
const DISCORD_LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.5A18 18 0 0 0 15.9 3l-.2.4c1.5.4 2.7 1 3.9 1.7a13 13 0 0 0-11.2 0c1.2-.7 2.5-1.4 3.9-1.7L12 3a18 18 0 0 0-4.4 1.5C4.7 8.7 3.9 12.8 4.3 16.8a18 18 0 0 0 5.4 2.7l.9-1.5c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.9 12.9 0 0 0 11 0l.4.3c-.5.4-1.1.7-1.7.9l.9 1.5c1.9-.6 3.7-1.5 5.4-2.7.4-4.6-.7-8.7-2.7-12.3ZM9.7 14.4c-1 0-1.9-1-1.9-2.1 0-1.2.9-2.1 1.9-2.1s2 .9 1.9 2.1c0 1.2-.9 2.1-1.9 2.1Zm4.6 0c-1 0-1.9-1-1.9-2.1 0-1.2.9-2.1 1.9-2.1s1.9.9 1.9 2.1c0 1.2-.8 2.1-1.9 2.1Z"/></svg>';

function injectStyles() {
  const el = document.createElement('style');
  el.id = 'tw-extras-css';
  el.textContent = styles;
  document.head.appendChild(el);
}

/* ----------------------------------------------------------- external links */
// Chrona hosts the game in an iframe sandboxed to scripts and pointer lock. In
// that frame target="_blank" and window.open() are refused without a word, so
// every link out of the city — Find the venue, RSVP, the calendar, Discord, X —
// did nothing when clicked. When a new tab cannot open, show the address and
// copy it instead: the classic execCommand copy still works in that sandbox,
// the asynchronous Clipboard API is blocked by permissions policy.
// What the box says depends on where the link goes: the Discord invite is
// where the exact address and a way in are found, so say that; any other
// link is named by its site.
function linkCopy(url) {
  if (url.startsWith(DISCORD_INVITE)) {
    return {
      title: 'The venue is in the Discord',
      copied: 'The exact address, and someone to get you in, are in the Discord. The invite link is copied — paste it into a new tab to join.',
      manual: 'The exact address, and someone to get you in, are in the Discord. Copy the invite link and paste it into a new tab to join.',
    };
  }
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return {
    title: host ? `Open ${host} in a new tab` : 'Open in a new tab',
    copied: 'This window cannot open new tabs. The link is copied — paste it into a new tab.',
    manual: 'This window cannot open new tabs. Copy the link and paste it into a new tab.',
  };
}

function showLink(url) {
  document.getElementById('tw-linkbox')?.remove();
  const text = linkCopy(url);
  const box = document.createElement('div');
  box.id = 'tw-linkbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', text.title);
  box.innerHTML = `<h4></h4><p></p>
    <div class="tw-linkrow"><code class="tw-linkurl"></code><button type="button" class="tw-linkcopy">Copy</button><button type="button" class="tw-linkclose" aria-label="Close">✕</button></div>`;
  const code = box.querySelector('code'), note = box.querySelector('p');
  box.querySelector('h4').textContent = text.title;
  code.textContent = url;
  // A Range selection copies without moving focus; focusing a field inside a
  // cross-origin frame is what browsers refuse and log.
  const selectUrl = () => {
    const range = document.createRange(); range.selectNodeContents(code);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  };
  const copy = () => {
    selectUrl();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    if (ok) { note.textContent = text.copied; return; }
    note.textContent = text.manual;
    navigator.clipboard?.writeText(url).then(() => { note.textContent = text.copied; }, () => {});
  };
  box.querySelector('.tw-linkcopy').addEventListener('click', copy);
  box.querySelector('.tw-linkclose').addEventListener('click', () => box.remove());
  code.addEventListener('click', selectUrl);
  document.body.appendChild(box);
  copy();
}

function installLinkFallback() {
  const nativeOpen = window.open.bind(window);
  // Open without 'noopener': with it, open() returns null even when a tab did
  // appear, so success could not be told from a refusal. The opener is severed
  // by hand instead.
  const openTab = url => {
    let tab = null;
    try { tab = nativeOpen(url, '_blank'); } catch { tab = null; }
    if (tab) { try { tab.opener = null; } catch {} }
    return tab;
  };
  window.open = function (url, target, features) {
    if (!url || (target && target !== '_blank')) return nativeOpen(url, target, features);
    const tab = openTab(String(url));
    if (!tab) showLink(String(url));
    return tab;
  };
  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = event.target.closest?.('a[href][target="_blank"]');
    if (!a || !/^https?:/i.test(a.href)) return;
    // This card has a dedicated parent bridge. Let its target click handler
    // run before attempting a sandbox-blocked popup or showing a copy box.
    const xHandle = a.dataset.chronaXHandle;
    if (window.__SF_HOST_CLIENT__ && window.parent !== window &&
        typeof xHandle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(xHandle) &&
        a.href === `https://x.com/${xHandle}`) return;
    event.preventDefault();
    if (!openTab(a.href)) showLink(a.href);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.getElementById('tw-linkbox')?.remove();
  });
}

/* ------------------------------------------------------------ flight school */
// The first minute in the city, one move at a time. A step waits until the
// player has actually done the thing — read from the flight input and the
// camera state, with the keys themselves as the fallback — ticks it off, and
// hands over to the next. Shown once per browser; Skip ends it for good.
// Keyboard only, so touch devices never see it.
const GUIDE_KEY = 'sf-ink-guide';
const GUIDE_STEPS = [
  { text: 'Hold <kbd>W</kbd> to fly forward, <kbd>S</kbd> to slow down and glide.',
    keys: /^(w|s|arrowup|arrowdown)$/, input: i => i.forward || i.backward },
  { text: '<kbd>A</kbd> and <kbd>D</kbd> turn. The arrow keys work too.',
    keys: /^(a|d|arrowleft|arrowright)$/, input: i => i.left || i.right },
  { text: '<kbd>Space</kbd> climbs, <kbd>C</kbd> dives.',
    keys: /^( |c)$/, input: i => i.up || i.down },
  { text: '<kbd>V</kbd> switches the camera: chase cam or beak cam.',
    keys: /^v$/, view: true },
  { text: 'Fly a little, then let go of every key — the bird hovers. That is your pause. <kbd>Esc</kbd> stops a guided flight, <kbd>T</kbd> starts the cruise.',
    keys: /^escape$/, hover: true },
];
const GUIDE_DONE = 'That is the city. <kbd>Shift</kbd> boosts, <kbd>U</kbd> hides the interface, and any event card flies you there.';
const GUIDE_START_DELAY = 3000;  // ms after the world is ready; the welcome toast goes first
const GUIDE_HOVER_MS = 1200;     // no input this long counts as a deliberate hover
const GUIDE_TICK_MS = 750;       // the check mark stays this long before the next step

function installFlightGuide(TW, city) {
  if (!city || !TW?.state) return;
  try { if (localStorage.getItem(GUIDE_KEY)) return; } catch {}
  if (window.matchMedia?.('(pointer: coarse)').matches) return;
  const bootAt = performance.now();
  let el = null, step = -1, ctx = null, timer = 0;
  const remember = () => { try { localStorage.setItem(GUIDE_KEY, String(Date.now())); } catch {} };
  const anyInput = i => !!(i.forward || i.backward || i.left || i.right || i.up || i.down);
  const ticking = () => !!el?.classList.contains('tw-guide-tick');

  function render(text) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'tw-guide'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<div class="tw-guide-head"><span class="tw-guide-label"></span><span class="tw-guide-dots" aria-hidden="true"></span><button type="button" class="tw-guide-skip">Skip</button></div><p></p>';
      el.querySelector('.tw-guide-skip').addEventListener('click', () => finish(true));
      document.body.appendChild(el);
    }
    const n = GUIDE_STEPS.length;
    el.querySelector('.tw-guide-label').textContent = step < n ? `Flight school · ${step + 1}/${n}` : 'Flight school';
    el.querySelector('.tw-guide-dots').textContent = GUIDE_STEPS.map((_, i) => i < step ? '●' : i === step ? '◉' : '○').join('');
    el.querySelector('p').innerHTML = text;
  }
  function show(i) {
    step = i;
    ctx = { view: TW.state.view, moved: false, lastInput: 0, key: false };
    render(GUIDE_STEPS[i].text);
  }
  function stop() {
    clearInterval(timer); timer = 0;
    window.removeEventListener('keydown', onKey, true);
  }
  function finish(skipped) {
    remember(); stop();
    if (skipped || !el) { el?.remove(); el = null; return; }
    step = GUIDE_STEPS.length;
    render(GUIDE_DONE);
    el.querySelector('.tw-guide-skip').hidden = true;
    el.classList.add('tw-guide-finished');
    setTimeout(() => { el?.remove(); el = null; }, 6500);
  }
  function advance() {
    el.classList.add('tw-guide-tick');
    setTimeout(() => {
      if (!el) return;
      el.classList.remove('tw-guide-tick');
      if (step + 1 < GUIDE_STEPS.length) show(step + 1); else finish(false);
    }, GUIDE_TICK_MS);
  }
  function onKey(event) {
    if (step < 0 || ticking() || !ctx) return;
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select')) return;
    if (GUIDE_STEPS[step].keys.test(event.key.toLowerCase())) ctx.key = true;
  }
  function tick() {
    if (step < 0) {
      if (city.freeFlightEnabled && performance.now() - bootAt >= GUIDE_START_DELAY) show(0);
      return;
    }
    if (!el) return;
    el.hidden = !!document.querySelector('.city-shell.ui-hidden');
    if (ticking() || !ctx) return;
    const current = GUIDE_STEPS[step], input = city.flightInput || {}, now = performance.now();
    if (anyInput(input)) { ctx.moved = true; ctx.lastInput = now; }
    let done = ctx.key || !!(current.input && current.input(input));
    if (current.view && TW.state.view !== ctx.view) done = true;
    if (current.hover && (!city.freeFlightEnabled || (ctx.moved && now - ctx.lastInput >= GUIDE_HOVER_MS))) done = true;
    if (done) advance();
  }
  window.addEventListener('keydown', onKey, true);
  timer = setInterval(tick, 80);
}

/* ------------------------------------------------------------------ Discord */
function mountDiscord() {
  if (document.getElementById('tw-discord')) return;
  const a = document.createElement('a');
  a.id = 'tw-discord';
  a.href = DISCORD_INVITE;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = 'Find events and ask for addresses on Discord';
  a.innerHTML = DISCORD_LOGO;
  a.setAttribute('aria-label', 'Join the Discord — find events and ask for addresses');
  document.body.appendChild(a);
}

// Idle birds hover. Event navigation is only started by an explicit player action.

/* ------------------------------------------- the chase camera stays outside */
// The chase camera trails the bird by a fixed distance, which put it inside
// whatever tower the bird had just flown past. After every simulation step the
// line from the bird back to the camera is checked against the roofs: if it
// crosses a building, the camera comes forward to the near side of it, and if
// it still sits inside one it rises above the roof. Smoothed, so a tower
// passing behind you reads as the camera tucking in, not jumping.
function installCameraClearance(TW, city) {
  if (typeof city.updateSimulation !== 'function' || !city.camera || !city.target) return;
  const previous = city.updateSimulation.bind(city);
  let smooth = 1;
  city.updateSimulation = (dt) => {
    previous(dt);
    const terrain = window.__twTerrain;
    if (!terrain || !city.freeFlightEnabled || TW.state.view === 'fpv') { smooth = 1; return; }
    const cam = city.camera.position, tgt = city.target;
    const dx = cam.x - tgt.x, dy = cam.y - tgt.y, dz = cam.z - tgt.z;
    let want = 1;
    for (let f = 0.12; f <= 1.0001; f += 0.08) {
      if (terrain.roofAt(tgt.x + dx * f, tgt.z + dz * f) > tgt.y + dy * f + 1.5) { want = Math.max(0.1, f - 0.1); break; }
    }
    smooth += (want - smooth) * Math.min(1, (dt || 0.016) * (want < smooth ? 14 : 4));
    if (smooth < 0.999) { cam.set(tgt.x + dx * smooth, tgt.y + dy * smooth, tgt.z + dz * smooth); city.camera.lookAt(tgt); }
    const roofHere = terrain.roofAt(cam.x, cam.z);
    if (roofHere > cam.y - 1) { cam.y = roofHere + 4; city.camera.lookAt(tgt); }
  };
}

/* ------------------------------------------------ the fleet at a distance */
// Only the flagships read from across the city. The rest of the fleet is drawn
// when you are within reach of it and grows in as you arrive — so the skyline
// stays quiet from afar, and the frame stays cheap.
const SHIP_FAR = 1000;
function installFleetDistance(TW, city) {
  const ease = (k) => 1 - (1 - k) * (1 - k) * (1 - k);
  setInterval(() => {
    const cam = city.camera || city.flightCharacter;
    if (!cam || !cam.position) return;
    for (const ev of TW.state.events || []) {
      const ship = ev.ship;
      if (!ship || !ev.hasVehicle) continue;
      if (ev.featured || ev.spotlightPick) { ship.visible = true; continue; }
      const d = ship.position.distanceTo(cam.position);
      const want = d < SHIP_FAR;
      if (want !== ship.visible) { ship.visible = want; if (want) ship.userData.twAppear = 0; }
      if (want && ship.userData.twAppear !== undefined && ship.userData.twAppear < 1) {
        ship.userData.twAppear = Math.min(1, ship.userData.twAppear + 0.08);
        ship.scale.setScalar(0.15 + 0.85 * ease(ship.userData.twAppear));
      }
    }
  }, 90);
}

/* --------------------------------------------- fly close to another player */
// The roster comes from the multiplayer layer (multiplayer.js publishes it on
// window.__sfNet). Standalone and single-file builds have no roster, so the
// card simply never appears.
function neighbourXHandle(player) {
  // The legacy roster may carry its X name in `name`; a coordinate in `x`
  // is not a handle, and a display name containing spaces is not an X name.
  const raw = [player.handle, player.x, player.name].find((value) => typeof value === 'string' && value.trim());
  const handle = raw ? raw.trim().replace(/^@/, '') : '';
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : '';
}

function openHostedXProfile(event, handle) {
  if (typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle) ||
      event.type !== 'click' || !event.isTrusted ||
      !window.__SF_HOST_CLIENT__ || window.parent === window) return false;
  // Hosted worlds cannot open new tabs themselves. The trusted parent accepts
  // only this narrow profile action and owns the popup or fallback link.
  event.preventDefault();
  window.parent.postMessage({ type: 'chrona:open-x-profile', handle }, 'https://chrona.world');
  return true;
}

function installNeighbourCard(TW, city) {
  let card = null, current = null;

  const remove = () => { if (card) { card.remove(); card = null; } current = null; };

  const show = (player) => {
    const handle = neighbourXHandle(player);
    remove();
    if (!handle) return;
    current = player.id;
    card = document.createElement('div');
    card.id = 'tw-neighbour';
    card.innerHTML = `<i></i>
      <span><b></b><small>flying beside you</small></span>
      <a class="tw-follow" target="_blank" rel="noopener noreferrer">${X_LOGO} Follow</a>
      <button type="button" class="tw-dismiss" aria-label="Dismiss">×</button>`;
    card.querySelector('i').style.backgroundColor = player.color || '#c6583c';
    card.querySelector('b').textContent = `@${handle}`;
    const follow = card.querySelector('.tw-follow');
    follow.href = `https://x.com/${handle}`;
    follow.dataset.chronaXHandle = handle;
    follow.addEventListener('click', (event) => openHostedXProfile(event, handle));
    card.querySelector('.tw-dismiss').addEventListener('click', remove);
    document.body.appendChild(card);
  };

  setInterval(() => {
    const net = window.__sfNet;
    if (!net || net.state !== 'room' || !city.freeFlightEnabled) { if (card) remove(); return; }
    const me = city.flightCharacter && city.flightCharacter.position;
    const others = (net.players || []).filter((p) => !p.self && p.connected && p.position);
    // Departure invalidates the existing card before distance hysteresis can
    // retain it because a different player is still somewhere nearby.
    if (card && !others.some((player) => player.id === current)) remove();
    if (!me || !others.length) { if (card) remove(); return; }

    let closest = null, best = Infinity;
    for (const p of others) {
      const d = Math.hypot(p.position.x - me.x, p.position.y - me.y, p.position.z - me.z);
      if (d < best) { best = d; closest = p; }
    }
    if (closest && best < NEAR_PLAYER && closest.id !== current) show(closest);
    else if (card && (best > LEAVE_PLAYER || !closest)) remove();
  }, 700);
}

/* ------------------------------------------------------ solid, steady flight */
// Two things the engine leaves out. Buildings are solid: after each flight
// step the wall index (the one the signage and the chase camera already read)
// pushes the bird back out of any facade it crossed, and a roof it comes down
// on carries it. And the chase camera follows: a dragged orbit offset is kept
// while the bird hovers, so the city can be looked at from any side, but as
// soon as the player flies the camera eases back behind the bird — forward
// must never mean "towards the viewer". A guided flight circling its event
// keeps the camera on the event, as before.
const BIRD_RADIUS = 1.6;   // metres from a facade the body stops at
const ROOF_REST = 1.2;     // metres above a roof the bird settles
const WALL_EDGE = 5;       // metres: this close to an indexed wall, the wall decides, not the coarse roof grid
const CAMERA_FOLLOW = 3;   // per second: how fast the orbit eases back behind the bird

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const anyFlightInput = i => !!(i && (i.forward || i.backward || i.left || i.right || i.up || i.down));

function settleAgainstWalls(city, walls, before) {
  const p = city.flightCharacter.position, v = city.flightVelocity;
  let nearestWall = Infinity;
  for (let pass = 0; pass < 2; pass += 1) {
    let pushed = false;
    for (const seg of walls.near(p.x, p.z, BIRD_RADIUS + WALL_EDGE)) {
      if (p.y < seg.y0 - 0.5 || p.y > seg.y1 + 0.5) continue;
      const { d, t } = segmentDistance(p.x, p.z, seg);
      if (d < nearestWall) nearestWall = d;
      if (d >= BIRD_RADIUS) continue;
      const cx = seg.ax + (seg.bx - seg.ax) * t, cz = seg.az + (seg.bz - seg.az) * t;
      let nx = p.x - cx, nz = p.z - cz;
      const nl = Math.hypot(nx, nz);
      // On the wall, or already through it: out along the facade's own normal.
      if (nl < 1e-6 || nx * seg.nx + nz * seg.nz < 0) { nx = seg.nx; nz = seg.nz; }
      else { nx /= nl; nz /= nl; }
      p.x = cx + nx * BIRD_RADIUS; p.z = cz + nz * BIRD_RADIUS;
      const into = v.x * nx + v.z * nz;
      if (into < 0) { v.x -= nx * into; v.z -= nz * into; }   // slide along the glass
      pushed = true;
    }
    if (!pushed) break;
  }
  // The roof grid catches what the walls miss: low or short facades that were
  // never indexed, party walls, and a facade crossed in one fast step.
  const roof = walls.roofAt(p.x, p.z);
  if (!Number.isFinite(roof) || p.y >= roof + ROOF_REST) return;
  if (nearestWall < WALL_EDGE) return;                        // at a facade the grid is coarse; the wall above has spoken
  const roofBefore = walls.roofAt(before.x, before.z);
  if (before.y >= roof + ROOF_REST - 0.05) {                  // came down onto the roof: rest on it
    p.y = roof + ROOF_REST; if (v.y < 0) v.y = 0; return;
  }
  if (!Number.isFinite(roofBefore) || before.y >= roofBefore + ROOF_REST - 0.05) {   // flew into the building: stop at its wall
    p.x = before.x; p.z = before.z; v.x = 0; v.z = 0; city.gullSpeed = 0; return;
  }
  p.y = roof + ROOF_REST; if (v.y < 0) v.y = 0;               // already inside (placed there): out onto the roof
}

function installSolidFlight(TW, city) {
  if (typeof city.updateGullFlight !== 'function' || !city.flightCharacter || !city.flightVelocity) return;
  const previous = city.updateGullFlight.bind(city);
  city.updateGullFlight = function (delta) {
    if (!city.freeFlightEnabled) return previous(delta);
    const p = city.flightCharacter.position;
    const before = { x: p.x, y: p.y, z: p.z };
    const moving = anyFlightInput(city.flightInput);
    previous(delta);
    const walls = window.__twWalls;
    if (walls && typeof walls.near === 'function' && typeof walls.roofAt === 'function') settleAgainstWalls(city, walls, before);
    if (!moving || city.drag || TW.nav?.phase === 'circle') return;
    const dt = Math.min(Math.max(delta, 0), 0.05);
    const off = wrapAngle(city.flightCharacter.rotation.y + Math.PI - city.yaw);
    if (Math.abs(off) < 0.002) return;
    city.yaw += off * (1 - Math.exp(-CAMERA_FOLLOW * dt));
    city.applyOrbit();
  };
}

/* ------------------------------------- Tokyo-style signage on busy buildings */
// Posters on the glass. A building with events wears their covers on one of
// its own walls — the real wall, read out of the city mesh, so the poster sits
// flush and square on the facade instead of on a plane guessed from a probe.
// Only a real cover goes up: an event whose poster has not loaded (or has no
// poster at all) simply has nothing on the wall yet, and the covers load as
// you fly in, so a street of signs lights up as you approach it.
const SIGN_BUDGET_MS = 6;     // per slice: signage never owns a whole frame
const SIGN_START_DELAY = 900; // ms after the world is ready, so entry stays smooth
const SIGN_MAX_PER_VENUE = 4; // posters on one building; the list has the rest
const SIGN_MARGIN = 1.6;      // metres from the wall's edges
const SIGN_GAP = 1.4;         // metres between posters
const SIGN_CLEAR = 0.35;      // metres off the glass, enough to avoid z-fighting
const SIGN_TOP_GAP = 3;       // metres below the roofline
const SIGN_TEX_W = 224;       // texture width in px; a sign is read from the street
const SIGN_ASPECT = { min: 0.72, max: 1.4 }; // height / width; covers are cropped to this band

// The bundle exposes Texture but not CanvasTexture; this is the same thing.
// Every poster is drawn on a canvas and uploaded to the GPU, which is the
// expensive part — so each event's texture is made once and reused across
// rebuilds instead of being redrawn every time the fleet changes.
const textures = new Map();          // event key → texture, most recently used last
const TEXTURE_CAP = 200;             // live posters at once; the rest are re-drawn when you come back
function canvasTexture(T, canvas) {
  const texture = new T.Texture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
// Half-size copies for the hoarding: read from the street, not the skyline.
function halfSize(canvas) {
  const small = document.createElement('canvas');
  small.width = Math.max(64, canvas.width >> 1); small.height = Math.max(64, canvas.height >> 1);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  return small;
}
function rememberTexture(key, texture) {
  textures.set(key, texture);
  if (textures.size > TEXTURE_CAP) {
    const [oldKey, old] = textures.entries().next().value;
    textures.delete(oldKey); old.dispose();
    for (const mesh of old.userData.meshes || []) if (mesh.material?.uniforms?.map?.value === old) { mesh.material.uniforms.map.value = null; mesh.userData.textured = false; }
  }
}
function posterTexture(T, TW, event) {
  const key = event.id || event.url || event.title;
  let texture = textures.get(key);
  if (texture) { textures.delete(key); textures.set(key, texture); return texture; }
  texture = canvasTexture(T, halfSize(TW.drawPoster(event)));
  texture.userData.withCover = !!event.coverImg;
  rememberTexture(key, texture);
  return texture;
}
// The cover itself, cropped to the sign's proportions, behind a hairline of
// ink — the poster in a lightbox, not a banner with a poster in one corner.
function coverTexture(T, event, aspect) {
  const key = 'cover:' + (event.id || event.url || event.title);
  let texture = textures.get(key);
  if (texture) { textures.delete(key); textures.set(key, texture); return texture; }
  const im = event.coverImg;
  const cv = document.createElement('canvas');
  cv.width = SIGN_TEX_W; cv.height = Math.round(SIGN_TEX_W * aspect);
  const g = cv.getContext('2d');
  const k = Math.max(cv.width / im.width, cv.height / im.height);      // cover-fit: fill, crop the overflow
  const dw = im.width * k, dh = im.height * k;
  g.fillStyle = '#1d1519'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(im, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  // Three hundred events share the calendar's stock poster. On a wall that
  // is three hundred identical black squares, so a stock poster carries the
  // event's own name, host and hour in a band along its foot.
  if (event.genericPoster) titleBand(g, cv, event);
  g.strokeStyle = 'rgba(29,21,25,0.9)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, cv.width - 3, cv.height - 3);
  g.strokeStyle = 'rgba(255,244,222,0.55)'; g.lineWidth = 1; g.strokeRect(4.5, 4.5, cv.width - 9, cv.height - 9);
  texture = canvasTexture(T, cv);
  texture.userData.withCover = true;
  rememberTexture(key, texture);
  return texture;
}
function wrapText(g, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (g.measureText(next).width <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length) { const last = lines[maxLines - 1]; if (g.measureText(last).width > maxWidth || lines.join(' ').length < words.join(' ').length) { let cut = last; while (cut && g.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1); lines[maxLines - 1] = cut + '…'; } }
  return lines;
}
function whenText(event) {
  const d = event.startDate instanceof Date ? event.startDate : event.start ? new Date(event.start) : null;
  if (!d || isNaN(d)) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).replace(',', ' ·').toUpperCase();
}
function titleBand(g, cv, event) {
  const W = cv.width, H = cv.height, pad = 10;
  const bandH = Math.round(H * 0.42), top = H - bandH;
  const grad = g.createLinearGradient(0, top - 18, 0, top + 10);
  grad.addColorStop(0, 'rgba(29,21,25,0)'); grad.addColorStop(1, 'rgba(29,21,25,0.94)');
  g.fillStyle = grad; g.fillRect(0, top - 18, W, 28);
  g.fillStyle = 'rgba(29,21,25,0.94)'; g.fillRect(0, top + 10, W, bandH - 10);
  g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillStyle = '#e9c46a'; g.font = '700 11px ui-monospace, Menlo, monospace';
  g.fillText(whenText(event), pad, top + 4);
  g.fillStyle = '#f6ecd8'; g.font = '700 19px Georgia, "Times New Roman", serif';
  const lines = wrapText(g, event.title, W - pad * 2, 3);
  lines.forEach((line, i) => g.fillText(line, pad, top + 20 + i * 22));
  const host = Array.isArray(event.cohosts) && event.cohosts.length ? [event.host, ...event.cohosts].filter(Boolean).join(' × ') : event.host;
  if (host) { g.fillStyle = 'rgba(246,236,216,0.78)'; g.font = '500 11px ui-monospace, Menlo, monospace'; g.fillText(wrapText(g, host, W - pad * 2, 1)[0] || '', pad, Math.min(H - 16, top + 22 + lines.length * 22)); }
}
// Covers arrive after the hoarding was drawn (they load as you approach).
// Redraw the poster with the real image the first time it is available.
function refreshPosterIfCoverArrived(T, TW, mesh) {
  const event = mesh.userData.ev;
  const map = mesh.material?.uniforms?.map;
  if (!event || !map || !event.coverImg || map.value?.userData?.withCover) return;
  const key = event.id || event.url || event.title;
  const fresh = canvasTexture(T, halfSize(TW.drawPoster(event)));
  fresh.userData.withCover = true;
  fresh.userData.meshes = [mesh];
  textures.set(key, fresh);
  map.value = fresh;
}

function billboardMaterial(T, city, texture) {
  const U = city.globalUniforms;
  // Same fog treatment as the airship banners, so the signs sit in the weather.
  return new T.ShaderMaterial({
    uniforms: { map: { value: texture }, uFogColor: U.uFogColor, uFogNear: U.uFogNear, uFogFar: U.uFogFar, uFogMax: U.uFogMax, uCamPos: U.uCamPos, uLight: { value: 1 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: 'uniform sampler2D map; uniform vec3 uFogColor, uCamPos; uniform float uFogNear, uFogFar, uFogMax, uLight; varying vec2 vUv; varying vec3 vW; void main(){ vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y); vec3 col = texture2D(map, uv).rgb * uLight; float fog = smoothstep(uFogNear, uFogFar, distance(vW, uCamPos)) * uFogMax; gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0); }',
    side: T.DoubleSide,
  });
}

/* --------------------------------------------- the walls, read from the city */
// The city is one big mesh of extruded footprints. Every vertical quad in it
// is a wall: two corners on the ground, two on the roofline, and a normal that
// points out of the building. One pass over the triangles inside the event
// area collects them into a coarse grid, and signage asks that grid for the
// walls near an address. The pass is sliced so no frame pays for all of it.
const WALL_CELL = 48;         // metres per grid cell
const WALL_MIN_LEN = 8;       // metres: shorter walls are corner facets
const WALL_MIN_H = 8;         // metres: lower walls are podium steps

function findBuildingsMeshes(city) {
  const meshes = [];
  city.scene.traverse((o) => {
    if (o.isMesh && /Refined DataSF footprints/.test(o.name) && o.geometry?.attributes?.position && o.position.lengthSq() < 1e-6 && Math.abs(o.rotation.y) < 1e-6) meshes.push(o);
  });
  return meshes;
}

function buildWallIndex(city, bounds, done) {
  const meshes = findBuildingsMeshes(city);
  if (!meshes.length) { done(null); return; }
  const s = meshes[0].scale.x || 1;
  if (meshes.some(mesh => Math.abs((mesh.scale.x || 1) - s) > 1e-6)) { done(null); return; }
  let meshIndex = 0, pos, idx, triCount;
  const selectMesh = () => {
    const geometry = meshes[meshIndex].geometry;
    pos = geometry.attributes.position.array;
    idx = geometry.index ? geometry.index.array : null;
    triCount = Math.floor((idx ? idx.length : pos.length / 3) / 3);
  };
  selectMesh();
  const segs = new Map();
  const minX = bounds.minX / s, maxX = bounds.maxX / s, minZ = bounds.minZ / s, maxZ = bounds.maxZ / s;
  const minLen = WALL_MIN_LEN / s, minH = 3 / s, flat = 0.6 / s;
  const same = (x0, z0, x1, z1) => Math.abs(x0 - x1) < 0.03 && Math.abs(z0 - z1) < 0.03;
  // The roofs, rasterised: every flat triangle paints its height into an
  // 8 m grid, so "is there a building here, and how tall" is one lookup.
  // That is what keeps the bird and the camera out of the towers.
  const ROOF_CELL = 8;
  const gx0 = bounds.minX, gz0 = bounds.minZ, gcols = Math.ceil((bounds.maxX - bounds.minX) / ROOF_CELL) + 1, grows = Math.ceil((bounds.maxZ - bounds.minZ) / ROOF_CELL) + 1;
  const roofs = new Float32Array(gcols * grows).fill(-Infinity);
  const paintRoof = (x0, z0, x1, z1, x2, z2, h) => {
    const c0 = Math.max(0, Math.floor((Math.min(x0, x1, x2) - gx0) / ROOF_CELL)), c1 = Math.min(gcols - 1, Math.floor((Math.max(x0, x1, x2) - gx0) / ROOF_CELL));
    const r0 = Math.max(0, Math.floor((Math.min(z0, z1, z2) - gz0) / ROOF_CELL)), r1 = Math.min(grows - 1, Math.floor((Math.max(z0, z1, z2) - gz0) / ROOF_CELL));
    const det = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
    if (Math.abs(det) < 1e-9) return;
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
      const k = r * gcols + c;
      if (roofs[k] >= h) continue;
      if (c0 === c1 && r0 === r1) { roofs[k] = h; continue; }                   // a triangle smaller than a cell still counts
      const px = gx0 + (c + 0.5) * ROOF_CELL, pz = gz0 + (r + 0.5) * ROOF_CELL;
      const w0 = ((x1 - px) * (z2 - pz) - (x2 - px) * (z1 - pz)) / det;
      const w1 = ((x2 - px) * (z0 - pz) - (x0 - px) * (z2 - pz)) / det;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) roofs[k] = h;
    }
  };
  let t = 0;
  const step = () => {
    const until = performance.now() + 14;
    while (t < triCount && performance.now() < until) {
      const end = Math.min(triCount, t + 12000);
      for (; t < end; t += 1) {
        const k = t * 3;
        const i0 = (idx ? idx[k] : k) * 3, i1 = (idx ? idx[k + 1] : k + 1) * 3, i2 = (idx ? idx[k + 2] : k + 2) * 3;
        const y0 = pos[i0 + 1], y1 = pos[i1 + 1], y2 = pos[i2 + 1];
        const ymin = Math.min(y0, y1, y2), ymax = Math.max(y0, y1, y2);
        const x0 = pos[i0], z0 = pos[i0 + 2], x1 = pos[i1], z1 = pos[i1 + 2], x2 = pos[i2], z2 = pos[i2 + 2];
        const cx = (x0 + x1 + x2) / 3, cz = (z0 + z1 + z2) / 3;
        if (cx < minX || cx > maxX || cz < minZ || cz > maxZ) continue;
        if (ymax - ymin < flat) { if (ymax * s > 2) paintRoof(x0 * s, z0 * s, x1 * s, z1 * s, x2 * s, z2 * s, ymax * s); continue; }   // a roof
        if (ymax - ymin < minH) continue;                                          // kerbs, steps
        let ax, az, bx, bz;                                                        // the two distinct corners of a vertical quad
        if (same(x0, z0, x1, z1)) { ax = x0; az = z0; bx = x2; bz = z2; }
        else if (same(x1, z1, x2, z2)) { ax = x1; az = z1; bx = x0; bz = z0; }
        else if (same(x0, z0, x2, z2)) { ax = x0; az = z0; bx = x1; bz = z1; }
        else continue;                                                             // a sloped face
        const len = Math.hypot(bx - ax, bz - az);
        if (len < minLen) continue;
        const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0, e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
        let nx = e1y * e2z - e1z * e2y, nz = e1x * e2y - e1y * e2x;               // the winding's normal: outward, like the mesh's own
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const swap = ax > bx || (ax === bx && az > bz);
        const kx0 = swap ? bx : ax, kz0 = swap ? bz : az, kx1 = swap ? ax : bx, kz1 = swap ? az : bz;
        const key = `${Math.round(kx0 * 10)},${Math.round(kz0 * 10)}|${Math.round(kx1 * 10)},${Math.round(kz1 * 10)}`;
        const seg = segs.get(key);
        if (!seg) segs.set(key, { ax: kx0 * s, az: kz0 * s, bx: kx1 * s, bz: kz1 * s, y0: ymin * s, y1: ymax * s, nx, nz, len: len * s, used: [], shared: false });
        else {
          if (ymin * s < seg.y0) seg.y0 = ymin * s; if (ymax * s > seg.y1) seg.y1 = ymax * s;
          if (nx * seg.nx + nz * seg.nz < -0.9) seg.shared = true;                // two buildings back to back: a party wall, not a facade
        }
      }
    }
    if (t < triCount) { setTimeout(step, 0); return; }
    if (++meshIndex < meshes.length) { selectMesh(); t = 0; setTimeout(step, 0); return; }
    if (city.disposed) return;
    const cells = new Map();
    const cellKey = (x, z) => `${Math.floor(x / WALL_CELL)},${Math.floor(z / WALL_CELL)}`;
    let count = 0;
    for (const seg of segs.values()) {
      if (seg.shared || seg.y1 - seg.y0 < WALL_MIN_H) continue;
      count += 1;
      const x0 = Math.floor(Math.min(seg.ax, seg.bx) / WALL_CELL), x1 = Math.floor(Math.max(seg.ax, seg.bx) / WALL_CELL);
      const z0 = Math.floor(Math.min(seg.az, seg.bz) / WALL_CELL), z1 = Math.floor(Math.max(seg.az, seg.bz) / WALL_CELL);
      for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) {
        const key = `${cx},${cz}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(seg);
      }
    }
    const near = (x, z, r) => {
      const out = new Set();
      const x0 = Math.floor((x - r) / WALL_CELL), x1 = Math.floor((x + r) / WALL_CELL), z0 = Math.floor((z - r) / WALL_CELL), z1 = Math.floor((z + r) / WALL_CELL);
      for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) for (const seg of cells.get(`${cx},${cz}`) || []) out.add(seg);
      return [...out];
    };
    const roofAt = (x, z) => {
      const c = Math.floor((x - gx0) / ROOF_CELL), r = Math.floor((z - gz0) / ROOF_CELL);
      if (c < 0 || r < 0 || c >= gcols || r >= grows) return -Infinity;
      return roofs[r * gcols + c];
    };
    // The tallest roof under a straight line ahead, and how far you can fly
    // along it at a given height before something is in the way.
    const roofAhead = (x, z, heading, dist) => {
      let best = roofAt(x, z);
      const sx = Math.sin(heading), sz = Math.cos(heading);
      for (let d = ROOF_CELL; d <= dist; d += ROOF_CELL) { const h = roofAt(x + sx * d, z + sz * d); if (h > best) best = h; }
      return best;
    };
    const clearance = (x, z, y, heading, dist) => {
      const sx = Math.sin(heading), sz = Math.cos(heading), step = ROOF_CELL / 2;
      for (let d = step; d <= dist; d += step) if (roofAt(x + sx * d, z + sz * d) > y) return d;
      return dist;
    };
    window.__twTerrain = { roofAt, roofAhead, clearance, cell: ROOF_CELL };
    done({ near, count, cellKey, roofAt });
  };
  setTimeout(step, 0);
}

// Distance from a point to a wall segment, and where along it the point falls.
function segmentDistance(x, z, seg) {
  const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
  const t = Math.max(0, Math.min(1, ((x - seg.ax) * dx + (z - seg.az) * dz) / (seg.len * seg.len || 1)));
  return { d: Math.hypot(seg.ax + dx * t - x, seg.az + dz * t - z), t };
}

// A wall with another wall right in front of it is a party wall or an alley:
// nobody reads a poster there.
function wallBlocked(index, seg) {
  const mx = (seg.ax + seg.bx) / 2 + seg.nx * 7, mz = (seg.az + seg.bz) / 2 + seg.nz * 7;
  for (const other of index.near(mx, mz, 8)) {
    if (other === seg) continue;
    if (other.nx * seg.nx + other.nz * seg.nz > -0.6) continue;
    if (segmentDistance(mx, mz, other).d < 7) return true;
  }
  return false;
}

// How far the air in front of a wall stays clear at a given height — a wall
// with another building a few metres in front of it is not a place for a
// poster, and a bird cannot hover there to read one.
function frontClear(index, seg, y, limit) {
  if (typeof index.roofAt !== 'function') return limit;
  const mx = (seg.ax + seg.bx) / 2, mz = (seg.az + seg.bz) / 2;
  for (let d = 6; d <= limit; d += 6) if (index.roofAt(mx + seg.nx * d, mz + seg.nz * d) > y - 4) return d - 6;
  return limit;
}

// Free room along a wall for `n` posters of width `w`: the first gap that fits
// them side by side, remembering what earlier venues on the same wall took.
function takeSpan(seg, w, n) {
  const need = n * w + (n - 1) * SIGN_GAP + 2 * SIGN_MARGIN;
  const taken = seg.used.slice().sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [u0, u1] of [...taken, [seg.len, seg.len]]) {
    if (u0 - cursor >= need) { seg.used.push([cursor, cursor + need]); return cursor + SIGN_MARGIN; }
    cursor = Math.max(cursor, u1);
  }
  return null;
}

// Where a venue's posters go: the best wall near the address, and a slot per
// poster on it. The wall is scored for size and nearness, walls that face
// another wall are avoided, and a wall already carrying signs shares its
// length. Rows are used only when the wall is too short for a single row.
function planSignage(index, venue, anchor, count) {
  if (!count) return null;
  const x = anchor.world.x, z = anchor.world.z, ground = anchor.ground || 0;
  const cands = [];
  for (const seg of index.near(x, z, 44)) {
    const height = seg.y1 - seg.y0;
    if (seg.len < 10 || height < WALL_MIN_H || seg.y1 < ground + 6) continue;
    const { d } = segmentDistance(x, z, seg);
    if (d > 44) continue;
    const front = frontClear(index, seg, seg.y1 - SIGN_TOP_GAP - 8, 48);
    if (front < 12) continue;
    const score = (Math.min(seg.len, 40) / 40) * (Math.min(height, 40) / 40) / (1 + d / 18) * (0.5 + 0.5 * front / 48);
    cands.push({ seg, d, score, front });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const { seg, front } of cands.slice(0, 8)) {
    if (wallBlocked(index, seg)) continue;
    const height = seg.y1 - seg.y0;
    const w = Math.max(9, Math.min(24, seg.len * 0.5));
    const rowPitch = w * SIGN_ASPECT.max + SIGN_GAP;
    const rowsFit = Math.max(1, Math.floor((height - SIGN_TOP_GAP - 2 + SIGN_GAP) / rowPitch));
    const perRowFit = Math.max(1, Math.floor((seg.len - 2 * SIGN_MARGIN + SIGN_GAP) / (w + SIGN_GAP)));
    let n = Math.min(count, rowsFit * perRowFit);
    if (height < w * SIGN_ASPECT.min + SIGN_TOP_GAP + 1) continue;               // not even one poster fits
    for (; n > 0; n -= 1) {
      const cols = Math.min(n, perRowFit), rows = Math.ceil(n / cols);
      if (rows > rowsFit) continue;
      const u0 = takeSpan(seg, w, cols);
      if (u0 === null) continue;
      const slots = [];
      for (let i = 0; i < n; i += 1) {
        const col = i % cols, row = Math.floor(i / cols);
        slots.push({ u: u0 + col * (w + SIGN_GAP) + w / 2, yTop: seg.y1 - SIGN_TOP_GAP - row * rowPitch, w });
      }
      return { seg, slots, w, front };
    }
  }
  return null;
}

function buildBillboards(TW, city) {
  const T = window.__SF_THREE;
  if (!T || !city.scene || !TW.state.venues) return null;
  const root = new T.Group();
  root.name = 'Building signage';
  city.scene.add(root);

  let index = null;         // the wall grid, once the pass is done
  let plans = new Map();    // venue key → { seg, slots, members, panels }
  let pending = 0;
  const touched = new Set(); // walls that carry signs, so a replan can free them
  const planOf = new Map();  // event → its plan, for the bird's tour
  // Where to hover to read a building's posters: in front of the wall, level
  // with the top row, looking at it.
  const VISIT_STANDOFF = 46;
  const visitPoint = (event) => {
    const p = planOf.get(event);
    if (!p) return null;
    const seg = p.seg, slots = p.slots;
    const u = slots.reduce((sum, slot) => sum + slot.u, 0) / slots.length;
    const dx = (seg.bx - seg.ax) / seg.len, dz = (seg.bz - seg.az) / seg.len;
    const y = Math.max(24, slots[0].yTop - 9);
    // As far back as the street allows, never inside the building opposite.
    let stand = Math.min(VISIT_STANDOFF, Math.max(14, (p.front || VISIT_STANDOFF) - 8));
    const roofAt = index && index.roofAt;
    if (roofAt) while (stand > 14 && roofAt(seg.ax + dx * u + seg.nx * stand, seg.az + dz * u + seg.nz * stand) > y - 6) stand -= 4;
    const x = seg.ax + dx * u + seg.nx * stand, z = seg.az + dz * u + seg.nz * stand;
    const under = roofAt ? roofAt(x, z) : -Infinity;
    return { x, z, y: Number.isFinite(under) ? Math.max(y, under + 8) : y, face: Math.atan2(-seg.nx, -seg.nz) };
  };
  // Read the actual displayed poster, never a hidden placeholder or a slot
  // whose remote image failed to load. No roof queries in the proximity loop.
  const anchorPoint = (event) => {
    const panel = planOf.get(event)?.panels.get(event);
    return panel && panel.visible ? panel.position : null;
  };
  window.__twSigns = { visitPoint, anchorPoint, has: (event) => planOf.has(event), count: () => planOf.size };

  const planVenue = (venue) => {
    const members = (venue.members || [])
      .filter((e) => e.onMap && (e.claimed || e.approxLocation) && !e.wantsVehicle && e.image && e.world)
      .sort((a, b) => (b.rsvp || 0) - (a.rsvp || 0))
      .slice(0, SIGN_MAX_PER_VENUE);
    if (!members.length) return;
    const lead = members[0];
    // The address itself, not the spot the placement spiral gave a second
    // event in the same block: the wall has to belong to this building.
    const geo = window.__sfGeo;
    const world = lead.claimed && geo && Number.isFinite(+lead.lng) && Number.isFinite(+lead.lat) ? geo.Hn(+lead.lng, +lead.lat, 0) : lead.world;
    const plan = planSignage(index, venue, { world: { x: world.x, z: world.z }, ground: lead.ground }, members.length);
    if (!plan) return;
    touched.add(plan.seg);
    plan.members = members.slice(0, plan.slots.length);
    plan.panels = new Map();
    plans.set(venue.key, plan);
    for (const member of plan.members) planOf.set(member, plan);
  };

  // One venue per slice, with a millisecond budget: planning walks the grid,
  // and there are a few hundred venues.
  const plan = () => {
    if (pending) clearTimeout(pending);
    for (const p of plans.values()) for (const panel of p.panels.values()) { panel.geometry.dispose(); panel.material.dispose(); }
    root.clear();
    plans = new Map();
    planOf.clear();
    for (const seg of touched) seg.used = [];
    touched.clear();
    const uses = new Map();
    for (const event of TW.state.events || []) if (event.image) uses.set(event.image, (uses.get(event.image) || 0) + 1);
    for (const event of TW.state.events || []) event.genericPoster = !!event.image && (uses.get(event.image) || 0) >= 4;
    const queue = (TW.state.venues || []).slice();
    const step = () => {
      const until = performance.now() + SIGN_BUDGET_MS;
      while (queue.length && performance.now() < until) {
        try { planVenue(queue.shift()); } catch (error) { console.error('[TW signage]', error); }
      }
      pending = queue.length ? setTimeout(step, 0) : 0;
    };
    pending = setTimeout(step, 0);
  };

  // A poster goes up as soon as the event is planned. If its remote cover is
  // blocked by hosted-page CORS, the generated event poster stays on the wall;
  // a later successful cover load upgrades the same panel in place.
  const raise = (plan, i, event) => {
    const existing = plan.panels.get(event);
    if (existing) {
      if (event.coverImg && !existing.userData.withCover) {
        const texture = coverTexture(T, event, existing.userData.aspect);
        (texture.userData.meshes ||= []).push(existing);
        existing.material.uniforms.map.value = texture;
        existing.userData.withCover = true;
      }
      return existing;
    }
    const im = event.coverImg;
    const aspect = im ? Math.max(SIGN_ASPECT.min, Math.min(SIGN_ASPECT.max, im.height / im.width)) : 1;
    const slot = plan.slots[i], seg = plan.seg;
    const w = slot.w, h = w * aspect;
    const dx = (seg.bx - seg.ax) / seg.len, dz = (seg.bz - seg.az) / seg.len;
    const texture = im ? coverTexture(T, event, aspect) : posterTexture(T, TW, event);
    const panel = new T.Mesh(new T.PlaneGeometry(w, h), billboardMaterial(T, city, texture));
    panel.position.set(seg.ax + dx * slot.u + seg.nx * SIGN_CLEAR, slot.yTop - h / 2, seg.az + dz * slot.u + seg.nz * SIGN_CLEAR);
    panel.rotation.y = Math.atan2(seg.nx, seg.nz);
    panel.userData.ev = event; panel.userData.textured = true; panel.userData.withCover = !!im; panel.userData.aspect = aspect;
    panel.userData.appear = 0; panel.scale.setScalar(0.01);            // it grows onto the glass over a few frames
    (panel.material.uniforms.map.value.userData.meshes ||= []).push(panel);
    root.add(panel);
    plan.panels.set(event, panel);
    return panel;
  };

  // Signs answer to the bird: the ones you are flying at light up, the ones
  // across the bay are not drawn at all. Covers for the buildings ahead start
  // loading before you can read them, so the wall is lit by the time you arrive.
  const NEAR_SIGN = 190, MID_SIGN = 520, FAR_SIGN = 900, LOAD_SIGN = 1100;
  const pulse = () => {
    const cam = city.camera || city.flightCharacter;
    if (!cam || !cam.position || !index) return;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (const p of plans.values()) {
      const seg = p.seg;
      const d = Math.hypot((seg.ax + seg.bx) / 2 - cx, seg.y1 - cy, (seg.az + seg.bz) / 2 - cz);
      if (d > FAR_SIGN) { for (const panel of p.panels.values()) panel.visible = false; if (d > LOAD_SIGN) continue; }
      p.members.forEach((event, i) => {
        if (event.image && !event.coverImg && !event.coverFailed && !event.coverPending && !event.coverNear && d <= LOAD_SIGN && typeof TW.loadCover === 'function') {
          event.coverNear = true;
          try { TW.loadCover(event); } catch (error) { event.coverFailed = true; }
        }
        if (d > FAR_SIGN) return;
        const panel = raise(p, i, event);
        panel.visible = true;
        if (panel.userData.appear < 1) { panel.userData.appear = Math.min(1, panel.userData.appear + 0.14); const k = panel.userData.appear; panel.scale.setScalar(0.01 + 0.99 * (1 - (1 - k) * (1 - k))); }
        const want = d < NEAR_SIGN ? 1.32 : d < MID_SIGN ? 1.12 : 0.92;
        const u = panel.material.uniforms.uLight;
        u.value += (want - u.value) * 0.25;
      });
    }
  };
  setInterval(pulse, 110);

  // Let the city finish its own first frames before signage starts, and then
  // follow the data: the calendar arrives after the world is ready (later
  // still in the single-file build, where the whole feed is inlined), so the
  // venue list we plan from can be empty or half-built at that point. Watch a
  // cheap signature of it rather than trusting one timer.
  let signature = '';
  const fenceSignature = () => { const f = TW.state.fence; return f ? [f.minX,f.maxX,f.minZ,f.maxZ].join(':') : ''; };
  const sync = () => {
    if (!index) return;
    if (fenceSignature() !== indexedFence) scheduleIndex();
    const venues = TW.state.venues || [];
    let signed = 0;
    for (const venue of venues) for (const member of venue.members || []) if (member.onMap && (member.claimed || member.approxLocation) && !member.wantsVehicle) signed += 1;
    const next = `${venues.length}:${signed}`;
    if (next === signature) return;
    signature = next;
    plan();
  };
  let indexing = false, indexDirty = false, indexTimer = null, indexedRevision = -1, indexedFence = '';
  const start = () => {
    indexTimer = null;
    if (city.disposed) return;
    if (indexing) { indexDirty = true; return; }
    indexing = true; indexDirty = false;
    const revision = city.streaming?.revision || 0, fenceKey = fenceSignature();
    // The event area, but never more than a few kilometres around downtown:
    // one stray coordinate in the feed would otherwise size the roof grid to
    // the whole bay.
    const GEO = window.__sfGeo, centre = GEO ? GEO.Hn(DOWNTOWN.lng, DOWNTOWN.lat, 0) : { x: 0, z: 0 };
    const REACH = 3200, fence = TW.state.fence;
    const bounds = {
      minX: Math.max(centre.x - REACH, fence ? fence.minX - 200 : -Infinity), maxX: Math.min(centre.x + REACH, fence ? fence.maxX + 200 : Infinity),
      minZ: Math.max(centre.z - REACH, fence ? fence.minZ - 200 : -Infinity), maxZ: Math.min(centre.z + REACH, fence ? fence.maxZ + 200 : Infinity),
    };
    buildWallIndex(city, bounds, (built) => {
      indexing = false; indexedRevision = revision; indexedFence = fenceKey;
      if (built) {
        index = built; window.__twWalls = built;
        signature = ''; sync();
      } else console.warn('[TW signage] no building mesh found; signs stay off');
      if ((indexDirty || (city.streaming?.revision || 0) !== indexedRevision) && !city.disposed) scheduleIndex();
    });
  };
  const scheduleIndex = () => {
    if (indexTimer === null && !city.disposed) indexTimer = setTimeout(start, 1200);
  };
  const onGeometry = event => { if (event.detail?.city === city) scheduleIndex(); };
  window.addEventListener('sf-city-geometry-updated', onGeometry);
  const previousDispose = city.dispose.bind(city);
  city.dispose = () => { window.removeEventListener('sf-city-geometry-updated', onGeometry); clearTimeout(indexTimer); clearInterval(watcher); previousDispose(); };
  indexTimer = setTimeout(start, SIGN_START_DELAY);
  const watcher = setInterval(sync, 2500);
  // Live calendar updates may change the event fence long after two minutes.
  // Keep this small signature check until the city is disposed.
  // Rebuild whenever the fleet changes (a refresh, or an event ending).
  const originalRebuild = TW.rebuildWorld;
  if (typeof originalRebuild === 'function') TW.rebuildWorld = () => { originalRebuild(); try { signature = ''; sync(); } catch (error) { console.error('[TW signage]', error); } };
  return root;
}


/* ------------------------------------------------ the network panel goes away */
// The "Public World · N flying" card sat over the skyline and re-rendered its
// roster on every presence update. Multiplayer keeps running; the card only
// comes back if the connection actually needs the player (an error, or a
// reconnect), which is the one time it says something useful.
// A small pill instead of a panel: how many people are flying, and who, only
// when you ask. The panel itself stays hidden unless the connection needs you.
function mountWhoIsHere() {
  if (document.getElementById('tw-who')) return;
  const pill = document.createElement('button');
  pill.id = 'tw-who';
  pill.type = 'button';
  pill.title = 'Who is flying right now';
  pill.innerHTML = '<i></i><span>—</span>';
  document.body.appendChild(pill);

  let list = null;
  const closeList = () => { if (list) { list.remove(); list = null; } };
  const names = () => {
    const players = (window.__sfNet?.players || []).filter((p) => p.connected);
    if (players.length) return players;
    const me = window.TW?.state?.user;
    return me ? [{ id: 'me', self: true, connected: true, name: me.name || 'you', handle: me.handle || '', color: '#34262f' }] : null;
  };

  const renderList = () => {
    if (!list) return;
    list.replaceChildren();
    const players = names();
    if (!players) { const note = document.createElement('p'); note.textContent = 'Nobody else is flying right now.'; list.append(note); return; }
    const sorted = players.slice().sort((a, b) => (a.self ? -1 : b.self ? 1 : (a.metres ?? 1e9) - (b.metres ?? 1e9)));
    for (const player of sorted) {
      const li = document.createElement('li'), dot = document.createElement('i');
      const name = document.createElement('span'), tag = document.createElement('small');
      dot.style.background = player.color || '#c6583c';
      const handle = (player.handle || '').replace(/^@+/, '');
      name.textContent = handle ? '@' + handle : (player.name || 'Player');
      tag.textContent = player.self ? 'you'
        : player.metres == null ? 'somewhere over the city'
        : player.metres > 1000 ? (player.metres / 1000).toFixed(1) + ' km away' : player.metres + ' m away';
      li.append(dot, name, tag);
      if (!player.self && typeof window.__sfNet?.flyBeside === 'function') {
        const go = document.createElement('button');
        go.type = 'button'; go.className = 'tw-fly-beside'; go.textContent = 'Fly beside';
        go.addEventListener('click', (event) => { event.stopPropagation(); window.__sfNet.flyBeside(player.id); closeList(); });
        li.append(go);
      }
      list.append(li);
    }
  };

  pill.addEventListener('click', () => {
    if (list) return closeList();
    list = document.createElement('ul');
    list.id = 'tw-who-list';
    document.body.appendChild(list);
    renderList();
  });
  window.addEventListener('pointerdown', (event) => {
    if (list && !list.contains(event.target) && event.target !== pill && !pill.contains(event.target)) closeList();
  }, true);

  setInterval(() => {
    const players = (window.__sfNet?.players || []).filter((p) => p.connected);
    const online = players.length > 0;
    pill.dataset.online = String(online);
    pill.querySelector('span').textContent = online ? `${players.length} in the city` : 'solo';
    renderList();
  }, 3000);
}

function hideNetPanel() {
  const panel = document.getElementById('sfnet');
  if (!panel) return;
  const error = document.getElementById('sfnet-error');
  const retry = document.getElementById('sfnet-retry');
  const sync = () => {
    const needed = (error && !error.hidden && error.textContent.trim()) || (retry && !retry.hidden);
    panel.style.display = needed ? '' : 'none';
    if (!needed) panel.open = false;
  };
  sync();
  const observer = new MutationObserver(sync);
  for (const node of [error, retry]) if (node) observer.observe(node, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
}

/* ------------------------------------------------------ always a way back out */
// A dialog you cannot dismiss is the worst bug in a game you fly through:
// Escape and a click on the backdrop both close it, whatever opened it.
function installModalEscape() {
  const modal = document.getElementById('tw-modal');
  if (!modal) return;
  const close = () => { if (!modal.hidden) { modal.hidden = true; modal.innerHTML = ''; } };
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!modal.hidden) { event.stopPropagation(); close(); return; }
    const panel = document.getElementById('sfnet');
    if (panel && panel.open) panel.open = false;
  }, true);
  modal.addEventListener('pointerdown', (event) => { if (event.target === modal) close(); });
}

/* --------------------------------------------------- the ships that carry the week */
// The host's event and the week's opening acts fly larger so the eye finds them
// from anywhere over downtown. Five at most: past that, nothing reads as big.
const FEATURED_SCALE = 3.0;
const SPOTLIGHT_SCALE = 2.2;
const SPOTLIGHT_MAX = 5;

function featureShips(TW) {
  const apply = () => {
    const events = TW.state.events || [];
    const featured = events.find((e) => e.featured);
    const others = events
      .filter((e) => e.spotlightPick && !e.featured && e.ship)
      .sort((a, b) => (b.rsvp || 0) - (a.rsvp || 0))
      .slice(0, SPOTLIGHT_MAX - 1);
    for (const [event, scale] of [[featured, FEATURED_SCALE], ...others.map((e) => [e, SPOTLIGHT_SCALE])]) {
      if (!event || !event.ship || event.ship.userData.twScaled) continue;
      event.ship.userData.twScaled = true;
      event.ship.scale.multiplyScalar(scale);
    }
  };
  apply();
  setTimeout(apply, 1200);
  const original = TW.rebuildWorld;
  if (typeof original === 'function') TW.rebuildWorld = () => { original(); try { apply(); } catch (error) { console.error('[TW spotlight]', error); } };
}

/* ------------------------------------- the host's own hoarding, on open ground */
// The host event has no venue yet, so it has no building to wear a sign on.
// Instead it gets a hoarding on the open ground under its ship — the kind that
// stands in an empty lot — which is also the answer to "no address yet".
const HOARDING = { w: 88, h: 50, lift: 6 };

function hostHoarding(TW, city) {
  const T = window.__SF_THREE;
  if (!T || !city.scene) return;
  const group = new T.Group();
  group.name = 'Host hoarding';
  city.scene.add(group);

  const openGroundNear = (x, z, ground) => {
    const probe = TW.roofHeightAt;
    if (typeof probe !== 'function') return { x, z };
    for (let radius = 90; radius <= 420; radius += 60) {
      for (let k = 0; k < 12; k += 1) {
        const angle = k * Math.PI / 6 + radius * 0.11;
        const px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
        const roof = probe(px, pz, HOARDING.w * 0.6);
        if (!Number.isFinite(roof) || roof <= ground + 3) return { x: px, z: pz };
      }
    }
    return { x, z };
  };

  const build = () => {
    const ev = (TW.state.events || []).find((e) => e.featured);
    if (!ev || !ev.world || group.children.length) return;
    const ground = ev.ground || 0;
    const spot = openGroundNear(ev.world.x, ev.world.z, ground);
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = Math.atan2(ev.world.x - spot.x, ev.world.z - spot.z);

    const board = new T.Mesh(new T.PlaneGeometry(HOARDING.w, HOARDING.h), billboardMaterial(T, city, posterTexture(T, TW, ev)));
    board.position.set(0, ground + HOARDING.lift + HOARDING.h / 2, 0);
    board.userData.ev = ev;
    group.add(board);
    const refresh = setInterval(() => { refreshPosterIfCoverArrived(T, TW, board); if (board.material.uniforms.map.value.userData.withCover) clearInterval(refresh); }, 1500);


    // It stands on a low plinth — a wall in an empty lot, not a sign on stilts.
    const plinth = new T.Mesh(new T.BoxGeometry(HOARDING.w + 6, HOARDING.lift, 5), city.createSolidMaterial('sign-mast', '#34262f'));
    plinth.position.set(0, ground + HOARDING.lift / 2, -1.2);
    group.add(plinth);
  };

  setTimeout(build, 1400);
  const original = TW.rebuildWorld;
  if (typeof original === 'function') TW.rebuildWorld = () => { original(); try { build(); } catch (error) { console.error('[TW hoarding]', error); } };
  return group;
}

/* ------------------------------------------------- tapping a sign selects it */
// The game's own picker knows ships and kites; the signs are ours. A tap the
// game did not answer is cast against the signage instead — the nearest panel
// under the pointer, within reading distance, opens its card. A sign is a flat
// rectangle, so the test is a ray against its own plane, no raycaster needed.
const SIGN_PICK_RANGE = 700;   // metres: signs are read from the street, not picked from the skyline
function installSignPicking(TW, city, roots) {
  const T = window.__SF_THREE;
  const el = city.renderer && city.renderer.domElement;
  if (!T || !el) return;
  const origin = new T.Vector3(), dir = new T.Vector3(), local = new T.Vector3(), ldir = new T.Vector3(), inv = new T.Matrix4();
  const hitPanel = (node) => {
    const geo = node.geometry && node.geometry.parameters;
    if (!geo || !Number.isFinite(geo.width) || !Number.isFinite(geo.height)) return null;
    inv.copy(node.matrixWorld).invert();
    local.copy(origin).applyMatrix4(inv);
    ldir.copy(dir).transformDirection(inv);
    if (Math.abs(ldir.z) < 1e-6) return null;
    const t = -local.z / ldir.z;
    if (t <= 0 || t > SIGN_PICK_RANGE) return null;
    const px = local.x + ldir.x * t, py = local.y + ldir.y * t;
    if (Math.abs(px) > geo.width / 2 || Math.abs(py) > geo.height / 2) return null;
    return t;
  };
  let down = null, before = null;
  el.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY, t: performance.now() }; before = TW.state.selected; });
  el.addEventListener('pointerup', (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y), held = performance.now() - down.t, was = before;
    down = null; before = null;
    if (moved > 6 || held > 600) return;
    if (TW.state.selected !== was) return;                 // the game's picker already answered this tap
    const cam = city.camera;
    if (!cam || !cam.matrixWorld) return;
    const rect = el.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1, ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    origin.setFromMatrixPosition(cam.matrixWorld);
    dir.set(nx, ny, 0.5).unproject(cam).sub(origin).normalize();
    let best = null;
    for (const root of roots) {
      if (!root) continue;
      root.traverse((node) => {
        if (!node.isMesh || !node.visible || !node.userData.ev) return;
        const t = hitPanel(node);
        if (t !== null && (!best || t < best.t)) best = { t, ev: node.userData.ev };
      });
    }
    if (best) TW.select(best.ev);
  });
}

/* ------------------------------------------------------------------- boot */
(function boot(n) {
  const TW = window.TW, city = window.__sfCity;
  if (TW && TW.state && TW.state.ready && city) {
    try {
      injectStyles();
      installLinkFallback();
      setTimeout(() => document.querySelector('.flight-hint')?.classList.add('tw-hint-fade'), 14000);
      mountDiscord();
      hideNetPanel();
      mountWhoIsHere();
      installModalEscape();
      installFlightGuide(TW, city);
      installCameraClearance(TW, city);
      installSolidFlight(TW, city);
      installFleetDistance(TW, city);
      installNeighbourCard(TW, city);
      const signage = buildBillboards(TW, city);
      featureShips(TW);
      const hoarding = hostHoarding(TW, city);
      installSignPicking(TW, city, [signage, hoarding]);
    } catch (error) { console.error('[TW extras]', error); }
  } else if (n < 1500) setTimeout(() => boot(n + 1), 60);
})(0);
