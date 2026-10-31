// The natural-rock terrain raster 1.7 draws on the elemental planes and on the Rot and Violet islands of the Realm of
// Chaos (1.7 js/world/planes/planeterrain.js ptCellRaster, its PT_MAT palettes; the Rot and Violet materials of
// js/presentation/render/chaos-preview-render.js; the cave-rock pass of js/world/terrain/environment-terrain.js
// enhanceKernel @3c8b312). Per sample point, from world position and the floor's salt: open floor (mineral drift,
// ribbons, the centre inlay, sun inlays, pools, scree, moss, occlusion), rock (a cliff face where open ground lies
// below, faceted tops elsewhere) and the dark beyond. Rock and floor then take the painted cave-rock master's grain.
// Drawn per chunk of cells into a canvas at S samples a cell (realm-view.js paints at 1.7's 128, audit WT7).
// Presentation only: nothing here reads or writes game state. The colours per sample are realm-ground.js's; the fields
// it reads and the light's fields it gives, realm-fields.js's (M10).

import { hash2, noiseSwept as ptVal, voronoiSwept as ptVor, grainHash, grainNoise } from '../lib/noise.js';
import { mixRgb as mix } from '../lib/colour.js';
import { mineralEnergy, rgbOf, streak, floorColor, kinder, chasmCell, islandDrop } from './realm-ground.js';

// render-31: where the rock's veins glint and its cliff crystals grow, one test each for the raster, the planes' motion
// and light (plane-anim.js) and the Chaos islands' glints (realm-view.js).
/** planeterrain.js ptGlints: a rock cell where a vein region runs catches the light (the caller asks for rock near open floor). */
export const veinAt = (x, y, salt) => ptVal(x * 0.24, y * 0.24, salt + 20) >= 0.6 && hash2(x, y, salt + 61) <= 0.07;
/** planeterrain.js ptCrystalAt: a cliff (rock over open ground) grows crystals here. */
export const crystalAt = (x, y, salt) => hash2(x, y, salt + 51) < 0.16;
import { ROCK } from '../data/rock.js';

const wrapM = (v, n) => { v = ((v % (n * 2)) + n * 2) % (n * 2); return v < n ? v : n * 2 - 1 - v; };

/**
 * One chunk of the raster.
 * @param {object} F the floor's fields: {W, H, wall(x,y), dist(x,y), matAt(x,y) -> ROCK entry or null, mossAt(x,y) -> bool,
 *   pool: Float32Array weights per cell, center, suns, salt, rock: rockPixels() result or null}
 * @param {number} cx0 first cell x, cy0 first cell y, cw, ch: the chunk in cells; S samples a cell
 * @returns {HTMLCanvasElement|OffscreenCanvas|null} null when no cell of the chunk has a material or a chasm edge (an OffscreenCanvas in a worker)
 */
