// A stand-in for pixi.js 8.22, the 2D game's renderer, for running the game's own interface code (forge-rewrite src/ui)
// in QuickJS (bridge.js, ui.js). It keeps pixi's scene graph as the code builds it: containers and their transforms,
// shapes, words, pictures, masks, events, bounds and hit areas, measured the way pixi measures them; it draws nothing.
// ui.js walks what was built (`serialize`) and Godot paints it (scripts/ui2d.gd). Words are measured in Godot's own
// fonts and pictures sized from their files, through `hooks`, which ui.js fills.

/** What only the host knows: a string's width in a font, a font's ink box, a picture's size. */
export const hooks = {
  measure: (font, px, s) => s.length * px * 0.5,
  fontBox: (font, px) => ({ ascent: px * 0.9, descent: px * 0.25, fontSize: px * 1.15 }),
  image: () => ({ w: 1, h: 1 }),
};

// ---- colours

const NAMED = { white: 0xffffff, black: 0x000000, red: 0xff0000, green: 0x00ff00, blue: 0x0000ff, transparent: 0 };
/** Any colour pixi takes, as [0xRRGGBB, alpha]. */
export function colourOf(c, alpha = 1) {
  if (c == null) return [0xffffff, alpha];
  if (typeof c === 'number') return [c >>> 0 & 0xffffff, alpha];
  if (typeof c === 'string') {
    let s = c.trim().toLowerCase();
    if (s in NAMED) return [NAMED[s], s === 'transparent' ? 0 : alpha];
    const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (fn) { const a = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : +fn[4]; return [(Math.round(+fn[1]) << 16) | (Math.round(+fn[2]) << 8) | Math.round(+fn[3]), alpha * a]; }
    if (s.startsWith('0x')) return [parseInt(s.slice(2), 16) & 0xffffff, alpha];
    if (s.startsWith('#')) s = s.slice(1);
    if (s.length === 3 || s.length === 4) s = [...s].map(ch => ch + ch).join('');
    if (s.length === 8) return [parseInt(s.slice(0, 6), 16), alpha * parseInt(s.slice(6), 16) / 255];
    const n = parseInt(s, 16);
    return [Number.isFinite(n) ? n : 0xffffff, alpha];
  }
  if (Array.isArray(c)) return [(Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255), alpha * (c[3] ?? 1)];
  if (c instanceof FillGradient) return colourOf(c.colorStops[0]?.color ?? 0xffffff, alpha);
  if (typeof c === 'object' && 'r' in c) return [(Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255), alpha * (c.a ?? 1)];
  return [0xffffff, alpha];
}

// ---- events

class Emitter {
  constructor() { this._ev = new Map(); }
  on(ev, fn, ctx) { if (typeof fn !== 'function') return this; if (!this._ev.has(ev)) this._ev.set(ev, []); this._ev.get(ev).push({ fn, ctx, once: false }); return this; }
  once(ev, fn, ctx) { if (typeof fn !== 'function') return this; if (!this._ev.has(ev)) this._ev.set(ev, []); this._ev.get(ev).push({ fn, ctx, once: true }); return this; }
  addListener(ev, fn, ctx) { return this.on(ev, fn, ctx); }
  off(ev, fn, ctx) {
    const l = this._ev.get(ev);
    if (!l) return this;
    if (!fn) this._ev.delete(ev); else this._ev.set(ev, l.filter(x => x.fn !== fn || (ctx !== undefined && x.ctx !== ctx)));
    return this;
  }
  removeListener(ev, fn, ctx) { return this.off(ev, fn, ctx); }
  emit(ev, ...a) {
    const l = this._ev.get(ev);
    if (!l || !l.length) return false;
    for (const x of [...l]) { if (x.once) this.off(ev, x.fn); x.fn.apply(x.ctx ?? this, a); }
    return true;
  }
  listenerCount(ev) { return this._ev.get(ev)?.length ?? 0; }
  listeners(ev) { return (this._ev.get(ev) ?? []).map(x => x.fn); }
  eventNames() { return [...this._ev.keys()]; }
  removeAllListeners(ev) { if (ev) this._ev.delete(ev); else this._ev.clear(); return this; }
}

// ---- geometry

export class Point {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x = 0, y = x) { this.x = x; this.y = y; return this; }
  copyFrom(p) { this.x = p.x; this.y = p.y; return this; }
  copyTo(p) { p.x = this.x; p.y = this.y; return p; }
  clone() { return new Point(this.x, this.y); }
  equals(p) { return p.x === this.x && p.y === this.y; }
}
Point.shared = new Point();
export class ObservablePoint extends Point {}

export class Rectangle {
  constructor(x = 0, y = 0, width = 0, height = 0) { this.type = 'rectangle'; this.x = +x; this.y = +y; this.width = +width; this.height = +height; }
  get left() { return this.x; } get right() { return this.x + this.width; }
  get top() { return this.y; } get bottom() { return this.y + this.height; }
  isEmpty() { return this.left === this.right || this.top === this.bottom; }
  clone() { return new Rectangle(this.x, this.y, this.width, this.height); }
  copyFrom(r) { this.x = r.x; this.y = r.y; this.width = r.width; this.height = r.height; return this; }
  copyTo(r) { return r.copyFrom(this); }
  set(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; return this; }
  contains(x, y) { return this.width > 0 && this.height > 0 && x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height; }
  strokeContains(x, y, w) { const h = w / 2; return x >= this.x - h && x <= this.right + h && y >= this.y - h && y <= this.bottom + h && !(x > this.x + h && x < this.right - h && y > this.y + h && y < this.bottom - h); }
  intersects(o) { return o.x < this.right && o.right > this.x && o.y < this.bottom && o.bottom > this.y; }
  containsRect(o) { return o.x >= this.x && o.right <= this.right && o.y >= this.y && o.bottom <= this.bottom; }
  pad(px = 0, py = px) { this.x -= px; this.y -= py; this.width += px * 2; this.height += py * 2; return this; }
  fit(r) { const x1 = Math.max(this.x, r.x), y1 = Math.max(this.y, r.y), x2 = Math.min(this.right, r.right), y2 = Math.min(this.bottom, r.bottom); this.x = x1; this.y = y1; this.width = Math.max(0, x2 - x1); this.height = Math.max(0, y2 - y1); return this; }
  enlarge(r) { const x1 = Math.min(this.x, r.x), y1 = Math.min(this.y, r.y), x2 = Math.max(this.right, r.right), y2 = Math.max(this.bottom, r.bottom); this.x = x1; this.y = y1; this.width = x2 - x1; this.height = y2 - y1; return this; }
  ceil() { const x2 = Math.ceil(this.right), y2 = Math.ceil(this.bottom); this.x = Math.floor(this.x); this.y = Math.floor(this.y); this.width = x2 - this.x; this.height = y2 - this.y; return this; }
  scale(x, y = x) { this.x *= x; this.y *= y; this.width *= x; this.height *= y; return this; }
  getBounds(out = new Rectangle()) { return out.copyFrom(this); }
  equals(r) { return r && r.x === this.x && r.y === this.y && r.width === this.width && r.height === this.height; }
}
Object.defineProperty(Rectangle, 'EMPTY', { get: () => new Rectangle() });

export class Circle {
  constructor(x = 0, y = 0, radius = 0) { this.type = 'circle'; this.x = x; this.y = y; this.radius = radius; }
  contains(x, y) { return this.radius > 0 && (x - this.x) ** 2 + (y - this.y) ** 2 <= this.radius ** 2; }
  clone() { return new Circle(this.x, this.y, this.radius); }
  getBounds(out = new Rectangle()) { return out.set(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2); }
}
export class Ellipse {
  constructor(x = 0, y = 0, halfWidth = 0, halfHeight = 0) { this.type = 'ellipse'; this.x = x; this.y = y; this.halfWidth = halfWidth; this.halfHeight = halfHeight; }
  contains(x, y) { if (this.halfWidth <= 0 || this.halfHeight <= 0) return false; return ((x - this.x) / this.halfWidth) ** 2 + ((y - this.y) / this.halfHeight) ** 2 <= 1; }
  clone() { return new Ellipse(this.x, this.y, this.halfWidth, this.halfHeight); }
  getBounds(out = new Rectangle()) { return out.set(this.x - this.halfWidth, this.y - this.halfHeight, this.halfWidth * 2, this.halfHeight * 2); }
}
export class RoundedRectangle extends Rectangle {
  constructor(x = 0, y = 0, width = 0, height = 0, radius = 20) { super(x, y, width, height); this.type = 'roundedRectangle'; this.radius = radius; }
  clone() { return new RoundedRectangle(this.x, this.y, this.width, this.height, this.radius); }
}
const flatPoints = pts => (pts.length && typeof pts[0] === 'object' ? pts.flatMap(p => [p.x, p.y]) : pts.slice());
function insidePoly(p, x, y) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export class Polygon {
  constructor(...points) { this.type = 'polygon'; if (points.length === 1 && Array.isArray(points[0])) points = points[0]; this.points = flatPoints(points); this.closePath = true; }
  contains(x, y) { return insidePoly(this.points, x, y); }
  clone() { return new Polygon(this.points.slice()); }
  getBounds(out = new Rectangle()) { const b = new Bounds(); for (let i = 0; i < this.points.length; i += 2) b.addPoint(this.points[i], this.points[i + 1]); return out.set(b.x, b.y, b.width, b.height); }
}

