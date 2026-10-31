// The animation clock: every tween in the game runs here, on Pixi's ticker.
// Animation speed (1 to 3x) and reduced motion live here and nowhere else. reduced is the player's Motion option only;
// rush is playback's: a turn more than 900 ms behind plays at once (Justin 2026-10-17, 1.7's cap), so tweens, waits and
// slides take no time while the particles, shake and the map's own motion go on (C6, render-06).

// inOut: 1.7's slide from rest (game.js slideAt), quadratic in and out.
const EASE = { out: t => 1 - (1 - t) * (1 - t), linear: t => t, inOut: t => t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2 };

/** One action's elapsed game time. Its clip and beats share the first-frame anchor and start rate. */
export const timeline = (clock, rate = clock.speed ?? 1) => ({ start: clock.now ?? 0, rate, t: 0, fresh: true });

/**
 * @param {{add:(fn:(t:{deltaMS:number, lastTime?:number, elapsedMS?:number})=>void)=>void}} ticker Pixi's ticker, or a
 *   test's: inside a listener Pixi's lastTime is still the previous frame's time and elapsedMS this frame's
 */
// A slide may follow on from an earlier one (o.append: one body's several steps in a turn, a dash): before its start
// the earlier one draws.
const seg = (s, T) => { while (s.prev && T < s.t0) s = s.prev; return s; };
const progress = (s, T) => { const g = seg(s, T); return g !== s && T < g.t0 + g.ms ? 0 : g.ms <= 0 ? 1 : Math.min(1, Math.max(0, (T - g.t0) / g.ms)); };
/** Where a slide (from clock.slide) draws its body at T: a pure function of the time, for the camera and the light too. */
export const slideAt = (s, T) => place(s, T);
const place = (s, T) => {
  s = seg(s, T);
  const p = s.ms <= 0 ? 1 : Math.min(1, Math.max(0, (T - s.t0) / s.ms)), q = s.lin ? p : EASE.inOut(p);
  return { x: s.from.x + (s.to.x - s.from.x) * q, y: s.from.y + (s.to.y - s.from.y) * q, hop: Math.abs(Math.sin(Math.PI * p)) * (s.hop ?? 0) };
};

/** v on the grid of whole device pixels, unit = one device pixel in world units (1 / (scale x resolution)). */
export const devicePx = (v, unit) => (unit > 0 ? Math.round(v / unit) * unit : v);
/**
 * Feel spec 2.5: the camera is the hero's slide position (no lunge, bump or hop), on the device-pixel grid the bodies
 * are drawn on, so the hero holds one screen pixel while he walks and the camera stops dead when he lands. 1.7 centred
 * on the drawn hero every frame with no smoothing (render.js:2130-2132).
 */
export const cameraOn = (at, unit, tile) => ({ x: devicePx(at.x, unit), y: devicePx(at.y, unit) - devicePx(tile / 2, unit) });

/**
 * Feel spec 2.2 (R6; 1.7 game.js:218-233): the walk cycle counts time on the move, never ground covered. v = base plus
 * the time since the run of chained slides began (s.onMove) over frameMs, carried through every chained slide; a frame
 * that would begin less than 35 ms before the slide ends is not begun, so a step chained on from there begins it at once.
 */
export const strideAt = (s, T, frameMs, base = 0) => {
  const v = base + Math.max(0, T - s.onMove) / frameMs, n = Math.floor(v), end = s.t0 + s.ms;
  return n > base && end - (s.onMove + (n - base) * frameMs) < 35 && T < end ? n - 1e-6 : v;
};

