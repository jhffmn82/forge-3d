// RC4: the Living Flame summon, drawn as 1.7 drew it (render.js:2460-2482): its one picture (living-flame.webp, in the
// 'play' group) bobbing and pulsing over a soft orange glow, with four sparks rising off it. No sheet, no clips: the
// same body interface as every look (body.js), so the map and playback treat it as any other body.

import { Container, Sprite, Graphics, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet } from './art-store.js';
import { asBody, hitFlash } from './body.js';

const DEATH_MS = 900;
let glowTex = null;
/** A radial fade, full at the middle and gone at the edge (1.7's createRadialGradient), tinted per use. */
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return (glowTex = Texture.from({ resource: c, scaleMode: 'linear' }));
}

/** @param {number} seed the body's own phase (1.7 used e.id * 1.37) */
export function createLivingFlame(tile, clock, seed = 0) {
  const tex = sheet('living-flame.webp'), aspect = tex.width / tex.height, phase = seed * 1.37;
  const root = new Container(), body = new Container();
  const shadow = new Graphics().ellipse(0, -tile * 0.06, tile * 0.26 * 0.7, tile * 0.09).fill({ color: 0x000000, alpha: 0.35 });
  const glow = new Sprite(glowTexture()), pic = new Sprite(tex), sparks = new Graphics();
  glow.anchor.set(0.5); glow.tint = 0xff6e19; glow.alpha = 0.13;   // rgba(255,110,25,.13) fading to nothing
  pic.anchor.set(0.5, 1);
  body.addChild(glow, pic, sparks);
  root.addChild(shadow, body);
  const hit = hitFlash({ filtered: pic, shaken: body, clock, tile });
  let gone = false, charged = false;

  const draw = dt => {
    const reduced = !!clock.reduced, t = reduced ? 0 : performance.now() / 1000;
    const pulse = reduced ? 1 : 1 + 0.025 * Math.sin(t * 4 + phase), h = tile * 0.82 * pulse, w = h * aspect;
    const bob = reduced ? 0 : tile * 0.025 * Math.sin(t * 3 + phase);
    body.y = -tile * 0.12 - bob;   // its foot 0.88 down the tile, as 1.7 stood it
    pic.height = h; pic.width = w;   // the setters keep a mirrored sign
    glow.position.set(0, -h * 0.45); glow.width = glow.height = h * 1.3;
    glow.tint = charged ? 0xffcd55 : 0xff6e19; glow.alpha = charged ? 0.3 : 0.13;   // RC4: charged rgba(255,205,85,.30)
    sparks.clear();
    if (!reduced) for (let i = 0; i < 4; i++) {
      const life = (t * 0.7 + i * 0.27 + phase) % 1;
      sparks.rect(Math.sin(i * 2.3 + phase + t) * w * 0.3, -h * (0.15 + life * 0.85), tile * 0.022, tile * 0.035).fill({ color: charged ? 0xfff2ae : 0xffba62, alpha: (1 - life) * 0.55 });
    }
    hit.frame(dt * clock.speed);
  };
  clock.onFrame(draw, { owner: root });
  draw(0);

  return asBody({
    root,
    /** A flame has no clips: every action resolves at once; its death fades it out over 1.7's 900 ms death, evenly from
     *  the first frame (FX16, 1.7 fx.js:140 drawLivingFlame alpha 1-p, death-adapter.js:72 dur 900), leaving no remains. */
    play(name) {
      if (name === 'death' && !gone) { gone = true; return clock.tween(DEATH_MS, p => { body.alpha = 1 - p; }); }
      return Promise.resolve();
    },
    clipMs(name) { return name === 'death' ? DEATH_MS : 0; },
    /** Playback leaves its fading to the flame (playback.js, FX15). */
    get fadesOwnDeath() { return true; },
    /** RC4: its next Flame Shot is the third (1.7 flameShots % 3 === 2): a brighter gold glow and pale sparks. */
    charge(on) { charged = !!on; },
    face(dx) { if (dx) pic.scale.x = Math.abs(pic.scale.x) * (dx > 0 ? 1 : -1); },
    flash(on) { if (on) hit.start(); },
    get mirrored() { return pic.scale.x < 0; },
    get sheet() { return 'living-flame.webp'; },
    get texture() { return pic.texture; },
  });
}