export class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) { this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty; }
  set(a, b, c, d, tx, ty) { this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty; return this; }
  apply(p, out = new Point()) { const x = p.x, y = p.y; out.x = this.a * x + this.c * y + this.tx; out.y = this.b * x + this.d * y + this.ty; return out; }
  applyInverse(p, out = new Point()) {
    const { a, b, c, d, tx, ty } = this, id = 1 / (a * d - c * b), x = p.x, y = p.y;
    out.x = d * id * x - c * id * y + (ty * c - tx * d) * id;
    out.y = a * id * y - b * id * x + (-ty * a + tx * b) * id;
    return out;
  }
  /** this = this * m (m applied first). */
  append(m) {
    const a1 = this.a, b1 = this.b, c1 = this.c, d1 = this.d;
    this.a = m.a * a1 + m.b * c1; this.b = m.a * b1 + m.b * d1;
    this.c = m.c * a1 + m.d * c1; this.d = m.c * b1 + m.d * d1;
    this.tx = m.tx * a1 + m.ty * c1 + this.tx; this.ty = m.tx * b1 + m.ty * d1 + this.ty;
    return this;
  }
  appendFrom(a, b) { return this.copyFrom(b).append(a); }
  /** this = m * this. */
  prepend(m) { const t = m.clone().append(this); return this.copyFrom(t); }
  invert() {
    const { a, b, c, d, tx, ty } = this, n = a * d - b * c;
    this.a = d / n; this.b = -b / n; this.c = -c / n; this.d = a / n;
    this.tx = (c * ty - d * tx) / n; this.ty = -(a * ty - b * tx) / n;
    return this;
  }
  identity() { return this.set(1, 0, 0, 1, 0, 0); }
  isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.tx === 0 && this.ty === 0; }
  translate(x, y) { this.tx += x; this.ty += y; return this; }
  scale(x, y) { this.a *= x; this.d *= y; this.c *= x; this.b *= y; this.tx *= x; this.ty *= y; return this; }
  rotate(r) {
    const cos = Math.cos(r), sin = Math.sin(r), a1 = this.a, c1 = this.c, tx1 = this.tx;
    this.a = a1 * cos - this.b * sin; this.b = a1 * sin + this.b * cos;
    this.c = c1 * cos - this.d * sin; this.d = c1 * sin + this.d * cos;
    this.tx = tx1 * cos - this.ty * sin; this.ty = tx1 * sin + this.ty * cos;
    return this;
  }
  clone() { return new Matrix(this.a, this.b, this.c, this.d, this.tx, this.ty); }
  copyFrom(m) { return this.set(m.a, m.b, m.c, m.d, m.tx, m.ty); }
  copyTo(m) { return m.copyFrom(this); }
  toArray() { return [this.a, this.b, this.c, this.d, this.tx, this.ty]; }
}
Object.defineProperty(Matrix, 'IDENTITY', { get: () => new Matrix() });
Matrix.shared = new Matrix();

export class Bounds {
  constructor(minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity) { this.minX = minX; this.minY = minY; this.maxX = maxX; this.maxY = maxY; this.matrix = new Matrix(); }
  clear() { this.minX = this.minY = Infinity; this.maxX = this.maxY = -Infinity; this.matrix = new Matrix(); return this; }
  set(x0, y0, x1, y1) { this.minX = x0; this.minY = y0; this.maxX = x1; this.maxY = y1; return this; }
  get isValid() { return this.minX + this.minY !== Infinity && this.minX <= this.maxX; }
  isEmpty() { return this.minX > this.maxX || this.minY > this.maxY; }
  get x() { return this.minX; } set x(v) { const w = this.width; this.minX = v; this.maxX = v + w; }
  get y() { return this.minY; } set y(v) { const h = this.height; this.minY = v; this.maxY = v + h; }
  get width() { return this.isValid ? this.maxX - this.minX : 0; } set width(v) { this.maxX = this.minX + v; }
  get height() { return this.isValid ? this.maxY - this.minY : 0; } set height(v) { this.maxY = this.minY + v; }
  get left() { return this.minX; } get right() { return this.maxX; } get top() { return this.minY; } get bottom() { return this.maxY; }
  get rectangle() { return new Rectangle(this.minX, this.minY, this.width, this.height); }
  addPoint(x, y) { if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x; if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y; return this; }
  addFrame(x0, y0, x1, y1, m = this.matrix) {
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) this.addPoint(m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty);
    return this;
  }
  addRect(r, m) { return this.addFrame(r.x, r.y, r.x + r.width, r.y + r.height, m); }
  addBounds(b, m) { if (b.isValid) this.addFrame(b.minX, b.minY, b.maxX, b.maxY, m ?? this.matrix); return this; }
  addBoundsMask(mask) { this.minX = Math.max(this.minX, mask.minX); this.minY = Math.max(this.minY, mask.minY); this.maxX = Math.min(this.maxX, mask.maxX); this.maxY = Math.min(this.maxY, mask.maxY); return this; }
  containsPoint(x, y) { return x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY; }
  clone() { return new Bounds(this.minX, this.minY, this.maxX, this.maxY); }
  pad(px, py = px) { this.minX -= px; this.maxX += px; this.minY -= py; this.maxY += py; return this; }
  ceil() { this.minX = Math.floor(this.minX); this.minY = Math.floor(this.minY); this.maxX = Math.ceil(this.maxX); this.maxY = Math.ceil(this.maxY); return this; }
  fit(r) { return this.addBoundsMask({ minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height }); }
  applyMatrix(m) { const b = new Bounds().addFrame(this.minX, this.minY, this.maxX, this.maxY, m); return this.set(b.minX, b.minY, b.maxX, b.maxY); }
}

// ---- the scene graph

let nextUid = 1;
export class Container extends Emitter {
  constructor(o = {}) {
    super();
    this.uid = nextUid++;
    this.children = []; this.parent = null; this.label = null;
    this.position = new ObservablePoint(); this.scale = new ObservablePoint(1, 1); this.pivot = new ObservablePoint(); this.skew = new ObservablePoint();
    this.rotation = 0; this.alpha = 1; this.visible = true; this.renderable = true; this.measurable = true;
    this.eventMode = 'passive'; this.interactiveChildren = true; this.cursor = null; this.hitArea = null; this.boundsArea = null;
    this.mask = null; this.filters = null; this.zIndex = 0; this.sortableChildren = false; this.sortDirty = false;
    this.tint = 0xffffff; this.blendMode = 'inherit'; this.destroyed = false; this.cullable = false; this.isRenderGroup = false; this.onRender = null;
    this._isMask = false;
    for (const k of ['label', 'alpha', 'visible', 'eventMode', 'cursor', 'zIndex', 'sortableChildren', 'rotation', 'tint', 'blendMode', 'hitArea', 'renderable', 'interactiveChildren', 'isRenderGroup']) if (o && k in o) this[k] = o[k];
    if (o?.x !== undefined) this.x = o.x;
    if (o?.y !== undefined) this.y = o.y;
    if (o?.position) this.position = o.position;
    if (o?.scale !== undefined) this.scale = o.scale;
    if (o?.pivot) this.pivot = o.pivot;
    if (o?.children) for (const c of o.children) this.addChild(c);
    if (o?.parent) o.parent.addChild(this);
  }
  get name() { return this.label; } set name(v) { this.label = v; }
  get x() { return this.position.x; } set x(v) { this.position.x = v; }
  get y() { return this.position.y; } set y(v) { this.position.y = v; }
  get position() { return this._position; }
  set position(p) { if (!this._position) this._position = new ObservablePoint(); this._position.set(p.x, p.y); }
  get scale() { return this._scale; }
  set scale(s) { if (!this._scale) this._scale = new ObservablePoint(1, 1); if (typeof s === 'number') this._scale.set(s, s); else this._scale.set(s.x, s.y); }
  get pivot() { return this._pivot; }
  set pivot(p) { if (!this._pivot) this._pivot = new ObservablePoint(); if (typeof p === 'number') this._pivot.set(p, p); else this._pivot.set(p.x, p.y); }
  get skew() { return this._skew; }
  set skew(p) { if (!this._skew) this._skew = new ObservablePoint(); this._skew.set(p.x, p.y); }
  get angle() { return this.rotation * 180 / Math.PI; } set angle(v) { this.rotation = v * Math.PI / 180; }
  get interactive() { return this.eventMode === 'static' || this.eventMode === 'dynamic'; }
  set interactive(v) { this.eventMode = v ? 'static' : 'passive'; }
  isInteractive() { return this.eventMode === 'static' || this.eventMode === 'dynamic'; }
  get mask() { return this._mask; }
  set mask(m) { if (this._mask) this._mask._isMask = false; this._mask = m ?? null; if (m) m._isMask = true; }
  get worldVisible() { let c = this; while (c) { if (!c.visible) return false; c = c.parent; } return true; }
  get worldAlpha() { let a = 1, c = this; while (c) { a *= c.alpha; c = c.parent; } return a; }

