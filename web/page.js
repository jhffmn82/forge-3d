// The browser build's page (export_presets.cfg head include): starts the game's engine in a worker (runtime/web.js)
// and links Godot to it (scripts/game.gd): window.forge.send(id, request) out, forge.onReply(id, reply) back. What the
// game keeps (the options, the journal) lives in this page's localStorage, which the worker cannot reach: it is handed
// over with the first request and written back as it changes.
//
// The engine's answers come back on a board of shared memory, read at the start of every frame, not as messages (below).
//
// The engine is one file, and its data another (tools/web.py engine, worker_files), fetched as the worker starts; the
// connection to GitHub's servers can drop mid-load, taking every download in flight with it (Justin 2026-10-28: "The game
// engine did not start", when it was some 340 files). A worker that fails
// before it says it is ready is started again, a second, two, three later and on to five seconds apart, some 25 seconds
// in all (four tries, 6 seconds, were not enough once in the 2026-11-04 sweep), and handed the requests it never answered.
(() => {
  const PREFIX = 'forge-3d:';
  const TRIES = 8;
  const waiting = [];   // the requests sent and not answered yet, in order
  let worker = null, ready = false, tries = 0, first = true;
  const kept = () => {
    const o = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(PREFIX)) o[k.slice(PREFIX.length)] = localStorage.getItem(k);
      }
    } catch { /* storage blocked: the game starts fresh */ }
    return o;
  };
  let showRecord = null, wantRecord = false, recordAsked = false;
  const forge = window.forge = {
    onReply: null,
    onRecord: null,
    audioOuts: [],   // what leaves for the speakers, for a recording's sound (below)
    // A sandbox run on screen or gone (play.gd): the Record button, fetched the first time it is wanted.
    record(on) {
      wantRecord = on;
      if (showRecord) showRecord(on);
      else if (on && !recordAsked) {
        recordAsked = true;
        import('../forge-godot/runtime/record-web.js').then(m => { showRecord = m.mountRecord(forge); showRecord(wantRecord); }, e => console.warn('forge record:', e.message));
      }
    },
    send(id, text) {
      const msg = { id, req: JSON.parse(text), at: performance.now() };
      if (first) { first = false; msg.kept = kept(); }
      waiting.push(msg);
      worker?.postMessage(msg);
    },
  };
  // The visitor's first press or key: nothing sounds in a browser before it, and the music's fade in waits for it
  // (scripts/sound.gd _play_track).
  const pressed = () => { forge.pressed = true; removeEventListener('pointerdown', pressed, true); removeEventListener('keydown', pressed, true); };
  addEventListener('pointerdown', pressed, true);
  addEventListener('keydown', pressed, true);
  // The nodes the game's sound leaves by, kept as Godot connects them: nothing else can hear what the speakers do.
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (to, ...more) {
    if (to === this.context.destination && !forge.audioOuts.includes(this)) forge.audioOuts.push(this);
    return connect.call(this, to, ...more);
  };
  // The engine's answers: a message has to wait its turn on this thread, and while a key repeated, on a machine whose
  // frames fill the time, one came up to 698 ms late against 30 ms with no key down, though frames ran steadily all along
  // (Justin's laptop, 2026-10-31: "i'm wondering if it's some sort of input lag where holding causes it to skip input by
  // overloading something"; "it takes longer for holding input to stall movement, but it still happens"). So the worker
  // writes each answer on a board of shared memory and every frame starts by reading it: a frame does not wait, so an
  // answer does not. The worker's message after each is only a nudge, for when no frame is running. Board: two marks, the
  // next byte to write and the next to read; then from byte 64 the answers, each its id, the engine's ms, its length and
  // its text, -1 for an id meaning the rest of the board was skipped (runtime/web.js writes them).
  // Sharing memory needs the page isolated from other sites', which takes headers GitHub Pages does not send: web/coi-sw.js
  // adds them, after one reload on a first visit. Without that, or with ?link=message for a comparison, answers come as
  // messages and frames queue behind them (below).
  // Not in another site's frame, as on itch.io: a frame is isolated only when the page holding it is, which nothing of
  // this page's can do. There itch's own "SharedArrayBuffer support" option isolates both; without it, the reload would
  // isolate nothing and come again on every visit (its mark lasts a browser session).
  const asked = new URLSearchParams(location.search).get('link');
  if (!self.crossOriginIsolated && asked !== 'message' && navigator.serviceWorker && window.top === window) {
    navigator.serviceWorker.register('coi-sw.js').then(() => navigator.serviceWorker.ready).then(() => {
      // (Once: if that did not isolate it, the game goes on by messages.)
      let last = 0;
      try { last = Number(sessionStorage.getItem(PREFIX + 'isolating')) || 0; sessionStorage.setItem(PREFIX + 'isolating', String(Date.now())); } catch { return; }
      if (Date.now() - last > 15000) location.reload();
    }, e => console.warn('forge link:', e.message));
  }
  const shared = self.crossOriginIsolated && asked !== 'message' ? new SharedArrayBuffer(64 + 16 * 1024 * 1024) : null;
  forge.link = shared ? 'board' : 'message';
  const marks = shared && new Int32Array(shared, 0, 2), words = shared && new Int32Array(shared, 64), bytes = shared && new Uint8Array(shared, 64);
  const reader = new TextDecoder();
  const answered = (id, reply, ms) => {
    const i = waiting.findIndex(m => m.id === id);
    if (i >= 0) {
      // A slow answer says so in the console, with what was asked: what a player sees as a freeze.
      const m = waiting.splice(i, 1)[0], took = performance.now() - m.at;
      if (took > 500) console.warn(`forge engine: ${m.req.op}${m.req.kind ? ' ' + m.req.kind : ''} took ${Math.round(took)} ms (${ms} ms of it the engine's own)`);
    }
    if (forge.onReply) forge.onReply(id, reply);
  };
  const readBoard = () => {
    for (;;) {
      const at = Atomics.load(marks, 1);
      if (at === Atomics.load(marks, 0)) return;
      const id = words[at >> 2], ms = words[(at >> 2) + 1], n = words[(at >> 2) + 2];
      if (id === -1) { Atomics.store(marks, 1, 0); continue; }
      const reply = reader.decode(bytes.slice(at + 12, at + 12 + n));   // (a copy: decode takes no shared memory)
      Atomics.store(marks, 1, at + 12 + ((n + 3) & ~3));
      answered(id, reply, ms);
    }
  };
  // Without the board: while the engine owes an answer, a frame waits its turn behind what is already queued. Run straight
  // from requestAnimationFrame, frames take the main thread ahead of the worker's messages while a key repeats. Posted, a
  // frame queues with them, first come first served. All a frame's callbacks go together, in order: the recorder's copy
  // reads the canvas Godot has just drawn.
  const raf = window.requestAnimationFrame.bind(window), turn = new MessageChannel();
  let due = [];
  turn.port1.onmessage = () => { const now = due; due = []; for (const [f, t] of now) f(t); };
  window.requestAnimationFrame = cb => raf(t => {
    if (shared) { readBoard(); cb(t); return; }
    if (!waiting.length && !due.length) { cb(t); return; }
    if (!due.length) turn.port2.postMessage(0);
    due.push([cb, t]);
  });
  // ?fps=1: the frames this browser draws each second and the second's slowest, at the top of the page. For a look from a
  // real window: the tests' browsers have no screen, read every frame back from the graphics card and so run slower than
  // a player's (docs/launch-tests.md, "What the bench's frames a second are").
  if (new URLSearchParams(location.search).get('fps')) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:98;padding:2px 8px;border-radius:4px;background:rgba(8,11,17,.8);color:#eaf4ff;font:13px monospace;pointer-events:none;';
    let n = 0, worst = 0, last = 0, since = 0;
    const count = t => {
      if (!box.isConnected) (document.body ?? document.documentElement).appendChild(box);
      if (last) worst = Math.max(worst, t - last);
      last = t;
      since ||= t;
      n++;
      if (t - since >= 1000) {
        box.textContent = `${Math.round((n - 1) * 1000 / (t - since))} fps, slowest frame ${Math.round(worst)} ms`;
        n = 1; worst = 0; since = t;
      }
      raf(count);
    };
    raf(count);
  }
  const start = () => {
    tries++;
    ready = false;
    worker = new Worker('forge-godot/runtime/web.js', { type: 'module' });
    if (shared) worker.postMessage({ board: shared });
    worker.onmessage = e => {
      const d = e.data;
      if (d.ready) ready = true;
      else if (d.nudge) readBoard();
      else if (d.keep !== undefined) { try { localStorage.setItem(PREFIX + d.keep, d.text); } catch { /* not kept */ } }
      else if (d.id !== undefined) answered(d.id, d.reply, d.ms);
    };
    worker.onerror = e => {
      if (!ready && tries < TRIES) {
        console.warn('forge engine: did not load, trying again', e.message ?? '');
        worker.terminate();
        worker = null;
        setTimeout(() => { start(); for (const m of waiting) worker.postMessage(m); }, 1000 * Math.min(5, tries));
        return;
      }
      console.error('forge engine:', e.message, e.filename, e.lineno);
      const p = document.createElement('div');
      p.textContent = 'The game engine did not start (' + (e.message || 'a file did not come') + '). Reload the page to try again.';
      p.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:99;color:#e8b44a;font:14px monospace;';
      document.body.appendChild(p);
    };
  };
  start();
})();

