// A body on the map drawn from its sheet: clips by name, frame timing from data/ui.json, sized as 1.7 sizes it.
// Hero sheets ('cast') stand 1.08 tiles tall and carry their worn gear (held.js, spec/held-items.md);
// creature sheets ('mob') fit their body box to the tile x their art.

import { Container, Sprite, Graphics, ColorMatrixFilter } from '../../../forge-godot/runtime/pixi.js';
import ui from '../../data/ui.json' with { type: 'json' };
import { sheet } from './art-store.js';
import { rowFor, clipFrame, clipLength, walkFrameMs } from './held.js';
import { strideAt, timeline } from './clock.js';
import { attachRim, paleRimmed } from './body-rim.js';
import { smoothSheet, gearPainter, beerIdle } from './hero-gear.js';
import { heldArt } from './art.js';
import { creatureFit, contactShadow, creatureMotion, FALL_MS } from './creature-motion.js';
import { asBody, hitFlash, ghostMatrix } from './body.js';

const MS = ui.motion.clipMs;
const SIZE = ui.actorSize;

const GHOST_ALPHA = 0.72;   // render.js:1173
const STRIKE = ui.motion.strike;

/**
 * Reviews 3 to 5 (Justin 2026-10-19): the frame t ms into an n-frame attack row (ms a frame) whose strike frame is k:
 * the frames before it spread over STRIKE.atMs, the strike held to STRIKE.untilMs across the blow (about 297 ms), the
 * rest at ms each. {frame, done, ms: the clip's whole length}.
 */
export function strikeAt(t, n, ms, k) {
  const end = STRIKE.untilMs + (n - 1 - k) * ms;
  const frame = t < STRIKE.atMs ? Math.floor(t * k / STRIKE.atMs) : t < STRIKE.untilMs ? k : Math.min(n - 1, k + 1 + Math.floor((t - STRIKE.untilMs) / ms));
  return { frame, done: t >= end, ms: end };
}

/**
 * The paper doll: a hero's still on his 256 px doll sheet ('cast-<look>-doll') with his held gear, as 1.7's paintDoll.
 * heightPx: the figure's standing height (meta.stand) on screen. The container's origin is between the soles;
 * held gear may reach past the figure (a raised axe, a long spear), so measure it with getBounds() when fitting.
 * @param {string} dollSheet e.g. 'cast-dwarf-m-doll'
 * @param {{main, off, ranged}|null} gear held.js heldGear(hero)
 * @param {number} heightPx
 */
export function dollSprite(dollSheet, gear, heightPx) {
  const sh = smoothSheet(sheet(dollSheet)), meta = sh.data.meta;
  if (meta.kind !== 'cast-doll') throw new Error(dollSheet + ' is not a doll sheet');
  if (gear && (gear.main || gear.off || gear.ranged)) heldArt();
  const root = new Container(), figure = new Container(), body = new Sprite(sh.textures.static);
  body.anchor.set(0);   // the sheet's frames carry a default anchor; the figure is placed by its pivot
  root.addChild(figure);
  figure.pivot.set(meta.cell / 2, meta.cell - meta.foot);
  figure.scale.set(heightPx / meta.stand);
  gearPainter(sh, figure, body)('static', gear, { row: 'static', frame: 0 }, 0xffffff);
  return root;
}


/**
 * @param {{sheet:string, art?:number, bigScale?:number}} look
 * @param {number} tile
 * @param {{size?:number, burrower?:boolean}} [o] size: the body's footprint in tiles (CH2; the root stays on its
 *   top-left tile's foot, the picture stands across the footprint); burrower: rises from the ground and bobs (the Maw);
 *   air: a flier's lift in tiles (RC15); hover: bobs in the air (UD9); phase: its own place in the bob;
 *   idlePhase: ms its idle runs ahead of the others' (RC36); still: holds its still in every state (RC38);
 *   elemental: an element-tier or still-posed body, which breathes and squashes if its sheet has no motion (RC37);
 *   clips: its monster row's look.clips (the animation review): stride true, its walk row is one stride, played once a
 *   step (item 223, creatures-01: the rat); fidget {row, everyMs}, a row played now and then at rest (the rat's sniff);
 *   strike, its attack row's strike frame (reviews 3 to 5); hurt false,
 *   no hurt row (review 7)
 */