  get localTransform() {
    const { x: sx, y: sy } = this.scale, r = this.rotation, kx = this.skew.x, ky = this.skew.y;
    const a = Math.cos(r + ky) * sx, b = Math.sin(r + ky) * sx, c = -Math.sin(r - kx) * sy, d = Math.cos(r - kx) * sy;
    const px = this.pivot.x, py = this.pivot.y;
    return new Matrix(a, b, c, d, this.x - (px * a + py * c), this.y - (px * b + py * d));
  }
  get worldTransform() { return this.parent ? this.parent.worldTransform.append(this.localTransform) : this.localTransform; }
  get groupTransform() { return this.worldTransform; }
  updateTransform(o = {}) {
    if ('x' in o) this.x = o.x; if ('y' in o) this.y = o.y;
    if ('scaleX' in o) this.scale.x = o.scaleX; if ('scaleY' in o) this.scale.y = o.scaleY;
    if ('rotation' in o) this.rotation = o.rotation;
    return this;
  }
  updateLocalTransform() {}
  setFromMatrix(m) {
    this.position.set(m.tx, m.ty);
    this.scale.set(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
    this.rotation = Math.atan2(m.b, m.a);
  }

  addChild(...cs) {
    for (const c of cs) {
      if (!c || c === this) continue;
      if (c.parent) c.parent.removeChild(c);
      this.children.push(c); c.parent = this;
      this.sortDirty = true;
      c.emit('added', this); this.emit('childAdded', c, this, this.children.length - 1);
    }
    return cs[0];
  }
  addChildAt(c, i) {
    if (c.parent === this) { this.setChildIndex(c, Math.min(i, this.children.length - 1)); return c; }
    if (c.parent) c.parent.removeChild(c);
    this.children.splice(Math.max(0, Math.min(i, this.children.length)), 0, c); c.parent = this;
    this.sortDirty = true;
    c.emit('added', this); this.emit('childAdded', c, this, i);
    return c;
  }
  removeChild(...cs) {
    for (const c of cs) {
      const i = this.children.indexOf(c);
      if (i < 0) continue;
      this.children.splice(i, 1); c.parent = null;
      c.emit('removed', this); this.emit('childRemoved', c, this, i);
    }
    return cs[0];
  }
  removeChildAt(i) { const c = this.children[i]; if (c) this.removeChild(c); return c; }
  removeChildren(begin = 0, end = this.children.length) {
    const out = this.children.slice(begin, end);
    for (const c of out) this.removeChild(c);
    return out;
  }
  removeFromParent() { this.parent?.removeChild(this); }
  getChildAt(i) { return this.children[i]; }
  getChildIndex(c) { const i = this.children.indexOf(c); if (i < 0) throw new Error('The supplied Container must be a child of the caller'); return i; }
  setChildIndex(c, i) { const at = this.getChildIndex(c); this.children.splice(at, 1); this.children.splice(i, 0, c); }
  swapChildren(a, b) { const i = this.getChildIndex(a), j = this.getChildIndex(b); this.children[i] = b; this.children[j] = a; }
  getChildByLabel(label, deep = false) {
    for (const c of this.children) if (c.label === label || (label instanceof RegExp && label.test(c.label))) return c;
    if (deep) for (const c of this.children) { const f = c.getChildByLabel(label, true); if (f) return f; }
    return null;
  }
  getChildByName(n, deep) { return this.getChildByLabel(n, deep); }
  getChildrenByLabel(label, deep = false, out = []) {
    for (const c of this.children) { if (c.label === label || (label instanceof RegExp && label.test(c.label))) out.push(c); if (deep) c.getChildrenByLabel(label, true, out); }
    return out;
  }
  sortChildren() { this.children.sort((a, b) => a.zIndex - b.zIndex); this.sortDirty = false; }
  /** The children in drawing order. */
  get drawOrder() { return this.sortableChildren ? [...this.children].sort((a, b) => a.zIndex - b.zIndex) : this.children; }

  destroy(o = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.parent?.removeChild(this);
    const kids = o === true || o?.children ? this.children.slice() : [];
    this.children = [];
    for (const c of kids) c.destroy(o);
    this.emit('destroyed', this);
    this.removeAllListeners();
    this._mask = null;
  }

  // Bounds: what this draws itself, in its own space (none for a plain container).
  _ownBounds() { return null; }
  _measure(bounds, m, root) {
    if (!root && (!this.visible || !this.measurable || this._isMask)) return;
    const masked = !!this._mask;
    const into = masked ? new Bounds() : bounds;
    if (this.boundsArea) into.addRect(this.boundsArea, m);
    else {
      const own = this._ownBounds();
      if (own && own.isValid) into.addFrame(own.minX, own.minY, own.maxX, own.maxY, m);
      for (const c of this.children) c._measure(into, m.clone().append(c.localTransform), false);
    }
    if (masked) {
      if (into.isValid) {
        // The mask's bounds, in the same space as these: its world box brought back through this one's world transform.
        const mb = this._mask.getBounds(), inv = this.worldTransform.invert(), back = m.clone().append(inv);
        const local = new Bounds().addFrame(mb.minX, mb.minY, mb.maxX, mb.maxY, back);
        into.addBoundsMask(local);
        if (into.isValid && into.maxX >= into.minX && into.maxY >= into.minY) bounds.addFrame(into.minX, into.minY, into.maxX, into.maxY, new Matrix());
      }
    }
  }
  getLocalBounds(out) {
    const b = new Bounds();
    this._measure(b, new Matrix(), true);
    if (!b.isValid) b.set(0, 0, 0, 0);
    if (out) { out.set(b.minX, b.minY, b.maxX, b.maxY); return out; }
    return b;
  }
  getBounds(skip, out) {
    const b = new Bounds();
    if (this.visible && this.measurable) {
      const wasMask = this._isMask;
      this._isMask = false;
      this._measure(b, this.worldTransform, true);
      this._isMask = wasMask;
    }
    if (!b.isValid) b.set(0, 0, 0, 0);
    if (out instanceof Bounds) { out.set(b.minX, b.minY, b.maxX, b.maxY); return out; }
    return b;
  }
  get width() { return Math.abs(this.scale.x) * this.getLocalBounds().width; }
  set width(v) { const lw = this.getLocalBounds().width, s = Math.sign(this.scale.x) || 1; this.scale.x = lw !== 0 ? (v / lw) * s : s; }
  get height() { return Math.abs(this.scale.y) * this.getLocalBounds().height; }
  set height(v) { const lh = this.getLocalBounds().height, s = Math.sign(this.scale.y) || 1; this.scale.y = lh !== 0 ? (v / lh) * s : s; }
  getSize(out = {}) { out.width = this.width; out.height = this.height; return out; }
  setSize(w, h = w) { if (typeof w === 'object') { h = w.height ?? w.width; w = w.width; } this.width = w; this.height = h; }

  toGlobal(p, out = new Point()) { return this.worldTransform.apply(p, out); }
  toLocal(p, from, out = new Point()) { const g = from ? from.toGlobal(p) : p; return this.worldTransform.applyInverse(g, out); }
  getGlobalPosition(out = new Point()) { return this.parent ? this.parent.toGlobal(this.position, out) : out.set(this.x, this.y); }
  /** Whether a point in this one's own space hits what it draws (Graphics, Sprite and Text say). */
  containsPoint() { return false; }
}

// ---- shapes

const SEG = r => Math.max(8, Math.min(96, Math.ceil(Math.abs(r) * 0.9)));
function arcPoints(cx, cy, r, a0, a1, ccw, out) {
  let sweep = a1 - a0;
  if (ccw) { if (sweep > 0) sweep -= Math.PI * 2 * Math.ceil(sweep / (Math.PI * 2)); }
  else if (sweep < 0) sweep += Math.PI * 2 * Math.ceil(-sweep / (Math.PI * 2));
  if (Math.abs(sweep) > Math.PI * 2) sweep = Math.sign(sweep) * Math.PI * 2;
  const n = Math.max(2, Math.ceil(SEG(r) * Math.abs(sweep) / (Math.PI * 2)));
  for (let i = 0; i <= n; i++) { const a = a0 + sweep * i / n; out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  return out;
}
function roundRectPoints(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (!r) return [x, y, x + w, y, x + w, y + h, x, y + h];
  const p = [];
  arcPoints(x + w - r, y + r, r, -Math.PI / 2, 0, false, p);
  arcPoints(x + w - r, y + h - r, r, 0, Math.PI / 2, false, p);
  arcPoints(x + r, y + h - r, r, Math.PI / 2, Math.PI, false, p);
  arcPoints(x + r, y + r, r, Math.PI, Math.PI * 1.5, false, p);
  return p;
}

/** A path being drawn: subpaths of flat points, each open or closed. */
class Path {
  constructor() { this.subs = []; this.cur = null; }
  clone() { const p = new Path(); p.subs = this.subs.map(s => ({ pts: s.pts.slice(), closed: s.closed })); return p; }
  get empty() { return !this.subs.some(s => s.pts.length >= 4); }
  shape(pts) { this.subs.push({ pts, closed: true }); this.cur = null; }
  moveTo(x, y) { this.cur = { pts: [x, y], closed: false }; this.subs.push(this.cur); }
  lineTo(x, y) { if (!this.cur) this.moveTo(x, y); else this.cur.pts.push(x, y); }
  last() { const p = this.cur?.pts; return p?.length ? [p[p.length - 2], p[p.length - 1]] : [0, 0]; }
  close() { if (this.cur) { this.cur.closed = true; this.cur = null; } }
}

export class FillGradient {
  constructor(a = 0, b = 0, c = 1, d = 0) {
    if (typeof a === 'object') { const o = a; this.type = o.type ?? 'linear'; this.start = o.start ?? { x: 0, y: 0 }; this.end = o.end ?? { x: 0, y: 1 }; this.colorStops = (o.colorStops ?? []).map(s => ({ ...s })); this.textureSpace = o.textureSpace ?? 'local'; }
    else { this.type = 'linear'; this.start = { x: a, y: b }; this.end = { x: c, y: d }; this.colorStops = []; this.textureSpace = 'global'; }
  }
  addColorStop(offset, color) { this.colorStops.push({ offset, color }); return this; }
  destroy() {}
}

const styleOf = (s, alpha, base) => {
  if (s === undefined || s === null) return { ...base };
  if (typeof s === 'number' || typeof s === 'string' || Array.isArray(s)) return { ...base, color: s, alpha: alpha ?? 1 };
  if (s instanceof FillGradient) return { ...base, fill: s, color: 0xffffff, alpha: alpha ?? 1 };
  if (s instanceof Texture) return { ...base, texture: s, color: 0xffffff, alpha: alpha ?? 1 };
  return { ...base, ...s };
};

export class GraphicsContext {
  constructor() { this.instructions = []; this.path = new Path(); this.tick = 0; this.fillStyle = { color: 0xffffff, alpha: 1 }; this.strokeStyle = { width: 1, color: 0xffffff, alpha: 1, alignment: 0.5 }; }
  destroy() {}
}

export class GraphicsPath {
  constructor() { this.ops = []; }
  moveTo(...a) { this.ops.push(['moveTo', a]); return this; } lineTo(...a) { this.ops.push(['lineTo', a]); return this; }
  closePath() { this.ops.push(['closePath', []]); return this; } rect(...a) { this.ops.push(['rect', a]); return this; }
  circle(...a) { this.ops.push(['circle', a]); return this; } poly(...a) { this.ops.push(['poly', a]); return this; }
  bezierCurveTo(...a) { this.ops.push(['bezierCurveTo', a]); return this; } quadraticCurveTo(...a) { this.ops.push(['quadraticCurveTo', a]); return this; }
  arc(...a) { this.ops.push(['arc', a]); return this; } roundRect(...a) { this.ops.push(['roundRect', a]); return this; }
}

export class Graphics extends Container {
  constructor(o) {
    super(o instanceof GraphicsContext ? {} : o ?? {});
    this.context = o instanceof GraphicsContext ? o : o?.context ?? new GraphicsContext();
    this.roundPixels = false;
  }
  get instructions() { return this.context.instructions; }
  _shape(pts) { const k = this.context; k.tick++; k.path.shape(pts); return this; }
  rect(x, y, w, h) { return this._shape([x, y, x + w, y, x + w, y + h, x, y + h]); }
  drawRect(x, y, w, h) { return this.rect(x, y, w, h); }
  roundRect(x, y, w, h, r = 0) { return this._shape(roundRectPoints(x, y, w, h, r)); }
  filletRect(x, y, w, h, r) { return this.roundRect(x, y, w, h, Math.abs(r)); }
  chamferRect(x, y, w, h, c) { return this._shape([x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c]); }
  circle(x, y, r) { return this._shape(arcPoints(x, y, r, 0, Math.PI * 2, false, []).slice(0, -2)); }
  drawCircle(x, y, r) { return this.circle(x, y, r); }
  ellipse(x, y, rx, ry) { const p = arcPoints(0, 0, 1, 0, Math.PI * 2, false, []).slice(0, -2); for (let i = 0; i < p.length; i += 2) { p[i] = x + p[i] * rx; p[i + 1] = y + p[i + 1] * ry; } return this._shape(p); }
  poly(points, close = true) {
    const p = flatPoints(points);
    const k = this.context;
    k.tick++;
    if (close) k.path.shape(p);
    else { k.path.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) k.path.lineTo(p[i], p[i + 1]); }
    return this;
  }
  drawPolygon(...a) { return this.poly(a.length === 1 ? a[0] : a); }
  regularPoly(x, y, r, n, rot = 0) { const p = []; for (let i = 0; i < n; i++) { const a = rot - Math.PI / 2 + i * Math.PI * 2 / n; p.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } return this._shape(p); }
  star(x, y, n, r, inner = r / 2, rot = 0) { const p = []; for (let i = 0; i < n * 2; i++) { const a = rot - Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? inner : r; p.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } return this._shape(p); }
  beginPath() { this.context.path = new Path(); return this; }
  moveTo(x, y) { this.context.tick++; this.context.path.moveTo(x, y); return this; }
  lineTo(x, y) { this.context.tick++; this.context.path.lineTo(x, y); return this; }
  closePath() { this.context.path.close(); return this; }
  quadraticCurveTo(cx, cy, x, y) {
    const k = this.context.path, [x0, y0] = k.last();
    for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; k.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); }
    this.context.tick++;
    return this;
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    const k = this.context.path, [x0, y0] = k.last();
    for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; k.lineTo(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y); }
    this.context.tick++;
    return this;
  }
  arc(cx, cy, r, a0, a1, ccw = false) {
    const p = arcPoints(cx, cy, r, a0, a1, ccw, []), k = this.context.path;
    if (!k.cur) k.moveTo(p[0], p[1]); else k.lineTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) k.lineTo(p[i], p[i + 1]);
    this.context.tick++;
    return this;
  }
  arcTo(x1, y1, x2, y2) { return this.lineTo(x1, y1).lineTo(x2, y2); }
  path(gp) { for (const [op, a] of gp.ops ?? []) this[op](...a); return this; }
  setFillStyle(s) { this.context.fillStyle = styleOf(s, undefined, { color: 0xffffff, alpha: 1 }); return this; }
  setStrokeStyle(s) { this.context.strokeStyle = styleOf(s, undefined, { width: 1, color: 0xffffff, alpha: 1, alignment: 0.5 }); return this; }
  _take(kind) {
    const k = this.context, last = k.instructions[k.instructions.length - 1];
    let path;
    if (k.tick === 0 && last && last.action !== kind && last.action !== 'svg' && last.action !== 'cut') path = last.path;
    else path = k.path.clone();
    k.path = new Path();
    k.tick = 0;
    return path;
  }
  fill(s, alpha) {
    const k = this.context;
    if (s !== undefined && s !== null) k.fillStyle = styleOf(s, alpha, { color: 0xffffff, alpha: 1 });
    const path = this._take('fill');
    if (!path.empty) k.instructions.push({ action: 'fill', style: { ...k.fillStyle }, path });
    return this;
  }
  stroke(s) {
    const k = this.context;
    if (s !== undefined && s !== null) k.strokeStyle = styleOf(s, undefined, { width: 1, color: 0xffffff, alpha: 1, alignment: 0.5 });
    const path = this._take('stroke');
    if (!path.empty) k.instructions.push({ action: 'stroke', style: { ...k.strokeStyle }, path });
    return this;
  }
  /** Cuts the shape just drawn out of the fill before it (a hole). */
  cut() {
    const k = this.context, path = k.path.clone(), last = k.instructions[k.instructions.length - 1];
    k.path = new Path(); k.tick = 0;
    if (last && last.action === 'fill') (last.holes ??= []).push(...path.subs);
    return this;
  }
  texture(tex, tint = 0xffffff, dx = 0, dy = 0, dw = tex.frame.width, dh = tex.frame.height) {
    this.context.instructions.push({ action: 'texture', texture: tex, tint, rect: [dx, dy, dw, dh] });
    return this;
  }
  svg(s) {
    const vb = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/.exec(s);
    const wm = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/.exec(s), hm = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/.exec(s);
    const box = vb ? vb.slice(1, 5).map(Number) : [0, 0, wm ? +wm[1] : 24, hm ? +hm[1] : 24];
    this.context.instructions.push({ action: 'svg', svg: s, box });
    return this;
  }
  clear() { const k = this.context; k.instructions = []; k.path = new Path(); k.tick = 0; return this; }
  _ownBounds() {
    const b = new Bounds();
    for (const ins of this.context.instructions) {
      if (ins.action === 'svg') { b.addFrame(ins.box[0], ins.box[1], ins.box[0] + ins.box[2], ins.box[1] + ins.box[3], new Matrix()); continue; }
      if (ins.action === 'texture') { const [x, y, w, h] = ins.rect; b.addFrame(x, y, x + w, y + h, new Matrix()); continue; }
      const pad = ins.action === 'stroke' ? (ins.style.width ?? 1) * (1 - (ins.style.alignment ?? 0.5)) : 0;
      for (const s of ins.path.subs) for (let i = 0; i < s.pts.length; i += 2) { b.addPoint(s.pts[i] - pad, s.pts[i + 1] - pad); b.addPoint(s.pts[i] + pad, s.pts[i + 1] + pad); }
    }
    return b;
  }
  containsPoint(p) {
    for (const ins of this.context.instructions) {
      if (ins.action === 'fill') { for (const s of ins.path.subs) if (s.pts.length >= 6 && insidePoly(s.pts, p.x, p.y)) return true; }
      else if (ins.action === 'stroke' || ins.action === 'svg' || ins.action === 'texture') {
        const b = new Bounds();
        if (ins.action === 'svg') b.set(ins.box[0], ins.box[1], ins.box[0] + ins.box[2], ins.box[1] + ins.box[3]);
        else if (ins.action === 'texture') b.set(ins.rect[0], ins.rect[1], ins.rect[0] + ins.rect[2], ins.rect[1] + ins.rect[3]);
        else { const w = (ins.style.width ?? 1) / 2; for (const s of ins.path.subs) for (let i = 0; i < s.pts.length; i += 2) { b.addPoint(s.pts[i] - w, s.pts[i + 1] - w); b.addPoint(s.pts[i] + w, s.pts[i + 1] + w); } }
        if (b.isValid && b.containsPoint(p.x, p.y)) return true;
      }
    }
    return false;
  }
  clone() { const g = new Graphics(); g.context.instructions = this.context.instructions.map(i => ({ ...i, path: i.path?.clone() })); return g; }
}