export function createClock(ticker) {
  const slides = new WeakMap();
  /** @type {{origin:ReturnType<typeof timeline>, from:number, ms:number, fn:(p:number)=>void, done:()=>void, ease:(t:number)=>number}[]} */
  let tweens = [];
  let frame = [], after = [];
  // Proof pass 2026-10-17 (item 3): tweens run on the frame's own time, so a slow frame catches them up instead of
  // taking up to 64 ms of it out of them (on a loaded laptop the melee hold stretched to 6 s). Feel spec 3: that time
  // is lastTime + elapsedMS; Pixi sets lastTime only after its listeners, so lastTime alone drew a frame behind. A
  // ticker with no lastTime (the tests') counts frame by frame.
  let now = 0, firstCredit = 0;
  const clock = {
    speed: 1,
    reduced: false,
    rush: false,
    /** Whether tweens, waits and slides take no time now: Motion off, or a late turn rushed through. */
    get instant() { return clock.reduced || clock.rush; },
    /** Runs fn(p) over ms of game time; origin/from place it on an action's timeline (e.g. a lunge after windup). */
    tween(ms, fn, ease = 'out', origin = timeline(clock), from = 0) {
      if (clock.instant || ms <= origin.t - from) { fn(1); return Promise.resolve(); }
      return new Promise(done => tweens.push({ origin, from, ms, fn, done, ease: EASE[ease] ?? EASE.out }));
    },
    /** Waits ms, or until ms into an existing action timeline (never scales a wall-time deadline). */
    wait(ms, origin) { return clock.tween(ms, () => {}, 'out', origin); },
    /** Called on a frame: full elapsed time after the same fresh-frame credit used by tweens. */
    elapsed(origin) {
      // Time before the first rendered frame counts at most 64 ms, including a newly started action after tab return.
      if (origin.fresh) { origin.fresh = false; origin.start = Math.max(origin.start, now - firstCredit); }
      return origin.t = Math.max(origin.t, (now - origin.start) * origin.rate);
    },
    /** The easing curves by name, for a tween that eases part of what it moves. */
    ease: EASE,
    /**
     * fn(dt, now) every frame after the tweens: dt the elapsed milliseconds (capped at 64), now the frame's time (ms).
     * o: true or {first} runs it before the others; {last} after all of them, whenever they were added (the lighting,
     * which draws every body's light from the frame its art shows this frame: item 265); {owner} drops it once
     * owner.destroyed. Returns off(), which drops it.
     */
    onFrame(fn, o = false) {
      const { first = false, last = false, owner = null } = typeof o === 'object' && o ? o : { first: !!o };
      const entry = { fn, owner };
      if (last) after.push(entry); else if (first) frame.unshift(entry); else frame.push(entry);
      return () => { frame = frame.filter(e => e !== entry); after = after.filter(e => e !== entry); };
    },
    get busy() { return tweens.length > 0; },
    /** The current frame's time (ms), what every slide and tween is drawn at. */
    get now() { return now; },

    // The slide store (feel spec 2.2, Justin 2026-10-17: "the point was to right new code because the old code was slow
    // and all over the place"; 1.7 is the feel target only). A body's drawn place is a pure function of the frame's time:
    // from + (to - from) * ease(p), exactly on its tile at p = 1, never past it, so nothing settles back. A step taken
    // while the body still slides goes on from where it is drawn, linear, over moveMs x max(0.5, the jump in tiles); one
    // from rest eases in and out over moveMs; a jump of more than 3 tiles, a hidden move or Motion off is placed at once.
    /**
     * Starts body's slide to `to` (world units) at t0 (default now). o: {from} where a body with no slide stands,
     * {unit} one tile in world units, {ms} the step length (moveMs), {instant} place it at once, {hop} the arc's height
     * at mid-step, {exact} take ms as given, linear (a leap, one share of several steps), {append} start where body's
     * slide ends, at its end (implies exact).
     * @returns {{from:{x:number,y:number}, to:{x:number,y:number}, t0:number, ms:number, lin:boolean, ready:number, onMove:number}}
     */
    slide(body, to, o = {}) {
      const unit = o.unit ?? 1, base = (o.ms ?? 200) / clock.speed, old = slides.get(body);
      if (o.append && old) {
        const t0 = old.t0 + old.ms, ms = clock.instant ? 0 : base;
        const s = { from: { ...old.to }, to: { x: to.x, y: to.y }, t0, ms, lin: true, hop: o.hop ?? 0, prev: old, ready: t0 + (clock.instant ? 1 : 0.7) * base, onMove: old.onMove };
        slides.set(body, s);
        return s;
      }
      const t0 = o.t0 ?? now, cur = old ? place(old, t0) : (o.from ?? to);
      const running = !!old && t0 < old.t0 + old.ms;
      const jump = Math.max(Math.abs(to.x - cur.x), Math.abs(to.y - cur.y)) / unit;
      const lin = o.exact || (running && jump <= 3), normal = jump > 3 || o.instant ? 0 : o.exact ? base : lin ? base * Math.max(0.5, jump) : base;
      const ms = clock.instant ? 0 : normal;
      // ready: when the next turn may run, 0.7 of the step's length; with Motion off its whole length, so a held walk still
      // goes 5 tiles a second (the lead's pick for Justin 2026-10-17). onMove: when this run of chained slides began (the
      // walk cycle counts time on the move from it).
      const s = { from: { x: cur.x, y: cur.y }, to: { x: to.x, y: to.y }, t0, ms, lin, hop: o.hop ?? 0, ready: t0 + (clock.instant ? 1 : 0.7) * normal, onMove: running ? old.onMove : t0 };
      slides.set(body, s);
      return s;
    },
    /** Where body is drawn at T (default now), its hop and p its slide's progress; null for a body never slid. */
    pos(body, T = now) { const s = slides.get(body); return s ? { ...place(s, T), p: progress(s, T) } : null; },
    /** body's slide progress at T, 0 to 1; 1 with no slide. */
    frac(body, T = now) { const s = slides.get(body); return s ? progress(s, T) : 1; },
    /** When body lands on its tile (its slide's end); -Infinity with no slide. */
    landing(body) { const s = slides.get(body); return s ? s.t0 + s.ms : -Infinity; },
    /** Whether body's slide is far enough on (0.7 of its step) for the next turn at T. */
    ready(body, T = now) { const s = slides.get(body); return !s || T >= s.ready; },
    /** The slide body is on, or null (read only). */
    slideOf(body) { return slides.get(body) ?? null; },
    /** Forgets body's slide (a body removed or redrawn elsewhere). */
    unslide(body) { slides.delete(body); },
  };
  ticker.add(t => {
    const dt = Math.min(t.deltaMS, 64);   // per-frame effects keep the cap; tweens use the wall clock
    const live = [];
    firstCredit = Math.min(t.elapsedMS ?? dt, 64);
    now = typeof t.lastTime === 'number' ? t.lastTime + (t.elapsedMS ?? t.deltaMS) : now + dt;
    for (const w of tweens) {
      const p = Math.max(0, Math.min(1, (clock.elapsed(w.origin) - w.from) / w.ms));
      w.fn(w.ease(p));
      if (p < 1) live.push(w);
      else w.done();
    }
    tweens = live;
    if (frame.some(e => e.owner?.destroyed)) frame = frame.filter(e => !e.owner?.destroyed);
    if (after.some(e => e.owner?.destroyed)) after = after.filter(e => !e.owner?.destroyed);
    for (const e of frame) e.fn(dt, now);
    for (const e of after) e.fn(dt, now);
  });
  return clock;
}
