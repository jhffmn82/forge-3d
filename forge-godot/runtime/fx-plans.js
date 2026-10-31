// What the 2D game draws for each event of a turn, worked out here from its own code and sent with the turn for
// scripts/fx.gd to draw in 3D (Justin 2026-10-29: "shooting a bow doesn't cause bow to be held. Also no arrow (I'm
// guessing all the spell effects are missing to include the infusing animations and sigils animations and messages
// too)"): forge-rewrite render/playback.js (castPicture, gearPicture, runPlan, prayerPlan, selfPlan, dicePlan, doubleCut,
// watchProcs and the effects of play's own branches), render/event-fx.js (eventFx), render/spell-fx.js and
// render/sigil-fx.js (the plans), unchanged, laid on a stand-in for the effects kit (render/fx-kit.js) that writes down
// each call. An event's calls are [piece, args, delay ms]: timed from the moment play.gd plays that event, a piece's own
// `at` inside its args as in the 2D game. What times the turn (a pose and its wind-up before a shot or a spell lets go, a
// bolt's flight, a great spell's impact and hold) is said beside them, for play.gd _act.

import monsters from '../../forge-rewrite/data/monsters.json' with { type: 'json' };
import bosses from '../../forge-rewrite/data/bosses.json' with { type: 'json' };
import abilities from '../../forge-rewrite/data/abilities.json' with { type: 'json' };
import prayers from '../../forge-rewrite/data/prayers.json' with { type: 'json' };
import amuletData from '../../forge-rewrite/data/amulets.json' with { type: 'json' };
import * as spellFx from '../../forge-rewrite/src/render/spell-fx.js';
import { sigilPlan, amuletPlan } from '../../forge-rewrite/src/render/sigil-fx.js';
import { eventFx } from '../../forge-rewrite/src/render/event-fx.js';
import { DAMAGE_COLOUR, ELEMENT_TRAIL as EL_TRAIL } from '../../forge-rewrite/src/data/palette.js';
import { walkable, opaque } from '../../forge-rewrite/src/data/tiles.js';
import { castTiles } from '../../forge-rewrite/src/rules/effects/select.js';

// playback.js's tables, as it has them.
const WINDUP = { melee: 170, ranged: 300, cast: 260 };
const DMG = DAMAGE_COLOUR;
const WORD_TONE = { immune: 'miss', block: 'miss', shell: 'miss', cracked: 'miss', ward: 'miss', shatter: 'ice', frozen: 'ice', hiss: 'ice' };
const POOL_TONE = { 'ice-armor': 'ice', guard: 'phys', ironhide: 'phys', sporecoat: 'heal' };
const FORGE_SPARK = { fused: [50], enchanted: [40], carved: [24, 'fire'], hero: [30, 'fire'] };
const PROC_OF = { burn: 'fire', chill: 'ice', frozen: 'ice', root: 'earth', poison: 'poison', bleed: 'blood', fear: 'dark', corrupt: 'dark', hollow: 'dark', rot: 'dark', snuffed: 'dark', blind: 'light', coward: 'light', stun: 'phys' };
const BLOCK_PROC = { chill: 'ice', frozen: 'ice', stun: 'lightning', corrupt: 'dark' };
const POSELESS = new Set(['channel', 'death', 'phylactery-broken', 'surfacing', 'erupt', 'dive', 'emerge']);
const MOVE_EL = {}, NO_SHOT = new Set();
for (const mv of [...Object.values(monsters.rows ?? {}).flatMap(r => r.moves ?? []), ...Object.values(bosses.rows ?? {}).flatMap(r => (r.actions ?? []).flatMap(a => a.moves ?? []))]) {
  if (mv.shot === 'none') NO_SHOT.add(mv.id);
  else if (mv.shot) MOVE_EL[mv.id] ??= mv.shot;
  if (mv.bolt) MOVE_EL[mv.id] = mv.bolt;
}
const SHOT_EL = new Set(['fire', 'ice', 'lightning', 'poison', 'dark', 'magic', 'light', 'earth', 'phys', 'blood', 'web']);
const shotOf = ev => (NO_SHOT.has(ev.move) ? null : MOVE_EL[ev.move] ?? (SHOT_EL.has(ev.element) ? ev.element : null));
// CH10, render-19 (playback.js specialClip, monsters.json look.specialClip): a creature's special plays its own clip (the
// Unmaker's cast), every other creature's its attack.
const specialClip = (state, id) => monsters.rows?.[state.actors?.[id]?.kind]?.look?.specialClip ?? 'attack';
const hex = c => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c);
// spell-fx.js infusionColours, here so the plans' module need not be asked
const PIECES = ['flare', 'rise', 'swirl', 'sweep', 'cone', 'shard', 'glyph', 'ripple', 'beam', 'pillar', 'splash', 'burst', 'sparkle',
  'explosion', 'bolt', 'proc', 'ring', 'light', 'shake', 'infuse', 'particle', 'castSurface', 'rock', 'rocksKeep', 'grapple'];

