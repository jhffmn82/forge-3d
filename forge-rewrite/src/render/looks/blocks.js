// Options > Map art > Blocks (1.7 render.js:1703-1831 Block Art, drawTerrainPass's glyph branch, paintTileObject,
// paintProp, the items and bodies passes @3c8b312): the readable glyph map. Every tile is a flat colour with its
// symbol, every object, prop, item, trap and body a bold symbol with a dark keyline over the biome's palette, in
// memory and under the light as the painted look is. Same interface as the painted look: terrain, ground, structures
// and body sprites. What a symbol shows never depends on anything hidden (1.7's rule: callers own sight).

import { Container, Graphics, Sprite, Texture } from '../../../../forge-godot/runtime/pixi.js';
import ui from '../../../data/ui.json' with { type: 'json' };
import monsters from '../../../data/monsters.json' with { type: 'json' };
import props from '../../../data/props.json' with { type: 'json' };
import { T, tileAt, G, isWallTile as isWall } from '../../data/tiles.js';
import { toNum, toRgb } from '../../lib/colour.js';
import { asBody } from '../body.js';
import { buildMarks } from '../map-marks.js';
import { sealedTreasure } from '../../engine/reads.js';

const G_PX = 128;   // a symbol's picture per tile, drawn once, sharp at the closest zoom on a dense screen
const FONT = `"${ui.fonts.mono}", monospace`;
const KEYLINE = '#151217', DOT = '#141316';
const EL = { fire: '#E2622B', water: '#62A8D8', air: '#E8D27A', earth: '#7FA05A', light: '#F6E7B0', shadow: '#8A6FB0' };   // 1.7 AFF_COL
// 1.7 game.js BIOMES floor colours; the Underdark keeps the Caverns' and the Realm the Crypt's.
const FLOOR = { dungeon: '#201C19', crypt: '#1E1D23', caverns: '#1F1B16', underdark: '#1F1B16', chaos: '#1E1D23' };

