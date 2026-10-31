// Title screen: a hero before a god's shrine, one of nine places, filling the screen, the six-gem plaque with the
// name, the menu on drawn plates. L: menu lower left, New Game across the top of a 2 x 2 grid. P: the scene above, menu
// rows at the bottom.

import { Container, Sprite, Graphics, Texture, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { headingPlate } from '../core/plates.js';
import { whenLoaded } from '../core/loaded.js';
import { VERSION } from '../../data/version.js';
import { versionCheck } from '../model/version-check.js';

// Item 291 (Justin 2026-10-21: "a player standing before a shrine to a god maybe, no combat, just large serene grassy
// biome 1 room with a shrine and a player standing before it"; then "a similar shot for each god providing different
// locations and making start up choose one at random"): a still of the game's own art for each of the nine gods, in
// place of 1.7's film (tools/assets/vendor/title-still), one picked at random each launch. Each is a load group of its
// own (title-<god>), so only the pick is fetched: the title asks for it as it draws and fades it in when it arrives.
export const STILLS = ['glimmer', 'anvil', 'vellum', 'grumbok', 'reginald', 'murk', 'sylla', 'grom', 'wobbles'].map(g => `assets/images/title/title-${g}.webp`);
export const STILL = STILLS[Math.floor(Math.random() * STILLS.length)];

let late = false;   // the picture was not in at the first draw: it fades in when it arrives
/** A picture covering the whole screen, including what lies outside the stage rectangle. */
export function cover(kit, src, redraw) {
  const st = kit.stage, x0 = -st.ox / st.s, y0 = -st.oy / st.s, w = st.w - x0 * 2, h = st.h - y0 * 2;
  const c = new Container();
  c.addChild(new Graphics().rect(x0, y0, w, h).fill(color.bg));
  const t = whenLoaded(src, redraw);
  if (!t) { late = true; return c; }
  const pic = new Sprite(/** @type {Texture} */ (t));
  const k = Math.max(w / t.width, h / t.height);
  pic.scale.set(k);
  pic.position.set(x0 + (w - t.width * k) / 2, y0 + (h - t.height * k) / 2);
  c.addChild(pic);
  if (late) {
    late = false; pic.alpha = 0;
    const fade = tk => { if (pic.destroyed || (pic.alpha = Math.min(1, pic.alpha + tk.deltaMS / 600)) >= 1) Ticker.shared.remove(fade); };
    Ticker.shared.add(fade);
  }
  return c;
}

/**
 * 1.7's #title::after (title-screen.css:6): a dark radial from the lower left corner, #05090f from 96% through 86%,
 * 52% and 14% to clear at 82% of the way out, and a foot band #05090f at 40% fading out over the lowest 16%, laid over
 * the scene so the menu reads against it. Drawn once, then stretched over the screen like the scene.
 */
let shadeTex = null;
function shade(kit) {
  const st = kit.stage, x0 = -st.ox / st.s, y0 = -st.oy / st.s, w = st.w - x0 * 2, h = st.h - y0 * 2;
  if (!shadeTex) {
    const W = 512, H = 320, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
    // An ellipse at the corner reaching the farthest corner: radii W and H times the square root of two.
    g.save(); g.setTransform(W * Math.SQRT2, 0, 0, H * Math.SQRT2, 0, H);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 1), ink = a => `rgba(5,9,15,${a})`;
    [[0, 0.96], [0.18, 0.86], [0.38, 0.52], [0.63, 0.14], [0.82, 0]].forEach(([at, a]) => r.addColorStop(at, ink(a)));
    g.fillStyle = r; g.fillRect(0, -1, 1 / Math.SQRT2, 1); g.restore();
    const foot = g.createLinearGradient(0, H, 0, H * 0.84);
    foot.addColorStop(0, ink(0.4)); foot.addColorStop(1, ink(0));
    g.fillStyle = foot; g.fillRect(0, H * 0.84, W, H * 0.16);
    shadeTex = Texture.from({ resource: c, scaleMode: 'linear' });
  }
  const s = new Sprite(shadeTex);
  s.position.set(x0, y0); s.width = w; s.height = h; s.eventMode = 'none';
  return s;
}

/**
 * The Sandbox on the title at every size, phones and tablets included. 1.7 hid it on touch (mobile.js:323-328, audit
 * T16), but Justin investigates the draft from any device (2026-10-17, sandbox item 102: "there isnt a sandbox mode
 * that let's me explore further maps and biomes"). Kept as a function so a later public build can turn it off here.
 */
export function sandboxShown() {
  return (typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__);
}

/** The plaque with the game's name set in blackletter on its face, on 1.7's dark edge. */
export function plaque(kit, w, words, size, kind = 'heading') {
  const c = new Container();
  const art = headingPlate(w, kind);
  // The title's name sits on a soft drop (title-screen.css:10), creation's step words on a hard one (forge-skin.css:539).
  const t = kit.text(words, { size, font: 'display', weight: '700', fill: color.ink, shadow: kind === 'bar' ? 'lift' : 'plaque' });
  t.anchor.set(0.5);
  t.position.set(w / 2, art.height * (kind === 'bar' ? 0.5 : 0.56));
  c.addChild(art, t);
  return c;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{hasContinue:()=>any, continueRun:()=>void, newGame:()=>void, open:(w:string)=>void, redraw?:()=>void}} acts
 */