// The 2D game's loading screen while Godot's own files come (forge-rewrite index.html #loadVeil, RB5): the title and
// "Loading game… N%", the code counted as 0-85%, read off Godot's own progress bar; "(slow connection, still loading)"
// after 10 s with nothing new. It goes as Godot's starts (its status overlay gone), where scripts/boot.gd says the rest
// in the same words and look. (Godot's bare bar showed instead; 2026-10-30.)
// In the game's own letters, as the 2D game's is and as boot.gd goes on (the two fonts beside the page: tools/web.py
// shell): in the browser's own serif and monospace the title changed its letters as Godot took over, five seconds in.
// Up as this script runs, in the head: put up only once the whole page was read, it waited for Godot's loader (index.js,
// 0.3 MB, which the page's reading stops for), and the page stood black that long. And what stops the game from starting
// is said on it: Godot writes that on its own overlay, which is under this one, so a browser with no WebGL 2 said
// "Loading game… 0% (slow connection, still loading)" for good.
(() => {
  const touch = matchMedia('(pointer: coarse)').matches;
  const faces = document.createElement('style');
  faces.textContent = "@font-face{font-family:'Grenze Gotisch';font-weight:700;font-display:block;src:url(web/fonts/grenze-gotisch-700.woff2) format('woff2')}"
    + "@font-face{font-family:'IBM Plex Mono';font-weight:400;font-display:block;src:url(web/fonts/ibm-plex-mono-400.woff2) format('woff2')}";
  document.head.appendChild(faces);
  const veil = document.createElement('div');
  veil.style.cssText = `position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#080b11;color:#bdc2d8;font:${touch ? 16 : 14}px 'IBM Plex Mono',monospace;text-align:center;padding:0 16px;`;
  const h = document.createElement('h1'), p = document.createElement('p');
  h.textContent = 'Forge of the Elements';
  h.style.cssText = `font:700 ${touch ? 34 : 32}px/1.1 'Grenze Gotisch',serif;color:#e8b44a;margin:0;`;
  p.style.margin = '0';
  p.textContent = 'Loading game… 0%';
  veil.append(h, p);
  (document.body ?? document.documentElement).appendChild(veil);
  let said = p.textContent, at = performance.now(), seen = false;
  const tick = setInterval(() => {
    const status = document.getElementById('status'), bar = document.getElementById('status-progress'), notice = document.getElementById('status-notice');
    seen ||= !!status;
    if (!seen) return;   // (the page's body is not read yet)
    if (notice && notice.style.display === 'block') {
      // Godot's own words for what is missing, or for what failed, said plainly here.
      const why = (notice.innerText || notice.textContent || '').trim();
      p.textContent = /WebGL/i.test(why)
        ? 'This browser cannot draw the game: it has no WebGL 2. Try a current Chrome, Edge, Firefox or Safari, with hardware acceleration turned on.'
        : `The game could not start. ${why.replace(/^Error\s*/i, '')} Reload the page to try again.`;
      p.style.maxWidth = '34em';
      clearInterval(tick);
      return;
    }
    if (!status || status.style.display === 'none' || status.style.visibility === 'hidden' || getComputedStyle(status).display === 'none') {
      clearInterval(tick); veil.remove(); return;
    }
    const words = bar && bar.max > 0 ? `Loading game… ${Math.min(85, Math.round(85 * bar.value / bar.max))}%` : said.replace(/ \(slow.*$/, '');
    if (words !== said.replace(/ \(slow.*$/, '')) { said = words; at = performance.now(); p.textContent = words; }
    else if (performance.now() - at > 10000 && !said.includes('slow')) { said = `${words} (slow connection, still loading)`; p.textContent = said; }
  }, 100);
})();

// What draws the game, said when it is not the graphics card; and the game taken up again when the browser's graphics
// stop under it (2026-11-11). A browser that has given up on the card draws in software, a frame a second, and says
// nothing: Justin's laptop, where the game had run at its screen's rate the day before ("the game takes a super long
// time to load now, what happened?", "I'm getting like 1 FPS in game right now", "it used to run just fine", "I'm not
// restarting my browser every time i want to play the game"; the test readout's last line named the Microsoft Basic
// Render Driver). Chrome does that for the rest of its session once its graphics process has died three times (shown
// on Chrome 157: docs/launch-tests.md), and a page under which it dies is told only that its WebGL context is lost.
// Godot's answer to that was a browser alert, "WebGL context lost, please reload the page", and a picture that stood
// still. Now:
// - As the page opens the card is asked for by name, and software drawing is said on the page.
// - A lost context is kept in the browser's storage: when, the build, the floor, how long the page had been up, whether
//   the safe mode was on, and the console's last lines (the last six losses). The engine's alert is not shown; the page
//   says what happened and loads itself again twelve seconds on (Chrome refuses every page a context for ten seconds
//   after one is lost), unless it had done so within the last two minutes: then it says so and waits for the visitor.
// - For a day after a loss the game runs in a safe graphics mode: no shaders built ahead (shader-warm.js) and the cave
//   ground drawn as it was before its cache (main.gd, ?ground=live), the two newest and heaviest things it asks of a
//   graphics driver. Not known to be what a driver dies of: the record says whether losses go on with them off.
//   ?safe=on and ?safe=off to try either.
// - The test readout (?watch=1, main.gd _card) says how often and when, or that it never happened in this browser.
// The card is asked of a WebGL 1 context on a canvas of its own: the first asking for WebGL 2 is shader-warm.js's cue.
(() => {
  const KEY = 'forge3d-graphics-lost', SOFT = /swiftshader|basic render|llvmpipe|softpipe|software/i, DAY = 864e5;
  const kept = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const build = () => document.querySelector('meta[name="forge-build"]')?.content ?? 'dev';
  const args = new URLSearchParams(location.search), asked = args.get('safe');
  const safe = asked ? asked !== 'off' : kept().some(e => Date.now() - Date.parse(e.at) < DAY);   // (as shader-warm.js reckons it)
  // What draws the page, asked at once, before the engine starts.
  let card = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl'), x = gl?.getExtension('WEBGL_debug_renderer_info');
    card = x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : '';
    // (Let go by itself with its canvas. Not lost on purpose to free it: a browser counts lost contexts against a page.)
  } catch { card = ''; }
  // A browser drawing in software is not asked to change anything (Justin 2026-11-11: "i want this game to run on itch
  // and I don't want them to change default chrome settings to play it"), and the game's picture is not changed for it
  // either. A smaller, plainer picture was taken by itself there for one build (the page's pixels the window's own,
  // not the screen's finer ones; the 3D half that each way and smaller yet while the frames stayed few, main.gd
  // ?small=; no light casting a shadow, ?lamp=off, ?sky=flat: on Windows' software renderer, this PC's processor, the
  // Caverns' 6 frames a second became 21, docs/launch-tests.md) and he threw it out on sight on his laptop ("this
  // looks fucking terrible", "i am not happy with what you have done to my game"). It is ?soft=on now, for a look,
  // and never taken unasked.
  const soft = args.get('soft') === 'on';
  window.forgeSafe = soft ? { small: '0.5', lamp: 'off', sky: 'flat' } : safe ? { ground: 'live' } : null;   // (page arguments the game reads as if they were on the address: game.gd page_arg)
  if (soft) {
    const real = window.devicePixelRatio || 1;
    window.forgeRatio = real;
    try { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => Math.min(real, 1) }); } catch { /* as it is */ }
  }
  // The console's last lines, for the record of a loss: what the game was doing.
  const tail = [];
  for (const k of ['log', 'warn', 'error']) {
    const real = console[k].bind(console);
    console[k] = (...a) => {
      try {
        const line = a.map(String).join(' ');
        if (!line.startsWith('WATCH')) { tail.push(`${(performance.now() / 1000).toFixed(1)}s ${line.slice(0, 140)}`); if (tail.length > 8) tail.shift(); }
      } catch { /* not kept */ }
      real(...a);
    };
  }
  const say = (words, small) => {
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.textContent = `${words} (Click this to hide it.)`;
    box.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:100;box-sizing:border-box;width:max-content;max-width:min(46em,calc(100vw - 24px));padding:10px 14px;border:1px solid #7a6231;border-radius:6px;background:rgba(8,11,17,.95);color:#e8b44a;font:14px/1.45 'IBM Plex Mono',monospace;text-align:left;cursor:pointer;";
    if (small) {
      const more = document.createElement('div');
      more.textContent = small;
      more.style.cssText = 'margin-top:8px;color:#8f8a78;font-size:11px;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere;';
      box.appendChild(more);
    }
    box.addEventListener('click', () => box.remove());
    (document.body ?? document.documentElement).appendChild(box);
  };
  const told = () => {
    const list = kept(), last = list[list.length - 1];
    return last ? `graphics lost ${list.length} time${list.length > 1 ? 's' : ''} in this browser, last ${last.at.slice(0, 16).replace('T', ' ')}Z on floor ${last.floor}, ${last.up} s into build ${last.build}${last.safe ? ' in safe mode' : ''}` : 'graphics never lost in this browser';
  };
  const detail = () => {
    const last = kept().pop();
    return `${told()}${safe ? '; safe mode on' : ''}${last?.tail?.length ? '\n' + last.tail.slice(-5).join('\n') : ''}`;
  };
  window.forgeGraphics = () => `${told()}${safe ? '; safe mode on' : ''}${soft ? `; software drawing mode (the screen's pixel ratio ${window.forgeRatio})` : ''}`;   // (the test readout's)
  // The game's own context lost. Heard on the way down to the canvas, before the engine's own listener, which is not let hear it.
  addEventListener('webglcontextlost', e => {
    if (e.target?.id !== 'canvas') return;
    e.stopImmediatePropagation();
    const list = kept(), again = list.some(x => Date.now() - Date.parse(x.at) < 120000);
    list.push({ at: new Date().toISOString(), build: build(), floor: window.forgeFloor || 0, up: Math.round(performance.now() / 1000), card, safe, tail: tail.slice() });
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-6))); } catch { /* not kept */ }
    console.error('forge graphics: the WebGL context was lost');
    if (again) say('The browser\'s graphics stopped under the game again, and its picture stands still. Reload the page to go on.', detail());
    else {
      say('The browser\'s graphics stopped under the game. It starts again by itself in a few seconds.', detail());
      setTimeout(() => location.reload(), 12000);
    }
  }, true);
  const look = () => {
    const last = kept().pop(), fresh = last && Date.now() - Date.parse(last.at) < 600000;
    if (SOFT.test(card)) {
      console.warn('forge graphics: drawn in software,', card);
      say(soft
        ? 'This browser is not drawing with the graphics card just now, and the smaller, plainer picture was asked for (?soft=on).'
        : 'This browser is not drawing with the graphics card just now, so the game will be very slow. Its speed comes back by itself once the browser is using the card again, which a restart of the browser usually does.', detail());
    } else if (fresh) {
      say('The browser\'s graphics stopped a moment ago, and the game has started again. For a day it runs in a safe graphics mode: floors take a little longer to appear.', detail());
    }
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', look); else look();
})();