/** The effects kit's stand-in: each call written down, with how long after the event it was made (fx.after). */
function recorder() {
  const calls = [];
  let shift = 0;
  const K = { reduced: false, now: 0, calls };
  for (const fn of PIECES) K[fn] = (...args) => { calls.push(shift ? [fn, args, shift] : [fn, args]); return Promise.resolve(); };
  K.after = (ms, fn) => { const was = shift; shift += ms; try { fn(); } finally { shift = was; } };
  K.wait = () => Promise.resolve();
  K.quiver = (id, o = {}) => { calls.push(['quiver', [id, o]]); };
  return K;
}

/**
 * What each of a turn's events shows: {index: {c: calls, clip, pose, who, windup, face, bolt, impact, hold, wait, word,
 * quiet, miss}}. before: where each body stood as the command began (the 2D game reads its sprites, which stand there
 * until the events move them); base: the first event's index in the turn.
 */
export function lookTurn(state, events, before, base = 0) {
  const out = {};
  const f = state.floor, w = f?.w ?? 0, player = state.playerId;
  const pos = new Map(before);
  const seen = (x, y) => !!f && x >= 0 && y >= 0 && x < f.w && y < f.h && !!state.vis?.[y * w + x];
  const at = id => (id ? pos.get(id) ?? null : null);
  const shown = id => !!id && (id === player || (p => !!p && seen(p.x, p.y))(at(id)));
  const sprite = id => { const p = at(id); return p ? { root: { x: p.x + 0.5, y: p.y + 1, destroyed: false, visible: true, alpha: 1 } } : null; };
  let K = null, look = null;
  const view = { tile: 1, sprite, float: (id, words, colour, where = null, big = false) => { look.c.push(['float', [id, String(words), hex(colour), where, !!big]]); }, get pieces() { return K; } };
  const floatOn = (id, words, colour, big = false) => look.c.push(['float', [id, String(words), hex(colour), null, !!big]]);
  let spell = null, lastShot = null, lastBoom = null, guard = null, blowNo = 0;
  const blows = new Map();
  let procShown = [];

  // ---- playback.js castPicture and its plans, on the stand-in
  const boltType = (ev, rest) => {
    const row = spell?.row, t = rest.find(e => e.type === 'damaged' && e.id === ev.target)?.dtype ?? row?.type ?? 'magic';
    return t === 'phys' && row?.element === 'earth' ? 'earth' : t;
  };
  function castPicture(ev, rest) {
    const row = abilities.rows[ev.ability] ?? prayers.rows[ev.ability], from = ev.from ?? at(ev.id), aim = ev.at;
    const cur = { ability: ev.ability, row, from, impact: 0, hold: 0, prev: null };
    if (!from || !row) return cur;
    const open = t => !f || walkable(f, t.x, t.y);
    const own = [];
    for (const e of rest) { if (e.type === 'ability' || (e.id && e.id !== ev.id && (e.type === 'moved' || e.type === 'move-used' || (e.type === 'attacked' && !e.spell)))) break; own.push(e); }
    let plan = null;
    if (ev.ability === 'fireball' && aim) {
      const d = Math.max(1, Math.abs(aim.x - from.x), Math.abs(aim.y - from.y));
      K.bolt(from.x, from.y, aim.x, aim.y, 'fire', { explosion: true, at: spellFx.RELEASE });
      plan = { calls: [], impact: spellFx.RELEASE + 110 + 55 * d, hold: spellFx.RELEASE + 110 + 55 * d };
      // its explosion sound as the bolt lands (playback.js onLand: cue('explosion'); bridge-core.js hearLooks)
      (look.cues ??= []).push(['explosion', plan.impact]);
    } else if (ev.ability === 'frostcone' && aim) plan = spellFx.frostCone({ from, at: aim, floorTiles: (ev.area ?? []).filter(open) });
    else if (ev.ability === 'radiantbeam' && ev.area?.length) plan = spellFx.radiantBeam({ from, tiles: ev.area });
    else if (ev.ability === 'lance' && ev.area?.length) plan = spellFx.lance({ from, tiles: ev.area, release: WINDUP[ev.clip] ?? WINDUP.melee });
    else if (ev.ability === 'venom-burst') plan = spellFx.venomBurst({ at: from });
    else if (ev.ability === 'shadowswarm') plan = spellFx.shadowSwarm({ spots: own.filter(e => e.type === 'spawned' && e.summon).map(e => e.at) });
    else if (ev.ability === 'glacialtomb' && aim) {
      const self = ev.target === player, splash = [];
      if (!self) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) splash.push({ x: aim.x + dx, y: aim.y + dy });
      plan = spellFx.glacialTomb({ at: aim, splash });
    } else if (ev.ability === 'livingflame' && aim) plan = spellFx.livingFlame({ at: aim });
    else if (ev.ability === 'upheaval' && aim) {
      const walls = own.find(e => e.type === 'terrain' && e.what === 'upheaval')?.tiles ?? [], dead = new Set(own.filter(e => e.type === 'died').map(e => e.id));
      const struck = [...new Set(own.filter(e => e.type === 'attacked' && e.spell && e.id === ev.id && e.hit).map(e => e.target))].filter(id => !dead.has(id));
      plan = spellFx.upheaval({ from, at: aim, walls, struck });
      // map.heave (map-view.js): each rock of the ridge heaves up out of the floor as the cast lets go for it
      for (const h of plan.heave ?? []) K.rock(h.x, h.y, { at: h.at });
    } else if (ev.ability === 'umbral' && aim) plan = spellFx.umbralPassage({ from, to: aim, echo: own.find(e => e.type === 'spawned' && /^echo-/.test(e.id ?? '') && e.at)?.at });
    else if (ev.ability === 'charge' || ev.ability === 'lunge') plan = runPlan(ev, own, from);
    else if (row.kind === 'prayer') plan = prayerPlan(ev, own, from);
    if (!plan) plan = selfPlan(ev, own, from, row);
    if (!plan) return cur;
    for (const c of plan.calls) {
      if (c.fn === 'quiver') K.quiver(c.id, ...c.args);
      else if (c.fn === 'ring') { if (seen(c.args[0], c.args[1])) K.ring(...c.args); }
      else if (c.fn === 'fx') { if (seen(c.args[1], c.args[2])) K[c.args[0]]?.(...c.args.slice(1)); }
      else K[c.fn]?.(...c.args);
    }
    cur.impact = plan.impact; cur.hold = plan.hold;
    return cur;
  }
  function gearPicture(ev, rest, who) {
    const me = at(who);
    if (ev.failed || !me) return;
    const own = [];
    for (const e of rest) { if (e.type === 'sigil' || e.type === 'amulet' || e.type === 'ability' || (e.id && e.id !== who && (e.type === 'move-used' || e.type === 'attacked'))) break; own.push(e); }
    const bodies = list => [...new Set(list.map(e => e.id))].map(at).filter(Boolean);
    let plan;
    if (ev.type === 'sigil') {
      const hurt = type => bodies(own.filter(e => e.type === 'damaged' && e.by === who && e.id !== who && e.dtype === type && !e.cause));
      const foes = ev.id === 'storm' ? hurt('lightning') : ev.id === 'sunburst' ? hurt('light')
        : ev.id === 'mire' ? bodies(own.filter(e => e.type === 'status' && e.status === 'root' && e.change === 'applied' && e.id !== who)) : [];
      const hop = own.find(e => e.type === 'teleported' && e.id === who);
      const spots = ev.id === 'naturesbounty' ? (f?.items ?? []).filter(i => i.item?.kind === 'food' && Math.max(Math.abs(i.x - me.x), Math.abs(i.y - me.y)) <= 2 && (i.x !== me.x || i.y !== me.y)) : [];
      const changed = own.find(e => e.type === 'hero' && /^item-/.test(e.change ?? ''))?.change.slice(5) ?? null;
      const read = own.some(e => e.type === 'identified' && e.which === 'one-chosen') && !own.some(e => e.type === 'log' && e.words === 'All gear identified.');
      plan = sigilPlan(ev.id, { at: me, foes, spots, carry: hop ? { from: hop.from, to: hop.to } : null, changed, read });
    } else {
      const moved = own.filter(e => e.type === 'moved');
      const mine = moved.find(e => e.id === who), theirs = moved.find(e => e.id !== who);
      // Item 262 (map-words.js grapple): the Hook throws its iron grappling hook at the body it drags in, or at the anchor
      // it hauls the wearer to, and bites as the cast lets go.
      if (ev.amulet === 'hook') {
        if (mine || theirs) K.grapple(who, mine ? { at: ev.at } : { id: theirs.id }, { bite: spellFx.RELEASE });
        // it bites with a clink as the cast lets go (playback.js onBite: cue('parry'); bridge-core.js hearLooks)
        if (mine || theirs) (look.cues ??= []).push(['parry', spellFx.RELEASE]);
        return;
      }
      const lv = ev.level ?? 1, radius = amuletData.rows?.seeking?.values?.radius?.byLevel?.[lv - 1] ?? 16;
      plan = amuletPlan(ev.amulet, { at: me, radius, swap: ev.amulet === 'swap' && mine ? { from: mine.from, to: mine.to } : null });
    }
    for (const c of plan.calls) K[c.fn]?.(...c.args);
  }
  function runPlan(ev, own, from) {
    const run = own.find(e => e.type === 'moved' && e.id === ev.id && e.dash), to = run?.to ?? from, land = run ? 200 : 0;
    const aim = ev.at ?? to;
    if (aim.x !== from.x) look.face = Math.sign(aim.x - from.x);
    if (ev.ability === 'lunge') {
      const mark = (ev.target && at(ev.target)) || ev.at;
      if (!mark) return null;
      const hit = own.some(e => e.type === 'damaged' && e.id === ev.target && e.amount > 0 && !e.cause);
      return spellFx.lunge({ from, foe: mark, hit, blow: land + 230 / 2 });
    }
    const stunned = own.filter(e => e.type === 'status' && e.status === 'stun' && e.change === 'applied' && e.id !== ev.id).map(e => at(e.id)).filter(Boolean);
    return spellFx.charge({ from, to, land, stunned });
  }
  function prayerPlan(ev, own, from) {
    const release = (WINDUP[ev.clip] ?? WINDUP.cast) - 20, me = ev.id, mine = e => e.id === me;
    const hop = own.filter(e => e.type === 'teleported' && mine(e)).at(-1);
    if (ev.ability === 'bonespear' && ev.at) {
      const dx = ev.at.x - from.x, dy = ev.at.y - from.y, steps = Math.max(Math.abs(dx), Math.abs(dy)), path = [];
      for (let i = 1; steps && i <= 6; i++) { const x = Math.round(from.x + dx * i / steps), y = Math.round(from.y + dy * i / steps); if (f && opaque(f, x, y)) break; path.push({ x, y }); }
      const pierced = [...new Set(own.filter(e => e.type === 'attacked' && e.spell && mine(e) && e.hit).map(e => e.target))].map(at).filter(Boolean).map(t => path.findIndex(p => p.x === t.x && p.y === t.y)).filter(k => k >= 0);
      return spellFx.boneSpear({ from, path, pierced, release });
    }
    if (ev.ability === 'arcaneblink') return hop ? spellFx.arcaneBlink({ from: hop.from, to: hop.to }) : null;
    if (ev.ability === 'the-brood') return spellFx.theBrood({ at: from, landed: own.filter(e => e.type === 'spawned' && e.summon && e.at).map(e => e.at), release });
    if (ev.ability === 'rolldice2') {
      const to = hop?.to ?? from, healed = own.some(e => e.type === 'healed' && mine(e) && e.amount > 0), mana = own.some(e => e.type === 'mana' && mine(e) && e.amount > 0);
      const gifts = own.filter(e => e.type === 'drops' && e.at).map(e => e.at), born = own.filter(e => e.type === 'spawned' && !mine(e) && e.at).map(e => e.at);
      const blind = own.some(e => e.type === 'status' && mine(e) && e.status === 'blind' && e.change === 'applied'), lost = own.some(e => e.type === 'essence' && mine(e) && e.amount < 0);
      const kind = healed || mana ? 'restore' : gifts.length ? 'gift' : born.length ? 'ambush' : blind ? 'splat' : hop ? 'teleport' : lost ? 'essence' : null;
      return spellFx.temptFate({ at: to, was: from, kind, cells: kind === 'gift' ? gifts : born, mana, release });
    }
    const caught = ev.ability === 'consecrate' ? [...new Set(own.filter(e => e.type === 'damaged' && e.id !== ev.id && e.dtype === 'light' && e.amount > 0).map(e => e.id))].map(at).filter(Boolean).map(t => ({ ...t, d: Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y)) })) : [];
    return spellFx.prayer({ id: ev.ability, at: from, release, caught });
  }
  function selfPlan(ev, own, from, row) {
    const release = (WINDUP[ev.clip] ?? WINDUP.cast) - 20, dead = new Set(own.filter(e => e.type === 'died').map(e => e.id));
    const struck = [...new Set(own.filter(e => e.type === 'attacked' && e.spell && e.id === ev.id && e.hit).map(e => e.target))];
    if (ev.ability === 'ironbody') return spellFx.ironBody({ at: from, release });
    if (ev.ability === 'bellow') return spellFx.bellow({ at: from, release, healed: own.some(e => e.type === 'healed' && e.id === ev.id) });
    if (ev.ability === 'heal') return spellFx.heal({ at: from, release });
    if (ev.ability === 'temper') return spellFx.temper({ at: from, release });
    if (ev.ability === 'unholyaura') return spellFx.unholyAura({ at: from });
    if (ev.ability === 'intothedark') return spellFx.intoTheDark({ at: from, release });
    if (ev.ability === 'shadowstep') return spellFx.shadowstep({ at: from, release });
    if (ev.ability === 'rolldice') return dicePlan(ev, own, from, release);
    if (ev.ability === 'stormform') return spellFx.stormForm({ at: from });
    if (ev.ability === 'dawn') return spellFx.dawn({ at: from, struck: struck.map(at).filter(Boolean) });
    if (ev.ability === 'earthquake') {
      const n = (row.effects ?? []).find(e => e.target?.selector === 'radius')?.target.n ?? 5, tiles = [];
      for (let y = from.y - n; y <= from.y + n; y++) for (let x = from.x - n; x <= from.x + n; x++) if (seen(x, y)) tiles.push({ x, y });
      return spellFx.earthquake({ at: from, radius: n, tiles, struck: struck.filter(id => !dead.has(id)) });
    }
    return null;
  }
  function dicePlan(ev, own, from, release) {
    const me = ev.id, mine = e => e.id === me, got = st => own.some(e => e.type === 'status' && mine(e) && e.status === st && e.change === 'applied');
    const hop = own.filter(e => e.type === 'teleported' && mine(e)).at(-1);
    return spellFx.rollDice({
      at: hop?.to ?? from, was: from, side: Math.floor(Date.now()) % 2 ? 1 : -1, release,
      healed: own.some(e => e.type === 'healed' && mine(e) && e.amount > 0), rampage: got('rampage'),
      spilt: own.some(e => e.type === 'mana' && mine(e) && e.amount < 0), chill: got('chill'), root: got('root'), blind: got('blind'),
      born: own.filter(e => e.type === 'spawned' && e.id !== me && e.at).map(e => e.at),
      gifts: own.filter(e => e.type === 'drops' && e.at).map(e => e.at),
    });
  }
  function doubleCut(ev, rest) {
    const foe = at(ev.target), me = at(ev.id);
    if (!foe || !me || !shown(ev.target)) return;
    const took = rest.find(e => (e.type === 'damaged' && e.id === ev.target && !e.cause) || e.type === 'attacked');
    if (took?.type !== 'damaged' || !(took.amount > 0)) return;
    const n = spell?.ability === 'double' ? (spell.cuts = (spell.cuts ?? 0) + 1) : 1;
    const plan = spellFx.doubleStrikeCut({ foe, side: foe.x < me.x ? -1 : 1, second: n % 2 === 0, unarmed: !!ev.unarmed, lean: (Math.random() - 0.5) * 0.12, at: WINDUP.melee + 60 });
    for (const c of plan.calls) K[c.fn]?.(...c.args);
  }

  // ---- playback.js watchProcs: what a blow sets off, as a flourish on the body it lands on (one blow at a time here)
  function hitProc(id, type, explicit = false) {
    const t = at(id);
    if (!t || !seen(t.x, t.y)) return;
    const beside = procShown.filter(q => q.id === id && q.blow === blowNo);
    if (beside.length >= 3 || beside.some(q => q.type === type)) return;
    K.proc(t.x, t.y, type, { at: 70 * beside.length });
    procShown.push({ id, type, blow: blowNo, explicit });
  }
  function smiteLook(id) {
    const t = at(id);
    if (!t || !shown(id) || !seen(t.x, t.y)) return;
    K.sparkle(t.x, t.y, 'light', 10); K.flare(t.x, t.y, '#FFF1C4', { dur: 300, heart: false });
  }
  function watchBlock(ev) {
    const g = guard;
    if (ev.type === 'attacked') guard = ev.hit && ev.blocked && ev.id && ev.target === player ? { by: ev.id, done: new Set() } : null;
    else if (!g) return;
    else if (ev.type === 'damaged' && ev.id === g.by && ev.dtype === 'fire' && ev.amount > 0 && !ev.cause) hitProc(g.by, 'fire', true);
    else if (ev.type === 'status' && (ev.change === 'applied' || (ev.change === 'stacked' && ev.status === 'chill')) && ev.id === g.by && BLOCK_PROC[ev.status]) {
      const el = BLOCK_PROC[ev.status];
      if (!g.done.has(el)) { g.done.add(el); hitProc(g.by, el, true); }
    } else if (ev.type === 'healed' && ev.amount > 0 && ev.id === player) hitProc(ev.id, 'heal', true);
  }
  function watchProcs(ev) {
    watchBlock(ev);
    if (ev.type === 'attacked' && ev.hit && ev.target) { blowNo += 1; blows.set(ev.target, { by: ev.id, area: !!ev.spell && !ev.bolt, n: 0, types: new Set(), crit: !!ev.crit, blow: blowNo }); }
    else if (ev.type === 'damaged' && ev.amount > 0 && !ev.cause) {
      const b = blows.get(ev.id);
      if (!b) return;
      b.n += 1; b.types.add(ev.dtype);
      if (ev.tags?.includes('smite')) { if (!ev.tags.includes('smite-again')) smiteLook(ev.id); return; }
      if (b.n > 1 && !b.area && b.by === player) hitProc(ev.id, ev.dtype ?? 'phys');
    } else if (ev.type === 'proc' && ev.id) {
      const t = shown(ev.id) ? at(ev.id) : null;
      if (ev.kind === 'smite') smiteLook(ev.id);
      else {
        if (ev.kind === 'fire-burst' && t && seen(t.x, t.y)) K.burst(t.x, t.y, 'fire', 16, 0.05);
        hitProc(ev.id, ev.kind === 'fire-burst' ? 'fire' : ev.kind, true);
      }
      if (ev.words && t) floatOn(ev.id, ev.words, DMG[ev.tone] ?? DMG.phys);
    } else if (ev.type === 'status' && ev.change === 'applied' && PROC_OF[ev.status]) {
      const b = blows.get(ev.id), marked = procShown.some(q => q.id === ev.id && q.explicit && q.blow === blowNo);
      if (b && !b.area && !marked) hitProc(ev.id, ev.status === 'stun' && b.types.has('lightning') ? 'lightning' : PROC_OF[ev.status]);
    } else if (ev.type === 'healed' && ev.amount > 0 && ev.id === player) {
      for (const b of blows.values()) if (b.by === ev.id && !b.area && b.blow === blowNo) { hitProc(ev.id, 'heal'); break; }
    }
  }
  let bossBlow = null;
  const bigNumber = ev => {
    if (ev.cause) return false;
    if (bossBlow && ev.by === bossBlow) return true;
    const b = blows.get(ev.id);
    return !!(b?.crit && b.n <= 1);
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i], rest = events.slice(i + 1);
    K = recorder();
    look = { c: K.calls };
    try {
      // CB45: a barrel set off by the blast beside it goes off 180 ms after it
      const near = ev.type === 'explosion' && ev.at && lastBoom && Math.max(Math.abs(ev.at.x - lastBoom.x), Math.abs(ev.at.y - lastBoom.y)) <= 1;
      if (ev.type === 'explosion' && ev.at) lastBoom = { x: ev.at.x, y: ev.at.y };
      const go = () => {
        try { eventFx(K, view, state, ev, seen); } catch (e) { look.error = String(e?.message ?? e); }
        watchProcs(ev);
        playLook(ev, rest);
      };
      if (near) K.after(180, go); else go();
    } catch (e) { look.error = String(e?.message ?? e); }
    if (look.c.length || Object.keys(look).length > 1) out[base + i] = look;
    if ((ev.type === 'moved' || ev.type === 'teleported') && ev.id && ev.to) pos.set(ev.id, { x: ev.to.x, y: ev.to.y });
    if (ev.type === 'spawned' && ev.id && ev.at) pos.set(ev.id, { x: ev.at.x, y: ev.at.y });
  }
  return out;

  // ---- playback.js play(): the branches that lay pieces, pose a body or time the turn
  function playLook(ev, rest) {
    if (ev.type === 'status' && ev.change === 'applied' && (ev.status === 'frozen' || ev.status === 'petrified') && shown(ev.id)) floatOn(ev.id, ev.status === 'frozen' ? 'frozen' : 'stone', ev.status === 'frozen' ? DMG.ice : DMG.phys);
    if (ev.type === 'status' && ev.status === 'stun' && ev.change === 'applied' && spell?.ability === 'sap' && shown(ev.id)) { const t = at(ev.id); K.swirl(t.x, t.y - 0.42, DMG.light, 0.42, { dur: 640, at: 90 }); }
    if (ev.type === 'boss-move' && ev.id) bossBlow = ev.id;
    else if (ev.type === 'attacked' && ev.id === bossBlow) bossBlow = null;
    if (ev.type === 'ability' && ev.id === player) {
      spell = castPicture(ev, rest);
      look.impact = spell.impact; look.hold = spell.hold;
      // WC5 (event-router.js): a cast over two tiles or more shows its struck tiles in sight for 0.65 s
      const tiles = castTiles(state, ev.ability, ev.at);
      if (tiles.length > 1) K.castSurface(tiles.filter(c => seen(c.x, c.y)).map(c => ({ x: c.x, y: c.y })));
    }
    // Upheaval's rocks whose time is up go (rules/effects/select.js); the ones still standing are named
    if (ev.type === 'terrain' && ev.what === 'upheaval-ends') K.rocksKeep((f?.props ?? []).filter(p => p.upheaval).map(p => [p.x, p.y]));
    if (ev.type === 'boss-move' && ev.move === 'pylon-beam' && ev.tiles?.some(t => seen(t.x, t.y))) {
      K.beam(ev.tiles.map(t => [t.x, t.y]), 'light', { col: ev.colour, dur: 320 });
      look.wait = 320 * 0.65;
      return;
    }
    const s = ev.id ? at(ev.id) : null, hero = ev.id === player;
    if (ev.type === 'face' && ev.dx) look.face = Math.sign(ev.dx);
    else if (ev.type === 'ability' || ev.type === 'sigil' || ev.type === 'amulet') {
      const who = ev.type === 'sigil' ? ev.by : ev.id;
      let clip = ev.type === 'ability' ? ev.clip : 'cast';
      if (ev.type === 'ability' && ev.ability === 'lance' && !clip) { const blows_ = rest.slice(0, (k => (k < 0 ? rest.length : k))(rest.findIndex(e => e.type === 'ability'))); if (!blows_.some(e => e.type === 'attacked' && e.id === ev.id)) clip = 'melee'; }
      if (ev.type !== 'ability') gearPicture(ev, rest, who);
      if (clip && at(who)) {
        look.who = who; look.clip = clip;
        if (ev.at && at(who) && ev.at.x !== at(who).x) look.face = Math.sign(ev.at.x - at(who).x);
        if (ev.ability !== 'arcaneblink') look.windup = WINDUP[clip] ?? 0;
      }
    } else if (ev.type === 'attacked' && ev.spell && hero && s) {
      const target = at(ev.target);
      if (spell?.ability === 'bonespear') look.impactWait = true;
      else if (ev.bolt || spell?.ability === 'chainbolt') {
        if (target) {
          const a = spell?.prev ?? s;
          if (!spell?.prev && target.x !== s.x) look.face = Math.sign(target.x - s.x);
          look.bolt = { a, b: target, type: spell?.ability === 'chainbolt' ? 'lightning' : boltType(ev, rest), discharge: !!spell?.prev };
          if (spell?.ability === 'chainbolt') spell.prev = target;
        }
      } else look.impactWait = true;
      if (target && !ev.hit) look.miss = shown(ev.target) ? 'miss' : null;
    } else if (ev.type === 'move-used' && (!ev.ranged || NO_SHOT.has(ev.move)) && s && !hero) {
      look.pose = specialClip(state, ev.id);
    } else if ((ev.type === 'boss-move' && !POSELESS.has(ev.move) || ev.type === 'telegraph') && s && !hero) {
      look.pose = specialClip(state, ev.id);
    } else if (ev.type === 'ring' && ev.at) {
      if (seen(ev.at.x, ev.at.y)) K.ring(ev.at.x, ev.at.y, ev.colour, ev.size);
    } else if ((ev.type === 'attacked' && ev.ranged || ev.type === 'move-used' && ev.ranged) && s) {
      const target = at(ev.target);
      if (target && target.x !== s.x) look.face = Math.sign(target.x - s.x);
      if (hero && !ev.spell) { look.pose = 'ranged'; look.windup = WINDUP.ranged; }
      else if (!hero) look.pose = ev.type === 'move-used' ? specialClip(state, ev.id) : 'attack';
      const el = ev.type === 'move-used' && shotOf(ev);
      if (el && target) {
        lastShot = `${s.x},${s.y}>${target.x},${target.y}`;
        look.bolt = { a: s, b: target, type: el, whole: true };
      } else if (target) {
        const own = ev.move === 'firebolt' ? 'fire' : ev.move === 'root-spit' ? 'earth' : null;
        look.bolt = { a: s, b: target, type: own ?? 'phys', arrow: !own };
      }
      if (ev.type === 'attacked' && target && !ev.hit) look.miss = shown(ev.target) ? (ev.deflected ? 'deflected' : 'miss') : null;
    } else if (ev.type === 'attacked' && s) {
      if (ev.label === 'Double Strike' && ev.hit && hero) doubleCut(ev, rest);
      if (!ev.hit) look.miss = shown(ev.target) ? (ev.parried ? 'parry' : 'miss') : null;
    } else if (ev.type === 'damaged') {
      if (!shown(ev.id) || !s) look.quiet = true;
      else {
        look.word = { col: ev.cause === 'bleed' ? DMG.blood : DMG[ev.dtype] ?? DMG.phys, big: bigNumber(ev) };
        if (spell?.ability === 'sap' && !ev.cause && ev.by === player) K.flare(s.x, s.y - 0.16, DMG.phys, { size: 0.6, dur: 340 });
      }
    } else if (ev.type === 'healed') {
      if (ev.regen || !shown(ev.id)) look.quiet = true;
      else look.word = { col: DMG.heal };
    } else if (ev.type === 'xp' && ev.amount > 0) floatOn(player, '+' + ev.amount + ' xp', DMG.xp);
    else if (ev.type === 'pickup' && (ev.what === 'essence' || ev.what === 'globe') && ev.n > 0) floatOn(player, ev.what === 'essence' ? '+' + ev.n : '+' + ev.n + ' mp', ev.what === 'essence' ? DMG.magic : DMG.ice);
    else if (ev.type === 'level' && at(player)) { const t = at(player); K.sparkle(t.x, t.y, 'light', 40); K.ring(t.x, t.y, '#E8B44A', 2.5); }
    else if (FORGE_SPARK[ev.type] && at(player) && (ev.type !== 'hero' || ev.change === 'upgrade')) {
      const t = at(player), [n, type] = FORGE_SPARK[ev.type];
      K.sparkle(t.x, t.y, type ?? EL_TRAIL[ev.element] ?? 'magic', n);
      // FX28 (event-router.js fused, spell-fx.js infusionColours): the infusion's own moment, once the Forge is shut
      if (ev.type === 'fused') { const col = spellFx.infusionColours(ev.element); K.infuse(col.col, col.pale); }
    } else if (ev.type === 'absorbed' && shown(ev.id)) floatOn(ev.id, '-' + ev.amount, DMG[ev.tone ?? POOL_TONE[ev.pool] ?? 'magic']);
    else if (ev.type === 'float' && ev.at && !ev.id) { if (seen(ev.at.x, ev.at.y)) look.c.push(['float', [null, String(ev.words), ev.tone === 'blood' ? '#c8382e' : DMG[ev.tone] ?? DMG.phys, ev.at, false]]); }
    else if (ev.type === 'float' && ev.id) { if (shown(ev.id)) floatOn(ev.id, ev.words, DMG[ev.tone ?? WORD_TONE[ev.words]] ?? DMG.phys, !!ev.big); look.quiet = true; }
    else if (ev.type === 'miss' && ev.id && (ev.id === player || shown(ev.id))) floatOn(ev.id, 'miss', DMG.miss);
    else if (ev.type === 'bolt' && ev.arrow && ev.from && ev.to) {
      if (ev.by === player) { look.who = player; look.pose = 'ranged'; look.windup = WINDUP.ranged; if (ev.to.x !== ev.from.x) look.face = Math.sign(ev.to.x - ev.from.x); }
      look.bolt = { a: ev.from, b: ev.to, type: 'phys', arrow: true };
    } else if (ev.type === 'bolt' && ev.arc && ev.from && ev.to) {
      if (seen(ev.from.x, ev.from.y) || seen(ev.to.x, ev.to.y)) look.bolt = { a: ev.from, b: ev.to, type: 'lightning', discharge: true };
    } else if (ev.type === 'bolt' && ev.from && ev.to) {
      if (ev.acidSpit && s) look.windup = WINDUP.cast;
      const key = `${ev.from.x},${ev.from.y}>${ev.to.x},${ev.to.y}`;
      if (key === lastShot) lastShot = null;
      else if (seen(ev.from.x, ev.from.y) || seen(ev.to.x, ev.to.y)) look.bolt = { a: ev.from, b: ev.to, type: ev.kind ?? ev.element ?? 'phys', whole: true };
    } else if (ev.type === 'explosion' && ev.at) {
      // FX11: fire and earth thrown out, rolling smoke, a shake and the blast's flash; out of sight, the shake alone
      if (seen(ev.at.x, ev.at.y)) { K.explosion(ev.at.x, ev.at.y); K.light(ev.at.x, ev.at.y, '#FF7A30', { r: 7, s: 0.9, flash: 700 }); } else K.shake(10);
    } else if (ev.type === 'blocked' && s && ev.at) look.bump = { x: ev.at.x - s.x, y: ev.at.y - s.y };
  }
}

/** Where each body stands as a command begins (the 2D game's sprites until the events move them). */
export function standing(state) {
  const m = new Map();
  for (const [id, a] of Object.entries(state?.actors ?? {})) if (a && Number.isFinite(a.x)) m.set(id, { x: a.x, y: a.y });
  return m;
}
