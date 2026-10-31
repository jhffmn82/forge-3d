// The Underdark's lava (M10, render-28: moved out of underdark-raster.js, which places it): each flow's mask, crust and
// rim baked per pixel (deeprender.js deepLavaRasters, drawDeepLava), and the flow's sprites, drift and heat over them.

import { Container, Graphics, Sprite, Texture, TilingSprite } from '../../../forge-godot/runtime/pixi.js';
import { T } from '../data/tiles.js';
import { hash2, noise as ptVal } from '../lib/noise.js';

const LS = 32;          // lava mask and crust pixels a tile (1.7 drawDeepLava's field)
const LAVA_T = 0.34;    // DEEP_LAVA_T

/**
 * The lava's pictures per flow (deeprender.js deepLavaRasters, drawDeepLava), LS pixels a tile over the flow's box:
 * mask (where the flow shows), crust (the basalt shore round it, under the flow) and rim (the bright edge and the
 * crust's inner glow, over the flow). Liquids lie under the walls (Justin, 2026-10-16): no pixel of any of the three
 * is ever on rock, by the same per-pixel outline the caves are drawn with.
 * @returns {{x0:number,y0:number,x1:number,y1:number,bw:number,bh:number,mask:Uint8ClampedArray,crust:Uint8ClampedArray,rim:Uint8ClampedArray}[]}
 */
export function lavaFlows(floor, F) {
  const { W, H, wall, wallCell, ptSalt } = F;
  const isLava = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floor.tiles[y * W + x] === T.LAVA;
  const boxes = [], seenL = new Uint8Array(W * H), out = [];
  for (let i = 0; i < W * H; i++) {
    if (floor.tiles[i] !== T.LAVA || seenL[i]) continue;
    const q = [i]; seenL[i] = 1; let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % W, y = (k / W) | 0;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      // lava two apart joins one flow (the metaball field reaches that far)
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const nx = x + ox, ny = y + oy, n = ny * W + nx; if (isLava(nx, ny) && !seenL[n]) { seenL[n] = 1; q.push(n); } }
    }
    boxes.push([Math.max(0, x0 - 1), Math.max(0, y0 - 1), Math.min(W - 1, x1 + 1), Math.min(H - 1, y1 + 1)]);
  }
  const lsalt = ptSalt + 1409;
  for (const [x0, y0, x1, y1] of boxes) {
    const bw = (x1 - x0 + 1) * LS, bh = (y1 - y0 + 1) * LS;
    const Mk = new Uint8ClampedArray(bw * bh * 4), Cc = new Uint8ClampedArray(bw * bh * 4), Rr = new Uint8ClampedArray(bw * bh * 4);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (wall[y * W + x]) continue;
      const cells = [], walls = [];
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (isLava(x + ox, y + oy)) cells.push([x + ox + 0.5, y + oy + 0.5]);
      if (!cells.length) continue;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (wallCell(x + ox, y + oy)) walls.push([x + ox + 0.5, y + oy + 0.5]);
      const lava = isLava(x, y);
      if (!lava && !cells.some(c => Math.abs(c[0] - 0.5 - x) <= 1 && Math.abs(c[1] - 0.5 - y) <= 1)) continue;
      for (let v = 0; v < LS; v++) for (let u = 0; u < LS; u++) {
        const wx = x + (u + 0.5) / LS, wy = y + (v + 0.5) / LS;
        let f = 0;
        for (const c of cells) { const dx = wx - c[0], dy = wy - c[1], d = Math.sqrt(dx * dx + dy * dy) / 1.25; if (d < 1) f += (1 - d) * (1 - d); }
        f += (ptVal(wx * 1.3, wy * 1.3, lsalt) - 0.5) * 0.34 + (ptVal(wx * 3.1, wy * 3.1, lsalt + 1) - 0.5) * 0.14;
        for (const e of walls) { const ex = wx - e[0], ey = wy - e[1], ed = Math.max(Math.abs(ex), Math.abs(ey)) / 1.05; if (ed < 1) f -= (1 - ed) * (1 - ed) * 1.6; }
        if (f < LAVA_T - 0.13 || (walls.length && F.rockAt(wx, wy))) continue;   // nothing here, or rock: liquids never on a wall
        const p = (((y - y0) * LS + v) * bw + (x - x0) * LS + u) * 4;
        if (f >= LAVA_T) {
          Mk[p] = Mk[p + 1] = Mk[p + 2] = Mk[p + 3] = 255;
          if (f < LAVA_T + 0.05) { Rr[p] = 255; Rr[p + 1] = 150; Rr[p + 2] = 60; Rr[p + 3] = 200; }
        } else {
          const inner = (f - (LAVA_T - 0.13)) / 0.13, grit = hash2(Math.floor(wx * 32), Math.floor(wy * 32), lsalt + 2);
          const col = inner > 0.72 ? [190, 64, 18] : grit < 0.25 ? [52, 36, 30] : [26, 18, 16];
          Cc[p] = col[0]; Cc[p + 1] = col[1]; Cc[p + 2] = col[2]; Cc[p + 3] = Math.round(inner > 0.72 ? 230 : 120 + 110 * inner);
          Rr[p] = col[0]; Rr[p + 1] = col[1]; Rr[p + 2] = col[2]; Rr[p + 3] = Cc[p + 3];
        }
      }
    }
    out.push({ x0, y0, x1, y1, bw, bh, mask: Mk, crust: Cc, rim: Rr });
  }
  return out;
}