// The props' 3D models come a small pack each as a floor wants them (scripts/models.gd); the one pack they came in, and
// the browser cache it was kept in, are gone (2026-10-28).
(async () => { try { await caches.delete('forge-3d-models'); } catch { /* no cache storage here */ } })();

// The art, sounds and models come packed in a few bundles (tools/web.py pack: itch.io takes at most 1,000 files a game),
// and the game asks for each by its own path as before (scripts/net.gd, through Godot's fetch). Asked for here, one is
// answered from its bundle with its bytes alone (a Range request), so a floor still fetches only its own; and kept in
// cache storage by the file's own hash (bundles/index.json), so a later visit, after a new build too, fetches only what
// is new. The browser's own cache is passed by: Safari and Firefox keep no part of a file in it.
(() => {
  const site = new URL('.', location.href), real = window.fetch.bind(window);
  const PACKED = /^(models\/.+\.pck|forge-(godot|rewrite)\/assets\/.+\.(webp|png|jpg|mp3))$/;
  const TYPE = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', mp3: 'audio/mpeg', pck: 'application/octet-stream' };
  const list = (async () => {
    for (let i = 0; i < 4; i++) {   // (tried again as net.gd tries: a connection dropped mid-load takes it with it)
      if (i) await new Promise(r => setTimeout(r, 1000 << (i - 1)));
      try {
        const r = await real(new URL('bundles/index.json', site), { cache: 'no-cache' });
        if (r.ok) return await r.json();
        if (r.status === 404) break;
      } catch { /* tried again */ }
    }
    console.warn('forge bundles: their list did not come');
    return null;
  })();
  const store = (async () => { try { return await caches.open('forge-3d-files'); } catch { return null; } })();
  const coming = new Map();   // a file's bytes on their way, by its path: the title's pictures are asked for twice
  let wholeSaid = false;
  const entry = (index, path) => {
    const at = path.lastIndexOf('/') + 1;
    return index?.files[path.slice(0, at)]?.[path.slice(at)];
  };
  const read = async (path, [b, at, n, hash], bundles, priority) => {
    const key = new URL(`${path}?v=${hash}`, site).href, cache = await store;
    try {
      const hit = cache && await cache.match(key);
      if (hit) return await hit.arrayBuffer();
    } catch { /* fetched */ }
    const r = await real(new URL('bundles/' + bundles[b], site), { headers: { Range: `bytes=${at}-${at + n - 1}` }, cache: 'no-store', priority });
    if (r.status !== 206 && r.status !== 200) throw new Error(`${path}: ${r.status}`);
    if (r.status === 200 && !wholeSaid) {
      wholeSaid = true;
      console.warn('forge bundles: the server sends a whole bundle for each file asked of it (it takes no Range requests)');
    }
    let body = await r.arrayBuffer();
    if (r.status === 200) body = body.slice(at, at + n);
    if (body.byteLength !== n) throw new Error(`${path}: ${body.byteLength} of ${n} bytes`);
    cache?.put(key, new Response(body, { headers: { 'Content-Type': TYPE[path.split('.').pop()] } })).catch(() => {});
    return body;
  };
  const packedPath = (input, init) => {
    try {
      const url = new URL(String(input), location.href);
      if (url.origin !== site.origin || !url.pathname.startsWith(site.pathname) || url.search || (init?.method ?? 'GET').toUpperCase() !== 'GET') return null;
      const path = decodeURIComponent(url.pathname.slice(site.pathname.length));
      return PACKED.test(path) ? path : null;
    } catch { return null; }
  };
  window.fetch = async (input, init) => {
    const path = input instanceof Request ? null : packedPath(input, init);
    if (!path) return real(input, init);
    const index = await list, e = entry(index, path);
    if (!e) return real(input, init);
    let bytes = coming.get(path);
    if (!bytes) {
      bytes = read(path, e, index.bundles, init?.priority);
      coming.set(path, bytes);
      bytes.then(() => coming.delete(path), () => coming.delete(path));
    }
    const body = await bytes;
    return new Response(body, { status: 200, headers: { 'Content-Type': TYPE[path.split('.').pop()], 'Content-Length': String(body.byteLength) } });
  };
  // What an older build kept that this one does not use, let go once the game has been up a minute.
  setTimeout(async () => {
    try {
      const index = await list, cache = await store;
      if (!index || !cache) return;
      for (const req of await cache.keys()) {
        const u = new URL(req.url);
        if (entry(index, decodeURIComponent(u.pathname.slice(site.pathname.length)))?.[3] !== u.searchParams.get('v')) cache.delete(req);
      }
    } catch { /* kept */ }
  }, 60000);
})();

// The title's and creation's pictures (forge-godot/web/preload.json) asked for as the page opens, alongside the engine,
// so they are in the browser's cache when the boot screen wants them (scripts/boot.gd, ui2d.gd preload_art). All nine of
// the title's scenes among them, though it shows the one it picks: the pick is made in the game's own code once that
// runs, and asked for only then it waited seconds behind the floor's models and sheets on the same connection (the bench,
// 2026-11-10). (The page picking it, and telling the title, would save the other eight, 2.4 MB: the title's code is the
// 2D game's.)
fetch('forge-godot/web/preload.json').then(r => r.json()).then(list => {
  for (const src of list) fetch('forge-rewrite/' + src, { priority: 'low' }).catch(() => {});
}).catch(() => {});