export function createActorSprite(look, tile, clock, { size = 1, burrower = false, pose = null, air = 0, hover = false, phase = 0, idlePhase = 0, still = false, elemental = false, clips = null, fallDust = () => {} } = {}) {
  const sh = sheet(look.sheet);
  const meta = sh.data.meta, hero = meta.kind === 'cast', cell = meta.cell, n = hero ? 1 : Math.max(1, size);
  const root = new Container();
  root.footY = (n - 1) * tile;   // Light large bodies from their bottom foot row, as their remains are lit.
  const shadow = contactShadow(look, tile, n, hero);
  // The figure is drawn in the sheet's cell pixels: body, held gear and fingers share one space, mirrored together.
  const figure = new Container(), body = new Sprite();
  figure.addChild(body);
  // place: the footprint's foot (its bottom middle); for one tile it is the root itself.
  const place = new Container();
  place.position.set((n - 1) / 2 * tile, (n - 1) * tile);
  shadow.position.copyFrom(place.position);   // a child of the root itself, where body-shadows.js looks for it
  place.addChild(figure);
  root.addChild(shadow, place);

  let scale;
  if (hero) {
    scale = tile * SIZE.heroStandTiles / meta.stand;
    figure.pivot.set(cell / 2, cell - meta.foot);
  } else {
    const fit = creatureFit(meta, look, tile, n);
    scale = fit.scale;
    figure.pivot.set(fit.px, fit.py);
    figure.y = -fit.lift;
  }
  figure.scale.set(scale);
  // The Maw is clipped at the ground line while it rises (1.7 clipped 3 tiles left to 5 right, 5 up from its top tile).
  if (burrower) { const clip = new Graphics().rect(-(n / 2 + 3) * tile, -(n + 5) * tile, (n + 6) * tile, (n + 5) * tile).fill(0xffffff); place.addChild(clip); figure.mask = clip; }
  // CH-R5: art drawn facing left (its sheet's meta, or the monster row's look.facesLeft, 1.7 deepmobs/cavernmobs) is
  // mirrored to walk right; either mark is enough, both never flip twice.
  const facesRight = hero || (meta.facing !== 'left' && !look.facesLeft);

  const creatureClip = name => {
    const n = name === 'melee-off' ? 'melee' : name;
    for (const c of [n, n === 'melee' ? 'attack' : n]) if (sh.animations[c]) return c;
    return sh.animations.idle ? 'idle' : Object.keys(sh.animations)[0];
  };

  // What is playing: the action, the sheet row it plays on, time into it (ms of game time), and the run's stride.
  let action = 'idle', row = hero ? rowFor(meta, 'idle', null) : creatureClip('idle'), t = 0, loop = true, done = null, run;
  let gear = null, gearKey = '', stride = 0, walkEnded = -Infinity, now = 0, tint = 0xffffff, shown = '', asleep = false;
  const gait = !hero && clips?.stride === true, fidget = hero ? null : clips?.fidget ?? null, strike = hero ? null : clips?.strike ?? null;
  // Reviews 2 and 9 (Justin 2026-10-19): a walker with no walk row (not a flier, hoverer, burrower or posed body) stretches
  // with item 78's hop as it steps (creature-motion.js).
  const scurry = !hero && !sh.animations.walk && !air && !hover && !burrower && !pose ? { hop: 0.05 } : null;

  // live: what the body is doing now, for its motions (creature-motion.js).
  const live = { get action() { return action; }, get t() { return t; }, get row() { return row; }, get asleep() { return asleep; } };
  let faced = false;   // RC39: it has stepped or struck sideways (until then it faces the hero)
  /** Which frame (and step) is on screen now. */
  const frameNow = () => {
    if (motion.falling) return { frame: 0, done: motion.fallen };
    if (!hero) {
      // RC35 (1.7 render.js:1063-1065): an idle with its own frameMs (the bat's wingbeats) runs at it; RC36: each body's
      // idle loop is offset by its idlePhase, so a room does not idle in lockstep.
      const n = sh.animations[row].length, own = row === 'idle' ? meta.clips?.idle?.frameMs : 0, ms = own > 0 ? own : MS[row] ?? MS.idle;
      // Item 223, creatures-01 (Justin 2026-10-19: "rat animation still seems really bad ... it doesn't seem to walk"): a
      // body whose walk row is one stride (clips.stride, the rat's PixelLab sheet) plays it once a step on its slide's time,
      // at every speed; at rest its idle row loops and its fidget row (the sniff) plays once every everyMs or so.
      if (gait && loop && row === 'walk') return { frame: Math.min(n - 1, Math.floor((clock.frac?.(self) ?? 0) * n)), done: false };
      if (fidget && loop && row === 'idle' && action === 'idle') {
        const u = (now + idlePhase * 7) % (fidget.everyMs + idlePhase * 2), k = Math.floor(u / ms);
        if (k < sh.animations[fidget.row].length) return { frame: k, row: fidget.row, done: false };
      }
      // Reviews 3 to 5: an attack row with a strike frame winds up to it and holds it through the blow (strikeAt); flat
      // 60 ms frames had the rat's bite over before the hit showed and a troll's swing land after it.
      if (!loop && strike != null && (row === 'attack' || row === 'melee')) return strikeAt(t, n, ms, strike);
      // Sandbox 97 (Justin 2026-10-17: "the rats animation is too twitchy"): a looping idle or walk runs on the body's
      // own clock, never restarted by a step or a return to idle, as 1.7 read it off the wall clock (render.js:1061,
      // :1063-1065); restarting it each step showed a walking rat's first two idle frames over and over.
      const at = loop && (row === 'idle' || row === 'walk') ? now + idlePhase : t;
      return { frame: loop ? Math.floor(at / ms) % n : Math.min(Math.floor(t / ms), n - 1), done: !loop && t >= ms * n };
    }
    if (action === 'walk') return { frame: Math.floor(stride) % meta.clips[row].frames, done: false };
    if (beer && action === 'idle' && meta.clips[row]) return beer.frame();
    return clipFrame(meta, action, row, t, { speed: loop ? clock.speed : run.rate, reduce: !!clock.reduced });
  };

  // RC59: the Dwarf male tourist's beer (hero-gear.js beerIdle).
  const beer = hero ? beerIdle(meta, clock, live) : null;

  const paint = gearPainter(sh, figure, body);

  /** Puts the body, the held gear and the fingers over it in order for this frame. */
  const draw = () => {
    const fr = frameNow(), rw = fr.row ?? row, name = rw === 'static' ? 'static' : `${rw}-${fr.frame}`;
    // RC13 (1.7 render.js:1043-1045; Justin 2026-09-19, the Myconid swayed with a Z over it): asleep, a creature holds its
    // still pose until something wakes it; a clip it plays (a blow landing on it) still plays.
    // RC38 (1.7 render.js:998-1001): a body marked stillPose holds its still in every state, mid-clip included.
    if (!hero) { body.texture = (still || asleep && action === 'idle') && sh.textures.static ? sh.textures.static : sh.animations[fr.row ?? row][fr.frame]; return fr; }
    body.texture = sh.textures[name];
    const key = name + '|' + fr.step + '|' + !!fr.off + '|' + gearKey + '|' + tint;
    if (key === shown) return fr;
    shown = key;
    paint(name, gear, { row: rw, frame: fr.frame, step: fr.step, off: fr.off }, tint);
    return fr;
  };

  // 1.7's hit (body.js hitFlash) on every body however its sheet is cut, so a creature with no hurt row still shows the blow.
  let base = [], ghostA = 1, fadeA = 1;   // base: the filters the body always wears (an echo's ghost)
  const hit = hitFlash({ filtered: figure, clock, tile, base: () => base });

  const motion = creatureMotion({ tile, n, clock, root, place, figure, scale, pose, air, hover, phase, burrower, hero, elemental, scurry, sh, sheetName: look.sheet, hit, fallDust }, live);

  let rimSync = null;   // RC34, PT15 (body-rim.js)
  clock.onFrame(dt => {
    const d = dt * clock.speed, previous = t;
    hit.frame(d);
    now += d;
    if (hero && action === 'walk') stride = walkStride(d);
    else t = loop ? t + d : clock.elapsed(run);
    motion.frame(motion.falling ? t - previous : d);
    const fr = draw();
    rimSync?.();
    if (fr.done && done) { const r = done; done = null; r(run); }
  }, { owner: root });

  // Feel spec 2.2 (movement rebuild): the hero's walk cycle runs on his slide's time on the move (clock.strideAt), so it
  // never drifts from his feet after a slow frame. A new run of slides starts at the next whole frame after the last one
  // shown, or at 0 once he has stood a step's length. A body with no slide counts frame by frame, as before.
  let chainAt = null, strideBase = 0, slideEnd = -Infinity;
  const walkStride = d => {
    const sl = clock.slideOf?.(self);
    if (!sl) return stride + d / walkFrameMs();
    if (sl.onMove !== chainAt) { strideBase = sl.onMove - slideEnd < ui.motion.moveMs ? Math.ceil(stride) : 0; chainAt = sl.onMove; }
    slideEnd = sl.t0 + sl.ms;
    return strideAt(sl, clock.now, walkFrameMs(), strideBase);
  };
  const start = (name, once, straight = false) => {
    if (hero && action === 'walk' && name !== 'walk') walkEnded = now;
    if (hero && name === 'walk') {
      // W2: a step soon after the last one carries the stride on from its next whole frame.
      stride = action === 'walk' || now - walkEnded < ui.motion.moveMs ? Math.ceil(stride) : 0;
    }
    action = name;
    row = hero ? rowFor(meta, name, gear, { straight }) : creatureClip(name);
    t = 0; loop = !once; done = null; run = timeline(clock);
    beer?.reset();   // RC59: a clip or a step ends the beer and starts the count again
    motion.fall(!hero && name === 'death' && !sh.animations.death);
  };
  start('idle', false);
  draw();

  const self = asBody({
    root,
    /**
     * Plays a clip once (resolves at its end) or loops it. Hero actions: idle, walk, melee, melee-off, hurt, death, cast, ranged.
     * straight: a swing that names no weapon (held.js rowFor).
     */
    play(name, once = true, { straight = false } = {}) {
      if (action === 'death' && name === 'hurt') return Promise.resolve(run);   // item 159: a later blow leaves the fall be
      start(name, once, straight);
      if (!once) return Promise.resolve(run);
      if (hero && clipLength(meta, name) <= 0) return Promise.resolve(run);
      return new Promise(r => { done = r; });
    },
    // Item 159 (Justin 2026-10-18: "Player death animation doesn't trigger on death"): a clip's or a swing's settle to
    // idle never stands a falling body back up (the hero's swing settled 400 ms after it began, mid-fall); 1.7 held the
    // death's last frame (render.js:764-782 @3c8b312).
    idle(owned = run) { if (owned === run && action !== 'death') start('idle', false); },
    /** How long clip `name` runs once, in ms of game time (a death without frames falls over FALL_MS). */
    clipMs(name) {
      if (hero) return clipLength(meta, name);
      if (name === 'death' && !sh.animations.death) return FALL_MS;
      const c = creatureClip(name), n = sh.animations[c]?.length ?? 1, ms = MS[c] ?? MS.idle;
      return strike != null && (c === 'attack' || c === 'melee') ? strikeAt(0, n, ms, strike).ms : n * ms;
    },
    /** Its step's arc (body.js): the hero's run rows fly on their own (RC57, 1.7 render.js:1165-1168). */
    get step() { return { hop: hero && /^run/.test(row) ? 0 : 0.05 }; },
    /** The clip playing now (idle, walk, melee ...): a glide settles to idle only from its walk. */
    get action() { return action; },
    get animation() { return run; },
    /** RC59: whether the hero is calm enough for the beer (alive, no foe in sight, the off hand free), each frame. */
    calm(ok) { beer?.calm(ok); },
    /** RC59: a turn passed: the beer ends and the count starts again. */
    stir() { if (beer && action === 'idle') beer.settle(); },
    /** The sheet row playing now (the hero's run rows, RC57). */
    get row() { return row; },
    /** The hero's held gear (held.js heldGear); idempotent. */
    wear(g) {
      if (!hero) return;
      const k = JSON.stringify(g ?? null);
      if (k === gearKey) return;
      if (g && (g.main || g.off || g.ranged)) heldArt();   // a gear change before the held sheet is loaded is an error, never a silent bare hand
      gear = g; gearKey = k; shown = '';
      if (action === 'idle' || action === 'walk') row = rowFor(meta, action, gear);
    },
    /** Faces toward a screen x relative to the body. */
    face(dx) { if (dx) { faced = true; figure.scale.x = Math.abs(figure.scale.x) * ((dx > 0) === facesRight ? 1 : -1); } },
    /** RC39 (1.7 render.js:2352-2354): a creature that has not yet stepped or struck sideways faces the hero (dx: his
     *  screen x relative to it); once it has, it keeps the way it last faced. */
    watch(dx) { if (!hero && !faced && dx) figure.scale.x = Math.abs(figure.scale.x) * ((dx > 0) === facesRight ? 1 : -1); },
    /** RC39: whether it has turned on its own yet, for probes. */
    get faced() { return faced; },
    /** on: starts the hit flash and shake (220 ms, ends by itself); off does nothing (the hit runs its course). */
    flash(on) { if (on) hit.start(); },
    /** RC10: drawn as 1.7's shadow clone, a grey-violet ghost at 72% (render.js:1173-1174). */
    ghost() {
      const f = new ColorMatrixFilter(); f.matrix = ghostMatrix();
      base = [f]; ghostA = GHOST_ALPHA;
      if (!hit.on) figure.filters = base;
      figure.alpha = ghostA * fadeA;
    },
    /** RC34, PT15 (body-rim.js): a creature's coloured edge or pale rim and a plane's violet halo, behind its body. */
    // A24: haloUnpainted keeps a halo off painted sheets (1.7 cryptrooms.js:268 paintedSheet: they have their own edge).
    rim({ pale = false, halo = 0, haloColour, haloBlurTiles, haloUnpainted = false } = {}) {
      if (haloUnpainted && !paleRimmed(look.sheet, meta)) halo = 0;
      if (hero || rimSync || !(meta.edge || (pale && paleRimmed(look.sheet, meta)) || (halo > 0 && n === 1))) return;
      rimSync = attachRim(figure, body, { tile, scale, edge: meta.edge ?? null, pale: pale && paleRimmed(look.sheet, meta), halo: n > 1 ? 0 : halo, haloColour, haloBlurTiles });
      rimSync();
    },
    /** RC11: drawn as 1.7's summoned Shade (shadeSummonSheet, render.js:930-939, :1214): grey at 72% brightness under
     *  40% of #1B102B, at 62%. */
    shadeSummon() {
      const f = new ColorMatrixFilter(), L = [0.2126, 0.7152, 0.0722].map(v => v * 0.72 * 0.6), ink = [27, 16, 43].map(v => v / 255 * 0.4);
      f.matrix = [...L, 0, ink[0], ...L, 0, ink[1], ...L, 0, ink[2], 0, 0, 0, 1, 0];
      base = [f]; ghostA = 0.62;
      if (!hit.on) figure.filters = base;
      figure.alpha = ghostA * fadeA;
    },
    /** RC16: the body's own opacity (0.5 while the hero is Hidden, render.js:2324); the shadow under it keeps its own. */
    fade(a) { if (a === fadeA) return; fadeA = a; figure.alpha = ghostA * fadeA; },
    /** A hero sheet ('cast'), which plays the hero's actions. */
    get hero() { return hero; },
    /** The sheet this body is drawn from. */
    get sheet() { return look.sheet; },
    /** CV12: rises out of the ground now (a burrower; others ignore it). */
    rise() { motion.rise(); },
    /** Drawn mirrored (facing the other way from its art), kept by the remains it leaves. */
    get mirrored() { return figure.scale.x < 0; },
    /** The footprint in tiles (CH2). */
    get size() { return n; },
    /** CV15: drawn k tiles below its foot line (0 puts it back). */
    lower(k) { motion.lower(k); },
    /** RC13: asleep, a creature stands on its still frame (the hero ignores it). */
    sleep(on) { asleep = !hero && !!on; },
    /** RC13: whether it is drawn asleep, for probes. */
    get asleep() { return asleep; },
    /** UD8: the Matron channelling a ritual (she rises over her glow); others ignore it. */
    channel(on) { motion.channel(on); },
    /** The body's texture on screen now (the frame's sheet and name), for probes. */
    get texture() { return body.texture; },
  });
  return self;
}

