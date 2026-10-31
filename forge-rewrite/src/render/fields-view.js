// Burning ground and fields on the map (src/rules/fields.js): soft stamps, never tile squares (effects rule: fluid,
// no hard lines). Fire flickers on the frame clock; clouds drift a little. Reads the floor; never writes it.

import { Container, Graphics, Rectangle, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { noise as ptVal } from '../lib/noise.js';
import { wallLike } from '../data/tiles.js';
import { objArt } from './art.js';
import { flame } from './status-badges.js';
import { greenPlant } from './ground-view.js';
import { poolRaster } from './pool-raster.js';
import { cryptOoze } from './crypt-grime.js';
import { oozeLife } from './crypt-life.js';
import { alsoLoad, sheet } from './art-store.js';
import { softTexture, fh, puffTexture, createCloudLayer } from './field-clouds.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;

const WEB_ART = 'images/effects/web-ground.webp';   // sync writes the vendored PNG as WebP; the manifest lists this
alsoLoad('play', WEB_ART);

// ---------------------------------------------------------------- 1.7's ground residues (CR15)
// cryptset.js drawGroundMaterial and oozeRaster's material branch: a residue is pooled matter, one connected pool per
// kind with a lip at the shore and a grain, its edges merging across neighbouring cells and running up to the walls.
// One picture per field (worked out once for its cells and kept), shown tile by tile where the hero sees (and, for
// the kinds 1.7 remembered, dimmed to 0.4 on remembered tiles).
const MAT_R = 32, matPics = new WeakMap();
function materialPicture(floor, kind, cells) {
  let byFloor = matPics.get(floor);
  if (!byFloor) matPics.set(floor, (byFloor = new Map()));
  const key = `${kind}|${cells.join(',')}`;
  if (byFloor.has(key)) return byFloor.get(key);
  const W = floor.w, R = MAT_R, salt = 7;
  const pool = poolRaster(floor, cells, { salt, clamp: true, skip: (x, y) => wallLike(floor, x, y), colour: ({ wx, wy, deep, shore, facing }) => {
    let grain = (ptVal(wx * 19, wy * 19, salt + 23) - 0.5) * 22, col, a;
    if (kind === 'ice') { col = shore ? [164, 193, 200] : [109 + deep * 22, 143 + deep * 20, 157 + deep * 16]; a = shore ? 170 : 100 + deep * 38; }
    else if (kind === 'holy') { col = shore ? [208, 179, 103] : [170, 139, 69]; a = shore ? 100 : 35 + deep * 24; }
    else if (kind === 'roots') { col = shore ? [92, 89, 56] : [56, 65, 37]; a = shore ? 108 : 78; }
    else {   // Match the Crypt's grave ooze: wet green shoreline and translucent, broad sheen.
      if (shore) {
        const glint = ptVal(wx * 6.5, wy * 6.5, salt + 9), lit = facing() > 0.004 && glint > 0.62;
        col = lit ? [130, 196, 92] : glint < 0.3 ? [40, 96, 34] : [24, 70, 28]; a = lit ? 210 : glint < 0.3 ? 150 : 215;
      } else {
        col = [30 + (1 - deep) * 16, 78 + (1 - deep) * 26, 34 + (1 - deep) * 6]; a = Math.round(150 + 50 * deep);
        if (ptVal(wx * 2.6 + 3, wy * 2.6, salt + 11) > 0.78 && deep > 0.35) col = [col[0] + 18, col[1] + 26, col[2] + 10];
      }
      grain = 0;
    }
    return [Math.max(0, Math.min(255, col[0] + grain)), Math.max(0, Math.min(255, col[1] + grain)), Math.max(0, Math.min(255, col[2] + grain)), a];
  } });
  const { x0, y0, filled } = pool;
  const tex = Texture.from({ resource: pool.canvas, scaleMode: 'linear' }), tiles = new Map();
  const pic = { tex, filled, tile(x, y) {
    const k = y * W + x;
    if (!tiles.has(k)) tiles.set(k, new Texture({ source: tex.source, frame: new Rectangle((x - x0) * R, (y - y0) * R, R, R) }));
    return tiles.get(k);
  } };
  byFloor.set(key, pic);
  return pic;
}

let darkTex = null;
/** 1.7 drawDarknessTelegraphs: near-black violet, solid to a tenth of a tile, thinning to nothing at 0.85 (alpha 0.82 = 1). */
function darkTexture() {
  if (darkTex) return darkTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 32 * 0.1 / 0.85, 32, 32, 32);
  gr.addColorStop(0, 'rgba(6,2,10,1)'); gr.addColorStop(0.6, `rgba(14,4,22,${(0.7 / 0.82).toFixed(3)})`); gr.addColorStop(1, 'rgba(20,6,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (darkTex = Texture.from({ resource: c, scaleMode: 'linear' }));
}

// Each field's colour and how strongly it shows (fire is drawn by its own stamps).
const TINT = { gas: [0x8fbf3a, 0.45], spores: [0xc9b46a, 0.4], static: [0x7fd4ff, 0.4], ice: [0xbfe8ff, 0.4], holy: [0xffe9a8, 0.4],
  'holy-ground': [0xffe9a8, 0.4], web: [0xe8e8e8, 0.3], smoke: [0x6a6a70, 0.6], 'poison-trail': [0x7cc24a, 0.35], 'chaos-hazard': [0xd05fe0, 0.4], darkness: [0x0a0a14, 0.7] };

/**
 * EP30 (1.7 sporecaller.js:160-172 draw, before the field is active): a spore field's warning is the green glow
 * (structures.js warnGlow, at 0.8) over a faint root pool (0.28), a pale mist (0.22) and a tiny green sprout on each
 * marked tile (0.28 of a tile, at 0.82). One container a tile, for structures.js buildMarks; sporeWarnTick moves it and
 * shows it only in sight.
 */
export function sporeWarnTiles(floor, tiles, tile) {
  const cells = tiles.map(t => t.y * floor.w + t.x), pic = materialPicture(floor, 'roots', cells), out = [];
  for (const t of tiles) {
    const c = new Container(), k = t.y * floor.w + t.x;
    if (pic.filled.has(k)) { const s = new Sprite(pic.tile(t.x, t.y)); s.width = s.height = tile; s.alpha = 0.28; c.addChild(s); }
    const mist = [0, 1].map(m => { const s = new Sprite(puffTexture('white')); s.anchor.set(0.5); s.tint = 0xa6b884; c.addChild(s); return { s, h: fh(t.x, t.y, m + 719) }; });
    const tex = greenPlant((t.x * 3 + t.y * 7) % 5);
    let plant = null;
    if (tex) { plant = new Sprite(tex); plant.anchor.set(0.5, 1); plant.position.set(tile * 0.5, tile * 0.92); plant.width = plant.height = tile * 0.28; plant.alpha = 0.82; c.addChild(plant); }
    c.position.set(t.x * tile, t.y * tile); c.zIndex = -3;
    c.sporeWarn = { x: t.x, y: t.y, mist, plant, tile };
    out.push(c);
  }
  return out;
}
/** Each frame: the warning's mist drifts as drawFieldMist's does and its sprout sways (1.7 plant: sin(t / 900 + x * .7 + y) * .018). */
export function sporeWarnTick(sp, now, reduced) {
  const w = sp.sporeWarn, T = w.tile, t = reduced ? 0 : now / 1000;
  for (const m of w.mist) {
    const ph = t * 0.25 + m.h * 6.28, r = T * (0.64 + m.h * 0.16);
    m.s.position.set((0.5 + Math.sin(ph) * 0.14) * T, (0.55 + Math.cos(ph * 0.8) * 0.12) * T);
    m.s.width = r * 2; m.s.height = r * 1.3; m.s.alpha = 0.22 * (0.88 + 0.12 * Math.sin(ph));
  }
  if (w.plant) w.plant.skew.x = reduced ? 0 : -Math.sin(now / 900 + w.x * 0.7 + w.y) * 0.018;
}

/** E20: how thick smoke still shows `now`, after it ended at `until` (1.7: 1 - (turns past + 1) / 3; gone at two). */
export const smokeAfter = (now, until) => Math.min(1, Math.max(0, 1 - ((now - until) / TURN + 1) / 3));
const webKnown = new WeakMap();   // a web field row -> the cells of it the hero has seen (EP29; looks only, not saved)
const lastSmoke = new WeakMap();   // floor -> its smoke cloud's cells and end, for the thinning after it ends (E20)
export function createFieldsView(clock) {
  const root = new Container(), under = new Container(), puddles = new Container(), puddleAnims = [], fires = [], dark = [];
  let tile = 64;
  // Sight/ground/pulse events often ask for the same picture. Keep its objects and animation lists until an input
  // changes; copy values rather than keeping array references because rules and sight update them in place.
  const inputs = [];
  let built = false;
  const unchanged = (state, size) => {
    let same = built, n = 0;
    const take = v => { if (inputs[n] !== v) same = false; inputs[n++] = v; };
    const f = state.floor, rows = f.fields ?? [], burning = Object.keys(f.burning ?? {});
    take(f); take(f.w); take(f.h); take(size); take(clock.reduced);
    take(burning.length); for (const k of burning) take(k);
    take(rows.length);
    let smoke = false, roots = false;
    for (const r of rows) {
      take(r.kind); take(r.ooze); take(r.cells.length); for (const k of r.cells) take(k);
      // A replacement web row has its own remembered cells, even when its coordinates are identical.
      if (r.kind === 'web') take(r);
      const turns = r.kind === 'darkness' ? 1.5 : r.kind === 'web' ? 1 : r.kind === 'gas' || r.kind === 'spores' || r.kind === 'poison-trail' ? 2 : 0;
      if (turns) take(Math.max(0, Math.min(1, (r.until === null ? Infinity : r.until - (state.now ?? 0)) / (turns * TURN))));
      if (r.kind === 'smoke') { smoke = true; take(r.until); }
      if (r.kind === 'roots' || r.kind === 'spore-field') roots = true;
    }
    const ended = !smoke && lastSmoke.get(f), fade = ended && ended.until !== null ? smokeAfter(state.now, ended.until) : 0;
    take(fade);
    if (fade > 0) { take(ended.cells.length); for (const k of ended.cells) take(k); }
    if (roots) take(objArt('props', 'root-tangle'));   // art arriving after the first draw must still appear
    // Pools can spill into neighbouring cells, so their visibility depends on more than the field's own cells.
    if (burning.length || rows.length || fade > 0) for (let k = 0; k < f.w * f.h; k++) { take(!!state.vis?.[k]); take(!!state.seen?.[k]); }
    if (inputs.length !== n) same = false;
    inputs.length = n;
    return same;
  };
  const clouds = createCloudLayer(root);   // gas, spores and static (1.7's clouds and sparks)
  clock.onFrame((dt, now) => { if (clouds.live) clouds.tick(now, clock.reduced); });   // render-16: the frame clock's time (ms)
  clock.onFrame((dt, now) => { for (const a of puddleAnims) a(now / 1000, clock.reduced); });
  clock.onFrame((dt, now) => {
    if ((!fires.length && !dark.length) || clock.reduced) return;
    const t = now / 1000;
    // A globe of darkness breathes a little, cell by cell (1.7 deepmobs.js drawDarknessTelegraphs).
    for (const d of dark) d.s.alpha = (0.82 + Math.sin(t * 1.1 + d.x * 0.9 + d.y * 1.7) * 0.05) * d.fade;
    // RC31 (1.7 render.js:2312 drawBurningFlame): each burning tile's three-layer flame sways and stretches.
    for (const f of fires) { f.g.clear(); flame(f.g, f.bx, f.by, f.h, now, f.seed, 0.62, false); }
  });
  const stamp = (x, y, color, alpha, size) => {
    const s = new Sprite(softTexture());
    s.anchor.set(0.5); s.tint = color; s.alpha = alpha; s.blendMode = color === 0x0a0a14 || color === 0x6a6a70 ? 'normal' : 'add';
    s.position.set((x + 0.5) * tile, (y + 0.55) * tile); s.scale.set(size * tile / 64);
    root.addChild(s); return s;
  };
  return {
    root,
    /** The residues' pools and the root tangles: on the ground, under the bodies and the light (main.js places it). */
    under,
    puddles,
    /** Updates from the floor's burning tiles and live fields, retaining an unchanged picture. */
    set(state, tileSize) {
      if (unchanged(state, tileSize)) return;
      built = false;
      tile = tileSize;
      root.removeChildren().forEach(c => c.destroy()); under.removeChildren().forEach(c => c.destroy());
      puddles.removeChildren().forEach(c => c.destroy()); puddleAnims.length = 0;
      fires.length = 0; dark.length = 0; clouds.clear();
      const mp = matPics.get(state.floor);
      if (mp?.size > 64) { for (const v of mp.values()) v.tex.destroy(true); mp.clear(); }   // the residue pictures, likewise
      const f = state.floor, seen = k => !!state.vis?.[k];   // only what the hero sees (the layer sits over the fog)
      for (const key of Object.keys(f.burning ?? {})) {
        const k = +key, x = k % f.w, y = (k / f.w) | 0;
        if (!seen(k)) continue;
        // RC31 (1.7 render.js:2307-2314): layered flames on the ground, 0.61 of a tile tall at 0.62 (Justin 2026-09-20:
        // 70% of what they were), standing at 0.92 down the tile; the embers are fx-kit.js's, the light lightmap.js's.
        const g = new Graphics(), e = { g, bx: (x + 0.5) * tile, by: (y + 0.92) * tile, h: tile * 0.61, seed: x * 5 + y * 7 };
        flame(g, e.bx, e.by, e.h, clock.now, e.seed, 0.62, clock.reduced);
        g.groundFire = true; under.addChild(g); fires.push(e);
      }
      const left = r => (r.until === null ? Infinity : r.until - (state.now ?? 0));
      // A residue's pool, tile by tile: in sight at full strength, on remembered tiles at 0.4 when the kind is kept.
      const pool = (r, kind, opacity, remembered = false) => {
        if (!(opacity > 0) || !r.cells.length) return;
        const pic = materialPicture(f, kind, r.cells);
        for (const k of pic.filled) {
          const inSight = !!state.vis?.[k];
          if (!inSight && !(remembered && state.seen?.[k])) continue;
          const x = k % f.w, y = (k / f.w) | 0, s = new Sprite(pic.tile(x, y));
          s.position.set(x * tile, y * tile); s.width = s.height = tile; s.alpha = opacity * (inSight ? 1 : 0.4);
          under.addChild(s);
        }
      };
      // drawGroundRoots: the root-tangle art squashed flat on each rooted cell in sight, flipped by a hash.
      const roots = (r, alpha) => {
        const art = objArt('props', 'root-tangle');
        if (!art) return;
        for (const k of r.cells) {
          if (!seen(k)) continue;
          const x = k % f.w, y = (k / f.w) | 0, s = new Sprite(art), fit = tile * 0.8 / Math.max(art.frame.width, art.frame.height);
          s.anchor.set(0.5, 1); s.alpha = alpha;
          s.scale.set(fit * (fh(x, y, 619) < 0.5 ? -1 : 1), fit * 0.48);
          s.position.set((x + 0.5) * tile, (y + 0.82) * tile);
          under.addChild(s);
        }
      };
      // a dark body under a lighter drifting billow, dense inside and soft at the edge, remembered too (1.7 sigils.js:283-297
      // drawSmokeTelegraphs)
      const smoke = (cells, fade) => {
        clouds.mist(state, cells, 0x36323b, 0.82 * fade, { remembered: true }, tile);
        clouds.mist(state, cells, 0x77707b, 0.55 * fade, { remembered: true, late: 1700 }, tile);
      };
      // E20 (1.7 turnExpireSmoke, drawSmokeTelegraphs fade): smoke that has ended still thins away over two turns, at
      // 1 - (turns past its end + 1) / 3; the sight it veiled is clear at once (rules/fields.js removes the row).
      const ended = lastSmoke.get(f);
      if (ended && ended.until !== null && !(f.fields ?? []).some(r => r.kind === 'smoke')) {
        const fade = smokeAfter(state.now, ended.until);
        if (fade > 0) smoke(ended.cells, Math.min(1, fade)); else lastSmoke.delete(f);
      }
      for (const r of f.fields ?? []) {
        if (r.kind === 'poison-trail' && r.until === null && !r.ooze && r.cells.length) {
          const poolFloor = { ...f, ooze: r.cells }, pic = cryptOoze(poolFloor, tile), life = oozeLife(poolFloor, tile);
          if (pic) puddles.addChild(pic);
          puddles.addChild(life.node);
          puddleAnims.push((t, reduced) => life.anim(t * (f.biome === 'crypt' ? 0.5 : 1), reduced, { vis: state.vis }));
          continue;
        }
        if (r.kind === 'gas' || r.kind === 'spores') { clouds.cloud(state, r, tile); continue; }
        if (r.kind === 'static') { clouds.staticField(state, r, tile); continue; }
        if (r.ooze || r.kind === 'slime-trail' || r.kind === 'plague-trail') continue;   // painted elsewhere: grave ooze with the ground under the walls (crypt-look.js); the trails and a chaos floor's patches as 1.7 pools (realm-view.js, C10b)
        // CR15, CR16: residues as 1.7 drew them (elements.js:93, sporecaller.js:165-167, chaos-enemy-art.js:45,
        // green-slime.js:109, balance-rulings.js:85-96, sigils.js:295-296).
        if (r.kind === 'ice') { pool(r, 'ice', 0.78); continue; }
        if (r.kind === 'roots') { pool(r, 'roots', 0.65); roots(r, 0.88); continue; }   // E13: Earth 6 grasping roots (1.7 elements.js:93)
        if (r.kind === 'spore-field') { pool(r, 'roots', 0.55); clouds.mist(state, r.cells, 0xa6b884, 0.15, {}, tile); roots(r, 0.48); continue; }
        if (r.kind === 'chaos-hazard') { pool(r, 'poison', 0.92); clouds.mist(state, r.cells, 0x93ae64, 0.16, {}, tile); continue; }
        if (r.kind === 'poison-trail') { pool(r, 'poison', Math.max(0, Math.min(1, left(r) / (2 * TURN))), true); continue; }
        if (r.kind === 'holy-ground' || r.kind === 'holy') { clouds.holyGround(state, r, tile); continue; }
        if (r.kind === 'smoke') { lastSmoke.set(f, { cells: r.cells, until: r.until }); smoke(r.cells, 1); continue; }
        const [color, alpha] = TINT[r.kind] ?? [0xffffff, 0.3];
        // Darkness thins out over its last turn and a half (deepmobs.js); webs over their last turn (enemy-fields.js draw:
        // min(1, remaining / 100)).
        const fade = r.kind === 'darkness' ? Math.max(0, Math.min(1, left(r) / (1.5 * TURN))) : r.kind === 'web' ? Math.max(0, Math.min(1, left(r) / TURN)) : 1;
        // EP29 (1.7 enemy-fields.js:46-53): a web cell the hero has seen stays drawn on its remembered tile at 0.4.
        const known = r.kind === 'web' ? (webKnown.get(r) ?? webKnown.set(r, new Set()).get(r)) : null;
        for (const k of r.cells) {
          // UD11: the globe is drawn on remembered cells too, so it shows from outside (1.7 drew it on seen[])
          if (known && seen(k)) known.add(k);
          if (!seen(k) && !(r.kind === 'darkness' && state.seen?.[k]) && !(known?.has(k) && state.seen?.[k])) continue;
          const x = k % f.w, y = (k / f.w) | 0;
          if (r.kind === 'web') {
            const s = new Sprite(sheet(WEB_ART));
            s.position.set(x * tile, y * tile); s.width = s.height = tile; s.alpha = 0.7 * fade * (seen(k) ? 1 : 0.4);
            root.addChild(s);
          } else if (r.kind === 'darkness') {
            const s = new Sprite(darkTexture());
            s.anchor.set(0.5); s.position.set((x + 0.5) * tile, (y + 0.5) * tile); s.width = s.height = tile * 1.7; s.alpha = 0.82 * fade;
            root.addChild(s); dark.push({ s, x, y, fade });
          }
          else stamp(x, y, color, alpha * fade, 1.6);
        }
      }
      built = true;
    },
  };
}
