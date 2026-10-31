// The Chaos islands' void and cliffs (M10, render-28: moved out of realm-view.js): the sky and the painted cliff cells
// round each island, inlays and chains, baked into the void scene realmTerrain lays under the islands.

import { rockPixels } from './realm-fields.js';
import { chasmCell } from './realm-ground.js';
import { chasmDepth } from './ground-marks.js';
import { sheet, hasSheet, R, VP, wallish, hexN, noise, path, polygon, hexA, motionSalt } from './realm-kit.js';

const VOID_DIM = 'rgb(128,163,133)';
const SKY = { prism: '#386DA7', rot: '#62D4BE', cinder: '#73BEDA', violet: '#708BCE' };
const CLIFF = { rot: [[48, 44, 29], [162, 140, 98]], violet: [[44, 32, 66], [165, 129, 183]], cinder: [[47, 35, 36], [175, 117, 88]], prism: [[22, 39, 65], [116, 153, 180]] };
const cliffCanvas = new Map();
function cliffPattern(g, theme) {
  if (!hasSheet('environment-terrain-cave-rock')) return null;
  const src = rockPixels(Object.values(sheet('environment-terrain-cave-rock').textures)[0].source);
  if (!src?.red) return null;
  let c = cliffCanvas.get(theme);
  if (!c || c.src !== src) {
    c = document.createElement('canvas'); c.width = src.w; c.height = src.h; c.src = src;
    const cg = c.getContext('2d'), im = cg.createImageData(src.w, src.h), a = im.data, [lo, hi] = CLIFF[theme];
    for (let i = 0; i < src.red.length; i++) { const v = src.red[i] / 255; for (let k = 0; k < 3; k++) a[i * 4 + k] = Math.round(lo[k] + (hi[k] - lo[k]) * v); a[i * 4 + 3] = 255; }
    cg.putImageData(im, 0, 0); cliffCanvas.set(theme, c);
  }
  const p = g.createPattern(c, 'repeat'); p.setTransform(new DOMMatrix().scale(0.25)); return p;
}
function paintCliffTexture(g, theme, x, y, w, h) {
  const pat = cliffPattern(g, theme);
  if (pat) { g.globalAlpha = 0.82; g.fillStyle = pat; g.fillRect(x, y, w, h); g.globalAlpha = 1; }
  const depth = g.createLinearGradient(0, y, 0, y + h);
  depth.addColorStop(0, 'rgba(235,217,187,.12)'); depth.addColorStop(0.24, 'rgba(0,0,0,0)'); depth.addColorStop(1, 'rgba(8,11,19,.62)');
  g.fillStyle = depth; g.fillRect(x, y, w, h);
  const relief = g.createLinearGradient(x, 0, x + w, 0);
  relief.addColorStop(0, 'rgba(233,220,199,.12)'); relief.addColorStop(0.34, 'rgba(0,0,0,0)'); relief.addColorStop(1, 'rgba(9,12,21,.28)');
  g.fillStyle = relief; g.fillRect(x, y, w, h);
  g.strokeStyle = theme === 'rot' ? 'rgba(34,31,20,.28)' : 'rgba(31,22,47,.28)'; g.lineWidth = 0.45;
  for (let n = 0; n < 5; n++) { const cy = y + h * (0.12 + n * 0.15), dx = w * (0.12 + noise(x, n, 83) * 0.42); g.beginPath(); g.moveTo(x + dx, cy); g.lineTo(x + dx + w * 0.17, cy - h * 0.024); g.lineTo(x + dx + w * 0.36, cy + h * 0.017); g.stroke(); }
}
function paintedCliff(g, theme, pts, fill, x, y, w, h) { g.save(); path(g, pts); g.clip(); g.fillStyle = fill; g.fillRect(x, y, w, h); paintCliffTexture(g, theme, x, y, w, h); g.restore(); }
function rootStrand(g, x, y, drop, side, width, color) { g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + side * 10, y + drop * 0.25, x - side * 9, y + drop * 0.61, x + side * 3, y + drop); g.stroke(); }

/** How much of the void a cell near the land's edge cuts away, per pixel: all of it on the land and down the Caverns'
 *  cliff band to its dark (chasmDepth 0 to 0.3), then less and less, so the sky closes over the depth (to 0.5). */
function landCut(E, x, y, salt) {
  const c = document.createElement('canvas'); c.width = c.height = VP;
  const g = c.getContext('2d'), im = g.createImageData(VP, VP), D = im.data;
  for (let v = 0; v < VP; v++) for (let u = 0; u < VP; u++) {
    const e = chasmDepth(E.near, E.own, x, y, x + (u + 0.5) / VP, y + (v + 0.5) / VP, salt);
    D[(v * VP + u) * 4 + 3] = e <= 0.3 ? 255 : Math.round(255 * Math.max(0, 1 - (e - 0.3) / 0.2));
  }
  g.putImageData(im, 0, 0);
  return c;
}