/**
 * FX14: a body's remains (1.7 drawDeathRemains, fx.js:172-189): the last frame of its death clip, or its standing
 * picture fallen on its side (FX13), lying where it died. The root sits where a living body's would. Item 248: a death
 * row ends lying down in the body's own art, so its last frame is drawn as it is, never flipped or turned.
 * @param {{sheet:string, art?:number, bigScale?:number}} look
 */
export function remainsSprite(look, tile, { size = 1, mirrored = false } = {}) {
  const sh = sheet(look.sheet), meta = sh.data.meta, n = Math.max(1, size), fit = creatureFit(meta, look, tile, n);
  const death = sh.animations.death, still = sh.animations.idle ?? Object.values(sh.animations)[0];
  const root = new Container(), place = new Container(), pic = new Sprite(death ? death[death.length - 1] : still[0]);
  root.footRows = n;
  root.footY = (n - 1) * tile;   // Large remains rest on the bottom row of their footprint.
  pic.anchor.set(0);   // placed by its pivot
  place.position.set((n - 1) / 2 * tile, (n - 1) * tile);
  pic.pivot.set(fit.px, fit.py);
  pic.y = -fit.lift;
  pic.scale.set(mirrored ? -fit.scale : fit.scale, fit.scale);
  if (!death) pic.rotation = (mirrored ? -1 : 1) * Math.PI / 2;
  place.addChild(pic);
  root.addChild(place);
  return root;
}