/** 1.7 blockReadableColor: keeps a creature's or element's own hue, lifted above the keyline when it is too dark. */
export function readable(colour) {
  if (!/^#[0-9a-f]{6}$/i.test(colour || '')) return '#DAE7EE';
  let rgb = Object.values(toRgb(colour));
  const lum = () => rgb.reduce((s, c, i) => { c /= 255; return s + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); }, 0);
  while (lum() < 0.28) rgb = rgb.map(c => Math.min(255, Math.round(c + (255 - c) * 0.12)));
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const DOORS = new Set([T.DOOR, T.LOCKED, T.TOLL, T.ICE_DOOR, T.THORNS, T.SEALED]);
/** 1.7 blockObjectMark: the symbol, colour and corner badge of a door, stairs or other object tile. */
export function objectMark(t, exitOpen = false) {
  const color = t === T.PORTAL || t === T.STAIRS || t === T.STAIRS_UP || t === T.EXIT ? '#8EE7F1' : t === T.FORGE ? '#FFAA66' : t === T.SHRINE ? '#EEE1AE'
    : t === T.BRIDGE || t === T.RUBBLE ? '#77736E' : t === T.ICE_DOOR ? '#9FD8FF' : t === T.THORNS ? '#91C475' : t === T.LOCKED || t === T.SEALED ? '#B9C5DF' : '#F1CF7E';
  const ch = DOORS.has(t) ? '+' : t === T.PORTAL ? 'O' : t === T.FORGE ? '&' : t === T.SHRINE ? '_' : t === T.CHEST ? '(' : t === T.BRIDGE ? '='
    : t === T.STAIRS_UP ? '<' : t === T.STAIRS || (t === T.EXIT && exitOpen) ? '>' : t === T.EXIT ? '+' : t === T.OPEN_DOOR ? "'" : ':';
  const badge = t === T.LOCKED ? 'k' : t === T.TOLL ? '$' : t === T.ICE_DOOR ? 'I' : t === T.THORNS ? '#' : t === T.SEALED || (t === T.EXIT && !exitOpen) ? 'X' : null;
  return { ch, color, badge };
}

const row = id => props.rows?.[id] ?? {};
/** 1.7 blockPropMark: a prop's symbol by what it does first (a lever, a fluid barrel, a powder keg, a prisoner, an
 *  altar), then by its family; quiet scenery is drawn fainter on every cell it blocks. null: draws nothing. */
export function propMark(p) {
  if (p.eventGate || p.part) return null;   // the gate's door says it; a wide piece is drawn once, from its head
  const r = row(p.id), id = p.id ?? '', fam = id === 'stack-group' || id === 'urn-group' ? (p.family ?? (id === 'urn-group' ? 'urn' : 'crate')) : id;
  const br = !!(r.breakable || p.breakable), b = r.blocks !== false && !r.flat;
  const used = !!(p.used || p.opened);
  let ch, color, badge = null, scenery = false;
  if (p.previewPortal) { ch = 'O'; color = '#8EE7F1'; }
  else if (p.crystalVault) { ch = '◇'; color = '#A0E6FF'; }
  else if (p.hoard || id === 'ice-block') { ch = '*'; color = '#A0E6FF'; }
  else if (r.fluid) { ch = '!'; color = r.fluid === 'water' ? '#79DFFF' : '#B3E56F'; badge = r.fluid === 'water' ? 'W' : 'P'; }
  else if (r.explodes) { ch = '*'; color = '#FF965C'; badge = '!'; }
  else if (id === 'final-forge' || id === 'lava-forge') { ch = '&'; color = '#FFAA66'; }
  else if (p.lever || /^lever-/.test(id)) { ch = used || id === 'lever-down' ? '\\' : '/'; color = '#F1CF7E'; }
  else if (id === 'elemental-lock') { ch = '+'; color = readable(EL[p.element]); }
  else if (p.prisoner) { ch = '@'; color = '#F1CF7E'; }
  else if (p.eventRoom !== undefined || p.silk) { ch = '!'; color = '#EDABF5'; }
  else if (r.altar || p.altar || p.ritualAltar || /altar|shrine|offering|font$/.test(id)) { ch = '_'; color = '#EEE1AE'; }
  else if (p.tablet) { ch = '?'; color = '#C9B9ED'; }
  else if (r.drinkable || p.drink) { ch = '{'; color = '#79DFFF'; }
  else if (p.sentry || p.sentinel || p.guardianStatue) { ch = '&'; color = '#BBC5D4'; }
  else if (p.merchant !== undefined || p.merchantId !== undefined) { ch = '$'; color = '#F1CF7E'; }
  else if (p.breakReward) { ch = '/'; color = '#DAE7EE'; }
  else if (r.bush || id === 'bush') { ch = '♣'; color = '#8BDB68'; }
  else if (r.curtain || r.web) { ch = '#'; color = '#D8D5C6'; scenery = !br; }
  else if (p.hatch && !p.hatched) { ch = '0'; color = '#E4D8B9'; }
  else if (/(^|-)crate(-|$)/.test(fam)) { ch = '□'; color = '#E8B36D'; }
  else if (/(^|-)barrel(-|$)/.test(fam)) { ch = 'o'; color = '#CC9874'; }
  else if (/(^|-)pot(-|$)/.test(fam)) { ch = 'u'; color = '#EEA18D'; }
  else if (/(^|-)urn(-|$)/.test(fam) && br) { ch = 'u'; color = '#C7AEED'; }
  else if (/(^|-)cart(-|$)/.test(id)) { ch = '='; color = '#D5AF87'; }
  else if (id === 'updraft-vent') { ch = '↑'; color = '#CDEDF5'; }
  else if (br) { ch = '('; color = '#F1CF7E'; }
  else {
    scenery = true;
    if (/mushroom|fungus|shroom/.test(id)) { ch = '♠'; color = '#8BAF9B'; }
    else if (/vines|fern|root|moss|flowers/.test(id)) { ch = '"'; color = '#8AAB73'; }
    else if (/crystal|geode|pylon|pearls/.test(id)) { ch = '◇'; color = '#9EA6C4'; }
    else if (/bones|bone-pile|lost-miner|skeleton/.test(id)) { ch = 'x'; color = '#ABA697'; }
    else if (/bookshelf|shelf/.test(id)) { ch = '≡'; color = '#B89B7A'; }
    else if (/brazier|torch|candle|candelabra|campfire/.test(id)) { ch = 'i'; color = p.light || r.light ? '#DBAE70' : '#90867A'; }
    else if (/cage|portcullis|weapon-rack/.test(id)) { ch = '≠'; color = '#929BAA'; }
    else if (/sarc|coffin|grave-slab|tomb/.test(id)) { ch = '▬'; color = '#A79BB4'; }
    else { ch = b ? '#' : ':'; color = b ? '#96949E' : '#827D82'; }
  }
  return { ch, color, badge, used, scenery };
}

const ITEMS = { heart: ['!', '#F69A9A'], globe: ['!', '#8ECFFF'], essence: ['$', '#C7A1FF'], food: ['%', '#EAB98A'], sigil: ['?', '#EDABF5'],
  weapon: [')', '#DAE7EE'], armour: ['[', '#A6C8F5'], offhand: ['[', '#91DBBE'], key: ['(', '#79DFFF'], ring: ['=', '#F1CF7E'], amulet: ['"', '#C7AEED'] };
/** 1.7 blockItemMark. */
export function itemMark(it) {
  const m = it.kind === 'mote' ? ['*', readable(EL[it.el])] : ITEMS[it.kind] ?? [';', '#F1CF7E'];
  return { ch: m[0], color: m[1] };
}

const TRAPS = { dart: '#A69B87', fire: '#F58B42', gas: '#91BC61', frost: '#9FD8FF', spark: '#FFE080', teleport: '#B58CFF', web: '#D8D5C6', alarm: '#E8B44A', pit: '#94887C', spikes: '#B9B3AA' };
/** 1.7 blockTrapMark. */
export const trapMark = t => ({ ch: '^', color: TRAPS[t.kind] ?? '#B9B3AA' });

/** 1.7 blockActorMark: the creature's own letter and colour, its element tier, and a line in its allegiance colour. */
export function actorMark(a, hero = false) {
  const m = monsters.rows?.[a.kind] ?? {};
  // 1.7 blockActorMark's own glyph or colour where it differs from the bestiary's (monsters.json look.blockGlyph, blockColour).
  let ch = hero ? '@' : m.look?.blockGlyph ?? m.look?.glyph ?? '?', color = m.look?.blockColour ?? m.look?.colour;
  const summoned = !!a.shade || a.kind === 'shade' || a.kind === 'shade-swarm' || a.kind === 'living-flame';   // CB14: a.shade, a Corrupted foe's Shade
  if (a.shade || a.kind === 'shade' || a.kind === 'shade-swarm') { ch = a.kind === 'shade-swarm' ? 's' : 'S'; color = EL.shadow; }
  else if (a.kind === 'living-flame') { ch = 'f'; color = EL.fire; }
  else if (a.kind === 'echo') { ch = '@'; color = '#B8AFC8'; }
  return { ch, color: hero ? '#FFFFFF' : readable(color), badge: !summoned && m.elementTier ? String(m.elementTier) : null,
    allegiance: hero ? '#FFFFFF' : a.side === 'ally' ? '#8CE69B' : a.side === 'foe' ? '#FF918A' : '#96D7F1' };
}

// ---- pictures ----------------------------------------------------------------------------------------------------

const cache = new Map();
/** A tile's picture drawn once on a canvas (TS = G_PX) and kept. */
function tileTex(key, draw, w = 1, h = 1) {
  let t = cache.get(key);
  if (t && !t.destroyed) return t;
  const c = document.createElement('canvas'); c.width = G_PX * w; c.height = G_PX * h;
  draw(c.getContext('2d'), G_PX);
  t = Texture.from(c);
  t.source.autoGenerateMipmaps = true;   // the phone's 40 px tile reads the 128 px symbol through its mipmaps
  cache.set(key, t);
  return t;
}
/** 1.7 glyph: a quiet symbol (600, 0.58 of a tile), centred. */
function plainGlyph(ctx, TS, ch, col, px = 0, py = 0) {
  ctx.fillStyle = col; ctx.font = `600 ${Math.round(TS * 0.58)}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, px + TS / 2, py + TS / 2);
}
/** 1.7 mark: a small corner badge (600, 0.36 of a tile), left aligned. */
function badgeGlyph(ctx, TS, ch, col, x, y) {
  ctx.fillStyle = col; ctx.font = `600 ${Math.max(8, Math.round(TS * 0.36))}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x, y);
}
/** 1.7 blockGlyph: the floor dot covered, then a bold symbol (700, 0.68 of a tile) with a dark keyline. */
function boldGlyph(ctx, TS, ch, col, px = 0, py = 0) {
  ctx.fillStyle = DOT; ctx.fillRect(px + TS * 0.4, py + TS * 0.54, TS * 0.2, TS * 0.22);
  ctx.font = `700 ${Math.round(TS * 0.68)}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.strokeStyle = KEYLINE; ctx.lineWidth = Math.max(2, TS * 0.08);
  ctx.strokeText(ch, px + TS * 0.5, py + TS * 0.5); ctx.fillStyle = col || '#F5E9D6'; ctx.fillText(ch, px + TS * 0.5, py + TS * 0.5);
}

const markTex = m => tileTex(`b|${m.ch}|${m.color}|${m.badge ?? ''}`, (ctx, TS) => { boldGlyph(ctx, TS, m.ch, m.color); if (m.badge) badgeGlyph(ctx, TS, m.badge, m.color, TS * 0.75, TS * 0.18); });
const quietTex = m => tileTex(`q|${m.ch}|${m.color}`, (ctx, TS) => plainGlyph(ctx, TS, m.ch, m.color));
/** A corner badge alone, at (x, y) of the tile. */
const badgeTex = (ch, color, x, y) => tileTex(`m|${ch}|${color}|${x}|${y}`, (ctx, TS) => badgeGlyph(ctx, TS, ch, color, TS * x, TS * y));

/** One tile's picture as a sprite at tile (x, y), w x h tiles. */
function at(tex, x, y, tile, w = 1, h = 1) {
  const s = new Sprite(tex);
  s.position.set(x * tile, y * tile); s.width = tile * w; s.height = tile * h;
  return s;
}

// ---- terrain -----------------------------------------------------------------------------------------------------

const CHUNK = 16;
/** 1.7 drawTerrainPass's Block Art branch: flat colour and a symbol per tile; a wall darkens the top of the floor below
 *  it (not on cave or plane rock). Drawn in 16-tile chunks; only those near the camera are shown (cull). */
export function buildTerrain(floor, tile) {
  const root = new Container(), chunks = [];
  const bg = FLOOR[floor.biome] ?? FLOOR.dungeon, rock = floor.biome === 'caverns' || floor.biome === 'underdark' || !!floor.plane;
  const texOf = (t, shade) => {
    const wall = isWall(t);
    const fill = wall ? '#2B2B30' : t === T.CHASM ? '#050408' : t === T.LAVA ? '#512819' : t === T.WATER ? '#182733' : bg;
    const ch = wall ? '#' : t === T.CHASM ? '∨' : t === T.WATER || t === T.LAVA ? '~' : '.';
    const col = wall ? '#B1ADB5' : t === T.LAVA ? '#E59555' : t === T.WATER ? '#6DA9BD' : t === T.CHASM ? '#817690' : '#69646B';
    return tileTex(`t|${fill}|${ch}|${col}|${shade ? 1 : 0}`, (ctx, TS) => {
      ctx.fillStyle = fill; ctx.fillRect(0, 0, TS, TS);
      plainGlyph(ctx, TS, ch, col);
      if (shade) {
        const g = ctx.createLinearGradient(0, 0, 0, TS * 0.35);
        g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.55; ctx.fillStyle = g; ctx.fillRect(0, 0, TS, TS * 0.35); ctx.globalAlpha = 1;
      }
    });
  };
  for (let cy = 0; cy < floor.h; cy += CHUNK) for (let cx = 0; cx < floor.w; cx += CHUNK) {
    const c = new Container();
    c.box = { x: cx * tile, y: cy * tile, w: CHUNK * tile, h: CHUNK * tile };
    for (let y = cy; y < Math.min(floor.h, cy + CHUNK); y++) for (let x = cx; x < Math.min(floor.w, cx + CHUNK); x++) {
      const t = floor.tiles[y * floor.w + x];
      const shade = !rock && !isWall(t) && t !== T.CHASM && isWall(tileAt(floor, x, y - 1));
      c.addChild(at(texOf(t, shade), x, y, tile));
    }
    chunks.push(c); root.addChild(c);
  }
  root.cull = (x0, y0, x1, y1) => { for (const c of chunks) c.visible = c.box.x < x1 && c.box.x + c.box.w > x0 && c.box.y < y1 && c.box.y + c.box.h > y0; };
  return root;
}

/** 1.7's Block Art ground decals: grass as '"', webs as '#', other marks as ',', at 60%. */
export function buildGround(floor, tile) {
  const under = new Container();
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
    const v = floor.ground?.[y * floor.w + x];
    if (!v || isWall(floor.tiles[y * floor.w + x])) continue;
    const m = { ch: v === G.GRASS ? '"' : v === G.WEB ? '#' : ',', color: v === G.GRASS || v === G.SHORT ? '#859572' : '#918B80' };
    const s = at(quietTex(m), x, y, tile); s.alpha = 0.6;
    under.addChild(s);
  }
  return { under, over: [], swaying: [] };
}

// ---- objects, props, traps, items --------------------------------------------------------------------------------

/** Every object tile, prop, found trap, chest and floor item as its symbol. Flat (zIndex -1): bodies stand over them. */
export function buildStructures(floor, tile) {
  const out = [];
  const put = (s, alpha = 1) => { s.zIndex = -1; s.alpha = alpha; out.push(s); };
  const chestAt = new Set((floor.chests ?? []).map(c => c.y * floor.w + c.x));
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
    const t = floor.tiles[y * floor.w + x];
    if (t === T.FLOOR || t === T.WALL || t === T.WATER || t === T.SECRET || t === T.CHASM || t === T.LAVA) continue;
    if (t === T.CHEST && chestAt.has(y * floor.w + x)) continue;
    put(at(markTex(objectMark(t, !!floor.exitOpen)), x, y, tile));
  }
  for (const p of floor.props ?? []) {
    const m = propMark(p);
    if (!m) continue;
    const w = p.w ?? row(p.id).footprint?.w ?? 1, h = p.h ?? row(p.id).footprint?.h ?? 1;
    if (!m.scenery) put(at(markTex(m), p.x + (w - 1) / 2, p.y + (h - 1) / 2, tile), m.used ? 0.4 : 1);
    // Quiet scenery still shows every cell of its footprint; so does a blocking piece, on the cells its centred symbol
    // does not reach (item 168: a 3 x 3 forge stood on eight bare floor cells).
    const far = (d, n) => Math.abs(d - (n - 1) / 2) >= 1, ring = !m.scenery && (p.blocks || row(p.id).blocks);
    if (m.scenery || ring) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (m.scenery || far(dx, w) || far(dy, h)) put(at(quietTex(m), p.x + dx, p.y + dy, tile), (m.used ? 0.4 : 1) * 0.7);
    if (m.scenery && m.badge) put(at(badgeTex(m.badge, m.color, 0.75, 0.18), p.x, p.y, tile), m.used ? 0.4 : 1);
  }
  for (const t of floor.traps ?? []) if (t.found) put(at(markTex(trapMark(t)), t.x, t.y, tile));
  for (const c of floor.chests ?? []) put(at(markTex({ ch: '(', color: '#F1CF7E' }), c.x, c.y, tile), c.open ? 0.4 : 1);   // a mimic is a chest until it moves
  for (const i of floor.items ?? []) { const m = !sealedTreasure(floor, i) && itemMark(i.item); if (m) put(at(markTex(m), i.x, i.y, tile)); }   // item 290: a vault's treasure is inside its crystal
  return out;
}

// ---- bodies ------------------------------------------------------------------------------------------------------

const REMAINS = new Map(Object.values(monsters.rows ?? {}).filter(r => r.look?.sheet).map(r => [r.look.sheet, r.look.colour]));
/** 1.7 drawCorpse's Block Art branch: a flat bar of the body's colour where it fell. Root at the body's foot point. */
export function remains(sheetName, tile, size = 1) {
  const g = new Graphics(), n = Math.max(1, size);
  g.rect(-tile / 2 + tile * 0.18, -tile + tile * 0.6 + (n - 1) * tile * 0.5, tile * (n - 0.36), tile * 0.2).fill({ color: toNum(REMAINS.get(sheetName) ?? '#7C6654') });
  const c = new Container(); c.addChild(g);
  return c;
}

/** 1.7 drawBlockActor: a dark box, the body's symbol, its tier badge, and a line (or for a big body a frame) in its
 *  allegiance colour. A body (body.js); it slides as bodies do and fades when it dies. */
export function createActorSprite(a, tile, clock, hero = false) {
  const m = actorMark(a, hero), n = Math.max(1, a.size ?? 1);
  const root = new Container(), figure = new Container();
  const box = new Graphics(), TS = tile, px = -TS / 2, py = -TS, al = toNum(m.allegiance);
  box.rect(px + TS * 0.12, py + TS * 0.1, TS * (n - 0.24), TS * (n - 0.2)).fill({ color: 0x111216 });
  if (n > 1) box.rect(px + TS * 0.12, py + TS * 0.1, TS * (n - 0.24), TS * (n - 0.2)).stroke({ color: al, width: Math.max(1, TS * 0.04) });
  else if (!hero) box.moveTo(px + TS * 0.2, py + TS * 0.88).lineTo(px + TS * 0.8, py + TS * 0.88).stroke({ color: al, width: Math.max(1, TS * 0.04) });
  const glyph = at(markTex({ ch: m.ch, color: m.color, badge: null }), (n - 1) / 2 - 0.5, (n - 1) / 2 - 1, TS);
  figure.addChild(box, glyph);
  if (m.badge) figure.addChild(at(badgeTex(m.badge, m.color, 0.8, 0.7), -0.5, -1, TS));
  root.addChild(figure);
  // A blow lightens the box for 220 ms (1.7's hit flash, in the block's terms).
  let fadeA = 1, ghostA = 1, flashT = -1;
  clock.onFrame(dt => {
    if (flashT < 0) return;
    flashT += dt; if (flashT > 220) flashT = -1;
    box.alpha = flashT >= 0 ? 0.55 : 1;
  }, { owner: root });
  return asBody({
    root,
    play(name) {
      if (name !== 'death') return Promise.resolve();
      return clock.tween(clock.reduced ? 1 : 300, p => { if (!root.destroyed) figure.alpha = (1 - p) * ghostA * fadeA; });
    },
    flash(on) { if (on) { flashT = 0; box.alpha = 0.55; } },
    ghost() { ghostA = 0.72; figure.alpha = ghostA * fadeA; },
    fade(v) { if (v === fadeA) return; fadeA = v; figure.alpha = ghostA * fadeA; },
    get size() { return n; },
  });
}

/** render-18: Block Art as the map view draws a look (map-view.js LOOKS): bodies fill their tile (no lift). */
export const look = {
  lift: () => 0, body: (a, c) => createActorSprite(a, c.tile, c.clock, a.side === 'player'),
  terrain: (st, c) => buildTerrain(st.floor, c.tile), ground: (st, c) => buildGround(st.floor, c.tile),
  structures: (st, c) => [...buildStructures(st.floor, c.tile), ...buildMarks(st.floor, c.tile)],
  remains: (r, c) => remains(r.sheet, c.tile, r.size), remainsSheet: false, paint: false, beacons: true, objAnim: false, prepare: false, swaps: true,
};