export function rasterChunk(F, cx0, cy0, cw, ch, S) {
  let any = false;
  for (let y = cy0; y < cy0 + ch && !any; y++) for (let x = cx0; x < cx0 + cw; x++) if (F.matAt(x, y) || chasmCell(F, x, y)) { any = true; break; }
  if (!any) return null;
  const salt = F.salt, step = 1 / S, W = cw * S, H = ch * S;
  const FACEP = Math.round(0.8 * S);
  const kindAt = (gu, gv) => kind((gu + 0.5) * step, (gv + 0.5) * step);
  const kind = kinder(F);
  // Kinds cached over the chunk and a margin (the cleanup, cliff, scree and shadow scans read around a point).
  const PAD = Math.ceil(S * 0.3) + 4, X0 = -PAD, Y0 = -PAD, KW = W + PAD * 2, KH = H + FACEP + PAD * 2;
  const k0m = new Uint8Array(KW * KH).fill(255), km = new Uint8Array(KW * KH).fill(255);
  const gu0 = cx0 * S, gv0 = cy0 * S;
  const K0 = (u, v) => {
    const i = u - X0, j = v - Y0;
    if (i < 0 || j < 0 || i >= KW || j >= KH) return kindAt(gu0 + u, gv0 + v);
    const q = j * KW + i; let k = k0m[q]; if (k === 255) k = k0m[q] = kindAt(gu0 + u, gv0 + v); return k;
  };
  const Kraw = (u, v) => {
    const k0 = K0(u, v);
    if (k0 === 1 && ((K0(u - 1, v) === 0 && K0(u + 1, v) === 0) || (K0(u, v - 1) === 0 && K0(u, v + 1) === 0) || (K0(u - 2, v) === 0 && K0(u + 2, v) === 0 && K0(u, v - 1) === 0))) return 0;
    return k0;
  };
  const K = (u, v) => {
    const i = u - X0, j = v - Y0;
    if (i < 0 || j < 0 || i >= KW || j >= KH) return Kraw(u, v);
    const q = j * KW + i; let k = km[q]; if (k === 255) k = km[q] = Kraw(u, v); return k;
  };
  const foot = new Uint16Array(W * H);
  for (let u = 0; u < W; u++) {
    let d = 0;
    for (let v = H + FACEP; v >= 0; v--) { if (K(u, v) === 0) d = 0; else d++; if (v < H) foot[v * W + u] = d > 0 && d <= FACEP ? d : 0; }
  }
  const c = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : new OffscreenCanvas(W, H);   // a worker has no document (realm-worker.js)
  const g = c.getContext('2d'), im = g.createImageData(W, H), D = im.data;
  const rock = F.rock?.red ? F.rock : null, sc = 128 / S;
  const screeN = Math.max(1, Math.round(S * 7 / 32)), occStep = Math.max(1, Math.round(S * 2 / 32)), back = Math.max(1, Math.round(S * 2 / 128));
  const poolF = (wx, wy) => {
    if (!F.pool) return 0;
    const cx = Math.floor(wx), cy = Math.floor(wy); let f = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= F.W || ny >= F.H) continue;
      const pw = F.pool[ny * F.W + nx]; if (!pw) continue;
      const dx = wx - (nx + 0.5), dy = (wy - (ny + 0.5)) * 1.1, d = Math.sqrt(dx * dx + dy * dy) / 1.5;
      if (d < 1) f += (1 - d) * (1 - d) * pw;
    }
    return f ? f + (ptVal(wx * 1.6, wy * 1.6, 977) - 0.5) * 0.22 : 0;
  };
  const mossF = (wx, wy) => {
    const cx = Math.floor(wx), cy = Math.floor(wy); let f = 0, tot = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= F.W || ny >= F.H) continue;
      const dx = wx - (nx + 0.5), dy = wy - (ny + 0.5), d = Math.sqrt(dx * dx + dy * dy) / 1.9; if (d >= 1) continue;
      const w = (1 - d) * (1 - d); tot += w; if (F.mossAt(nx, ny)) f += w;
    }
    return tot ? f / tot : 0;
  };
  const rows = new Map();
  const palRow = M => {
    let r = rows.get(M);
    if (!r) { r = { topLow: [], topSpan: [], faceLow: [], faceSpan: [] }; for (let k = 0; k < 3; k++) { const tg = M.organicRock ? 0.72 : 0.61, fg = M.organicRock ? 0.58 : 0.5, tl = M.topLo[k] * tg, fl = M.faceLo[k] * fg; r.topLow.push(tl); r.topSpan.push(M.topHi[k] * tg - tl); r.faceLow.push(fl); r.faceSpan.push(M.lip[k] * 0.85 * fg - fl); } rows.set(M, r); }
    return r;
  };
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const cellX = cx0 + Math.floor(u / S), cellY = cy0 + Math.floor(v / S), M = F.matAt(cellX, cellY), E = chasmCell(F, cellX, cellY);
    const p = (v * W + u) * 4;
    if (!M && !E) continue;
    const wx = (gu0 + u + 0.5) * step, wy = (gv0 + v + 0.5) * step;
    // Items 185, 205: where the land meets the void, the Caverns' chasm edge, off the tile grid: past it the cliff falls
    // into the dark (the void's sky closes over it, realm-void.js); the land runs to it with no lip.
    const drop = E ? islandDrop(E, cellX, cellY, wx, wy, salt + 600) : null;
    if (drop || !M) { if (drop) { D[p] = drop[0]; D[p + 1] = drop[1]; D[p + 2] = drop[2]; D[p + 3] = drop[3]; } continue; }
    const kk = K(u, v);
    let col, wd = -1, pooled = false;
    if (kk === 2) {
      col = M.void;
      if (K(u, v + 1) === 1 || K(u - 1, v) === 1 || K(u + 1, v) === 1 || K(u, v - 1) === 1) col = M.voidEdge;
    } else if (kk === 1) {
      const dn = foot[v * W + u];
      if (dn > 0) {
        wd = 1 - dn / FACEP;
        const depth = dn / FACEP, cf = ptVor(wx * 2.2, wy * 0.55, 0.55, salt + 21), shade = 0.86 + 0.2 * hash2(cf.ix, cf.iy, salt + 22);
        col = mix(M.faceLo, M.face, Math.min(1, depth * 1.1)); col = [col[0] * shade, col[1] * shade, col[2] * shade];
        if (cf.d2 - cf.d1 < 0.03) col = mix(col, M.faceLo, 0.3);
        if (K(u, v - 1) !== 1 || K(u, v - 2) !== 1) col = M.lip;
      } else {
        const f = ptVor(wx, wy, 1.5, salt + 11), ang = Math.atan2(wy - f.sy, wx - f.sx), turn = hash2(f.ix, f.iy, salt + 13) * 6.28;
        const facet = Math.floor((((ang + turn) % 6.2832) + 6.2832) % 6.2832 / 1.2566), fa = facet * 1.2566 - turn + 0.628, lit = -(Math.cos(fa) * 0.7 + Math.sin(fa) * 0.7);
        col = M.organicRock ? mix(M.topLo, M.topHi, Math.max(0, Math.min(1, 0.48 + lit * 0.25 + (ptVal(wx * 2.7, wy * 2.7, salt + 116) - 0.5) * 0.6))) : lit > 0.35 ? M.topHi : lit > -0.35 ? M.top : M.topLo;
        col = mix(col, M.topLav, 0.25 * ptVal(wx * 0.35, wy * 0.35, salt + 14));
        const mot = (ptVal(wx * 3.2, wy * 3.2, salt + 15) - 0.5) * 9 + (ptVal(wx * 7.5, wy * 7.5, salt + 16) - 0.5) * 5;
        col = [col[0] + mot, col[1] + mot, col[2] + mot * 1.05];
        if (hash2(Math.floor(wx * S), Math.floor(wy * S), salt + 17) < 0.03) col = mix(col, M.topLo, 0.35);
        if (f.d2 - f.d1 < 0.03) col = mix(col, M.topLo, M.organicRock ? 0.16 : 0.5);
        for (let b = 1; b <= 4; b++) if (K(u, v - b * back) === 2) { col = mix(col, M.topLo, 0.45 * (1 - (b - 1) / 4)); break; }
        if (K(u - 1, v) === 0 || K(u + 1, v) === 0 || K(u, v - 1) === 0) col = mix(col, M.edge, 0.55);
      }
      col = streak(col, wx, wy, M, salt);
      if (M.organicRock) {
        const pore = ptVor(wx, wy, 0.2, salt + 117), pr = 0.019 + 0.023 * hash2(pore.ix, pore.iy, salt + 118);
        if (pore.d1 < pr) col = mix(col, M.faceLo, 0.45); else if (pore.d1 < pr + 0.015 && wy > pore.sy) col = mix(col, M.lip, 0.25);
      }
    } else {
      col = floorColor(wx, wy, M, salt, S, F.center);
      const ca = F.center;
      if (ca) {
        const dx = wx - (ca.x + 1), dy = (wy - (ca.y + 1.5)) / 0.85, rr = Math.sqrt(dx * dx + dy * dy), an = Math.atan2(dy, dx);
        if (rr < 1.5) col = mix(col, M.polish, 0.7);
        else if (rr < 2.6) {
          const segs = 16, sgf = ((an + Math.PI) / (Math.PI * 2)) * segs, sg = Math.floor(sgf), ring = rr < 2.05 ? 0 : 1;
          const broken = hash2(sg, ring, salt + 61) < 0.28 || (ring === 1 && hash2(sg, 7, salt + 62) < 0.2);
          if (!broken) {
            col = mix(col, M.inlay, 0.85);
            const edgeA = Math.min(sgf - sg, 1 - (sgf - sg)) * rr * (Math.PI * 2 / segs);
            if (edgeA < 0.035 || Math.abs(rr - 2.05) < 0.035 || rr < 1.535 || rr > 2.565) col = mix(col, M.inlayJoint, 0.8);
            if (hash2(sg, ring, salt + 63) < 0.22 && edgeA < 0.09 && Math.abs(rr - (ring ? 2.33 : 1.78)) < 0.08) col = M.vein;
          } else if (Math.abs(rr - 2.05) < 0.3 && hash2(Math.floor(wx * S), Math.floor(wy * S), salt + 64) < 0.05) col = mix(col, M.inlayJoint, 0.6);
        } else if (rr < 6) {
          const rk = ((an + Math.PI) / (Math.PI * 2)) * 12, rd = Math.abs(rk - Math.round(rk)) * rr * (Math.PI * 2 / 12), fade = 1 - (rr - 2.6) / 3.4;
          if (rd < 0.03 && ptVal(wx * 1.7, wy * 1.7, salt + 65) > 0.35) col = mix(col, M.vein, 0.55 * fade * fade);
        }
      }
      for (const sun of F.suns ?? []) {
        const sdx = wx - sun.x, sdy = (wy - sun.y) / 0.9, sr = Math.sqrt(sdx * sdx + sdy * sdy); if (sr > 1.35) continue;
        if (ptVal(wx * 3.1, wy * 3.1, salt + 81) < 0.3) continue;
        const san = Math.atan2(sdy, sdx), srk = ((san + Math.PI) / (Math.PI * 2)) * 12, srd = Math.abs(srk - Math.round(srk)), gap = ptVal(wx * 5.5, wy * 5.5, salt + 82);
        if (M.motif === 'moon') {
          const inner = Math.sqrt((sdx - 0.42) ** 2 + sdy * sdy), mr = Math.sqrt(sdx * sdx + sdy * sdy);
          if (mr < 0.95 && inner > 0.72 && gap > 0.3) col = mix(col, M.vein, 0.5); else if (sr > 1.15 && sr < 1.3 && gap > 0.35) col = mix(col, M.inlay, 0.5);
        } else if (M.motif === 'leaf') {
          const lk = ((san + Math.PI) / (Math.PI * 2)) * 6, lf = Math.abs(lk - Math.round(lk));
          if (sr < 0.22 && gap > 0.3) col = mix(col, M.vein, 0.5);
          else if (sr < 1.0 && lf < 0.2 - 0.12 * sr && gap > 0.4) col = mix(col, M.vein, 0.45 * (1 - sr));
          else if (sr > 1.1 && sr < 1.26 && gap > 0.35) col = mix(col, M.inlay, 0.45);
        } else if (M.motif === 'sun') {
          if (sr < 0.28) { if (gap > 0.3) col = mix(col, M.vein, 0.32 + 0.18 * (1 - sr / 0.28)); }
          else if (sr < 0.36) { if (gap > 0.25) col = mix(col, M.inlayJoint, 0.55); }
          else if (sr < 1.1 && srd < 0.14 * (1 - sr / 1.1) + 0.025) { if (gap > 0.42) col = mix(col, M.vein, 0.45 * (1 - sr / 1.25)); }
          else if (sr > 1.15 && sr < 1.3) { if (gap > 0.35) col = mix(col, M.inlay, 0.5); }
        }
      }
      const pf = poolF(wx, wy);
      if (pf > 0.3) {
        pooled = true;
        const deep = Math.min(1, (pf - 0.34) / 0.5), shelfN = ptVal(wx * 2.4, wy * 2.4, salt + 71);
        if (pf < 0.4 && shelfN > 0.55) col = mix(M.poolShelf, M.poolEdge, 0.5);
        else if (pf < 0.42) col = mix(M.poolShallow, M.poolEdge, (pf - 0.3) / 0.12);
        else col = mix(M.poolEdge, M.pool, Math.max(0, deep));   // item 249: clear water, no painted specks (plane-anim.js glints it)
        // Shadow keeps 1.7's broken waterline; the clear Light-plane pools stay unchanged.
        if (M === ROCK.shadow && pf < 0.325 && ptVal(wx * 3.4, wy * 3.4, salt + 74) > 0.62 && hash2(Math.floor(wx * S), Math.floor(wy * S), salt + 73) < 0.5) col = mix(col, M.poolRim, 0.7);
      } else if (pf > 0.18) {
        const sh2 = ptVal(wx * 2.4, wy * 2.4, salt + 71);
        col = sh2 > 0.62 ? mix(col, M.poolShelfDry, 0.45) : mix(col, M.poolWet, 0.3 * (pf - 0.18) / 0.12);
        if (sh2 > 0.62 && pf > 0.27) col = mix(col, M.edge, 0.25);
      }
      let dUp = 0;
      for (let su = 1; su <= screeN; su++) if (K(u, v - su) === 1) { dUp = su; break; }
      if (dUp) {
        const scree = ptVal(wx * 3.4, wy * 5.2, salt + 90), grit = hash2(Math.floor(wx * S), Math.floor(wy * S), salt + 91), reach = (screeN - dUp) / screeN;
        if (scree > 0.62 - reach * 0.3) { col = mix(col, grit < 0.3 ? M.topHi : grit < 0.62 ? M.top : M.topLo, 0.75); if (grit > 0.93) col = mix(col, M.edge, 0.5); }
        else if (grit < 0.05 + reach * 0.1) col = mix(col, M.topLo, 0.5);
      }
      if (M.moss && F.mossAt) {
        const mf = mossF(wx, wy);
        if (mf > 0.08 && pf < 0.18) {
          const mv = ptVor(wx + 0.3 * ptVal(wx * 1.4, wy * 1.4, salt + 67), wy, 1.5, salt + 61), along = Math.max(0, 1 - (mv.d2 - mv.d1) / 0.16);
          const drift = ptVal(wx * 1.1, wy * 1.1, salt + 64) * 0.6 + ptVal(wx * 2.8, wy * 2.8, salt + 65) * 0.4;
          let damp = mf * (M.organicRock ? Math.max(along * 0.6, Math.max(0, (drift - 0.2) * 2)) : along) * (0.55 + drift * 0.7);
          if (M === ROCK.earth) damp = Math.max(damp, mf * (0.35 + drift * 0.8));
          if (damp > 0.1) {
            col = mix(col, M.moss[2], Math.min(0.6, damp * 0.75));
            if (damp > 0.26) col = mix(col, M.moss[0], Math.min(M.organicRock ? 0.88 : 0.7, (damp - 0.26) * (M.organicRock ? 2.4 : 1.5)));
            const sp = hash2(Math.floor(wx * S), Math.floor(wy * S), salt + 62);
            if (M.organicRock) { if (damp > 0.2) col = mix(col, M.moss[1], Math.max(0, sp - 0.45) * 0.16); }
            else if (damp > 0.34 && sp < (damp - 0.34) * 0.85) col = M.moss[3];
            else if (damp > 0.2 && sp > 0.985) col = M.moss[1];
          }
        }
      }
      let occ = 0;
      for (let o = 2; o <= screeN; o += occStep) { if (K(u, v - o) === 1) occ = Math.max(occ, 1 - o / (S * 9 / 32)); if (K(u - o, v) === 1 || K(u + o, v) === 1) occ = Math.max(occ, 0.6 * (1 - o / (S * 9 / 32))); }
      if (occ) col = mix(col, M.occ, 0.32 * occ);
    }
    // environment-terrain.js enhanceKernel: rock takes the painted master's tone; open floor its grain.
    const rv = rock ? rock.red[wrapM(Math.floor(wy * 128), rock.h) * rock.w + wrapM(Math.floor(wx * 128), rock.w)] : 128;
    if (kk === 1 && rock) {
      const P = palRow(M), tone = Math.max(0, Math.min(1, M.organicRock ? 0.55 + (rv / 255 - 0.5) * 2.2 : 0.55 + (rv / 255 - 0.35) * 2)), face = wd >= 0 ? 1 : 0, depth = wd >= 0 ? wd : 0, lip = Math.max(0, 1 - depth / 0.04) * 0.08 * face;
      const cov = ((K(u + 1, v) === 1) + (K(u, v + 1) === 1) + (K(u + 1, v + 1) === 1) + 1) / 4, edge = (1 - cov) * 0.4;
      const energy = mineralEnergy(M, col);   // the veins' colour and hot cores show through (WT6)
      for (let k = 0; k < 3; k++) {
        let o = (P.topLow[k] + P.topSpan[k] * tone) * (1 - face) + (P.faceLow[k] + P.faceSpan[k] * tone * (1 - depth * 0.25)) * face;
        o = o * (1 - lip) + M.lip[k] * lip; o = o * (1 - edge) + M.edge[k] * edge; o = o * (1 - energy) + col[k] * energy;
        D[p + k] = o;
      }
    } else {
      let grain = 0;
      if (kk === 0 && pooled && M !== ROCK.fire && !M.organicRock && F.fluid?.red) {
        // 1.7 enhanceKernel: the painted fluid master, at 128 pixels per tile and .12 strength.
        const f = F.fluid, wrap = (v, n) => ((v % n) + n) % n;
        grain = (f.red[wrap(Math.floor(wy * 128), f.h) * f.w + wrap(Math.floor(wx * 128), f.w)] - 128) * 0.12;
      }
      if (kk === 0 && !pooled) {
        grain = grainNoise(wx * 12, wy * 12, 37) * 8 + grainNoise(wx * 38, wy * 38, 91) * 4 + (grainHash(gu0 + u, gv0 + v, 173) - 0.5) * 2;
        // A plane's stone takes its own roughness; the Chaos islands' natural stone the Caverns' (enhanceKernel: plane ? ... : .34, noise 12).
        const rough = M.organicRock ? 0.34 : Math.max(0.28, Math.min(0.42, 0.18 + M.grain * 8));
        if (rock) grain += (rv - 128) * rough + grainNoise(wx * 5, wy * 5, 227) * (M.organicRock ? 12 : rough * 28);
      }
      D[p] = col[0] + grain; D[p + 1] = col[1] + grain; D[p + 2] = col[2] + grain;
    }
    D[p + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  // Crystals growing out of the cliff faces (planeterrain.js ptCrystalAt, ptCrystal), planes only.
  for (let y = cy0; y < cy0 + ch; y++) for (let x = cx0; x < cx0 + cw; x++) {
    const M = F.matAt(x, y);
    if (!M || M.faceCrystals === false || !M.crystal || !F.wall(x, y) || F.wall(x, y + 1) || y + 1 >= F.H || !crystalAt(x, y, salt)) continue;
    g.save(); g.translate((x - cx0) * S, (y - cy0) * S); g.scale(S / 32, S / 32); crystal(g, x, y, salt, M); g.restore();
  }
  return c;
}