// ---- words

const FONT_DEFAULTS = {
  align: 'left', breakWords: false, dropShadow: null, fill: 0x000000, fontFamily: 'Arial', fontSize: 26, fontStyle: 'normal', fontVariant: 'normal',
  fontWeight: 'normal', leading: 0, letterSpacing: 0, lineHeight: 0, padding: 0, stroke: null, textBaseline: 'alphabetic', trim: false,
  whiteSpace: 'pre', wordWrap: false, wordWrapWidth: 100, tagStyles: null,
};
const SHADOW_DEFAULTS = { alpha: 1, angle: Math.PI / 6, blur: 0, color: 'black', distance: 5 };
export class TextStyle extends Emitter {
  constructor(o = {}) {
    super();
    Object.assign(this, FONT_DEFAULTS);
    if (o instanceof TextStyle) o = o._plain();
    for (const [k, v] of Object.entries(o ?? {})) this[k] = v;
  }
  get dropShadow() { return this._dropShadow; }
  set dropShadow(v) { this._dropShadow = v === true ? { ...SHADOW_DEFAULTS } : v ? { ...SHADOW_DEFAULTS, ...v } : null; }
  get stroke() { return this._stroke; }
  set stroke(v) { this._stroke = v == null ? null : typeof v === 'object' && !Array.isArray(v) && !(v instanceof FillGradient) ? { width: 1, ...v } : { color: v, width: 1 }; }
  _plain() { const o = {}; for (const k of Object.keys(FONT_DEFAULTS)) o[k] = this[k]; o.dropShadow = this._dropShadow ? { ...this._dropShadow } : null; o.stroke = this._stroke ? { ...this._stroke } : null; return o; }
  clone() { return new TextStyle(this._plain()); }
  update() {}
  reset() { Object.assign(this, FONT_DEFAULTS); }
  get fontSizePx() { return typeof this.fontSize === 'string' ? parseFloat(this.fontSize) : this.fontSize; }
  get styleKey() { return JSON.stringify(this._plain()); }
}

