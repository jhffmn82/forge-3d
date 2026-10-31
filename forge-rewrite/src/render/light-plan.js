// What each sprite casts or glows with (lighting.js), worked out once a step so a frame only draws: the shadow casters
// (bodies, solid props, plants, and a chest, forge, shrine or exit standing on its tile), the emission strengths of
// glowing art and the forge bowls. assets: the asset layer's { sheet, hasSheet }.

import { Graphics } from '../../../forge-godot/runtime/pixi.js';
import data from '../../data/lighting.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import monsters from '../../data/monsters.json' with { type: 'json' };
import { castsAsSolid } from './light-grid.js';
import { objArt } from './art.js';

const LT = data.rows.lights, EM = LT.emission, EMF = new RegExp(EM.families), CGL = LT['creature-glow'], PROF = LT['prop-profiles'].rows;
const CT = data.rows.casters, SHADOW_ALWAYS = CT.propsAlways.map(p => new RegExp(p)), SHADOW_NEVER = CT.propsNever.map(p => new RegExp(p));
const PLANT_NEVER = new RegExp(CT.plantsNever);
const propCasts = pr => {
  if (pr.part || pr.shadow === false) return false;
  const row = props.rows[pr.id], always = SHADOW_ALWAYS.some(r => r.test(pr.id)), never = SHADOW_NEVER.some(r => r.test(pr.id));
  return !!pr.shadow || (!never && (always || !(!row || row.flat || row.walkable || row.wallMounted || row.ground || row.shadow === false)));
};
const propEmission = pr => { const id = pr.art ?? pr.id; if (PROF[id]) return id === 'glow-mushrooms' ? EM.lamp : EM.crystal; if (id === 'dais-sarcophagus' || pr.light || props.rows[pr.id]?.light || EMF.test(id)) return EM.lamp; return 0; };

/** An empty plan. */
export const emptyPlan = () => ({ casters: [], ems: new Map(), bowls: [], any: false });

/**
 * plan(st) for a state (the tile art is looked up again on a new floor). view: map-view's view.
 */
export function createPlanner(view, assets) {
  let vegNames = null, tileArt = null, floor = null;
  const vegName = tex => {
    if (!vegNames) { if (!assets.hasSheet('environment-vegetation')) return null; vegNames = new Map(); for (const [name, tx] of Object.entries(assets.sheet('environment-vegetation').textures)) vegNames.set(tx, name); }
    return vegNames.get(tex) ?? null;
  };
  // Stairs, gates, arches, shrines and gold chests glow a little; a lit forge's bowl glows (its own mask).
  const tileEmission = c => {
    if (!tileArt) {
      const pick = (s, n, em) => { const a = objArt(s, n); return a ? { t: a, em } : null; };
      tileArt = [pick('structures', 'stairs-down', 0.4), pick('structures', 'exit-gate', 0.4), pick('structures', 'archway', 0.4), pick('structures', 'shrine', 0.4),
        floor?.shrine?.god ? pick('set', 'shrine-' + floor.shrine.god, 0.4) : null, pick('chests', 'chest-gold', 0.4), pick('set', 'forge-lit', 'forge'), pick('structures', 'forge-lit', 'forge')].filter(Boolean);
    }
    const tx = c.texture;
    if (!tx) return 0;
    for (const a of tileArt) { const f = a.t.frame, g = tx.frame; if (tx.source === a.t.source && g.x >= f.x - 1 && g.y >= f.y - 1 && g.x + g.width <= f.x + f.width + 1 && g.y + g.height <= f.y + f.height + 1) return a.em; }
    return 0;
  };
  const actorsLayer = st => view.sprite(st.playerId)?.root?.parent ?? null;

  function plan(st) {
    const out = emptyPlan();
    const actors = st && actorsLayer(st);
    if (!actors) return out;
    if (st.floor !== floor) { floor = st.floor; tileArt = null; }
    const W = st.floor.w, vis = st.vis, tile = view.tile;
    for (const id of st.order ?? []) {
      const a = st.actors[id], sp = view.sprite(id);
      if (!a || !sp) continue;
      const dead = !(a.hp > 0);
      out.casters.push({ id, s: sp, owner: 'actor:' + id, dead, flying: id !== st.playerId && (a.flags ?? []).includes('flying'), art: a.look?.art, size: a.size, hero: id === st.playerId });
      if (!dead && id !== st.playerId && vis?.[a.y * W + a.x] && (Object.values(CGL.families).some(k => k.includes(a.kind)) || monsters.rows?.[a.kind]?.look?.glow)) out.ems.set(sp.root, EM.body);
    }
    for (const c of actors.children) {
      if (!c.texture || out.ems.has(c)) continue;
      const pr = c.prop;
      if (pr) {
        let seen = false;
        for (let y = pr.y; y < pr.y + (pr.h ?? 1) && !seen; y++) for (let x = pr.x; x < pr.x + (pr.w ?? 1); x++) if (vis?.[y * W + x]) { seen = true; break; }
        if (!seen) continue;
        if (propCasts(pr)) out.casters.push({ id: 'prop:' + pr.x + ',' + pr.y + ':' + pr.id, s: { root: c, texture: c.texture }, prop: true, owner: 'prop:' + pr.x + ',' + pr.y, tile: { x: pr.x + ((pr.w ?? 1) - 1) / 2, y: pr.y + ((pr.h ?? 1) - 1) / 2 } });
        const em = propEmission(pr);
        if (em) out.ems.set(c, em);
        continue;
      }
      if (c.item) continue;
      const nm = vegName(c.texture);
      if (nm) {
        const x = Math.floor(c.x / tile), y = Math.floor((c.y - 1) / tile);
        if (!vis?.[y * W + x]) continue;
        if (!PLANT_NEVER.test(nm)) out.casters.push({ id: 'plant:' + Math.round(c.x) + ',' + Math.round(c.y), s: { root: c, texture: c.texture }, prop: true, silhouette: true, owner: null, tile: { x, y } });
        if (/^veg-(volcanic-ashweed|underdark-fungus)/.test(nm)) {
          const em = nm.startsWith('veg-volcanic-ashweed') ? 0.62 : (st.floor.lights ?? []).some(l => l.kind === 'glow' && l.x === x && Math.round(l.y - 0.2) === y) ? 0.38 : 0;
          if (em) out.ems.set(c, em);
        }
        continue;
      }
      const te = tileEmission(c);
      const cx = Math.floor((c.x + Math.abs(c.width) / 2) / tile), cy = Math.floor((c.y + c.height * 0.9) / tile), seen = !!vis?.[cy * W + cx];
      // A chest, forge, shrine or exit standing on its tile casts as a solid (1.7 draws them as 'sprite' surfaces; stairs
      // lie flat and doors stand in their wall, so neither casts).
      if (c.zIndex !== -1 && !(c instanceof Graphics) && seen && (castsAsSolid(st.floor, cx, cy) || (st.floor.chests ?? []).some(q => q.x === cx && q.y === cy)))
        out.casters.push({ id: 'tile:' + cx + ',' + cy, s: { root: c, texture: c.texture }, prop: true, owner: 'tile:' + cx + ',' + cy, tile: { x: cx, y: cy } });
      if (te) { if (seen) { if (te === 'forge') out.bowls.push(c); else out.ems.set(c, te); } continue; }
      if (c.emission && vis?.[c.emitAt]) out.ems.set(c, c.emission);
    }
    out.any = out.ems.size > 0 || out.bowls.length > 0;
    return out;
  }
  return { plan, actorsLayer };
}
