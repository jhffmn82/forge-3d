// Lighting and shadows (lighting-design.md): one pipeline, worked out where it is drawn, every frame.
// Per step (update, on sight, terrain, floor or light changes): the light list (lights.js) and the per-step pictures
// (light-grid.js), uploaded at once. Per frame (frame, after the camera): lights placed where their bodies stand (F1),
// the shadow mask (F2, shadows.js), the light field (F3), then Pixi draws the ground through the ground pass (F4) and the
// bodies and props through the card pass (F5); glows, bloom and the vignette (F6) go over them. No bakes.
// The outward face is what map-view uses: root (over the bodies), under (between ground and bodies), flats (flat pieces,
// lit as the floor), unlit (gear and food at their painted colour), over (the vignette, over the beacons, fog and
// effects, as 1.7 drew it last), terrainHost, actorFilters, mode, update, frame, trail, flash, stats.

import { Container, Filter, Geometry, GlProgram, Mesh, Rectangle, RenderTexture, Shader, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import data from '../../data/lighting.json' with { type: 'json' };
import { gatherLights } from './lights.js';
import { buildGrid } from './light-grid.js';
import { wallBand } from './wall-band.js';
import { createShadows } from './shadows.js';
import { MAX_LIGHTS, FILTER_VERTEX, MESH_VERTEX, FIELD_FRAGMENT, BLOOM_FRAGMENT } from './light-glsl.js';
import { TERRAIN_FRAGMENT } from './ground-glsl.js';
import { CARD_FRAGMENT } from './card-glsl.js';
import { planeVeinLights } from './plane-lights.js';
import { dataTexture, upload, glowTexture, keepTargetAfterCache } from './light-textures.js';
import { createNormalSets, createHandNormals } from './light-normals.js';
import { createPlanner, emptyPlan } from './light-plan.js';
import { createPasses } from './light-passes.js';

const P = data.rows.pipeline, S = P.samplesPerTile, FL = P.flicker, RL = data.rows.relief, WS = P.waterShimmer;
/** The ground's water shimmer on this floor: none on a plane, whose pools sparkle instead (item 214, plane-anim.js poolSparkles). */
export const shimmerStrength = f => (WS.on && !f?.plane ? WS.strength : 0);
const RELIEF_ON = RL?.on !== false;
const UNLIT = new Set(['food', 'weapon', 'armour', 'armor', 'offhand', 'off', 'ring', 'amulet']);
const quad = () => new Geometry({ attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1], aUV: [0, 0, 1, 0, 1, 1, 0, 1] }, indexBuffer: [0, 1, 2, 0, 2, 3] });
const v4 = (a = [0, 0, 0, 0]) => ({ value: new Float32Array(a), type: 'vec4<f32>' });

/**
 * @param {*} clock the animation clock
 * @param {() => any} viewOf map-view's view (camera, root, screen size, scale, tile, resolution, lighting, sprite, follow)
 * @param {{sheet: Function, hasSheet: Function, readable: Function}} assets the asset layer's sheet lookups and whether a
 *   texture's pixels can be read (handed in: render does not import the platform layer)
 */