/** The lava layer (drawDeepLava): every flow of the floor into lavaLayer, its drift and heat into anims; lavaArt: the lava-flow master's source (null: flat colour). */
export function lavaSprites(floor, F, tile, lavaLayer, anims, lavaArt) {
  const canvasOf = (px, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0); return c; };
  for (const { x0, y0, x1, y1, bw, bh, mask: mpx, crust: cpx, rim: rpx } of lavaFlows(floor, F)) {
    const mask = canvasOf(mpx, bw, bh), crust = canvasOf(cpx, bw, bh), rim = canvasOf(rpx, bw, bh);
    const X = x0 * tile, Y = y0 * tile, w = (x1 - x0 + 1) * tile, h = (y1 - y0 + 1) * tile;
    const place = (s) => { s.position.set(X, Y); s.width = w; s.height = h; return s; };
    const flow = new Container();
    flow.position.set(X, Y);
    const crustS = place(new Sprite(Texture.from(crust)));
    lavaLayer.addChild(crustS);
    const P = 6 * tile;   // the master spans six tiles
    let a = null, b = null;
    if (lavaArt) {
      const tex = new Texture({ source: lavaArt });
      a = new TilingSprite({ texture: tex, width: w, height: h }); a.tileScale.set(P / lavaArt.pixelWidth);
      b = new TilingSprite({ texture: tex, width: w, height: h }); b.tileScale.set(-P / lavaArt.pixelWidth, -P / lavaArt.pixelWidth); b.alpha = 0.35;
      flow.addChild(a, b);
    } else flow.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0xd8501a }));
    const pulse = new Graphics().rect(0, 0, w, h).fill({ color: 0xffb040 }); pulse.alpha = 0.12; flow.addChild(pulse);
    const m = place(new Sprite(Texture.from(mask)));
    lavaLayer.addChild(flow, m); flow.mask = m;
    lavaLayer.addChild(place(new Sprite(Texture.from(rim))));
    const box = [X, Y, X + w, Y + h];
    // Small embers drift above the lava; large solid heat ellipses read as bubbles.
    // In the lava layer, so the rock drawn over it covers any of it that reaches a wall (liquids under the walls).
    const heat = new Container(), cells = [];
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (floor.tiles[yy * floor.w + xx] === T.LAVA) cells.push([xx, yy]);
    const motes = [];
    for (let i = 0; i < Math.min(8, Math.max(2, Math.round(cells.length / 3))); i++) {
      const [cx, cy] = cells[Math.floor(hash2(x0 + i, y0 + i, 401) * cells.length)];
      const ember = new Graphics().circle(0, 0, Math.max(1.2, tile / 26)).fill({ color: 0xffc070 }).circle(0, 0, Math.max(2.5, tile / 12)).fill({ color: 0xff7a30, alpha: 0.35 }); ember.blendMode = 'add';
      heat.addChild(ember);
      motes.push({ ember, bx: (cx + 0.5) * tile - X, by: (cy + 0.6) * tile - Y, ph: hash2(cx, cy, 402) * 6.28, sp: 0.55 + 0.35 * hash2(cx, cy, 403) });
    }
    flow.parent.addChild(Object.assign(heat, { box: null }));
    heat.position.set(X, Y);
    anims.push((now, reduced) => {
      heat.visible = flow.visible && !reduced;
      if (!heat.visible) return;
      const t = now / 1000;
      for (const m of motes) {
        const k = ((t * m.sp + m.ph / 6.28) % 1 + 1) % 1, sway = Math.sin(t * 2.1 + m.ph) * tile * 0.12;
        const e = (k * 1.7) % 1;
        m.ember.position.set(m.bx + sway, m.by - e * tile * 1.1); m.ember.alpha = 0.9 * (1 - e);
      }
    });
    anims.push((now, reduced) => {
      if (!flow.visible) return;
      const t = reduced ? 0 : now / 1000, speed = tile / 32;   // 1.7 drifts 5 and 3 px a second at 32 px a tile
      if (a) { a.tilePosition.set(-(X + t * 5 * speed), -(Y + t * 3 * speed)); b.tilePosition.set(-X + t * 2 * speed, -(Y + t * 1.5 * speed)); }
      pulse.alpha = reduced ? 0.12 : 0.1 + 0.1 * Math.sin(t * 1.4);
    });
    flow.box = box;
  }
}
