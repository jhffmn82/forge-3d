// The shadow mask (lighting-design.md F2): every caster in sight drawn each frame into one half-resolution picture over
// the window, which the ground pass multiplies by 1 - strength x mask (1.7 normal-lighting.js:86). 1.7's projected
// shadows (projected-shadows.js @3c8b312) as output, not code:
// - a body: its feet pressed flat under it at full (the contact), and its silhouette laid away from its one or two
//   strongest lights, fading to the tip, three faint feet stamps joining the two;
// - a solid prop: its outline as stacked rounded sections (its volume): the base sections at full, every section slid
//   away from the light by its height at 0.65, fading to nothing over one tail length;
// - a light never shadows its owner (the hero's lamp, a lamp prop's own flame, a glowing body's glow); daylight casts
//   one fixed way, short and weak; broad glows short and weak;
// - lights are known by who they are, so a cast eases (85 ms) as its light moves instead of jumping a step.
// Positions are map pixels (the root's own space); lights are tiles with a tile's corner on whole numbers, the same
// numbering, so nothing is shifted half a tile.

import { Container, Graphics, Matrix, RenderTexture, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import data from '../../data/lighting.json' with { type: 'json' };
import { maskFor, partsOf, hoverOval, loftParts, contactShape, castMesh, edgeAlong } from './shadow-shapes.js';

const SH = data.rows.pipeline.shadow;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = t => t * t * (3 - 2 * t);

/** Who a light is, so its casts keep their place in the history while it moves. */
const lightKey = L => (L.owner ? L.owner + ':' + L.kind : L.kind + ':' + L.tx + ',' + L.ty);

/**
 * The shadow mask. setLights after each light update (the shaded list and the admission picture); draw each frame.
 * draw returns { texture, win } (the mask and its window, tiles) for the ground pass. readable(source): whether a
 * texture's pixels can be read (the asset layer's, handed in).
 */
export function createShadows(readable = () => false) {
  // The mask in layers, as 1.7 composes it (projected-shadows.js:597-667): a caster's casts from its first, second and
  // retiring light go in slots 0, 1 and 2, a slot's shapes joined by max (a loft fills once) and the slots added (1.7
  // adds a caster's directions, 'lighter'); the contacts and the ruled wall band then join by max.
  const layer = () => ({ c: new Container(), pool: [], n: 0, k: 0 });
  const slots = [layer(), layer(), layer()], contacts = layer(), bandLayer = new Container();
  const slotSprite = new Sprite(), adder = new Container();
  slotSprite.blendMode = 'add'; adder.addChild(slotSprite);
  let rt = null, slotRT = null, lights = [], grid = null, heroId = null;
  const stats = { stamps: 0, casters: 0 };
  const history = new Map(), lastMask = new Map();
  const allow = { left: 0 };
  const take = L => { let s = L.pool[L.n]; if (!s) { s = new Sprite(); s.blendMode = 'max'; L.pool.push(s); L.c.addChild(s); } L.n++; L.k++; s.visible = true; return s; };
  const slotOf = j => slots[Math.min(j, slots.length - 1)];
  // A prop's loft is kept: its contact as a shape and each light's cast as a mesh, made again only when the prop's art,
  // size or place changes; a light moving only moves uniforms (rebuilding shapes each frame made c899b9e slow).
  const lofts = new Map();
  let frameNo = 0;
  const maxShape = () => { const g = new Graphics(); g.blendMode = 'max'; return g; };
  const place = (g, L) => { if (g.parent !== L.c) L.c.addChild(g); g.visible = true; L.k++; };
  const M = new Matrix(), P = new Matrix(), T = new Matrix(), C = new Matrix(), E = new Matrix(), J = new Matrix(), GR = new Matrix(), PMT = new Matrix(), rootInv = new Matrix();

  /** How much of light k reaches a point (tiles): its admission ramped across tile edges, times its falloff. */
  function weightOf(k, x, y) {
    const L = lights[k], A = grid.admission, w = grid.w, h = grid.h, byte = k >> 3, bit = 1 << (k & 7);
    const qx = x - 0.5, qy = y - 0.5, fx = Math.floor(qx), fy = Math.floor(qy), ux = clamp((qx - fx - 0.25) * 2, 0, 1), uy = clamp((qy - fy - 0.25) * 2, 0, 1);
    const at = (tx, ty) => (tx < 0 || ty < 0 || tx >= w || ty >= h ? 0 : (A[(ty * w + tx) * 4 + byte] & bit) ? 1 : 0);
    const adm = (at(fx, fy) * (1 - ux) + at(fx + 1, fy) * ux) * (1 - uy) + (at(fx, fy + 1) * (1 - ux) + at(fx + 1, fy + 1) * ux) * uy;
    if (adm <= 0) return 0;
    if (L.daylight) return adm * L.s;
    const d = Math.hypot(L.x - x, L.y - y);
    return d >= L.r ? 0 : adm * (1 - d / L.r) ** L.falloff * L.s;
  }

  /** The one or two lights that cast this caster's shadow now, direction and reach eased (1.7 lightFor). Each light is
   *  weighed where 1.7 weighs it (wx, wy: a body's tile centre, a prop's tile sample) and its nearness taken from the
   *  nearer of the cast's origin and the caster's tile centre (sx, sy) for a prop (projected-shadows.js:259-290). */
  function lightFor(id, owner, ox, oy, wx, wy, sx, sy, height, maxReach, moved, now) {
    const cands = [];
    for (let k = 0; k < lights.length; k++) {
      const L = lights[k];
      if (L.owner && L.owner === owner) continue;   // a light never shadows its own owner (projected-shadows.js:278)
      const w = weightOf(k, wx, wy);
      if (!(w > 0)) continue;
      const dist = sx == null ? Math.hypot(ox - L.x, oy - L.y) : Math.min(Math.hypot(ox - L.x, oy - L.y), Math.hypot(sx - L.x, sy - L.y));
      const fixed = L.shadow, near = fixed ? 1 : smoothstep(clamp((dist - SH.near[0]) / SH.near[1], 0, 1));
      const strength = (fixed ? fixed.strength : L.diffuse ? SH.diffuseStrength : 1) * near;
      if (strength <= 0) continue;
      cands.push({ k, key: lightKey(L), weight: w * strength, alpha: Math.sqrt(clamp(w / SH.alphaAt, 0, 1)) * strength });
    }
    const prior = history.get(id);
    if (!cands.length) { history.delete(id); return []; }
    let primary = cands.reduce((a, b) => (b.weight > a.weight ? b : a));
    const old = prior?.sources ?? [];
    const inc = old[0] && cands.find(c => c.key === old[0].key);
    if (inc && inc.weight >= primary.weight * 0.88) primary = inc;   // the lamp in place keeps its slot when nearly tied
    let secondary = null;
    for (const c of cands) if (c.key !== primary.key && (!secondary || c.weight > secondary.weight)) secondary = c;
    const t = secondary ? clamp((secondary.weight / primary.weight - 0.25) / 0.5, 0, 1) : 0, sw = secondary ? secondary.weight * smoothstep(t) : 0;
    const total = primary.weight + sw, desired = [{ c: primary, share: primary.weight / total }];
    if (sw > 0) desired.push({ c: secondary, share: sw / total });
    const elapsed = prior ? clamp(now - prior.time, 0, 100) : 100, blend = 1 - Math.exp(-elapsed / SH.blendMs);
    const sources = desired.map(({ c, share }) => {
      const L = lights[c.k], dx = ox - L.x, dy = oy - L.y, dist = Math.hypot(dx, dy), fixed = L.shadow;
      let angle = fixed ? Math.atan2(fixed.direction[1], fixed.direction[0]) : Math.atan2(dy, dx);
      const hh = clamp(height, 0.08, 2.4), sh = L.z ?? 1.1;
      const readable = clamp(hh * 0.8, 0.3, 0.65) * Math.min(1, dist / 0.8), physical = dist * hh * 0.22 / Math.max(0.65, sh - hh * 0.4);
      let length = clamp(Math.hypot(physical, readable), 0.05, Math.max(maxReach, readable * 1.2));
      if (fixed) length = Math.max(0.025, Math.min(maxReach, fixed.length * hh));
      else if (L.diffuse) length = Math.max(0.025, Math.min(maxReach, SH.diffuseLength * hh));
      length *= 0.88;
      const was = old.find(o => o.key === c.key);
      if (was) {
        const da = Math.atan2(Math.sin(angle - was.angle), Math.cos(angle - was.angle)), dl = length - was.length;
        // 1.7 (2026-10-14): a caster standing still keeps its cast until its light turns or reaches noticeably further.
        if (!moved && Math.abs(da) < SH.hold.angle && Math.abs(dl) <= SH.hold.length * Math.max(length, was.length) && Math.abs(c.alpha - was.alpha) < SH.hold.alpha) return { ...was, share };
        angle = was.angle + da * blend; length = was.length + dl * blend;
      }
      return { key: c.key, angle, length, alpha: c.alpha, share, diffuse: !!(fixed || L.diffuse) };
    });
    // A light that was casting and no longer is one of the two fades out over 120 ms while it still reaches.
    const rawElapsed = prior ? Math.max(0, now - prior.time) : 0;
    for (const o of old) {
      if (sources.some(q => q.key === o.key) || sources.length >= 2 || !cands.some(c => c.key === o.key)) continue;
      const left = (o.retire ?? 120) - rawElapsed;
      if (left > 0) sources.push({ ...o, retire: left, share: (o.share ?? 1) * left / (o.retire ?? 120) });
    }
    history.set(id, { sources, time: now });
    return sources;
  }

  /** A prop's loft this frame: its kept shapes, drawn again only when what they are drawn from changed. */
  function propLoft(id, m, toRoot, foot, anchor, sectionScale, depth, supportWidth, bodyHeight, srcs, fade, tile) {
    let rec = lofts.get(id);
    if (!rec) { rec = { sig: '', m: null, contact: maxShape(), casts: [] }; lofts.set(id, rec); }
    rec.frame = frameNo;
    const sig = [foot.x, foot.y, anchor.y, sectionScale, bodyHeight, fade].map(v => v.toFixed(3)).join(',');
    if (sig !== rec.sig || m !== rec.m) {
      stats.remade++; rec.sig = sig; rec.m = m; rec.parts = loftParts(m, toRoot, foot, sectionScale, depth, supportWidth, bodyHeight);
      rec.contact.clear(); if (rec.parts) contactShape(rec.contact, rec.parts, fade);
      for (const c of rec.casts) if (c) { c.geometry.destroy(); c.destroy(); }
      rec.casts = [];
    }
    if (!rec.parts) return;
    // This low stone ring needs a shallow contact tucked beneath its front stones.
    const firePit = id.endsWith(':kobold-campfire');
    rec.contact.scale.y = firePit ? 0.5 : 1;
    rec.contact.position.set(anchor.x, anchor.y - (firePit ? tile * 0.04 : 0)); place(rec.contact, contacts);
    srcs.forEach((L, j) => {
      let c = rec.casts[j];
      if (!c || c.diffuse !== !!L.diffuse) { if (c) { c.geometry.destroy(); c.destroy(); } c = rec.casts[j] = castMesh(rec.parts, !!L.diffuse); stats.meshes++; }
      const len = L.length * tile, ux = Math.cos(L.angle), uy = Math.sin(L.angle), u = c.shader.resources.loft.uniforms;
      u.uRay[0] = ux * len; u.uRay[1] = uy * len; u.uRay[2] = len; u.uRay[3] = edgeAlong(rec.parts, ux, uy);
      u.uLoft[0] = L.alpha * (L.share ?? 1) * fade;
      c.position.set(anchor.x, anchor.y); place(c, slotOf(j));
    });
    for (let j = srcs.length; j < rec.casts.length; j++) if (rec.casts[j]) rec.casts[j].visible = false;
  }

  return {
    stats,
    /** After each light update: the shaded lights (positions are moved per frame by the caller) and the grid. */
    setLights(ls, g, hero) { lights = ls; grid = g; heroId = hero; },
    /**
     * This frame's mask. casters: [{ id, s (an actor sprite: { root, texture }) or a prop sprite (prop: true), owner,
     * dead, flying, art, size, hero }]. win: the window in tiles. Returns { texture, win } or null.
     */
    draw(renderer, view, casters, win, now, band = null) {
      if (!grid || !renderer) return null;
      const tile = view.tile, k = clamp(SH.resolution * (view.scale || 1) * (view.resolution || 1), 0.1, 1);
      const W = Math.ceil(win.w * tile * k), H = Math.ceil(win.h * tile * k);
      if (!rt || rt.width !== W || rt.height !== H) { rt?.destroy(true); rt = RenderTexture.create({ width: W, height: H }); }
      view.root.getGlobalTransform(rootInv, false); rootInv.invert();
      allow.left = 2; stats.remade = 0; stats.meshes = 0;
      for (const L of [...slots, contacts]) { L.n = 0; L.k = 0; }
      frameNo++;
      stats.each = {};
      for (const c of casters) {
        const s = c.s;
        if (!s || s.destroyed || s.root.destroyed || !s.root.visible || !s.root.parent) continue;
        const { body, ellipse } = c.prop ? { body: s.root, ellipse: null } : partsOf(s);
        if (ellipse) ellipse.visible = false;
        const fade = clamp(s.root.alpha ?? 1, 0, 1);
        if (!body || !body.texture || body.texture === Texture.EMPTY) continue;
        let m = maskFor(body.texture, readable, allow);
        if (!m) m = lastMask.get(c.id);
        if (!m || m.empty) continue;
        lastMask.set(c.id, m);
        body.getGlobalTransform(M, false); M.prepend(rootInv);
        const fr = body.texture.frame, ax = body.anchor.x * fr.width, ay = body.anchor.y * fr.height, u = m.unit;
        T.set(1 / u, 0, 0, 1 / u, -m.pad / u - ax, -m.pad / u - ay);
        const toRoot = (x, y) => { const lx = x / u - ax, ly = y / u - ay; return { x: M.a * lx + M.c * ly + M.tx, y: M.b * lx + M.d * ly + M.ty }; };
        const foot = toRoot(m.supportX, m.bottom), head = toRoot(m.supportX, m.top);
        const pixelScale = Math.hypot(M.a, M.b) / u, supportWidth = m.supportWidth * pixelScale, bodyHeight = Math.max(1, foot.y - head.y);
        // 1.7's footprint bounds a body's contact: the hero 0.28 x 0.10, a body 0.26 x art by 0.09 (render.js:1072).
        const fp = c.prop ? { rx: 99, ry: 99 } : c.hero ? { rx: 0.28, ry: 0.1 } : { rx: 0.26 * (c.art ?? 0.9) * (c.size ?? 1), ry: 0.09 * (c.size ?? 1) };
        const depth = Math.max(tile * 0.035, Math.min(supportWidth * 0.36, bodyHeight * 0.35, fp.ry * 1.8 * tile));
        // The cast starts 0.3 of the depth up from the foot; a solid prop's at least as far up as its rounded base's lip.
        const solid = c.prop && !c.silhouette;
        const inset = solid ? Math.max(depth * 0.3, Math.min(depth, m.baseInset * bodyHeight / Math.max(1, m.bottom - m.top))) : depth * 0.3;
        // A body stands on its fixed ground point: where map-view stands it, its lunge kept and its hop not, so its
        // contact never bobs with the frame (1.7 render.js:1135, rp + groundY); its art's feet set only the projection.
        let ground = foot;
        if (!c.prop) { s.root.getGlobalTransform(GR, false); GR.prepend(rootInv); ground = { x: GR.tx, y: GR.ty + (s.root.hop ?? 0) }; }
        const anchor = { x: ground.x, y: ground.y - inset };
        // The anchor in tiles: root pixels over the tile size (corner numbering, as the lights).
        const ox = anchor.x / tile, oy = anchor.y / tile, maxReach = clamp(0.25 + supportWidth / tile * 0.35, 0.3, 1.1);
        const hist = history.get(c.id), moved = !hist?.at || Math.abs(hist.at.x - anchor.x) > 0.01 || Math.abs(hist.at.y - anchor.y) > 0.01;
        // A fallen body: its cast collapses onto its own outline (1.7 shadowResting). Item 213: so does a body playing its
        // death clip, which the light plan (made again on a sight change) may still call alive.
        const rest = c.dead || s.action === 'death' ? 1 : 0;
        // Where 1.7 weighs the lights: a body at its tile centre as it slides (a sixth of a tile above its feet, map-view's
        // lift), a prop at its tile's admission sample (the lower right quarter; projected-shadows.js:249-251, :259).
        const T0 = c.tile, wx = T0 ? T0.x + 0.75 : ground.x / tile, wy = T0 ? T0.y + 0.75 : ground.y / tile - 1 / 6;
        const srcs = lightFor(c.id, c.owner, ox, oy, wx, wy, T0 ? T0.x + 0.5 : null, T0 ? T0.y + 0.5 : null, (bodyHeight / tile * (c.silhouette ? 1 : 0.8)) * (1 - rest) + 0.1 * rest, maxReach * (1 - rest) + 0.16 * rest, moved, now);
        const h2 = history.get(c.id); if (h2) h2.at = { x: anchor.x, y: anchor.y };
        (stats.each ??= {})[c.id] = { at: [+ox.toFixed(2), +oy.toFixed(2)], srcs: srcs.map(L => ({ key: L.key, ang: +(L.angle * 180 / Math.PI).toFixed(0), len: +L.length.toFixed(2), a: +L.alpha.toFixed(2), share: L.share })) };
        if (rest) { const r0 = take(contacts); r0.texture = m.sil; r0.anchor.set(0); r0.setFromMatrix(PMT.copyFrom(M).append(T)); r0.alpha = fade; continue; }
        if (c.flying) {
          // A flyer has no cast joined to the floor: a soft oval under it, sliding 0.3 of the cast away from its light.
          const o = take(contacts), L0 = srcs[0];
          o.texture = hoverOval(); o.anchor.set(0.5); o.rotation = 0; o.skew.set(0, 0);
          o.width = fp.rx * 2.3 * tile; o.height = fp.ry * 3.4 * tile;
          o.position.set(ground.x + (L0 ? Math.cos(L0.angle) * L0.length * tile * 0.3 : 0), ground.y + (L0 ? Math.sin(L0.angle) * L0.length * tile * 0.3 : 0));
          o.alpha = 0.7 * fade;
          continue;
        }
        if (solid) {
          propLoft(c.id, m, toRoot, foot, anchor, pixelScale, depth, supportWidth, bodyHeight, srcs, fade, tile);
          stats.each[c.id].loft = { base: m.volume.base.map(i => +(m.volume.nodes[i].r * pixelScale / tile).toFixed(3)), depth: +(depth / tile).toFixed(3), support: +(supportWidth / tile).toFixed(3), height: +(bodyHeight / tile).toFixed(3), mask: [m.w, m.h, m.left, m.top, m.right, m.bottom] };
          continue;
        }
        // A body: its feet pressed to the footprint's depth, their front lip a little before the anchor; its silhouette
        // laid away from each light, then three faint feet stamps joining the two (1.7: t = .25, .5, .75 at .25).
        // As wide as its feet, at most its footprint (1.7 projected-shadows.js:433-435: the 1.2 x support cap is for casters
        // without a footprint, and every body has one).
        const flip = Math.sign(M.a || 1), footWidth = m.footW * pixelScale, fw = Math.min(footWidth, c.silhouette ? supportWidth * 1.2 : fp.rx * 2 * tile);
        const frontLip = Math.min(depth * 0.4, tile * 0.055), footBack = 0.7 - frontLip / depth;
        const sx = (fw / m.footW) * flip, sy = depth / m.footH, axPx = m.pad + (m.supportX - m.footLeft), ayPx = m.pad + m.footH * footBack;
        C.set(sx, 0, 0, sy, anchor.x - sx * axPx, anchor.y - sy * ayPx);
        srcs.forEach((L, j) => {
          const to = slotOf(j), away = { x: Math.cos(L.angle) * L.length * tile, y: Math.sin(L.angle) * L.length * tile };
          const wx = Math.sin(L.angle), wy = -Math.cos(L.angle), a = L.alpha * (L.share ?? 1);
          P.set(wx * 0.88, wy * 0.88, -away.x / bodyHeight, -away.y / bodyHeight, 0, 0);
          P.tx = anchor.x - (P.a * foot.x + P.c * foot.y); P.ty = anchor.y - (P.b * foot.x + P.d * foot.y);
          PMT.copyFrom(P).append(M).append(T);
          const cs = take(to);
          cs.texture = L.diffuse ? m.castDiffuse : m.cast; cs.anchor.set(0); cs.setFromMatrix(PMT); cs.alpha = a * fade;
          E.copyFrom(PMT).append(J.set(1, 0, 0, 1, m.footLeft, m.footTop));
          for (const t of c.silhouette ? [0, 0.25, 0.5, 0.75] : [0.25, 0.5, 0.75]) {
            const st = take(to);
            st.texture = m.feet; st.anchor.set(0);
            st.setFromMatrix(J.set(C.a + (E.a - C.a) * t, C.b + (E.b - C.b) * t, C.c + (E.c - C.c) * t, C.d + (E.d - C.d) * t, C.tx + (E.tx - C.tx) * t, C.ty + (E.ty - C.ty) * t));
            st.alpha = (c.silhouette ? 0.5 : 0.25) * a * fade;
          }
        });
        const ct = take(contacts); ct.texture = m.feet; ct.anchor.set(0); ct.setFromMatrix(C); ct.alpha = fade;
      }
      // A prop not drawn this frame: its shapes hidden, and let go once it has been gone a while.
      for (const [id, rec] of lofts) {
        if (rec.frame === frameNo) continue;
        rec.contact.visible = false; for (const g of rec.casts) if (g) g.visible = false;
        if (frameNo - rec.frame > 600) { rec.contact.destroy(); for (const g of rec.casts) if (g) { g.geometry.destroy(); g.destroy(); } lofts.delete(id); }
      }
      let stamps = 0;
      for (const L of [...slots, contacts]) { for (let i = L.n; i < L.pool.length; i++) L.pool[i].visible = false; stamps += L.k; }
      stats.stamps = stamps; stats.casters = casters.length; stats.masks = 2 - allow.left;
      const view0 = new Matrix(k, 0, 0, k, -win.x * tile * k, -win.y * tile * k);
      let cleared = false;
      const into = c => { renderer.render({ container: c, target: rt, clear: !cleared, clearColor: [0, 0, 0, 0], transform: view0 }); cleared = true; };
      for (const L of slots) {
        if (!L.k) continue;
        if (!cleared) { into(L.c); continue; }   // the first slot straight into the cleared mask
        if (!slotRT || slotRT.width !== W || slotRT.height !== H) { slotRT?.destroy(true); slotRT = RenderTexture.create({ width: W, height: H }); }
        renderer.render({ container: L.c, target: slotRT, clear: true, clearColor: [0, 0, 0, 0], transform: view0 });
        slotSprite.texture = slotRT;
        renderer.render({ container: adder, target: rt, clear: false });
      }
      into(contacts.c);
      // The ruled wall band (Justin 2026-10-17, item 107; it darkens the ground's light as a shadow does, at its own
      // depth: drawn at band / strength so the ground pass's 1 - strength x mask gives it back), by max.
      if (band) { bandLayer.removeChildren(); bandLayer.addChild(band); into(bandLayer); }
      this.last = { texture: rt, win, k, tile };   // dev probes
      return this.last;
    },
    /** Shows the actor sprites' own ellipses again (lighting off) or hides them. */
    ellipses(view, ids, on) { for (const id of ids) { const s = view.sprite(id); if (!s || s.destroyed) continue; const { ellipse } = partsOf(s); if (ellipse) ellipse.visible = !on; } },
  };
}
