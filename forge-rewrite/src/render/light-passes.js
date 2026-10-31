// The lighting's side passes (lighting.js): the emission and hand-normal pictures of the bodies and props (F5's inputs),
// the ground cover picture (F4's), the Caverns' hanging stone under its own ground pass, the halos and the vignette
// (F6). ctx: { view, card, terrain, hang, under, vignette, glows, stats } from lighting.js, plus what it keeps current
// there: renderer, terrainHost, mode, plan, fieldWin.

import { Bounds, Container, Graphics, Matrix, RenderTexture, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import data from '../../data/lighting.json' with { type: 'json' };
import { lightLOS } from './light-grid.js';
import { cutNormal, forgeMask, grey, haloTexture, sizedTarget, vignetteTexture, whiteSilhouette } from './light-textures.js';

const P = data.rows.pipeline, FLAT_CARD = new RegExp(P.flatCard.of);

export function createPasses(ctx, normalFor) {
  const { view, card, terrain, hang, under, vignette, glows } = ctx;
  const normalTwins = new Container(), formTwins = new Container(), footTwins = new Container(), bowls = new Container(), halos = [], twins = [], forms = [], feet = [];
  let normalRT = null, formRT = null, footRT = null, emitRT = null, coverRT = null, coverFit = [0, 1, 1], coverKey = '', coverWin = null, coverTerrain = null, vigKey = '', moved = null;
  const emitBounds = new Bounds();
  let emitFloor = null, emitW = 0, emitH = 0, emitResolution = 0, emitLeft, emitTop, emitRight, emitBottom;
  // Bounds are current, including nested animation poses; forge masks use their existing map-space placement.
  const includeEmission = (c, mapSpace = false) => {
    if (c.destroyed || !c.visible || !c.renderable || !(c.alpha > 0)) return;
    const b = c.getBounds(false, emitBounds), s = mapSpace ? view.scale || 1 : 1;
    const x = mapSpace ? view.root.x : 0, y = mapSpace ? view.root.y : 0;
    const l = Math.max(0, b.minX * s + x), t = Math.max(0, b.minY * s + y);
    const r = Math.min(view.screenW, b.maxX * s + x), d = Math.min(view.screenH, b.maxY * s + y);
    if (r > l && d > t) { emitLeft = Math.min(emitLeft, l); emitTop = Math.min(emitTop, t); emitRight = Math.max(emitRight, r); emitBottom = Math.max(emitBottom, d); }
  };
  // Audit 332: paint is nested below its layer, and the camera hides chunks without adding/removing them. Listen to
  // those changes once, rather than scanning every blade each frame; wind/pose changes do not rebake the mask.
  let coverRevision = 0, coverDrawing = false, coverRoots = [];
  const coverWatched = new Set(), coverChanged = () => { if (!coverDrawing) coverRevision++; };
  const watchCover = c => {
    if (c.destroyed || coverWatched.has(c)) return;
    coverWatched.add(c); c.on('visibleChanged', coverChanged); c.on('destroyed', removeCover);
    if (!(c instanceof Sprite)) { c.on('childAdded', addCover); c.on('childRemoved', removeCover); }
    for (const child of c.children) watchCover(child);
  };
  const unwatchCover = c => {
    if (!coverWatched.delete(c)) return;
    c.off('visibleChanged', coverChanged); c.off('destroyed', removeCover);
    c.off('childAdded', addCover); c.off('childRemoved', removeCover);
    for (const child of c.children) unwatchCover(child);
  };
  const addCover = c => { watchCover(c); coverChanged(); }, removeCover = c => { unwatchCover(c); coverChanged(); };
  const take = (pool, parent, i) => (pool[i] ??= parent.addChild(new Sprite()));
  // A cover rebake changes the picture, not the lifetime of every wall-normal sprite in it.
  const coverClear = new Container(), coverPieces = new Container(), coverTwins = [], coverMasks = [];
  let coverOwner = null, coverFloor = null;
  const releaseCoverTwin = i => {
    const t = coverTwins[i]; t.mask = null; t.texture = Texture.EMPTY; t.visible = false;
    coverMasks[i]?.destroy(); coverMasks[i] = null;   // the source Graphics still owns its shared context
  };
  const clearCoverPieces = () => {
    for (let i = 0; i < coverTwins.length; i++) releaseCoverTwin(i);
    coverPieces.removeChildren().forEach(c => c.destroy()); coverTwins.length = coverMasks.length = 0;
    coverFloor = null;
  };
  glows.once('destroyed', () => {
    coverOwner?.off('destroyed', clearCoverPieces); clearCoverPieces(); coverOwner = null;
    coverPieces.destroy(); coverClear.destroy();
    emitRT?.destroy(true); emitRT = null;
  });
  /**
   * The normal maps and forms of every layer the card pass lights, the living's and the remains' under them (item 202,
   * Justin 2026-10-19: "corpses loose their shading": a corpse is lit as its body's last death frame was, each of its pieces
   * a body on its rest point), drawn where each sprite stands: a sprite with a normal map as its map
   * (mirrored with the sprite), and every sprite 1.7 gives a form (normal-lighting.js:59-67: every body, gear included,
   * and every prop without a map) as its silhouette, tinted with what the card pass needs to read its form at 1.7's
   * scale (1.7 masks each sprite at its own art's size): red a body, green the screen pixels a texel / 2, blue the hero
   * (his card is lit under his own lamp; his silhouettes are made at once, never held a frame). And every sprite's foot
   * (item 178): the row its body, plant or prop stands on (the bottom of a sprite's picture, a body's rest point), in red
   * at 32 a tile modulo 8 tiles, so the card pass lights each from its own foot as 1.7 lit each record from its own point;
   * in green, at the same scale, how many rows of floor its footprint covers behind that row (item 186: a 2x2 piece, a
   * size 2 body), which the card pass lights where they lie.
   * Each sprite is placed from its own transform this frame and its parents' up to the actors layer (item 163: Pixi's
   * worldTransform is the last render's, a frame behind a body on the move), as the shadow pass places its casters.
   * Returns how many maps, forms and feet.
   */
  const allow = { left: 0 }, cutsLeft = { left: 0 }, always = { left: Infinity }, top = new Matrix(), toWorld = new Matrix(), at = [0, 1, 2, 3, 4].map(() => new Matrix());
  function placeTwins(layers, actors, bodies, hero) {
    const res = view.resolution || 1;
    allow.left = 2; cutsLeft.left = 2;
    let n = 0, f = 0, ft = 0, W = toWorld, remains = false;
    const isBody = k => remains || bodies.has(k);
    const visit = (c, d, up, standsAt, behind, body, his) => {
      for (const k of c.children) {
        if (!k.visible || !(k.alpha > 0) || k.twins === false) continue;   // item 218: a finger over held gear (the body's frame, masked) has none
        const inBody = body || (d === 0 && isBody(k)), inHero = his || (d === 0 && k === hero);
        k.updateLocalTransform();
        const M = at[d].appendFrom(k.localTransform, up), drawn = !!k.texture?.source && k.texture !== Texture.EMPTY;
        // A body stands on its rest point; anything else on the bottom of what it draws (item 187: a door is one container
        // at the map's origin with its frame and leaf laid where they stand).
        const lb = d > 0 || isBody(k) ? null : k.getLocalBounds();
        const foot = d > 0 ? standsAt : lb && Number.isFinite(lb.maxY) ? M.b * (lb.minX + lb.maxX) / 2 + M.d * lb.maxY + M.ty : M.ty + (k.footY ?? 0) * M.d;
        const deep = d > 0 ? behind : (k.prop?.h ?? k.footRows ?? bodies.get(k) ?? 1) - 1;
        if (drawn) {
          const map = normalFor(k.texture), white = whiteSilhouette(k.texture, inHero ? always : allow);
          const nt = map && cutNormal(map, k.texture, M.a * M.d - M.b * M.c < 0, inHero ? always : cutsLeft);   // cut to its art, mirrored with it (item 258)
          if (nt) {
            const tw = take(twins, normalTwins, n++);
            tw.visible = true; tw.texture = nt;
            tw.anchor.copyFrom(k.anchor); tw.setFromMatrix(M);
            tw.scale.set(tw.scale.x * k.texture.width / nt.width, tw.scale.y * k.texture.height / nt.height);
          }
          if (white) {
            const fo = take(feet, footTwins, ft++);
            fo.visible = true; fo.texture = white; fo.anchor.copyFrom(k.anchor); fo.setFromMatrix(M);
            fo.tint = ((((Math.round(foot / view.tile * 32) % 256) + 256) % 256) << 16) | (Math.min(255, deep * 32) << 8) | (k.held ? 0xff : 0);   // item 218: blue, held gear
          }
          if (white && (inBody || !map) && !FLAT_CARD.test(k.texture.label ?? '')) {   // a front door's arch is wall, no form (item 280)
            const fm = take(forms, formTwins, f++), texel = Math.hypot(M.a * W.a + M.b * W.c, M.a * W.b + M.b * W.d) * res / (k.texture.source.resolution || 1);
            fm.visible = true; fm.texture = white; fm.anchor.copyFrom(k.anchor); fm.setFromMatrix(M);
            fm.tint = (inBody ? 0xff0000 : 0) | (Math.max(1, Math.min(255, Math.round(texel * 127.5))) << 8) | (inHero ? 0xff : 0);
          }
        }
        if (d < 4 && k.children.length) visit(k, d + 1, M, foot, deep, inBody, inHero);   // item 218: a held picture sits in its holder under the figure
      }
    };
    for (const layer of layers) { W = layer.getGlobalTransform(toWorld, false); remains = layer !== actors; visit(layer, 0, top, 0, 0, false, false); }
    for (let i = n; i < twins.length; i++) twins[i].visible = false;
    for (let i = f; i < forms.length; i++) forms[i].visible = false;
    for (let i = ft; i < feet.length; i++) feet[i].visible = false;
    return { n, f, ft };
  }

  return {
    /** Full-resolution normal, form and foot pictures; emission is equally sharp but cropped to visible glowing art. */
    sprites(layers, actors, hero) {
      const u = card.resources.card.uniforms.uEmit, k = card.resources.card.uniforms.uFormK, plan = ctx.plan, renderer = ctx.renderer;
      u[2] = 0; u[3] = 0; k[0] = 0;
      if (!actors) return;
      const sw = view.screenW, sh = view.screenH, full = view.resolution || 1, s = view.scale || 1;
      if (emitFloor !== ctx.floor || emitW !== sw || emitH !== sh || emitResolution !== full) {
        card.resources.uEmitTex = Texture.EMPTY.source; emitRT?.destroy(true); emitRT = null;
        emitFloor = ctx.floor; emitW = sw; emitH = sh; emitResolution = full;
      }
      u[0] = sw; u[1] = sh;
      const M = new Matrix(s, 0, 0, s, view.root.x, view.root.y);
      const placed = placeTwins(layers, actors, new Map(plan.casters.filter(c => !c.prop).map(c => [c.s.root, c.size ?? 1])), hero);
      if (placed.n) {
        normalRT = sizedTarget(normalRT, sw, sh, full);
        renderer.render({ container: normalTwins, target: normalRT, clear: true, clearColor: [0, 0, 0, 0], transform: M });
        card.resources.uNormTex = normalRT.source; u[3] = 1;
      }
      if (placed.f) {
        if (!formRT || formRT.width !== sw || formRT.height !== sh || formRT.source.resolution !== full) {
          formRT?.destroy(true);
          formRT = RenderTexture.create({ width: sw, height: sh, resolution: full, autoGenerateMipmaps: true, scaleMode: 'linear', mipmapFilter: 'linear' });
        }
        renderer.render({ container: formTwins, target: formRT, clear: true, clearColor: [0, 0, 0, 0], transform: M });
        formRT.source.updateMipmaps();
        card.resources.uFormTex = formRT.source; k[0] = 1;
      }
      footRT = sizedTarget(footRT, sw, sh, full);
      renderer.render({ container: footTwins, target: footRT, clear: true, clearColor: [0, 0, 0, 0], transform: M });
      card.resources.uFootTex = footRT.source;
      if (!plan.any) return;
      const bl = plan.bowls.filter(c => !c.destroyed && c.parent);
      if (bl.length) {
        bowls.removeChildren().forEach(b => b.destroy());
        for (const c of bl) { const b = new Sprite(forgeMask(c.texture)); b.position.copyFrom(c.position); b.scale.copyFrom(c.scale); b.tint = grey(0.95); bowls.addChild(b); }
      }
      emitLeft = sw; emitTop = sh; emitRight = emitBottom = 0;
      for (const c of plan.ems.keys()) if (c.parent === actors) includeEmission(c);
      if (bl.length) for (const b of bowls.children) includeEmission(b, true);
      if (!(emitRight > emitLeft && emitBottom > emitTop)) return;
      // Two physical pixels pad bilinear edges; 256-pixel capacity blocks grow only, avoiding camera/pose resize churn.
      const x = Math.floor(emitLeft * full) - 2, y = Math.floor(emitTop * full) - 2;
      const w = Math.min(Math.ceil(sw * full) + 4, Math.ceil((Math.ceil(emitRight * full) + 2 - x) / 256) * 256);
      const h = Math.min(Math.ceil(sh * full) + 4, Math.ceil((Math.ceil(emitBottom * full) + 2 - y) / 256) * 256);
      if (!emitRT || emitRT.source.pixelWidth < w || emitRT.source.pixelHeight < h)
        emitRT = sizedTarget(emitRT, Math.max(w, emitRT?.source.pixelWidth ?? 0) / full, Math.max(h, emitRT?.source.pixelHeight ?? 0) / full, full);
      card.resources.card.uniforms.uEmitWin.set([x / full, y / full, emitRT.width, emitRT.height]);
      M.tx -= x / full; M.ty -= y / full;
      const kids = actors.children, tints = kids.map(c => c.tint), own = kids.map(c => c.filters), filters = actors.filters;
      for (const c of kids) { const em = plan.ems.get(c); c.tint = em ? grey(em) : 0x000000; c.filters = null; }
      actors.filters = null;
      renderer.render({ container: actors, target: emitRT, clear: true, clearColor: [0, 0, 0, 0], transform: M });
      kids.forEach((c, i) => { c.tint = tints[i]; c.filters = own[i]; });
      actors.filters = filters;
      if (bl.length) {
        renderer.render({ container: bowls, target: emitRT, clear: false, transform: M });
      }
      card.resources.uEmitTex = emitRT.source; u[2] = 1;
    },

    /** The ground cover picture: the alpha of the terrain's paint layer (moss, ash, blood, water...), the ground layer
     *  (grass beds), the flat pieces (traps, stairs, rubble, loot: item 169, Justin 2026-10-18: "releif shading is
     *  paint over traps") over the whole floor, puddles left out (item 67: they keep the stone's relief). Drawn once a
     *  floor and again when their pieces or culled chunks change; the ground pass takes the stone's
     *  relief away under it, on the floor and on a face (1.7: flat-lit decals). And the walls' trim (rims, caps, door
     *  frames, the face ends) in its own relief picture (item 201, Justin 2026-10-19: "normal maps on new wall pieces seems
     *  missing or done incorrectly, and relief maps overlap upper lip"): each piece by its own map, flat where it has none,
     *  its chunk drawn whether the camera culls it or not, so no brick or mortar from under it shows and the ledge's
     *  relief, not the face's, lies over the lip; drawn again as the maps come in. Both lie in one picture, the trim in
     *  its top rows at twice the cover's sharpness, a clear gap of 2, the cover under it (item 225, Justin 2026-10-19:
     *  "something has gone wrong": a picture of its own made the ground program's 17th texture, over the 16 a GPU such
     *  as his allows, and the program never linked). */
    cover() {
      const CV = P.groundCover, fl = ctx.floor, relief = ctx.mode === 'relief';
      const host = ctx.terrainHost, ground = host?.children[0]?.children?.[0], trim = ground?.trim && !ground.trim.destroyed ? ground.trim : null;
      if (coverOwner !== ground || coverFloor !== fl) {
        coverOwner?.off('destroyed', clearCoverPieces); clearCoverPieces();
        coverOwner = ground; coverFloor = fl; coverOwner?.once('destroyed', clearCoverPieces);
      }
      // Every layer of the lit ground group over the terrain (the ground cover, the slime trail, the flat pieces), not two
      // fixed slots: the slime trail's layer had taken the flat pieces' slot (Justin 2026-10-19: "bed rolls have relief over them").
      const parts = [ground?.liquids, ...(host?.children.slice(1) ?? [])].filter(c => c && !c.destroyed && c.visible);
      if (coverRoots.length !== parts.length || parts.some((c, i) => c !== coverRoots[i])) {
        coverRoots.forEach(unwatchCover); coverRoots = parts; coverRoots.forEach(watchCover); coverRevision++;
      }
      const fit = () => { for (const f of [terrain, hang]) { const u = f.resources.terrain.uniforms.uCoverK; u[0] = parts.length && relief ? CV.share : 0; u[1] = relief ? coverFit[0] : 0; u[2] = coverFit[1]; u[3] = coverFit[2]; } };
      fit();
      if ((!parts.length && !trim) || !relief || !fl) return;
      const key = coverRevision + '|' + (trim?.children.length ?? 0) + '|' + normalFor.loads.count + '|' + fl.w + 'x' + fl.h;
      // Item 261 (Justin 2026-10-20: "revealing a hidden door leaves behind graphical artifacts"): a found door rebuilds the
      // terrain (map-floor.js setTerrain) with the same layers, a container a chunk, so a new terrain is drawn again too.
      if (key === coverKey && coverWin?.floor === fl && coverTerrain === ground) return;
      coverKey = key; coverTerrain = ground; coverWin = { x: 0, y: 0, w: fl.w, h: fl.h, floor: fl };
      // The flat pieces with relief maps of their own (a rug, a book pile; item 237, Justin 2026-10-20: "do these things
      // have shading yet?"): lit by them where they lie, as the trim is, over the floor's relief the cover takes away.
      const lying = [], seek = (c, x, y) => { for (const s of c.children) if (s instanceof Sprite) { if (s.visible && normalFor(s.texture)) lying.push([s, x, y]); } else if (s.visible && s.children?.length) seek(s, x + s.x, y + s.y); };
      if (ctx.flats && !ctx.flats.destroyed) seek(ctx.flats, 0, 0);
      const own = !!trim || lying.length > 0;   // the band of pieces lit by their own relief
      const cap = 4094 / Math.max(fl.w, fl.h), tl = view.tile, px = Math.min(CV.pxPerTile, cap), tp = own ? Math.min(2 * CV.pxPerTile, cap) : 0;
      const W = Math.ceil(fl.w * px), H = Math.ceil(fl.h * px), TW = Math.ceil(fl.w * tp), TH = Math.ceil(fl.h * tp), RW = Math.max(W, TW), RH = H + (own ? TH + 2 : 0);
      if (!coverRT || coverRT.width !== RW || coverRT.height !== RH) { coverRT?.destroy(true); coverRT = RenderTexture.create({ width: RW, height: RH, resolution: 1, scaleMode: 'linear' }); }
      coverFit = [TH / RH, W / RW, H / RH];
      const M = new Matrix(px / tl, 0, 0, px / tl, -coverWin.x * px, RH - H - coverWin.y * px), hidden = [];
      const hideMultiply = c => { if (c.blendMode === 'multiply' && c.visible) { c.visible = false; hidden.push(c); } for (const ch of c.children ?? []) hideMultiply(ch); };
      coverDrawing = true;   // this pass's temporary multiply exclusion must not invalidate its own cache
      try {
        parts.forEach(hideMultiply);
        ctx.renderer.render({ container: coverClear, target: coverRT, clear: true, clearColor: [0, 0, 0, 0] });
        parts.forEach(c => ctx.renderer.render({ container: c, target: coverRT, clear: false, transform: M }));
      } finally { for (const c of hidden) c.visible = true; coverDrawing = false; }
      for (const f of [terrain, hang]) { f.resources.uCover = coverRT.source; f.resources.terrain.uniforms.uCoverWin.set([coverWin.x, coverWin.y, coverWin.w, coverWin.h]); }
      fit();
      if (!own) { for (let i = 0; i < coverTwins.length; i++) releaseCoverTwin(i); return; }
      const flat = { left: Infinity }; let n = 0;
      const twin = (s, x, y) => {
        // A piece's map cut to its art (item 258), its tilt across turned for a mirrored piece (item 280, Justin 2026-10-20:
        // "weird shadow on door frame": a frame's right half, its left mirrored, leaned away from the torch beside it).
        const map = normalFor(s.texture), nt = map && cutNormal(map, s.texture, s.scale.x < 0);
        if (map && !nt) return;   // its pictures not readable yet
        const i = n++, t = take(coverTwins, coverPieces, i);
        t.visible = true; t.texture = nt ?? whiteSilhouette(s.texture, flat) ?? Texture.WHITE; t.scale.set(1);
        t.anchor.copyFrom(s.anchor); t.position.set(s.x + x, s.y + y); t.rotation = s.rotation; t.width = s.width; t.height = s.height; t.alpha = s.alpha;
        if (s.scale.x < 0) t.scale.x *= -1;   // a mirrored piece
        t.tint = nt ? 0xffffff : 0x8080ff;   // flat, or restore a reused mapped piece's neutral tint
        if (s.mask) {
          const mask = coverMasks[i] ??= coverPieces.addChild(new Graphics(s.mask.context));
          mask.context = s.mask.context; t.mask = mask;
        } else { t.mask = null; coverMasks[i]?.destroy(); coverMasks[i] = null; }
      };
      const walk = (c, x, y) => { for (const s of c.children) if (s instanceof Sprite) { if (s.visible && s.texture?.source) twin(s, x, y); } else if (s.children?.length) walk(s, x + s.x, y + s.y); };
      if (trim) walk(trim, 0, 0);
      for (const [s, x, y] of lying) twin(s, x, y);
      for (let i = n; i < coverTwins.length; i++) releaseCoverTwin(i);
      ctx.renderer.render({ container: coverPieces, target: coverRT, clear: false, transform: new Matrix(tp / tl, 0, 0, tp / tl, -coverWin.x * tp, -coverWin.y * tp) });
    },

    /** The Caverns' hanging stone (cave-terrain.js root.hanging) lit by its own pass under the bodies. */
    hanging(on) {
      const caveRoot = ctx.terrainHost?.children[0]?.children?.[0], hanging = caveRoot && !caveRoot.destroyed ? caveRoot.hanging : null;
      if (moved && moved.hanging !== hanging) { if (!moved.hanging.destroyed) moved.hanging.destroy({ children: true }); moved = null; }
      if (!hanging || hanging.destroyed) return;
      if (on && hanging.parent !== under) { under.addChildAt(hanging, 0); hanging.filters = [hang]; moved = { hanging }; }
      else if (!on && hanging.parent !== caveRoot) { caveRoot.addChild(hanging); hanging.filters = null; moved = null; }
      if (on) { const u = hang.resources.terrain.uniforms, v = terrain.resources.terrain.uniforms; u.uMap[0] = v.uMap[0]; u.uMap[1] = v.uMap[1]; u.uMap[2] = v.uMap[2]; u.uFieldWin.set(v.uFieldWin); hang.resources.uField = terrain.resources.uField; }
    },

    /** The vignette over the screen (1.7 render.js:2437-2440). */
    vignette() {
      const sw = view.screenW, sh = view.screenH, s = view.scale || 1;
      vignette.visible = !!view.lighting && sw > 0;
      if (!vignette.visible) return;
      const key = sw + 'x' + sh;
      if (key !== vigKey) { vigKey = key; vignette.texture?.destroy(true); vignette.texture = vignetteTexture(sw, sh, P.vignette); }
      vignette.position.set(-view.root.x / s, -view.root.y / s);
      vignette.width = sw / s; vignette.height = sh / s;
    },

    /** Halos (1.7 render.js:1363-1385): round a lamp prop or a burning tile, screened, cut to the tiles in sight it sees. */
    halos(lights, state, tile) {
      let gi = 0;
      const f = state.floor, W0 = f.w, H0 = f.h;
      for (const L of lights) {
        if (!L.halo || L.hero || !state.vis?.[L.ty * W0 + L.tx]) continue;
        const hx = L.tx, hy = L.ty, reach = L.halo.r * 1.13;
        let g = halos[gi++];
        if (!g) { g = new Sprite(); g.anchor.set(0.5); g.blendMode = 'screen'; g.clip = new Graphics(); glows.addChild(g, g.clip); g.mask = g.clip; halos.push(g); }
        g.texture = haloTexture(L.halo.r); g.visible = g.clip.visible = true; g.tint = (Math.round(L.c[0] * 255) << 16) | (Math.round(L.c[1] * 255) << 8) | Math.round(L.c[2] * 255);
        g.position.set((hx + 0.5) * tile, (hy + 0.5) * tile); g.width = g.height = 2 * L.halo.r * tile; g.size = g.width; g.alpha = L.halo.s; g.px = hx; g.py = hy;
        g.clip.clear();
        for (let y = Math.max(0, Math.floor(hy - reach)); y <= Math.min(H0 - 1, Math.ceil(hy + reach)); y++) for (let x = Math.max(0, Math.floor(hx - reach)); x <= Math.min(W0 - 1, Math.ceil(hx + reach)); x++)
          if (state.vis?.[y * W0 + x] && lightLOS(f, hx, hy, x, y)) g.clip.rect(x * tile, y * tile, tile, tile);
        g.clip.fill(0xffffff);
      }
      for (let k = gi; k < halos.length; k++) halos[k].visible = halos[k].clip.visible = false;
    },
    /** The halos breathe with their flames. */
    breathe(t, still) {
      for (const g of halos) {
        if (!g.visible) continue;
        const reach = still ? 1 : 1 + 0.08 * Math.sin(t / 170 + g.px * 3 + g.py * 7) + 0.05 * Math.sin(t / 53 + g.px);
        g.width = g.height = g.size * reach;
      }
    },
  };
}