export function createLighting(clock, viewOf, assets) {
  const view = new Proxy({}, { get: (_, k) => viewOf()[k] });
  const root = new Container(), under = new Container(), flats = new Container(), unlit = new Container(), over = new Container(), glows = new Container(), sparks = new Container();
  let lastState = null, grid = null, frameOnClock = false, drivenFrame = false, t = 0, unlinked = false;
  // Timings for the probes: the last update and frame, the slowest update, why the grid last redid everything, and the
  // last frame's passes (shadow mask, ground cover, sprite pictures, the rest; masks and lofts made that frame).
  const stats = { updates: 0, updateMs: 0, updateMsMax: 0, fullBuilds: [], frameMs: 0, lights: 0, folded: 0, shadowStamps: 0,
    parts: { shadow: 0, cover: 0, sprites: 0, rest: 0, masks: 0, remade: 0, meshes: 0 } };
  const shadows = createShadows(assets.readable);

  // The per-step pictures and the light arrays (shared by every pass).
  const admitT = dataTexture(true), surfT = dataTexture(true), ambT = dataTexture(false), bandT = dataTexture(false), fineT = dataTexture(true);
  const bandSprite = new Sprite();
  let band = null, bandBytes = null, bandLook = null;
  const grade = new Float32Array(4);   // item 254: vibrance, contrast, pivot (the world's colour grade, every lit pass)
  const lpos = new Float32Array(MAX_LIGHTS * 4), lcol = new Float32Array(MAX_LIGHTS * 4), lday = new Float32Array(MAX_LIGHTS * 4), baseCol = new Float32Array(MAX_LIGHTS * 4);
  let shaded = [];
  const shared = () => ({
    uFloor: v4([1, 1, S, 0]), uShade: v4([P.diffuseFloor, P.limitKnee, P.wallHeight, P.faceShare]), uGrain: v4([P.grain.base, P.grain.span, P.grain.scale, 0]),
    uCount: { value: 0, type: 'i32' },
    uLPos: { value: lpos, type: 'vec4<f32>', size: MAX_LIGHTS }, uLCol: { value: lcol, type: 'vec4<f32>', size: MAX_LIGHTS }, uLDay: { value: lday, type: 'vec4<f32>', size: MAX_LIGHTS },
    uKnee: { value: new Float32Array([P.finalKnee.floor, P.finalKnee.top]), type: 'vec2<f32>' }, uGrade: { value: grade, type: 'vec4<f32>' },
    uStack: v4([P.stack.knee, P.stack.cap, 0, 0]),   // item 271: how the placed lights on a pixel add
  });
  const flat = Texture.WHITE.source, none = Texture.EMPTY.source;
  const sharedTex = { uAdmit: none, uSurf: none, uAmb: none };

  // F3: the light field over the window, 2 samples a tile, stored at half.
  const fieldGeo = quad();
  const fieldShader = new Shader({ glProgram: GlProgram.from({ vertex: MESH_VERTEX, fragment: FIELD_FRAGMENT, name: 'light-field' }),
    resources: { field: { ...shared(), uWin: v4(), uBleed: v4([P.bleed.brick, P.lightCeiling, 0, 0]) }, ...sharedTex } });
  const fieldQuad = new Mesh({ geometry: fieldGeo, shader: fieldShader });
  let fieldRT = null;

  // F4: the ground (and the Caverns' hanging stone, the same program, its hang flag on).
  const terrainRes = () => ({
    terrain: { ...shared(), uMap: v4(), uFieldWin: v4([0, 0, 1, 1]), uShadowWin: v4([0, 0, 1, 1]), uShadowK: v4([P.shadow.strength, 0, 0, 0]),
      uCoverWin: v4([0, 0, 1, 1]), uCoverK: v4([0, 0, 1, 1]), uGrid: { value: new Float32Array(16).fill(1), type: 'vec4<f32>', size: 4 },
      uSetK: { value: new Float32Array(16), type: 'vec4<f32>', size: 4 }, uAreaSet: { value: new Float32Array(8), type: 'vec4<f32>', size: 2 },
      uGain: v4([P.groundNormalGain, P.trimRelief.share, P.flatRelief.share, 0]), uTrimKey: v4([...P.trimKey.dir, P.trimKey.share]), uLip: v4([P.lip.rows, P.lip.share, 0, 0]), uFineK: v4(), uWater: v4([P.waterShimmer.on ? P.waterShimmer.strength : 0, P.waterShimmer.sharp, 0.5, 0]) },
    ...sharedTex, uField: none, uShadow: none, uCover: none, uFine: flat, uN0: flat, uF0: flat, uN1: flat, uF1: flat, uN2: flat, uF2: flat, uN3: flat, uF3: flat,
  });
  const groundFilter = () => new Filter({ glProgram: GlProgram.from({ vertex: FILTER_VERTEX, fragment: TERRAIN_FRAGMENT, name: 'light-ground' }), resources: terrainRes(), resolution: 'inherit' });
  const terrain = groundFilter(), hang = groundFilter();
  hang.resources.terrain.uniforms.uMap[3] = 1;
  // F5: bodies and props.
  const card = new Filter({ glProgram: GlProgram.from({ vertex: FILTER_VERTEX, fragment: CARD_FRAGMENT, name: 'light-card' }),
    resources: { card: { ...shared(), uScreen: v4(), uForm: v4([P.form, P.cardNormalGain, P.cardZPerTile, 0]), uHero: v4([-99, -99, P.heroSelfLight, P.ownLightHeight.hero]),
      uEmit: v4(), uEmitWin: v4([0, 0, 1, 1]), uFormK: v4([0, P.groundNormalGain, 0, 0]), uFieldWin: v4([0, 0, 1, 1]) }, ...sharedTex, uEmitTex: flat, uNormTex: flat, uFormTex: none, uFootTex: none, uField: none },
    resolution: 'inherit' });
  const programs = [fieldShader.resources.field, terrain.resources.terrain, hang.resources.terrain, card.resources.card];
  const bindShared = (key, src) => { for (const r of [fieldShader.resources, terrain.resources, hang.resources, card.resources]) r[key] = src; };

  // F6: bloom from the field, drawn added at the field's window; glows, the vignette, a shot's sparks.
  const bloomShader = new Shader({ glProgram: GlProgram.from({ vertex: MESH_VERTEX, fragment: BLOOM_FRAGMENT, name: 'light-bloom' }),
    resources: { bloom: { uBloom: v4([P.bloom.threshold, P.bloom.gain, P.bloom.cap, P.bloom.alpha]) }, uField: none } });
  const bloomGeo = quad(), bloom = new Mesh({ geometry: bloomGeo, shader: bloomShader }), vignette = new Sprite();
  bloom.blendMode = 'add';
  root.addChild(bloom, glows, sparks);
  over.addChild(vignette);

  const normalFor = createHandNormals(assets), normals = createNormalSets([terrain, hang], view, assets), planner = createPlanner(view, assets);
  // What the side passes read, kept current here.
  const ctx = { view, card, terrain, hang, under, vignette, glows, flats, stats, renderer: null, terrainHost: null, mode: 'relief', plan: emptyPlan(), fieldWin: { x: 0, y: 0, w: 1, h: 1 } };
  const passes = createPasses(ctx, normalFor);
  let replan = true;

  /** The floor in view now plus a margin, in tiles. */
  const windowNow = margin => {
    const tl = view.tile, s = view.scale || 1, hw = view.screenW / 2 / s / tl, hh = view.screenH / 2 / s / tl, cx = view.camera.x / tl, cy = view.camera.y / tl;
    return { x: Math.floor(cx - hw - margin), y: Math.floor(cy - hh - margin), w: Math.ceil(hw * 2 + margin * 2) + 1, h: Math.ceil(hh * 2 + margin * 2) + 1 };
  };
  const filterRect = new Rectangle();

  // Where map-view stands a body on its tile (map-view.js centre: its feet a third of a tile up from the tile's foot).
  const centre = (x, y) => ({ x: (x + 0.5) * view.tile, y: (y + 1) * view.tile - (view.look === 'blocks' ? 0 : view.tile / 3) });
  // F1: each shaded light where it is this frame: a light that moves with a body takes that body's offset from its tile
  // (its rest point: the slide the camera follows, no hop or lunge), flicker and breath on its strength.
  function placeLights(dt) {
    t += dt * (lastState?.floor?.biome === 'crypt' ? 0.5 : 1);
    const st = lastState;
    for (let k = 0; k < shaded.length; k++) {
      const L = shaded[k];
      let x = L.x, y = L.y;
      if (L.follow != null && st) {
        const sp = view.sprite(L.follow), a = st.actors?.[L.follow];
        const at = sp && (clock.pos?.(sp) ?? (sp.root ? { x: sp.root.x - (sp.root.offX ?? 0), y: sp.root.y + (sp.root.hop ?? 0) - (sp.root.offY ?? 0) } : null));
        if (at && a) { const c0 = centre(a.x, a.y); x += (at.x - c0.x) / view.tile; y += (at.y - c0.y) / view.tile; }
      }
      lpos[k * 4] = x; lpos[k * 4 + 1] = y;
      let f = 1;
      if (!clock.reduced) {
        if (L.pulse) f = L.pulseAmp ? 1 + L.pulseAmp * Math.sin(t / L.pulse + 1.3 * L.tx + L.ty) : 0.8 + 0.2 * Math.sin(t / L.pulse + 1.3 * L.tx + L.ty);
        else if (L.flicker) { const seed = L.tx * 7 + L.ty; f = 1 + FL.a * Math.sin(t / FL.aMs + seed * 1.7) + FL.b * Math.sin(t / FL.bMs + seed * 3.1); }
      }
      for (let c = 0; c < 3; c++) lcol[k * 4 + c] = baseCol[k * 4 + c] * f;
    }
    if (!st) return;
    const hs = view.sprite(st.playerId), a = st.actors?.[st.playerId];
    const at = hs && (clock.pos?.(hs) ?? (hs.root ? { x: hs.root.x, y: hs.root.y } : null));
    const u = card.resources.card.uniforms.uHero;
    if (at && view.tile) { u[0] = at.x / view.tile; u[1] = at.y / view.tile; } else if (a) { u[0] = a.x + 0.5; u[1] = a.y + 0.667; }
  }

  function frame(dt) {
    const t0 = performance.now(), renderer = ctx.renderer, host = ctx.terrainHost, mode = ctx.mode;
    if (!view.lighting || unlinked || !renderer || !grid) { if (host?.filters) host.filters = null; passes.hanging(false); vignette.visible = false; return; }
    placeLights(dt);
    const tl = view.tile, s = view.scale || 1, rx = view.root.x, ry = view.root.y;
    // F2: the shadow mask over the window: the wall band, and in relief every caster's shadow (1.7 casts in its
    // dimensional look only).
    const win = windowNow(1);
    if (replan && lastState) { ctx.plan = planner.plan(lastState); replan = false; }
    const casters = mode === 'relief' ? ctx.plan.casters.filter(c => !c.s.root?.destroyed && c.s.root?.parent) : [];
    const shownBand = band?.visible ? band : null;
    const tA = performance.now(), mask = casters.length || shownBand ? shadows.draw(renderer, view, casters, win, tA, shownBand) : null, tB = performance.now();
    stats.shadowStamps = shadows.stats.stamps;
    // F3: the light field over the window and a margin.
    const fw = windowNow(3);
    ctx.fieldWin = fw;
    passes.cover();
    const tC = performance.now();
    const W = fw.w * S, H = fw.h * S;
    if (!fieldRT || fieldRT.width !== W || fieldRT.height !== H) { fieldRT?.destroy(true); fieldRT = RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: 'linear' }); }
    fieldShader.resources.field.uniforms.uWin.set([fw.x, fw.y, fw.w, fw.h]);
    for (const g of [fieldGeo, bloomGeo]) { const b = g.getAttribute('aPosition').buffer; b.data = new Float32Array([0, 0, W, 0, W, H, 0, H]); b.update(); }
    renderer.render({ container: fieldQuad, target: fieldRT, clear: true });
    // F4, F5: placement with this frame's root.
    for (const f of [terrain, hang]) {
      const u = f.resources.terrain.uniforms;
      u.uMap[0] = rx; u.uMap[1] = ry; u.uMap[2] = 1 / (s * tl);
      u.uFieldWin.set([fw.x, fw.y, fw.w, fw.h]); f.resources.uField = fieldRT.source;
      if (mask) { u.uShadowWin.set([mask.win.x, mask.win.y, mask.win.w, mask.win.h]); f.resources.uShadow = mask.texture.source; u.uShadowK[0] = P.shadow.strength; }
      else u.uShadowK[0] = 0;
      u.uGain[3] = mode === 'classic' ? 1 : 0;
      u.uWater[2] = clock.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t / WS.periodMs);
      u.uWater[3] = clock.reduced ? 0 : Math.sin(t / WS.driftMs) * WS.driftPx / tl;
      u.uWater[0] = shimmerStrength(ctx.floor);
    }
    const cu = card.resources.card.uniforms;
    cu.uScreen.set([rx, ry, 1 / (s * tl), 0]);
    cu.uFieldWin.set([fw.x, fw.y, fw.w, fw.h]); card.resources.uField = fieldRT.source;
    cu.uForm[3] = mode === 'classic' ? 1 : 0;
    const A = filterRect.copyFrom({ x: win.x * tl, y: win.y * tl, width: win.w * tl, height: win.h * tl });
    if (host) { host.filterArea = A; if (host.filters?.[0] !== terrain) host.filters = [terrain]; }
    const act = lastState && planner.actorsLayer(lastState); if (act) act.filterArea = A;
    passes.hanging(true);
    const tD = performance.now();
    if (mode === 'relief' && act) passes.sprites(view.root.children.filter(c => c.filters?.includes(card)), act, view.sprite(lastState.playerId)?.root ?? null);
    const tE = performance.now();
    // F6: bloom over the field's window, halos breathing, the vignette.
    bloom.visible = true; bloom.position.set(fw.x * tl, fw.y * tl); bloom.scale.set(tl / S);
    bloomShader.resources.uField = fieldRT.source;
    bloomShader.resources.bloom.uniforms.uBloom[2] = mode === 'relief' ? P.bloom.cap : 0;
    passes.breathe(t, clock.reduced);
    passes.vignette();
    // The grade read each frame from the floor's area row (pipeline.grade where it has none), so a value written live shows.
    const GR = grid.areas[0]?.grade ?? P.grade;
    grade[0] = GR.vibrance; grade[1] = GR.contrast; grade[2] = GR.pivot ?? P.grade.pivot;
    stats.frameMs = performance.now() - t0;
    Object.assign(stats.parts, { shadow: tB - tA, cover: tC - tB, sprites: tE - tD, rest: stats.frameMs - (tB - tA) - (tC - tB) - (tE - tD),
      masks: shadows.stats.masks ?? 0, remade: shadows.stats.remade ?? 0, meshes: shadows.stats.meshes ?? 0 });
  }

  // Item 183: Pixi links a program on its first draw, and these four took most of the first floor's first frame. The
  // map is on the stage from the title on, so as soon as the renderer exists each pass is drawn once off screen, one a
  // frame, while the title and creation are up. A pass this GPU will not link (item 225: the ground's 17 textures over
  // its 16) leaves the map drawn unlit, as Lighting Off draws it, never black.
  under.onRender = r => {
    if (ctx.renderer === r) return;
    ctx.renderer = r;
    keepTargetAfterCache(r);
    const target = RenderTexture.create({ width: 4, height: 4 }), filtered = f => Object.assign(new Sprite(Texture.WHITE), { filters: [f] });
    const queue = [new Mesh({ geometry: quad(), shader: fieldShader }), new Mesh({ geometry: quad(), shader: bloomShader }), filtered(terrain), filtered(card)];
    const off = clock.onFrame(() => {
      const c = queue.shift();
      if (!c) { off(); target.destroy(true); return; }
      r.render({ container: c, target, clear: true });
      const prog = (c.shader ?? c.filters[0]).glProgram, d = r.gl && r.shader?._programDataHash?.[prog._key];
      if (d && !r.gl.getProgramParameter(d.program, r.gl.LINK_STATUS)) { unlinked = true; console.warn('lighting: a pass did not link on this GPU, the map is drawn unlit:', r.gl.getProgramInfoLog(d.program)); }
      c.geometry?.destroy(); c.destroy();
    });
  };

  /** A glow sprite in the sparks layer. */
  const spark = (colour, radius) => { const g = new Sprite(glowTexture()); g.anchor.set(0.5); g.blendMode = 'add'; g.tint = colour; g.width = g.height = radius * view.tile * 2; sparks.addChild(g); return g; };
  return {
    root, under, flats, unlit, over, stats, shadows,
    get mode() { return ctx.mode; },
    get tuning() { return data.rows; },
    /** The ruled wall band's sprite, null on a floor without one (hidden, the shadow mask leaves it out: the harness
     *  measures 1.7's layers alone). */
    get wallBand() { return band; },
    /** The bodies' and props' filters (the card pass). */
    get actorFilters() { return unlinked ? [] : [card]; },
    terrainHost(c) { ctx.terrainHost = c; },
    /** The light's frame, after the camera; map-view may call it itself. */
    frame(dt) { drivenFrame = true; frame(dt); },
    /** A glow that travels with a shot; move(x, y) each frame, end() when it lands (SB1, kept by Justin's ruling). */
    trail(colour, radius = RL.trailRadius, strength = RL.trailStrength) {
      if (!view.lighting) return { move() {}, end() {} };
      const g = spark(colour, radius); g.alpha = strength;
      return { move: (x, y) => g.position.set(x, y), end: () => g.destroy() };
    },
    /** A brief flash of light at a point (a bolt landing, a spell going off): swells then fades. */
    flash(x, y, colour, radius = RL.flashRadius, strength = RL.flashStrength, ms = RL.flashMs) {
      if (!view.lighting) return Promise.resolve();
      const g = spark(colour, radius); g.position.set(x, y);
      return clock.tween(ms, p => { g.alpha = strength * (p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8); }).then(() => g.destroy());
    },
    /** Works the light out again for this state (sight, terrain, floor or lights changed). */
    update(state, tile) {
      const t0 = performance.now();
      if (!frameOnClock) { frameOnClock = true; clock.onFrame(dt => { if (!drivenFrame) frame(dt); }, { last: true }); }   // after every body has set its frame (item 265)
      const forced = /lighting=(relief|classic)/.exec(globalThis.location?.search ?? '')?.[1];
      ctx.mode = view.lighting === 'classic' || (view.lighting === true && (forced === 'classic' || !RELIEF_ON)) ? 'classic' : 'relief';
      const relief = ctx.mode === 'relief', f = state.floor;
      ctx.floor = f;
      if (lastState?.floor !== f) normals.reset();
      const lights = gatherLights(state, { look: ctx.mode, extra: planeVeinLights(state, relief) });
      grid = buildGrid(state, lights, { look: ctx.mode, fine: relief ? view.terrainKinds ?? null : null, accent: view.terrainAccent ?? null });
      bindShared('uAdmit', upload(admitT, grid.w, grid.h, grid.admission));
      bindShared('uSurf', upload(surfT, grid.w, grid.h, grid.surface));
      bindShared('uAmb', upload(ambT, grid.w * S, grid.h * S, grid.ambient));
      // The ruled wall band, on the painted Dungeon and Crypt floors (as f721b64): made once a floor, then again only
      // round a tile that changes (a door opening), into the same picture; drawn into the shadow mask at band / strength,
      // so the ground pass's 1 - strength x mask gives the band back.
      const painted = view.look === 'painted' && !f.plane && (f.biome === 'dungeon' || f.biome === 'crypt' || !f.biome), steps = P.wallBand.steps;
      const level = v => Math.round(Math.min(1, v / P.shadow.strength) * 255);
      if (grid.fresh || bandLook !== painted) {
        const b = painted ? wallBand(f, { dither: true }) : null;
        band = null; bandLook = painted;
        if (b) {
          bandBytes = new Uint8Array(b.length * 4);
          for (let i = 0; i < b.length; i++) bandBytes[i * 4 + 3] = level(b[i]);
          bandSprite.texture = new Texture({ source: upload(bandT, f.w * steps, f.h * steps, bandBytes) });
          bandSprite.scale.set(tile / steps); bandSprite.blendMode = 'max'; band = bandSprite;
        }
      } else if (band && grid.changed.length) {
        const Wt = f.w * steps;
        for (const t of grid.changed) {
          const x = t % f.w, y = (t / f.w) | 0, R = [Math.max(0, x - 3), Math.max(0, y - 3), Math.min(f.w - 1, x + 3), Math.min(f.h - 1, y + 3)];
          const b = wallBand(f, { dither: true, region: R }), RW = (R[2] - R[0] + 1) * steps;
          for (let gy = Math.max(0, y - 2) * steps; gy < (Math.min(f.h - 1, y + 2) + 1) * steps; gy++) for (let gx = Math.max(0, x - 2) * steps; gx < (Math.min(f.w - 1, x + 2) + 1) * steps; gx++)
            bandBytes[(gy * Wt + gx) * 4 + 3] = b ? level(b[(gy - R[1] * steps) * RW + gx - R[0] * steps]) : 0;
        }
        upload(bandT, f.w * steps, f.h * steps, bandBytes);
      }
      // Raster terrain's per-pixel kinds.
      const F = relief ? view.terrainKinds ?? null : null;
      for (const fl of [terrain, hang]) fl.resources.terrain.uniforms.uFineK.set(F ? [F.S, F.w, F.h, 1] : [0, 0, 0, 0]);
      if (F && fineT.bytes !== F.data) { const src = upload(fineT, F.w, F.h, F.data instanceof Uint8Array ? F.data : new Uint8Array(F.data.buffer)); terrain.resources.uFine = src; hang.resources.uFine = src; }
      normals.place(grid.areas, grid.areaNames, ctx.floor?.chaos ? 0.3 : 1);
      // The light arrays: positions and shapes; colour x strength (flicker per frame).
      shaded = grid.shaded;
      lpos.fill(0); lcol.fill(0); lday.fill(0); baseCol.fill(0);
      shaded.forEach((L, k) => {
        lpos.set([L.x, L.y, L.z, L.r], k * 4);
        baseCol.set([L.c[0] * L.s, L.c[1] * L.s, L.c[2] * L.s, L.falloff], k * 4);
        lcol.set(baseCol.subarray(k * 4, k * 4 + 4), k * 4);
        if (L.daylight) lday.set([L.beam, L.lean, L.spill, 0], k * 4);
      });
      for (const u of programs) { u.uniforms.uCount = shaded.length; u.uniforms.uFloor[0] = grid.w; u.uniforms.uFloor[1] = grid.h; }
      fieldShader.resources.field.uniforms.uBleed[0] = P.bleed[grid.areas[0]?.bleed ?? 'brick'] ?? P.bleed.brick;
      shadows.setLights(shaded, grid, state.playerId);
      lastState = state; replan = true;
      // Gear and food in sight lie over the light at their painted colour (1.7 kind 'unlit'); out of sight with the floor.
      for (const c of [...flats.children, ...unlit.children]) {
        if (!c.item || !UNLIT.has(c.item.kind)) continue;
        const want = relief && !!state.vis?.[c.item.y * f.w + c.item.x] ? unlit : flats;
        if (c.parent !== want) want.addChild(c);
      }
      passes.halos(lights, state, tile);
      if (grid.full) { stats.fullBuilds.push(grid.why); if (stats.fullBuilds.length > 8) stats.fullBuilds.shift(); }
      stats.updates++; stats.updateMs = performance.now() - t0; stats.updateMsMax = Math.max(stats.updateMsMax, stats.updateMs); stats.lights = shaded.length; stats.folded = grid.folded;
    },
  };
}