export function buildTitle(kit, acts) {
  const st = kit.stage, P = st.kind === 'P', root = new Container();
  const redraw = acts.redraw ?? (() => {});
  const scene = cover(kit, STILL, redraw);
  scene.label = 'title-still';
  root.addChild(scene, shade(kit));

  // Placed against the real screen, not the stage rectangle: on a screen taller or wider than the stage (Justin's
  // 1012 x 963 window) the plaque still sits top centre and the menu at the foot (Justin 10-16).
  const top = -st.oy / st.s, foot = st.h + st.oy / st.s, left = -st.ox / st.s, right = st.w + st.ox / st.s;
  const short = !P && foot - top < 600;
  const pw = P ? st.w - space.betweenSections : short ? Math.min(460, st.w * 0.42) : Math.min(671, st.w * 0.52);
  const head = plaque(kit, pw, 'Forge of the Elements', P ? 26 : short ? 32 : 40);
  head.position.set(Math.round((st.w - pw) / 2), top + (P ? space.betweenSections * 2 : short ? space.betweenRows : space.betweenSections * 3));
  root.addChild(head);

  const cont = acts.hasContinue();
  const gap = P ? space.betweenRows : 14, menu = new Container();
  const wide = P ? Math.min(430, st.w - space.betweenSections * 2) : short ? 380 : 430, h = P ? 52 : short ? 46 : 58, half = Math.floor((wide - gap) / 2);
  const items = [];
  // The title's plates sit quiet on the scene: Continue and New Game at .85 until lit, every plate 1.15 under the
  // pointer (painted-ui.css:302-303).
  const tone = big => ({ rest: big ? 0.85 : 1, hover: 1.15 });
  // The word that calls for the click glows blue: Continue, or New Game when there is nothing to continue (1.7).
  // CSS-11: the saved hero's line sits inside the Continue plate under the word (1.7 painted-ui.css:531-534), the plate
  // at least 54 tall to hold both (1.7's 52 px floor on a short screen).
  const contH = cont?.line ? Math.max(h, 54) : h;
  if (cont) items.push(kit.plateButton('Continue', acts.continueRun, { rank: 'prominent', w: wide, h: contH, size: 26, glow: true, tone: tone(true), sub: cont.line || undefined }));
  items.push(kit.plateButton('New Game', acts.newGame, { rank: cont ? 'subdued' : 'prominent', w: wide, h, size: 26, glow: !cont, tone: tone(!cont) }));
  // New Game across, then a 2 x 2 grid at every size (Justin 10-16); Continue takes the row above when a save exists.
  const small = [['Load Game', () => acts.open('Load')], ['Settings', () => acts.open('Settings')], ['Journal', () => acts.open('Journal')], ['About', () => acts.open('About')]];
  let y = 0;
  for (const b of items) { b.position.set(0, y); menu.addChild(b); y += (b.label === 'Continue' ? contH : h) + gap; }
  small.forEach(([words, fn], i) => {
    const sh = P ? 48 : short ? 44 : 55;
    const b = kit.plateButton(words, fn, { w: half, h: sh, size: 20, tone: tone(false) });
    b.position.set((i % 2) * (half + gap), y + Math.floor(i / 2) * (sh + gap));
    menu.addChild(b);
  });
  // 1.7 at 1280x800: menu from x 64, its last row ending at y 733.
  const footerGap = Math.max(P ? space.betweenSections * 2 : short ? space.betweenSections : 67, kit.target + space.betweenRows + space.inRow);
  menu.position.set(P ? Math.round((st.w - wide) / 2) : left + 64, foot - menu.height - footerGap);
  root.addChild(menu);

  // The version and what the update check found (1.7 #tUpdate, title-screen.css:24-27): dim, "update available" in the
  // highlight, a tap opens the Version notes. It sits in the free corner at the foot, a fingertip tall.
  const { titleStatus, state: versionState, watch: watchVersion } = versionCheck(acts);   // C17: the update check through deps
  const ver = kit.button(`${VERSION} · ${titleStatus()}`, () => acts.open('Version'), { size: 14, font: 'body', tight: !st.touch });
  const verWords = ver.children[1];
  const paintVer = () => {
    if (verWords.destroyed) return;
    verWords.text = `${VERSION} · ${titleStatus()}`;
    verWords.style.fill = versionState().latest ? kit.accent : color.dim;
    ver.position.set(right - ver.width - space.betweenSections + space.betweenRows, foot - ver.height - space.inRow);
  };
  ver.label = 'title-version';
  ver.on('pointerout', paintVer);
  paintVer();
  const unwatch = watchVersion(paintVer);
  root.on('destroyed', unwatch);
  root.addChild(ver);
  // Sandbox: a dev run with its own save, its tools in the in-play menu (Justin 10-16: "jump in in sandbox mode and investigate").
  if (acts.sandbox && sandboxShown(kit.stage)) {
    const sb = kit.button('Sandbox', acts.sandbox, { size: 20 });
    sb.label = 'title-sandbox';
    // L: above the version words at the foot; P: under the plaque, where the menu rows cannot reach.
    sb.position.set(right - sb.width - space.betweenSections + space.betweenRows, P ? head.y + head.height + space.betweenRows : ver.y - sb.height);
    root.addChild(sb);
  }
  return root;
}