const FAMILY = { 'grenze gotisch': 'display', spectral: 'body', 'ibm plex mono': 'mono' };
/** The font file a style draws in (assets/ui/fonts): the 2D game's three families at the weights it loads. */
export function fontFile(style) {
  const fam = String(Array.isArray(style.fontFamily) ? style.fontFamily[0] : style.fontFamily).split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
  const kind = FAMILY[fam] ?? (fam.includes('mono') ? 'mono' : fam.includes('serif') ? 'body' : 'body');
  const w = style.fontWeight === 'bold' || style.fontWeight === 'bolder' ? 700 : style.fontWeight === 'normal' || !style.fontWeight ? 400 : Number(style.fontWeight) || 400;
  if (kind === 'display') return w >= 600 ? 'grenze-gotisch-700' : 'grenze-gotisch-500';
  if (kind === 'mono') return w >= 500 ? 'ibm-plex-mono-600' : 'ibm-plex-mono-400';
  if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') return 'spectral-400-italic';
  return w >= 500 ? 'spectral-600' : 'spectral-400';
}

const widthCache = new Map(), boxCache = new Map();
function widthOf(font, px, s) {
  if (!s) return 0;
  const k = font + '|' + px + '|' + s;
  let w = widthCache.get(k);
  if (w === undefined) { w = hooks.measure(font, px, s); widthCache.set(k, w); }
  return w;
}
function boxOf(font, px) {
  const k = font + '|' + px;
  let b = boxCache.get(k);
  if (!b) { b = hooks.fontBox(font, px); boxCache.set(k, b); }
  return b;
}
const SPACE = /^\s+$/;
/** pixi's word wrap (CanvasTextMetrics._wordWrap), greedy by words, spaces dropped at the breaks. */
function wrap(text, style, measure) {
  const max = style.wordWrapWidth, out = [];
  const collapse = style.whiteSpace === 'normal' || style.whiteSpace === 'pre-line';
  for (let para of text.split(/\r\n|\r|\n/)) {
    if (collapse) para = para.replace(/[ \t]+/g, ' ');
    const tokens = para.split(/(\s+)/).filter(t => t !== '');
    let line = '', w = 0;
    for (const t of tokens) {
      const space = SPACE.test(t), tw = measure(t);
      if (line && w + tw > max) {
        out.push(line.replace(/\s+$/, ''));
        if (space) { line = ''; w = 0; continue; }
        if (style.breakWords && tw > max) { let part = ''; for (const ch of t) { if (part && measure(part + ch) > max) { out.push(part); part = ''; } part += ch; } line = part; w = measure(part); continue; }
        line = t; w = tw;
        continue;
      }
      if (!line && space && out.length) continue;
      if (!line && style.breakWords && tw > max && !space) { let part = ''; for (const ch of t) { if (part && measure(part + ch) > max) { out.push(part); part = ''; } part += ch; } line = part; w = measure(part); continue; }
      line += t; w += tw;
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

/** Splits tagged words (pixi's tagStyles: <em>word</em>) into runs, each with its tag's style or none. */
function runsOf(text, tags) {
  if (!tags) return [{ s: text, tag: null }];
  const names = Object.keys(tags).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!names) return [{ s: text, tag: null }];
  const re = new RegExp(`<(${names})>([\\s\\S]*?)<\\/\\1>`, 'g'), out = [];
  let at = 0, m;
  while ((m = re.exec(text))) { if (m.index > at) out.push({ s: text.slice(at, m.index), tag: null }); out.push({ s: m[2], tag: m[1] }); at = re.lastIndex; }
  if (at < text.length) out.push({ s: text.slice(at), tag: null });
  return out;
}

export class CanvasTextMetrics {
  constructor(text, style, width, height, lines, lineWidths, lineHeight, maxLineWidth, fontProperties) {
    Object.assign(this, { text, style, width, height, lines, lineWidths, lineHeight, maxLineWidth, fontProperties });
  }
  static measureFont(font) { return boxOf(font, 16); }
  /** pixi's measureText: the lines, each one's width, the whole box (with the stroke and the shadow's reach). */
  static measureText(text = ' ', style = new TextStyle(), canvas, wordWrap = style.wordWrap) {
    if (!(style instanceof TextStyle)) style = new TextStyle(style);
    const font = fontFile(style), px = style.fontSizePx, fp = boxOf(font, px), ls = style.letterSpacing || 0;
    const tagged = !!style.tagStyles && /<[a-z]/i.test(text);
    const plain = tagged ? runsOf(text, style.tagStyles).map(r => r.s).join('') : text;
    const measure = s => widthOf(font, px, s) + (s.length > 1 ? (s.length - 1) * ls : 0);
    const lines = wordWrap ? wrap(plain, style, measure) : plain.split(/\r\n|\r|\n/);
    let lineWidths;
    if (tagged && !wordWrap) {
      // A tagged line is measured run by run, each in its own weight.
      const textLines = text.split(/\r\n|\r|\n/);
      lineWidths = textLines.map(l => runsOf(l, style.tagStyles).reduce((n, r) => n + widthOf(r.tag ? fontFile({ ...style._plain(), ...style.tagStyles[r.tag] }) : font, r.tag && style.tagStyles[r.tag].fontSize ? parseFloat(style.tagStyles[r.tag].fontSize) : px, r.s), 0));
    } else lineWidths = lines.map(measure);
    const maxLineWidth = Math.max(0, ...lineWidths);
    const sw = style.stroke?.width || 0;
    let width = maxLineWidth + sw;
    if (style.dropShadow) width += style.dropShadow.distance;
    const lineHeight = style.lineHeight || fp.fontSize;
    let height = Math.max(lineHeight, fp.fontSize + sw) + (lines.length - 1) * (lineHeight + style.leading);
    if (style.dropShadow) height += style.dropShadow.distance;
    return new CanvasTextMetrics(text, style, width, height, lines, lineWidths, lineHeight + style.leading, maxLineWidth, fp);
  }
}
CanvasTextMetrics.METRICS_STRING = '|ÉqÅ';
CanvasTextMetrics.BASELINE_SYMBOL = 'M';

export class Text extends Container {
  constructor(a = {}, b) {
    const o = typeof a === 'string' || typeof a === 'number' ? { text: a, style: b } : a ?? {};
    super(o);
    this.anchor = new ObservablePoint(0, 0);
    if (o.anchor !== undefined) this.anchor = o.anchor;
    this.resolution = o.resolution ?? 1;
    this.roundPixels = !!o.roundPixels;
    this._style = o.style instanceof TextStyle ? o.style : new TextStyle(o.style ?? {});
    this._text = String(o.text ?? '');
  }
  get anchor() { return this._anchor; }
  set anchor(v) { if (!this._anchor) this._anchor = new ObservablePoint(); if (typeof v === 'number') this._anchor.set(v, v); else this._anchor.set(v.x, v.y); }
  get text() { return this._text; } set text(v) { this._text = String(v ?? ''); }
  get style() { return this._style; } set style(v) { this._style = v instanceof TextStyle ? v : new TextStyle(v ?? {}); }
  get metrics() { return CanvasTextMetrics.measureText(this._text, this._style); }
  _ownBounds() {
    const m = this.metrics, x = -this.anchor.x * m.width, y = -this.anchor.y * m.height;
    return new Bounds(x, y, x + m.width, y + m.height);
  }
  containsPoint(p) { const b = this._ownBounds(); return b.containsPoint(p.x, p.y); }
  get width() { return Math.abs(this.scale.x) * this.metrics.width; }
  set width(v) { const w = this.metrics.width, s = Math.sign(this.scale.x) || 1; this.scale.x = w ? (v / w) * s : s; }
  get height() { return Math.abs(this.scale.y) * this.metrics.height; }
  set height(v) { const h = this.metrics.height, s = Math.sign(this.scale.y) || 1; this.scale.y = h ? (v / h) * s : s; }
}
export class HTMLText extends Text {}
export class BitmapText extends Text {}

// ---- pictures

export class TextureSource extends Emitter {
  constructor(o = {}) {
    super();
    this.uid = nextUid++;
    this.label = o.label ?? o.resource?.src ?? o.src ?? '';
    this.resource = o.resource ?? null;
    this.width = o.width ?? 1; this.height = o.height ?? 1;
    this.pixelWidth = this.width; this.pixelHeight = this.height; this.resolution = o.resolution ?? 1;
    this._scaleMode = o.scaleMode ?? 'linear';
    this.autoGenerateMipmaps = !!o.autoGenerateMipmaps;
    this.destroyed = false;
  }
  get scaleMode() { return this._scaleMode; } set scaleMode(v) { this._scaleMode = v; }
  get style() { const s = this; return { get scaleMode() { return s._scaleMode; }, set scaleMode(v) { s._scaleMode = v; }, update() {} }; }
  update() {} unload() {} resize(w, h) { this.width = w; this.height = h; }
  destroy() { this.destroyed = true; }
}
export class ImageSource extends TextureSource {}
export class CanvasSource extends TextureSource {}
export class BufferImageSource extends TextureSource {}

// ---- canvases: a 2D canvas the game paints once (the end screen's element dots, the doll's ground) records what is
// painted on it, and Godot paints the same (ui2d.gd)

class RecGradient {
  constructor(kind, args) { this.kind = kind; this.args = args; this.stops = []; }
  addColorStop(offset, color) { this.stops.push([offset, ...colourOf(color)]); }
}
const CTX_STATE = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'font', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'globalCompositeOperation', 'filter', 'imageSmoothingEnabled'];
export class RecCanvas {
  constructor(w = 300, h = 150) { this.width = w; this.height = h; this.ops = []; this.style = {}; this._ctx = null; }
  getContext() {
    if (this._ctx) return this._ctx;
    const ops = this.ops, state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, shadowColor: 'rgba(0,0,0,0)', shadowBlur: 0, font: '10px sans-serif' };
    const val = v => (v instanceof RecGradient ? { g: v.kind, a: v.args, s: v.stops } : typeof v === 'string' || typeof v === 'number' ? colourOf(v) : v);
    const ctx = {
      canvas: this,
      createLinearGradient: (...a) => new RecGradient('linear', a),
      createRadialGradient: (...a) => new RecGradient('radial', a),
      measureText: t => ({ width: hooks.measure('spectral-400', parseFloat(state.font) || 10, String(t)) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, drawImage() {}, setLineDash() {}, getLineDash: () => [],
    };
    for (const m of ['save', 'restore', 'scale', 'translate', 'rotate', 'transform', 'setTransform', 'resetTransform', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText'])
      ctx[m] = (...a) => { ops.push([m, ...a.map(x => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x))]); };
    const COLOURS = new Set(['fillStyle', 'strokeStyle', 'shadowColor']);
    for (const k of CTX_STATE) Object.defineProperty(ctx, k, { get: () => state[k], set: v => { state[k] = v; ops.push(['set', k, COLOURS.has(k) ? val(v) : v]); } });
    this._ctx = ctx;
    return ctx;
  }
  toDataURL() { return ''; }
  addEventListener() {} removeEventListener() {}
}
const inert = tag => ({ tagName: tag, style: {}, click() {}, remove() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, appendChild() {}, focus() {}, blur() {}, setSelectionRange() {} });
// The link a save is downloaded through and the file input a save is picked with (forge-rewrite ui/screens/save.js
// download, pickFile): their click() goes to the host (hooks.download, hooks.pick; ui.js hands them to Godot, which
// saves or opens the file). (Inert, Export and Import did nothing; 2026-10-30.)
const pageElement = tag => Object.assign(inert(tag), { click() { (tag === 'a' ? hooks.download : hooks.pick)?.(this); } });
if (typeof globalThis.Blob === 'undefined') globalThis.Blob = class Blob { constructor(parts = [], o = {}) { this.parts = parts; this.type = o.type ?? ''; } };
if (typeof globalThis.URL === 'undefined') globalThis.URL = class URL {};
if (typeof globalThis.URL.createObjectURL !== 'function') { let n = 0; globalThis.URL.createObjectURL = () => `blob:save-${++n}`; globalThis.URL.revokeObjectURL = () => {}; }
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: tag => (tag === 'canvas' ? new RecCanvas() : tag === 'a' || tag === 'input' ? pageElement(tag) : inert(tag)),
    getElementById: () => null, querySelector: () => null, addEventListener() {}, removeEventListener() {}, hidden: false,
    body: inert('body'), documentElement: inert('html'),
  };
}

export class Texture extends Emitter {
  constructor(o = {}) {
    super();
    this.uid = nextUid++;
    this.source = o.source ?? new TextureSource({ label: 'EMPTY' });
    this.label = o.label ?? this.source.label;
    this.frame = o.frame ? o.frame.clone?.() ?? new Rectangle(o.frame.x, o.frame.y, o.frame.width, o.frame.height) : new Rectangle(0, 0, this.source.width, this.source.height);
    this.orig = o.orig ?? new Rectangle(0, 0, this.frame.width, this.frame.height);
    this.trim = o.trim ?? null;
    this.defaultAnchor = o.defaultAnchor ?? null;
    this.defaultBorders = o.defaultBorders ?? null;
    this.rotate = o.rotate ?? 0;
    this.destroyed = false;
  }
  get width() { return this.orig.width; } get height() { return this.orig.height; }
  get baseTexture() { return this.source; }
  get textureSource() { return this.source; }
  update() {} updateUvs() {}
  destroy() { this.destroyed = true; }
  static from(src) {
    if (src instanceof Texture) return src;
    if (src instanceof TextureSource) return new Texture({ source: src });
    if (typeof src === 'string') return Assets.get(src) ?? loadPicture(src);
    const res = src?.resource ?? src;
    if (res && typeof res === 'object' && 'width' in res) {
      const k = src.resolution ?? 1;
      return new Texture({ source: new CanvasSource({ label: 'CANVAS', width: res.width / k, height: res.height / k, resource: res, scaleMode: src.scaleMode }) });
    }
    return Texture.EMPTY;
  }
}
Texture.EMPTY = new Texture({ source: new TextureSource({ label: 'EMPTY', width: 1, height: 1 }) });
Texture.WHITE = new Texture({ source: new TextureSource({ label: 'WHITE', width: 1, height: 1 }) });
export class RenderTexture extends Texture {
  static create(o = {}) { return new RenderTexture({ source: new TextureSource({ label: 'RENDER', width: o.width ?? 1, height: o.height ?? 1 }) }); }
}

export class Sprite extends Container {
  constructor(o) {
    const opts = o instanceof Texture ? { texture: o } : o ?? {};
    super(opts);
    this._anchor = new ObservablePoint();
    this._texture = opts.texture ?? Texture.EMPTY;
    if (opts.anchor !== undefined) this.anchor = opts.anchor;
    else if (this._texture.defaultAnchor) this.anchor = this._texture.defaultAnchor;
    this.roundPixels = !!opts.roundPixels;
    if (opts.width !== undefined) this.width = opts.width;
    if (opts.height !== undefined) this.height = opts.height;
  }
  static from(src) { return new Sprite(Texture.from(src)); }
  get anchor() { return this._anchor; }
  set anchor(v) { if (typeof v === 'number') this._anchor.set(v, v); else this._anchor.set(v.x, v.y); }
  get texture() { return this._texture; }
  set texture(t) { this._texture = t ?? Texture.EMPTY; }
  /** The quad pixi draws: the trimmed picture where its trim says, from the anchor of the whole. */
  _quad() {
    const t = this._texture, o = t.orig, tr = t.trim;
    if (tr) { const x = tr.x - this._anchor.x * o.width, y = tr.y - this._anchor.y * o.height; return [x, y, tr.width, tr.height]; }
    return [-this._anchor.x * o.width, -this._anchor.y * o.height, o.width, o.height];
  }
  _ownBounds() { const [x, y, w, h] = this._quad(); return new Bounds(x, y, x + w, y + h); }
  containsPoint(p) { const t = this._texture, x = -this._anchor.x * t.orig.width, y = -this._anchor.y * t.orig.height; return p.x >= x && p.x < x + t.orig.width && p.y >= y && p.y < y + t.orig.height; }
  get width() { return Math.abs(this.scale.x) * this._texture.orig.width; }
  set width(v) { const s = Math.sign(this.scale.x) || 1; this.scale.x = (v / (this._texture.orig.width || 1)) * s; }
  get height() { return Math.abs(this.scale.y) * this._texture.orig.height; }
  set height(v) { const s = Math.sign(this.scale.y) || 1; this.scale.y = (v / (this._texture.orig.height || 1)) * s; }
}

export class AnimatedSprite extends Sprite {
  constructor(textures, autoUpdate = true) {
    const list = Array.isArray(textures) ? textures : textures?.textures ?? [];
    const frames = list.map(t => (t instanceof Texture ? { texture: t, time: null } : t));
    super(frames[0]?.texture ?? Texture.EMPTY);
    this._frames = frames; this.animationSpeed = 1; this.loop = true; this.updateAnchor = false; this.playing = false;
    this._at = 0; this.onComplete = null; this.onFrameChange = null; this.onLoop = null; this.autoUpdate = autoUpdate;
    if (autoUpdate) Ticker.shared.add(this.update, this);
  }
  get textures() { return this._frames.map(f => f.texture); }
  set textures(v) { this._frames = v.map(t => (t instanceof Texture ? { texture: t, time: null } : t)); this._at = 0; this.texture = this._frames[0]?.texture; }
  get totalFrames() { return this._frames.length; }
  get currentFrame() { return Math.max(0, Math.min(this._frames.length - 1, Math.floor(this._at))); }
  set currentFrame(v) { this._at = v; this.texture = this._frames[this.currentFrame]?.texture; }
  play() { this.playing = true; } stop() { this.playing = false; }
  gotoAndStop(n) { this.stop(); this.currentFrame = n; } gotoAndPlay(n) { this.currentFrame = n; this.play(); }
  update(ticker) {
    if (!this.playing || !this._frames.length) return;
    const before = this.currentFrame;
    this._at += this.animationSpeed * (ticker?.deltaTime ?? 1);
    if (this._at >= this._frames.length) { if (this.loop) { this._at %= this._frames.length; this.onLoop?.(); } else { this._at = this._frames.length - 1; this.playing = false; this.onComplete?.(); } }
    if (this.currentFrame !== before) { this.texture = this._frames[this.currentFrame].texture; this.onFrameChange?.(this.currentFrame); }
  }
  destroy(o) { Ticker.shared.remove(this.update, this); super.destroy(o); }
}

export class NineSliceSprite extends Container {
  constructor(o = {}) {
    const opts = o instanceof Texture ? { texture: o } : o;
    super(opts);
    this.texture = opts.texture ?? Texture.EMPTY;
    const d = this.texture.defaultBorders ?? {};
    this.leftWidth = opts.leftWidth ?? d.left ?? 10; this.rightWidth = opts.rightWidth ?? d.right ?? 10;
    this.topHeight = opts.topHeight ?? d.top ?? 10; this.bottomHeight = opts.bottomHeight ?? d.bottom ?? 10;
    this._anchor = new ObservablePoint();
    this._w = opts.width ?? this.texture.width; this._h = opts.height ?? this.texture.height;
    this.roundPixels = !!opts.roundPixels;
  }
  get anchor() { return this._anchor; } set anchor(v) { if (typeof v === 'number') this._anchor.set(v, v); else this._anchor.set(v.x, v.y); }
  get width() { return this._w; } set width(v) { this._w = v; }
  get height() { return this._h; } set height(v) { this._h = v; }
  _ownBounds() { const x = -this._anchor.x * this._w, y = -this._anchor.y * this._h; return new Bounds(x, y, x + this._w, y + this._h); }
  containsPoint(p) { return this._ownBounds().containsPoint(p.x, p.y); }
}

export class TilingSprite extends Container {
  constructor(o = {}) {
    const opts = o instanceof Texture ? { texture: o } : o;
    super(opts);
    this.texture = opts.texture ?? Texture.EMPTY;
    this._w = opts.width ?? this.texture.width; this._h = opts.height ?? this.texture.height;
    this.tilePosition = new ObservablePoint(); this.tileScale = new ObservablePoint(1, 1); this._anchor = new ObservablePoint();
  }
  get anchor() { return this._anchor; } set anchor(v) { if (typeof v === 'number') this._anchor.set(v, v); else this._anchor.set(v.x, v.y); }
  get width() { return this._w; } set width(v) { this._w = v; }
  get height() { return this._h; } set height(v) { this._h = v; }
  _ownBounds() { const x = -this._anchor.x * this._w, y = -this._anchor.y * this._h; return new Bounds(x, y, x + this._w, y + this._h); }
}

// Meshes are drawn by the map only; here they stand in place.
export class Mesh extends Container {}
export class MeshRope extends Container {}
/** pixi's PerspectiveMesh: a texture drawn across a grid between four corners (top-left, top-right, bottom-right,
 *  bottom-left), with perspective. Kept as its texture and corners; ui2d.gd draws the grid. */
export class PerspectiveMesh extends Container {
  constructor(o = {}) {
    super();
    this.texture = o.texture ?? Texture.EMPTY;
    this.verticesX = o.verticesX ?? 10; this.verticesY = o.verticesY ?? 10;
    this.corners = [o.x0 ?? 0, o.y0 ?? 0, o.x1 ?? 100, o.y1 ?? 0, o.x2 ?? 100, o.y2 ?? 100, o.x3 ?? 0, o.y3 ?? 100];
  }
  setCorners(x0, y0, x1, y1, x2, y2, x3, y3) { this.corners = [x0, y0, x1, y1, x2, y2, x3, y3]; }
  _ownBounds() { const b = new Bounds(), c = this.corners; for (let i = 0; i < 8; i += 2) b.addPoint(c[i], c[i + 1]); return b; }
}
export class Geometry {}
export class Shader {}
export class GlProgram { static from() { return new GlProgram(); } }

// ---- filters

export class Filter { constructor(o = {}) { this.enabled = true; this.padding = 0; this.resolution = 1; this.blendMode = 'normal'; Object.assign(this, o ?? {}); } destroy() {} }
export class BlurFilter extends Filter {
  constructor(o = {}) { super(); this.strength = typeof o === 'number' ? o : o?.strength ?? 8; this.quality = o?.quality ?? 4; }
  get blur() { return this.strength; } set blur(v) { this.strength = v; }
  get blurX() { return this.strength; } set blurX(v) { this.strength = v; }
  get blurY() { return this.strength; } set blurY(v) { this.strength = v; }
}
export class AlphaFilter extends Filter { constructor(o = {}) { super(); this.alpha = typeof o === 'number' ? o : o?.alpha ?? 1; } }
export class ColorMatrixFilter extends Filter {
  constructor(o) { super(o); this.matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]; this.alpha = 1; }
  _load(m, multiply) { if (multiply) { const a = this.matrix, out = new Array(20); for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) { let v = c === 4 ? a[r * 5 + 4] : 0; for (let k = 0; k < 4; k++) v += m[r * 5 + k] * a[k * 5 + c]; if (c === 4) v += m[r * 5 + 4] - a[r * 5 + 4] + a[r * 5 + 4]; out[r * 5 + c] = v; } this.matrix = out; } else this.matrix = m; }
  brightness(b, multiply) { this._load([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0], multiply); }
  tint(c, multiply) { const [rgb] = colourOf(c); this._load([(rgb >> 16 & 255) / 255, 0, 0, 0, 0, 0, (rgb >> 8 & 255) / 255, 0, 0, 0, 0, 0, (rgb & 255) / 255, 0, 0, 0, 0, 0, 1, 0], multiply); }
  greyscale(s, multiply) { this._load([s, s, s, 0, 0, s, s, s, 0, 0, s, s, s, 0, 0, 0, 0, 0, 1, 0], multiply); }
  grayscale(s, m) { this.greyscale(s, m); }
  desaturate() { this.saturate(-1); }
  saturate(amount = 0, multiply) { const x = (amount * 2) / 3 + 1, y = (x - 1) * -0.5; this._load([x, y, y, 0, 0, y, x, y, 0, 0, y, y, x, 0, 0, 0, 0, 0, 1, 0], multiply); }
  contrast(amount, multiply) { const v = (amount || 0) + 1, o = -0.5 * (v - 1); this._load([v, 0, 0, 0, o, 0, v, 0, 0, o, 0, 0, v, 0, o, 0, 0, 0, 1, 0], multiply); }
  reset() { this.matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]; }
}

