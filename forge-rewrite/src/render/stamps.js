// The soft textures every effect is laid from (consolidation C9, render-13): fx-kit's named stamps, made once, white,
// tinted per sprite, and radialTexture for any other soft round (a glow, a warning pool), cached by key. Painters ask
// here instead of drawing their own gradient canvas.

import { Texture } from '../../../forge-godot/runtime/pixi.js';

// ---- the soft stamps (1.7 fx.js fxStamp): made once, white, and tinted per sprite. Nothing here has an edge.
// puff: a feathered round of light. wisp: a bent streak tapering to nothing at both ends. shard: a soft spike, wide at
// the foot and drawn to a point. fork: a thin kinked thread with one branch. glow and dot: a bolt's head.
const STAMPS = {};
export function stampTexture(name) {
  if (STAMPS[name]) return STAMPS[name];
  const c = document.createElement('canvas'), g = c.getContext('2d');
  if (name === 'wisp') {
    c.width = 48; c.height = 176;
    for (let dab = 0; dab < 70; dab++) {
      const along = dab / 69, bend = Math.sin(along * Math.PI * 1.3) * 9, fat = (2 + 9 * Math.sin(along * Math.PI)) * 0.9, soft = g.createRadialGradient(24 + bend, 8 + along * 160, 0, 24 + bend, 8 + along * 160, fat + 3);
      soft.addColorStop(0, 'rgba(255,255,255,' + (0.2 * Math.sin(along * Math.PI)) + ')'); soft.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = soft; g.fillRect(0, along * 160 - 8, 48, fat * 2 + 22);
    }
  } else if (name === 'shard') {
    c.width = 48; c.height = 176;
    for (let chip = 0; chip < 80; chip++) {
      const up = chip / 79, girth = 1.2 + 10 * Math.pow(1 - up, 1.25), heft = Math.min(1, up * 7) * (1 - 0.4 * up), sx = 24 + Math.sin(up * 2.6) * 2.5, sy = 168 - up * 160, facet = g.createRadialGradient(sx, sy, 0, sx, sy, girth + 2.5);
      facet.addColorStop(0, 'rgba(255,255,255,' + (0.3 * heft) + ')'); facet.addColorStop(0.6, 'rgba(255,255,255,' + (0.13 * heft) + ')'); facet.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = facet; g.fillRect(0, sy - girth - 3, 48, girth * 2 + 6);
    }
  } else if (name === 'fork') {
    c.width = 64; c.height = 176; const kinks = [0, 13, -9, 10, -5, 0];
    for (let nib = 0; nib < 150; nib++) {
      const main = nib < 110, run = main ? nib / 109 : (nib - 110) / 39, leg = Math.min(4, Math.floor(run * 5)), nx = main ? 32 + kinks[leg] + (kinks[leg + 1] - kinks[leg]) * (run * 5 - leg) : 23 - 15 * run, ny = main ? 8 + run * 160 : 72 + 34 * run;
      const thin = main ? 2 + 2.8 * Math.sin(run * Math.PI) : 1.6 + 1.8 * (1 - run), lit = main ? 0.5 * Math.sqrt(Math.max(0, Math.sin(run * Math.PI))) : 0.4 * (1 - run), glint = g.createRadialGradient(nx, ny, 0, nx, ny, thin + 2.5);
      glint.addColorStop(0, 'rgba(255,255,255,' + lit + ')'); glint.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = glint; g.fillRect(0, ny - thin - 3, 64, thin * 2 + 6);
    }
  } else if (name === 'glow') {
    // a bolt's head: 1.7's radial gradient from 0.9 at the centre to nothing at its edge
    c.width = c.height = 64; const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  } else if (name === 'arrow') {
    // FX6 (1.7 fx.js:595-605 drawArrowInFlight): the drawn arrow, tip up: a plum-edged wooden shaft, a steel head and
    // two dull red vanes, 0.55 tile long. Drawn once at a 96 px tile and scaled; it keeps its own colours (tint white).
    const TS = 96, L = TS * 0.55, w = TS * 0.028, hl = L * 0.26, hw = TS * 0.055, fl = L * 0.3, fw = TS * 0.05, edge = TS / 90, pad = edge * 2;
    c.width = Math.ceil(hw * 2 + pad * 2); c.height = Math.ceil(L + pad * 2);
    g.translate(c.width / 2, c.height / 2);
    const head = () => { g.beginPath(); g.moveTo(0, -L / 2); g.lineTo(hw, -L / 2 + hl); g.lineTo(0, -L / 2 + hl * 0.72); g.lineTo(-hw, -L / 2 + hl); g.closePath(); };
    const vanes = () => { g.beginPath(); for (const d of [-1, 1]) { g.moveTo(0, L / 2 - fl); g.lineTo(d * fw, L / 2 - fl * 0.55); g.lineTo(d * fw, L / 2); g.lineTo(0, L / 2 - fl * 0.3); g.closePath(); } };
    g.lineJoin = 'round'; g.strokeStyle = '#241A2B'; g.lineWidth = edge * 2;
    vanes(); g.stroke(); head(); g.stroke();
    g.fillStyle = '#241A2B'; g.fillRect(-w / 2 - edge, -L / 2 + hl * 0.6, w + edge * 2, L - hl * 0.6);
    g.fillStyle = '#B8936A'; g.fillRect(-w / 2, -L / 2 + hl * 0.6, w, L - hl * 0.6 - edge);
    vanes(); g.fillStyle = '#A8483A'; g.fill();
    head(); g.fillStyle = '#D6DCE2'; g.fill();
  } else if (name === 'streak') {
    // an arrow's light streak (1.7 fx.js:599-606): bright at the point (the top), fading back along the flight line
    c.width = 8; c.height = 128; const r = g.createLinearGradient(0, 128, 0, 0);
    r.addColorStop(0, 'rgba(255,240,200,0)'); r.addColorStop(0.65, 'rgba(255,238,190,0.28)'); r.addColorStop(1, 'rgba(255,250,225,0.85)');
    g.fillStyle = r; g.fillRect(1, 0, 6, 128);
  } else if (name === 'dusk') {
    // FX28 (1.7 fx.js:285-288): the dark that closes about the hero as an element goes in. Clear in the middle, and
    // past the gradient's edge (32 px of 512) the dark runs on solid, so the sprite covers any view.
    c.width = c.height = 512; const r = g.createRadialGradient(256, 256, 32 * 0.21, 256, 256, 32);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.45, 'rgba(255,255,255,0.595)'); r.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = r; g.fillRect(0, 0, 512, 512);
  } else if (name === 'dot') {
    c.width = c.height = 32; g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill();
  } else if (name.startsWith('ring')) {
    // a ripple's feathered band (1.7 drew a radial gradient from inner to outer): stops 0, 0.2, 0.3, 0 as 0, 2/3, 1, 0
    const inner = Number(name.slice(4)) / 10;
    c.width = c.height = 256; const r = g.createRadialGradient(128, 128, 128 * inner, 128, 128, 128);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.5, 'rgba(255,255,255,0.667)'); r.addColorStop(0.72, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  } else {
    c.width = c.height = 96; const feather = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    feather.addColorStop(0, 'rgba(255,255,255,1)'); feather.addColorStop(0.25, 'rgba(255,255,255,.62)'); feather.addColorStop(0.55, 'rgba(255,255,255,.2)'); feather.addColorStop(0.8, 'rgba(255,255,255,.05)'); feather.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = feather; g.fillRect(0, 0, 96, 96);
  }
  return (STAMPS[name] = Texture.from({ resource: c, scaleMode: 'linear' }));
}

const RADIAL = new Map();
/**
 * A soft round, white with alpha, cached by key: stops are [offset, alpha] from the middle out (1.7's radial glows: a
 * bolt's head [[0, 0.9], [1, 0]]). size: the canvas side; scaleMode 'linear' unless named.
 */
export function radialTexture(key, stops, { size = 64, scaleMode = 'linear' } = {}) {
  let t = RADIAL.get(key);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2, grad = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, a] of stops) grad.addColorStop(o, `rgba(255,255,255,${a})`);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  RADIAL.set(key, (t = Texture.from({ resource: c, scaleMode })));
  return t;
}