/** The void painter for a Realm floor: (chunk cells) -> canvas. */
export function voidScene(floor) {
  const W = floor.w, H = floor.h, ch = floor.chaos, regions = ch.regions, seed = floor.seed ?? 91;
  const land = (x, y) => x >= 0 && y >= 0 && x < W && y < H && ch.regionOf[y * W + x] >= 0;
  const bounds = regions.map((r, i) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let k = 0; k < W * H; k++) if (ch.regionOf[k] === i) { const x = k % W, y = (k / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  });
  const floorCell = (x, y) => land(x, y) && !wallish(floor.tiles[y * W + x]);
  const edge = { W, matAt: (x, y) => (land(x, y) ? 1 : null) }, salt = motionSalt(floor) + 600;   // the raster's chasm edge (realm-raster.js)
  return (cx, cy, cw, chh) => {
    const c = document.createElement('canvas'); c.width = cw * VP; c.height = chh * VP;
    const g = c.getContext('2d');
    g.scale(VP / R, VP / R); g.translate(-cx * R, -cy * R);
    const X0 = cx - 3, X1 = cx + cw + 3, Y0 = cy - 6, Y1 = cy + chh + 1;
    const sky = g.createLinearGradient(0, 0, W * R, H * R); sky.addColorStop(0, '#315F99'); sky.addColorStop(1, '#487FAD');
    g.fillStyle = sky; g.fillRect(cx * R, cy * R, cw * R, chh * R);
    regions.forEach((r, i) => {
      const b = bounds[i], col = SKY[r.palette] ?? SKY.prism, n = hexN(col), rgb = `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`;
      g.save(); g.translate((b.x + b.w * 0.5) * R, (b.y + b.h * 0.5) * R); g.scale((b.w * 0.7 + 5) * R, (b.h * 0.7 + 5) * R);
      const haze = g.createRadialGradient(0, 0, 0, 0, 0, 1); haze.addColorStop(0, `rgba(${rgb},.92)`); haze.addColorStop(0.4, `rgba(${rgb},.65)`); haze.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = haze; g.fillRect(-1, -1, 2, 2); g.restore();
    });
    // Each island's hanging rock, clipped to its own neighbourhood (mixedBounds / mixedClip).
    regions.forEach((r, i) => {
      const b = bounds[i], mb = { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 3), right: Math.min(W, b.x + b.w + 4), bottom: Math.min(H, b.y + b.h + 6) };
      if (mb.right < X0 || mb.x > X1 || mb.bottom < Y0 || mb.y > Y1) return;
      g.save(); g.beginPath();
      for (let y = mb.y; y < mb.bottom; y++) for (let x = mb.x; x < mb.right; x++) if (ch.regionOf[y * W + x] < 0 || ch.regionOf[y * W + x] === i) g.rect(x * R, y * R, R, R);
      g.clip();
      const mine = (x, y) => land(x, y) && ch.regionOf[y * W + x] === i;
      for (let y = Math.max(0, Y0); y < Math.min(H, Y1); y++) for (let x = Math.max(0, X0); x < Math.min(W, X1); x++) if (mine(x, y)) cliffCell(g, r.palette, x, y, land, seed);
      g.restore();
    });
    // 1.7's void reads near black under its light (3, 9, 15 lit against the rewrite's 6, 14, 29 on the board,
    // chaos-f21-s11 and f22-s11): its void tiles take less ambient than this map gives them, so the void is darkened here.
    g.globalCompositeOperation = 'multiply'; g.fillStyle = VOID_DIM; g.fillRect(cx * R, cy * R, cw * R, chh * R);
    // Item 185: the land is cut out of the void along the Caverns' chasm edge, not its tiles, with its cliff band: the
    // raster's lip and ledges falling into the dark show whole, then the sky closes over the depth.
    g.globalCompositeOperation = 'destination-out';
    for (let y = cy; y < cy + chh; y++) for (let x = cx; x < cx + cw; x++) {
      const E = chasmCell(edge, x, y);
      if (E) g.drawImage(landCut(E, x, y, salt), x * R, y * R, R, R); else if (land(x, y)) g.fillRect(x * R, y * R, R, R);
    }
    g.globalCompositeOperation = 'source-over';
    // Ornaments that cross the land: Cinder's chains and Violet's filaments over everything, Rot's tendrils and the
    // Crucible's inlays on open ground only.
    for (const k of ch.chains ?? []) chain(g, k);
    for (const t of ch.filaments ?? []) {
      const ax = (t.x + 0.5) * R, ay = (t.y + 0.5) * R, bx = (t.toX + 0.5) * R, by = (t.toY + 0.5) * R;
      g.strokeStyle = 'rgba(227,208,243,.58)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + R * 0.7, bx, by); g.stroke();
    }
    if ((ch.tendrils?.length || ch.inlays?.length)) {
      g.save(); g.beginPath();
      for (let y = Math.max(0, cy - 1); y < Math.min(H, cy + chh + 1); y++) for (let x = Math.max(0, cx - 1); x < Math.min(W, cx + cw + 1); x++) if (floorCell(x, y)) g.rect(x * R, y * R, R, R);
      g.clip();
      for (const t of ch.tendrils ?? []) {
        const ax = (t.x + 0.5) * R, ay = (t.y + 0.5) * R, bx = (t.toX + 0.5) * R, by = (t.toY + 0.5) * R, dx = bx - ax, dy = by - ay;
        g.lineCap = 'round';
        for (const [col, w, o] of [['rgba(49,40,21,.30)', 3, 2], ['#B5A775', 1.4, 0]]) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(ax, ay + o); g.bezierCurveTo(ax + dx * 0.38 + dy * 0.15, ay + dy * 0.28 - dx * 0.15, bx - dx * 0.24 - dy * 0.1, by - dy * 0.22 + dx * 0.1, bx, by); g.stroke(); }
      }
      for (const m of ch.inlays ?? []) inlay(g, m);
      g.restore();
    }
    return c;
  };
}
function inlay(g, m) {
  const x = (m.x + 0.5) * R, y = (m.y + 0.5) * R;
  g.strokeStyle = hexA(m.color, m.opacity ?? 0.55); g.fillStyle = hexA(m.color, 0.1); g.lineWidth = m.lineWidth || 1.6;
  if (m.kind === 'broken-ring') for (const a of m.arcs ?? []) { g.beginPath(); g.ellipse(x, y, m.r * R, m.r * R * 0.86, 0, a[0], a[1]); g.stroke(); }
  else if (m.kind === 'disc') { g.beginPath(); g.ellipse(x, y, m.r * R, m.r * R * 0.86, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
  else if (m.kind === 'threshold') { g.fillRect(m.x * R, m.y * R, m.w * R, m.h * R); g.beginPath(); g.moveTo(m.x * R, m.y * R); g.lineTo((m.x + m.w) * R, m.y * R); g.moveTo(m.x * R, (m.y + m.h) * R); g.lineTo((m.x + m.w) * R, (m.y + m.h) * R); g.stroke(); }
}
function chain(g, k) {
  const ax = (k.x + 0.5) * R, ay = (k.y + 0.5) * R, bx = (k.toX + 0.5) * R, by = (k.toY + 0.5) * R, steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
  for (let j = 0; j <= steps; j++) {
    const t = j / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t + Math.sin(t * Math.PI) * R * 0.45;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(by - ay, bx - ax));
    g.lineWidth = 1.5; g.strokeStyle = '#403B3D'; g.beginPath(); g.ellipse(0, 1, 4, j % 2 ? 1.5 : 2.7, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = j % 2 ? '#9C8A71' : '#D0B481'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(0, 0, 3.5, j % 2 ? 1 : 2.2, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
}
/** One land cell's hanging rock by palette. */
function cliffCell(g, pal, x, y, land, seed) {
  // Item 185: each cliff hangs from half a tile up, under the land's chasm edge (the cut in voidScene), not from its tile line.
  const px = x * R, py = (y + 1) * R, top = py - R / 2;
  if (pal === 'rot') {
    if (land(x, y + 1)) return;
    const dep = R * (1.15 + noise(x, y, seed) * 1.15), tip = px + R * (0.35 + noise(x, y, seed + 1) * 0.3), ledge = g.createLinearGradient(px, py, px, py + dep);
    ledge.addColorStop(0, '#A38A61'); ledge.addColorStop(0.4, '#766340'); ledge.addColorStop(1, '#3C3B2C');
    paintedCliff(g, 'rot', [[px - 1, top], [px + R + 1, top], [px + R * 0.96, py + dep * 0.3], [px + R * 0.83, py + dep * 0.37], [px + R * 0.86, py + dep * 0.62], [px + R * 0.64, py + dep * 0.8],
      [tip + R * 0.13, py + dep], [tip - R * 0.13, py + dep * 0.94], [px + R * 0.18, py + dep * 0.71], [px + R * 0.08, py + dep * 0.44]], ledge, px - 1, top, R + 2, dep + 2 + R / 2);
    const roots = 1 + Math.floor(noise(x, y, seed + 11) * 3);
    for (let rt = 0; rt < roots; rt++) {
      const rx = px + R * (0.15 + 0.7 * (rt + noise(x, rt + y, seed + 12)) / roots), drop = dep * (0.5 + noise(x, rt + y, seed + 13) * 0.5), side = rt % 2 ? 1 : -1;
      rootStrand(g, rx + 1, py + 3, drop, side, 1.5, 'rgba(43,35,21,.45)'); rootStrand(g, rx, py + 2, drop, side, 0.8, '#9B8E65');
    }
    for (let m = 0; m < 5; m++) {
      const mx = px + (m + 0.4) * R / 5, mh = R * (0.07 + noise(x * 5 + m, y, seed + 15) * 0.34);
      for (let leaf = 0; leaf < 7; leaf++) { const lx = mx + (noise(x * 35 + m * 7 + leaf, y, seed + 51) - 0.5) * 7, ly = py + noise(x, y * 35 + m * 7 + leaf, seed + 52) * mh; polygon(g, [[lx - 1.1, ly], [lx + 0.5, ly - 1.2], [lx + 1.3, ly + 0.2], [lx - 0.4, ly + 1.1]], leaf % 2 ? '#667C32' : '#85943D'); }
    }
  } else if (pal === 'cinder') {
    if (!land(x, y + 1)) {
      const dep = R * (1.6 + noise(x, y, seed) * 1.6), tip = px + R * (0.25 + noise(x, y, seed + 1) * 0.5), rock = g.createLinearGradient(px, py, px, py + dep);
      rock.addColorStop(0, '#B6765C'); rock.addColorStop(0.35, '#89534B'); rock.addColorStop(1, '#4B4048');
      paintedCliff(g, 'cinder', [[px - 1, top], [px + R + 1, top], [px + R * 0.94, py + dep * 0.23], [px + R * 0.82, py + dep * 0.31], [px + R * 0.88, py + dep * 0.43], [px + R * 0.69, py + dep * 0.55],
        [tip + R * 0.08, py + dep * 0.83], [tip, py + dep], [tip - R * 0.09, py + dep * 0.91], [px + R * 0.1, py + dep * 0.63], [px + R * 0.14, py + dep * 0.38]], rock, px - 1, top, R + 2, dep + 3 + R / 2);
      if (noise(x, y, seed + 5) > 0.58) { g.fillStyle = '#83756A'; g.fillRect(px + R * 0.33, py + 4, R * 0.34, 12); g.fillStyle = '#D0AB73'; g.fillRect(px + R * 0.37, py + 6, 2, 2); }
    }
  } else if (pal === 'violet') {
    if (land(x, y + 1)) return;
    const dep = R * (1.05 + noise(x, y, seed) * 1.55), tip = px + R * (0.2 + noise(x, y, seed + 1) * 0.6), rock = g.createLinearGradient(px, py, px, py + dep);
    rock.addColorStop(0, '#AF91C6'); rock.addColorStop(0.23, '#826199'); rock.addColorStop(0.68, '#5D487E'); rock.addColorStop(1, '#3F416D');
    paintedCliff(g, 'violet', [[px - 1, top], [px + R + 1, top], [px + R * 0.94, py + dep * 0.22], [px + R * 0.77, py + dep * 0.27], [px + R * 0.83, py + dep * 0.46], [px + R * 0.61, py + dep * 0.61],
      [tip + R * 0.1, py + dep * 0.87], [tip, py + dep], [tip - R * 0.12, py + dep * 0.91], [px + R * 0.22, py + dep * 0.56], [px + R * 0.08, py + dep * 0.48], [px + R * 0.13, py + dep * 0.28]], rock, px - 1, top, R + 2, dep + 2 + R / 2);
  } else {
    if (!land(x, y + 1)) {
      const dep = R * (1.65 + noise(x, y, seed) * 2.2), tip = px + R * (0.2 + noise(x, y, seed + 1) * 0.6), ledge = g.createLinearGradient(0, py, 0, py + dep);
      ledge.addColorStop(0, '#6B94B9'); ledge.addColorStop(0.25, '#3D648D'); ledge.addColorStop(1, '#162F59');
      paintedCliff(g, 'prism', [[px - 1, top], [px + R + 1, top], [px + R * 0.93, py + dep * 0.29], [px + R * 0.82, py + dep * 0.36], [px + R * 0.9, py + dep * 0.52], [tip + R * 0.1, py + dep * 0.82],
        [tip, py + dep], [tip - R * 0.08, py + dep * 0.88], [px + R * 0.06, py + dep * 0.64], [px + R * 0.12, py + dep * 0.38]], ledge, px - 1, top, R + 2, dep + 2 + R / 2);
      if (noise(x, y, seed + 9) > 0.68) { g.strokeStyle = 'rgba(98,178,197,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + R * 0.4, py + 4); g.lineTo(px + R * 0.48, py + dep * 0.4); g.lineTo(px + R * 0.35, py + dep * 0.65); g.stroke(); }
    }
  }
}

// ---------------------------------------------------------------------------------------------- recoloured art