function crystal(g, x, y, salt, M) {
  const n = 1 + Math.floor(hash2(x, y, salt + 52) * 2), bx = 8 + hash2(x, y, salt + 53) * 16, by = Math.round(32 * 0.66);
  const C = M.crystal, tone = (hex, f) => `rgb(${rgbOf(hex).map(v => Math.min(255, Math.round(v * f))).join(',')})`;
  for (let k = 0; k < n; k++) {
    const ox = bx + (k - (n - 1) / 2) * 3, oy = by + (hash2(x, y, salt + 95 + k) - 0.5) * 3, h = 7 + hash2(x, y, salt + 60 + k) * 8, w = 1.6 + hash2(x, y, salt + 70 + k) * 1.6;
    const lean = (hash2(x, y, salt + 80 + k) - 0.5) * 4, cyan = hash2(x, y, salt + 90 + k) < 0.35;
    g.fillStyle = 'rgba(18,14,26,0.5)'; g.beginPath(); g.ellipse(ox, oy, w * 1.5, 1.6, 0, 0, 7); g.fill();
    const tipX = ox + lean, tipY = oy - h, leftX = ox - w * 0.75 + lean * 0.6, rightX = ox + w * 0.75 + lean * 0.6, shoulderY = oy - h * 0.78, ridgeX = ox + lean * 0.25;
    const poly = (pts, ink) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fillStyle = ink; g.fill(); };
    // PT3 (1.7 planeterrain.js ptWallShard): each face graded from its tip down into the rock, a slanted fracture across
    // the body and two fine broken highlights.
    const grade = (a, b) => { const gr = g.createLinearGradient(tipX, tipY, ox, oy); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
    const body = cyan ? C[3] : C[1], shade = cyan ? C[3] : C[2];
    poly([ox - w, oy, leftX, shoulderY, tipX, tipY, rightX, shoulderY, ox + w, oy], tone(shade, 0.48));
    poly([ox - w + 0.15, oy - 0.2, leftX + 0.12, shoulderY, tipX, tipY + 0.15, ridgeX, oy - 0.25], grade(tone(body, 1.04), tone(shade, 0.74)));
    poly([ridgeX, oy - 0.25, tipX, tipY + 0.15, rightX - 0.15, shoulderY + 0.15, ox + w * 0.5, oy - 0.2], grade(body, tone(shade, 0.58)));
    poly([ox + w * 0.5, oy - 0.2, rightX - 0.15, shoulderY + 0.15, ox + w - 0.15, oy - 0.2], grade(shade, tone(shade, 0.4)));
    poly([leftX + 0.12, shoulderY, tipX, tipY + 0.15, ridgeX + lean * 0.1, shoulderY + h * 0.11], grade(C[0], body));
    poly([ox - w * 0.64 + lean * 0.3, oy - h * 0.42, ridgeX, oy - h * 0.47, ox + w * 0.53 + lean * 0.3, oy - h * 0.39, ridgeX, oy - h * 0.43], tone(body, 0.84));
    // The highlights stay inside the crystal (1.7's second point lies outside its right edge, a hair past the tip).
    g.save(); g.beginPath(); g.moveTo(ox - w, oy); g.lineTo(leftX, shoulderY); g.lineTo(tipX, tipY); g.lineTo(rightX, shoulderY); g.lineTo(ox + w, oy); g.closePath(); g.clip();
    g.strokeStyle = C[0]; g.lineWidth = 0.16; g.beginPath(); g.moveTo(leftX + 0.14, shoulderY + 0.25); g.lineTo(tipX, tipY + 0.18); g.lineTo(rightX - 0.22, shoulderY * 0.38 + tipY * 0.62); g.stroke();
    g.strokeStyle = tone(body, 1.08); g.lineWidth = 0.12; g.beginPath(); g.moveTo(tipX, tipY + h * 0.16); g.lineTo(ridgeX, oy - h * 0.24); g.stroke(); g.restore();
    g.fillStyle = M.rockLo; g.beginPath(); g.moveTo(ox - w - 1, oy + 0.3); g.lineTo(ox - w * 0.7, oy - 1.3); g.lineTo(ox - w * 0.15, oy + 0.7); g.closePath(); g.fill();
    g.fillStyle = M.rockHi; g.beginPath(); g.moveTo(ox + w * 0.35, oy + 0.5); g.lineTo(ox + w * 0.8, oy - 0.7); g.lineTo(ox + w + 1, oy + 0.8); g.closePath(); g.fill();
  }
}
