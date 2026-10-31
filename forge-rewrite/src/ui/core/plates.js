// The drawn plates from 1.7 (assets/images/ui): window frames, the close X and the two button ranks.
// Loaded once before the first screen. Plates are painted art seen smaller than drawn, so they sample smoothly.

import { Assets, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Texture } from '../../../../forge-godot/runtime/pixi.js';

const UI = 'assets/images/ui/';
const SIX = ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right', 'face', 'anvil', 'gem-left', 'gem-right'];
const FILES = {
  plain: 'window-plain-v1.webp',
  close: 'close-x-v2.webp',
  prominent: 'button-raised-prominent-clean-v2.webp',
  subdued: 'button-raised-subdued-clean-v3.webp',
  heading: 'heading-steel-six-gems-v1.webp',
  bar: 'forge-heading-bar-v1.webp',
  tab: 'tab-steel-v1.webp',
  ...Object.fromEntries(['prominent-start', 'prominent-repeat', 'subdued-start', 'subdued-repeat'].map(k => ['chevron-' + k, `chevron-raised-${k}-v1.webp`])),
  ...Object.fromEntries(SIX.map(n => ['six-' + n, `frame6/${n}.webp`])),
};

/** Texture px of each plate's border, as drawn: the nine-slice cut and where the flat face begins. */
const CUT = {
  plain: { slice: 150, face: 88 },
  prominent: { slice: 200, face: 70 },
  subdued: { slice: 180, face: 60 },
};
const SIX_PIECE = 230;

let tex = null, windowFace = null;

export async function loadPlates() {
  if (tex) return tex;
  const entries = await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
    // Stretched nine-slice strips otherwise choose blurrier mip levels than their corners,
    // erasing the thin bevel in the middle of the top and bottom edges.
    const t = await Assets.load({ src: UI + file, data: { scaleMode: 'linear', autoGenerateMipmaps: key !== 'prominent' && key !== 'subdued' } });
    return [key, t];
  }));
  tex = Object.fromEntries(entries);
  return tex;
}

const need = () => { if (!tex) throw new Error('plates not loaded'); return tex; };

/**
 * A nine-slice plate drawn at w x h logical px, its border `border` px thick.
 * @param {'plain'|'prominent'|'subdued'} kind
 */
export function plate(kind, w, h, border) {
  const t = need()[kind], c = CUT[kind];
  const k = border / c.slice;
  const s = new NineSliceSprite({ texture: t, leftWidth: c.slice, rightWidth: c.slice, topHeight: c.slice, bottomHeight: c.slice });
  s.width = Math.max(c.slice * 2, w / k);
  s.height = Math.max(c.slice * 2, h / k);
  s.scale.set(k);
  return s;
}

/** Where content may start inside a plate of this border thickness. */
export function plateInset(kind, border) {
  return Math.ceil(CUT[kind].face * border / CUT[kind].slice);
}

/**
 * The six-gem forge frame (anvil on top, gems at the corners and the sides), w x h, pieces fw px square.
 * Same arrangement 1.7 used for the creation panel and the end screen.
 */
export function sixGemFrame(w, h, fw) {
  const t = need(), c = new Container();
  if (!windowFace) {
    const p = t.plain, inset = Math.min(CUT.plain.slice, p.width / 3, p.height / 3);
    windowFace = new Texture({ source: p.source, frame: new Rectangle(p.frame.x + inset, p.frame.y + inset, p.width - inset * 2, p.height - inset * 2) });
  }
  c.label = 'six';
  const put = (key, x, y, pw, ph) => {
    const s = new Sprite(key === 'face' ? windowFace : t['six-' + key]);
    s.position.set(x, y); s.width = pw; s.height = ph;
    c.addChild(s);
  };
  put('face', fw, fw, w - fw * 2, h - fw * 2);
  put('top', fw, 0, w - fw * 2, fw);
  put('bottom', fw, h - fw, w - fw * 2, fw);
  put('left', 0, fw, fw, h - fw * 2);
  put('right', w - fw, fw, fw, h - fw * 2);
  put('tl', 0, 0, fw, fw); put('tr', w - fw, 0, fw, fw);
  put('bl', 0, h - fw, fw, fw); put('br', w - fw, h - fw, fw, fw);
  // The edge and corner pictures include their old grey face: cover the whole opening,
  // up to its inner bevel, rather than only the middle rectangle between the pieces.
  const edge = sixGemInnerEdges(fw), l = edge.side, r = w - l, top = edge.top, bottom = h - edge.bottom, cut = fw * 70 / SIX_PIECE;
  const face = new Sprite(windowFace), mask = new Graphics().poly([
    l + cut, top, r - cut, top, r, top + cut,
    r, h / 2 - fw * 0.35, r - fw * 0.15, h / 2, r, h / 2 + fw * 0.35,
    r, bottom - cut, r - cut, bottom, l + cut, bottom, l, bottom - cut,
    l, h / 2 + fw * 0.35, l + fw * 0.15, h / 2, l, h / 2 - fw * 0.35, l, top + cut,
  ]).fill(0xffffff);
  face.position.set(l, top); face.width = r - l; face.height = bottom - top;
  face.mask = mask; face.label = 'window-interior';
  const gh = fw * 170 / SIX_PIECE;
  put('gem-left', 0, (h - gh) / 2, fw, gh);
  put('gem-right', w - fw, (h - gh) / 2, fw, gh);
  const aw = fw * 275 / SIX_PIECE, ah = fw * 210 / SIX_PIECE;
  put('anvil', (w - aw) / 2, fw * 20 / SIX_PIECE, aw, ah);
  c.addChild(face, mask);
  return c;
}