// ---- time

export class Ticker {
  constructor() { this._fns = []; this.deltaMS = 1000 / 60; this.deltaTime = 1; this.elapsedMS = this.deltaMS; this.lastTime = 0; this.speed = 1; this.started = true; this.autoStart = false; this.maxFPS = 0; this.minFPS = 10; }
  add(fn, ctx, priority = 0) { this._fns.push({ fn, ctx, once: false, priority }); return this; }
  addOnce(fn, ctx, priority = 0) { this._fns.push({ fn, ctx, once: true, priority }); return this; }
  remove(fn, ctx) { this._fns = this._fns.filter(x => x.fn !== fn || (ctx !== undefined && x.ctx !== ctx)); return this; }
  get count() { return this._fns.length; }
  get FPS() { return 1000 / this.deltaMS; }
  start() { this.started = true; } stop() { this.started = false; }
  destroy() { this._fns = []; }
  /** Runs every listener once, `ms` after the last (ui.js calls it as Godot's frames go by). */
  tick(ms) {
    this.deltaMS = ms * this.speed; this.elapsedMS = ms; this.deltaTime = this.deltaMS / (1000 / 60); this.lastTime += ms;
    for (const x of [...this._fns]) { if (!this._fns.includes(x)) continue; if (x.once) this._fns.splice(this._fns.indexOf(x), 1); x.fn.call(x.ctx, this); }
  }
  update(now) { this.tick(Math.max(0, (now ?? this.lastTime + 16.67) - this.lastTime)); }
}
Ticker.shared = new Ticker();
Ticker.system = new Ticker();
export const UPDATE_PRIORITY = { INTERACTION: 50, HIGH: 25, NORMAL: 0, LOW: -25, UTILITY: -50 };

