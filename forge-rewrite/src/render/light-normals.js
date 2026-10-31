// The normal maps the passes light by (lighting.js): the ground's normal sheets per area (laid like the colour sheets,
// up to three sets a floor plus the natural rock pair) and the hand-made normals of single sprites. assets: the asset
// layer's { sheet, hasSheet }, handed in.

import { Assets, Rectangle, Texture } from '../../../forge-godot/runtime/pixi.js';
import data from '../../data/lighting.json' with { type: 'json' };
import * as terrainArt from './terrain.js';

const P = data.rows.pipeline;
const sheetOf = (N, part) => `environment-terrain-${N.floor.match(/^normal-(.*)-floor\.(png|webp)$/)?.[1] ?? 'dungeon'}-${part}`;
const isRockPair = N => N && N.floor === 'normal-stone-detail.webp';   // the natural rock's ground; its smooth walls take no map (item 273)

/** The normal sheets of an area row (assets/sheets/normals), laid like the colour sheets, or null. Cached. */
const sheets = new Map();
function loadSheets(row, assets) {
  const N = row?.normals;
  if (!N) return Promise.resolve(null);
  const key = N.floor + '|' + N.face + '|' + (N.relay ?? '');
  if (sheets.has(key)) return sheets.get(key);
  const grid = name => { const k = name && assets.hasSheet(name) ? Object.values(assets.sheet(name).data.meta.keys)[0] : null; return k ? [k.columns, k.rows] : null; };
  const p = Promise.all([Assets.load('assets/sheets/normals/' + N.floor), N.face ? Assets.load('assets/sheets/normals/' + N.face) : null]).then(([floor, face]) => {
    const fg = grid(N.floorSheet ?? null) ?? grid(sheetOf(N, 'floor')), cg = face ? grid(N.faceSheet ?? null) ?? grid(sheetOf(N, 'face')) : [1, 1];   // no face map: its walls lit flat
    if (!fg || !cg) return null;
    const relaid = N.relay && terrainArt.relay ? terrainArt.relay(floor, N.relay) : null;
    return { floor: relaid ?? floor, face, grid: [fg[0], fg[1], cg[0], cg[1]] };
  }).catch(() => null);
  sheets.set(key, p);
  return p;
}

/**
 * The ground pass's normal sets for the floor's areas: place(areaRows, areaNames) binds them to the filters (once per
 * set of names); reset() forgets the floor. filters: the ground filters; view: map-view's view.
 */
export function createNormalSets(filters, view, assets) {
  let setsFor = null;
  return {
    reset() { setsFor = null; },
    place(areaRows, areaNames, floorGain = 1) {
      const key = areaNames.join(',') + ':' + floorGain;
      if (setsFor === key) return;
      setsFor = key;
      const uniq = [], areaSet = new Float32Array(8);
      areaRows.forEach((row, a) => {
        if (!row?.normals) { areaSet[a] = 4; return; }   // no set: lit flat (set 4 is never loaded)
        if (isRockPair(row.normals)) { areaSet[a] = 3; if (!uniq[3]) uniq[3] = row; return; }
        let i = uniq.findIndex((r, j) => j < 3 && r && r.normals.floor === row.normals.floor && r.normals.face === row.normals.face);
        if (i < 0) { i = [0, 1, 2].find(j => !uniq[j]) ?? 0; uniq[i] = row; }
        areaSet[a] = i;
      });
      for (const f of filters) { const u = f.resources.terrain.uniforms; u.uAreaSet.set(areaSet); u.uSetK.fill(0); }
      uniq.forEach((row, i) => {
        if (!row) return;
        loadSheets(row, assets).then(s => {
          if (setsFor !== key || !s) return;
          for (const f of filters) {
            const u = f.resources.terrain.uniforms;
            u.uGrid.set(s.grid, i * 4); u.uSetK[i * 4] = 1; u.uSetK[i * 4 + 1] = (row.normals.gain ?? 1) * floorGain * (i === 3 && view.terrainKinds ? P.rasterGroundGain ?? 1 : 1);
            u.uSetK[i * 4 + 2] = s.face ? (row.normals.lipRows ?? 0) * s.grid[3] / s.face.height : 0;   // the face cell's coping, as a share of the cell (item 234)
            u.uSetK[i * 4 + 3] = s.face ? row.normals.faceGain ?? 1 : 0;   // the face's own gain; none without a face map
            f.resources['uN' + i] = s.floor.source; if (s.face) f.resources['uF' + i] = s.face.source;
          }
        });
      });
    },
  };
}

/**
 * The hand-made normal of a sprite's frame, cut to the frame, or null: 1.7's records (assets/sheets/normals/normals.json)
 * and the rewrite's own (lighting.json spriteNormals: the walls' trim, item 201; one with no crop covers its whole sheet,
 * as the Dungeon's props sheet, item 233, grows). A record waits until its sheet is in
 * (a biome's art loads with the biome); loads.count is how many maps are in, so a picture made from them is made again.
 */
export function createHandNormals(assets) {
  const hand = [], loads = { count: 0 };
  let pending = null, tried = -Infinity;
  const resolve = () => {
    tried = performance.now();
    for (let i = pending.length - 1; i >= 0; i--) {
      const r = pending[i], name = r.source?.replace(/\.png$/, '');
      if (r.kind !== 'sprite' || !/\.png$/.test(r.source)) { pending.splice(i, 1); continue; }
      if (!assets.hasSheet(name)) continue;
      pending.splice(i, 1);
      const any = Object.values(assets.sheet(name).textures)[0], crop = r.crop ?? r.region ?? [0, 0, any.source.pixelWidth, any.source.pixelHeight];   // none: the whole sheet, as it grows
      // A whole sheet's map lies on it pixel for pixel, padded past its edge or not (item 299: the Dungeon props' map is
      // the sheet padded to 128-pixel cells, 3712 x 128 over 3692 x 120; scaled by their widths, a frame far along the
      // sheet took the relief up to 14 pixels to its right, the mossy drain's arch and spout beside its art).
      const whole = !(r.crop ?? r.region);
      Assets.load('assets/sheets/normals/' + r.normal).then(tx => { hand.push({ source: any.source, crop, normal: tx, k: whole ? 1 : tx.width / crop[2] }); loads.count++; }).catch(() => {});
    }
  };
  const normalFor = tex => {
    if (!pending) {
      pending = [...(data.rows.spriteNormals?.records ?? [])];
      fetch('assets/sheets/normals/normals.json').then(r => r.json()).then(j => { pending.push(...j.records); tried = -Infinity; }).catch(() => {});
    }
    if (pending.length && performance.now() - tried > 500) resolve();
    if (!tex?.source || !tex.frame) return null;
    const f = tex.frame, res = tex.source.resolution ?? 1;
    for (const h of hand) {
      if (h.source !== tex.source) continue;
      const [cx, cy, cw, ch] = h.crop, x = f.x * res, y = f.y * res, w = f.width * res, hh = f.height * res;
      if (x >= cx - 1 && y >= cy - 1 && x + w <= cx + cw + 1 && y + hh <= cy + ch + 1) {
        const k = h.k;
        h.subs ??= new Map();
        const key = x + ',' + y + ',' + w + ',' + hh;
        if (!h.subs.has(key)) h.subs.set(key, new Texture({ source: h.normal.source, frame: new Rectangle(Math.max(0, (x - cx) * k), Math.max(0, (y - cy) * k), Math.min(w * k, h.normal.width), Math.min(hh * k, h.normal.height)) }));
        return h.subs.get(key);
      }
    }
    return null;
  };
  normalFor.loads = loads;
  return normalFor;
}