/** Inner edge of the six-gem frame's face for pieces fw px square. */
export const sixGemInset = fw => Math.ceil(fw * 0.5);
export const sixGemInnerEdges = fw => ({ side: fw * 106 / SIX_PIECE, top: fw * 130 / SIX_PIECE, bottom: fw * 108 / SIX_PIECE });

/** The drawn close X, size px square. */
export function closePlate(size) {
  const s = new Sprite(need().close);
  s.width = size; s.height = size;
  return s;
}

/** The drawn rows of the two plaques (their pictures carry clear space above and below). */
const PLAQUE_ROWS = { heading: [117, 673], bar: [239, 540] };
const trimmed = new Map();

/**
 * A plaque w px wide: 'heading' is the title's six-gem plaque, 'bar' the thin six-gem bar over creation.
 * Its face centre is at `faceY` of its height.
 */
export function headingPlate(w, kind = 'heading') {
  if (!trimmed.has(kind)) {
    const t = need()[kind], [y0, y1] = PLAQUE_ROWS[kind];
    trimmed.set(kind, new Texture({ source: t.source, frame: new Rectangle(0, y0, t.width, y1 - y0) }));
  }
  const t = trimmed.get(kind), s = new Sprite(t);
  s.width = w; s.height = w * t.height / t.width;
  return s;
}

/** Texture px of a chevron's ends: the flat or notched left end, the point on the right. */
const CHEVRON_ENDS = { left: 230, right: 260 };

/**
 * One of 1.7's chevron plates, h px tall and w wide: `start` has a flat left end, the rest a notch that takes the
 * point of the chevron before it. Returns the sprite and how far the next chevron should tuck under its point.
 * @param {'prominent'|'subdued'} rank @param {boolean} start
 */
export function chevronPlate(rank, start, w, h) {
  const key = `chevron-${rank}-${start ? 'start' : 'repeat'}`, L = CHEVRON_ENDS.left, R = CHEVRON_ENDS.right;
  const { sprite, k } = threePiece(key, L, R, w, h);
  // The repeat art's notch is about 42% of its height; leave a small seam at the point.
  return { sprite, tuck: Math.round(h * 0.4), left: Math.round(L * k * (start ? 0.45 : 0.7)), right: Math.round(R * k * 0.6) };
}

/**
 * A plate stretched sideways from three cut pieces: its left end, a middle strip near its drawn size, its right end.
 * Squeezing a whole plate blurs it, so only the plain middle is stretched.
 */
function threePiece(key, L, R, w, h) {
  const t = need()[key], k = h / t.height, mid = 200;
  const piece = (x, pw) => {
    const id = `${key}:${x}:${pw}`;
    if (!trimmed.has(id)) trimmed.set(id, new Texture({ source: t.source, frame: new Rectangle(x, 0, pw, t.height) }));
    return new Sprite(trimmed.get(id));
  };
  const c = new Container(), inner = Math.max(0, w / k - L - R);
  const a = piece(0, L), m = piece(Math.round((t.width - mid) / 2), mid), b = piece(t.width - R, R);
  m.x = L; m.width = inner; b.x = L + inner;
  c.addChild(a, m, b);
  c.scale.set(k);
  return { sprite: c, k };
}

/** 1.7's steel tab, w x h: the window tabs that tuck behind the frame's top edge. */
export function tabPlate(w, h) {
  return threePiece('tab', 70, 70, w, h).sprite;
}

/**
 * The green + for spending a point: 1.7's plus-green-v2.svg (painted-ui.css:775-777), a rounded plus in the house green
 * on a dark keyline, smaller than the number beside it (Justin 10-15: "the green crosses should be smaller ... not that
 * color but that idea"). Drawn from its path, so it is sharp at any size; `size` px square.
 */
const PLUS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M9 6a3 3 0 0 1 6 0v3h3a3 3 0 0 1 0 6h-3v3a3 3 0 0 1-6 0v-3H6a3 3 0 0 1 0-6h3z" fill="#8fbd78" stroke="#141619" stroke-width="1.4" stroke-linejoin="round"/></svg>';
export function plusPlate(size) {
  const g = new Graphics().svg(PLUS_SVG);
  g.scale.set(size / 24);
  return g;
}