// ---- loading

/** What the host can read: a path in the 2D game (forge-rewrite/), as the game names it ('assets/...'). */
export const files = { read: () => null, root: '' };
const norm = u => String(u).replace(/^https?:\/\/[^/]+\//, '').replace(/^\.?\//, '').split('?')[0];
const cache = new Map();
function loadPicture(url) {
  const src = norm(url), size = hooks.image(src) ?? { w: 1, h: 1 };
  const t = new Texture({ source: new ImageSource({ label: src, width: size.w, height: size.h }), label: src });
  cache.set(src, t);
  return t;
}
/** A pixi spritesheet from its frame data: a texture for each frame (trimmed as packed), the animations, the data. */
export function spritesheetOf(data, imagePath) {
  const m = data.meta ?? {}, res = m.scale ? Number(m.scale) || 1 : 1;
  const size = m.size ? { w: m.size.w, h: m.size.h } : hooks.image(imagePath);
  const source = new ImageSource({ label: imagePath, width: size.w / res, height: size.h / res });
  const textures = {};
  for (const [name, f] of Object.entries(data.frames ?? {})) {
    const fr = f.frame, frame = new Rectangle(fr.x / res, fr.y / res, (f.rotated ? fr.h : fr.w) / res, (f.rotated ? fr.w : fr.h) / res);
    const ss = f.sourceSize ?? { w: fr.w, h: fr.h }, orig = new Rectangle(0, 0, ss.w / res, ss.h / res);
    const trim = f.trimmed && f.spriteSourceSize ? new Rectangle(f.spriteSourceSize.x / res, f.spriteSourceSize.y / res, fr.w / res, fr.h / res) : null;
    textures[name] = new Texture({ source, frame, orig, trim, rotate: f.rotated ? 2 : 0, defaultAnchor: f.anchor ?? f.pivot ?? null, defaultBorders: f.borders ?? null, label: name });
  }
  const animations = {};
  for (const [name, list] of Object.entries(data.animations ?? {})) animations[name] = list.map(n => textures[n]).filter(Boolean);
  return { textures, animations, data, textureSource: source, linkedSheets: [], cachePrefix: '', destroy() {}, parse: async () => textures };
}
export const sheetLoaders = { sheet: () => null };   // ui.js: a sheet's frame data by its path ('sheets/x.json'), or null
function loadOne(u) {
  const url = norm(typeof u === 'object' ? u.src ?? u.alias ?? '' : u);
  if (cache.has(url)) return cache.get(url);
  if (/\.json$/.test(url)) {
    const sheetData = sheetLoaders.sheet(url);
    if (sheetData) {
      const dir = url.slice(0, url.lastIndexOf('/') + 1), sheet = spritesheetOf(sheetData, dir + (sheetData.meta?.image ?? url.replace(/\.json$/, '.webp').slice(dir.length)));
      cache.set(url, sheet);
      return sheet;
    }
    const text = files.read(url);
    const v = text ? JSON.parse(text) : null;
    cache.set(url, v);
    return v;
  }
  return loadPicture(url);
}
export const Assets = {
  cache: { get: k => cache.get(norm(k)), has: k => cache.has(norm(k)), set: (k, v) => cache.set(norm(k), v), remove: k => cache.delete(norm(k)) },
  loader: { parsers: [] }, resolver: { add() {}, resolve: k => ({ src: k }) },
  init: async () => {}, add() {}, addBundle() {}, setPreferences() {}, backgroundLoad: async () => {}, backgroundLoadBundle: async () => {},
  get(k) { if (Array.isArray(k)) return Object.fromEntries(k.map(x => [x, cache.get(norm(x))])); return cache.get(norm(k)); },
  load(urls) {
    try {
      if (Array.isArray(urls)) return Promise.resolve(Object.fromEntries(urls.map(u => [typeof u === 'object' ? u.src : u, loadOne(u)])));
      return Promise.resolve(loadOne(urls));
    } catch (e) { return Promise.reject(e); }
  },
  loadBundle: async () => ({}),
  unload(k) { for (const x of [].concat(k)) cache.delete(norm(typeof x === 'object' ? x.src : x)); return Promise.resolve(); },
  unloadBundle: async () => {},
};

// ---- the rest pixi exports, inert

export class Application { constructor() { this.stage = new Container(); this.ticker = Ticker.shared; this.renderer = { resolution: 1, screen: new Rectangle(0, 0, 1280, 800) }; } async init() {} render() {} destroy() {} }
export const ExtensionType = new Proxy({}, { get: (t, k) => String(k) });
export const LoaderParserPriority = new Proxy({}, { get: (t, k) => String(k) });
export const extensions = { add() {}, remove() {} };
export const DOMAdapter = { get: () => ({ createCanvas: (w = 1, h = 1) => ({ width: w, height: h, getContext: () => null }) }), set() {} };
