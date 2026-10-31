// Plays the engine's events on screen, in order, with the clock's timing.
// Audio and the log listen to the same events as they play.

import ui from '../../data/ui.json' with { type: 'json' };
import monsters from '../../data/monsters.json' with { type: 'json' };
import bosses from '../../data/bosses.json' with { type: 'json' };
import abilities from '../../data/abilities.json' with { type: 'json' };
import prayers from '../../data/prayers.json' with { type: 'json' };
import { walkable, opaque } from '../data/tiles.js';
import * as spellFx from './spell-fx.js';
import { DAMAGE_COLOUR, ELEMENT_TRAIL as EL_TRAIL } from '../data/palette.js';   // C9 (render-11)
import { sigilPlan, amuletPlan } from './sigil-fx.js';
import amuletData from '../../data/amulets.json' with { type: 'json' };
import { devicePx, timeline } from './clock.js';
const SPECIAL_CLIP = new Map(Object.values(monsters.rows).filter(r => r.look?.specialClip).map(r => ['mob-' + r.look.sheet, r.look.specialClip]));

const MOVE_MS = ui.motion.moveMs, LUNGE_MS = 230;
// RB30 (1.7 game.js:133-136, :148-149 lungeFx, entOffset): a blow's lunge is a sine out and back over 230 ms, 0.42 tile
// along each axis toward the foe; it holds the turn for 55% of that (fxAt's hold) and finishes under the next command.
const LUNGE = { ms: LUNGE_MS, reach: 0.42, hold: 0.55 };
// 1.7's pacing (Justin 2026-10-17): a melee blow's lunge after its wind-up, the share of a kill's fall that holds the
// turn, and how far behind the screen may fall before a turn plays at once.
const MELEE_LUNGE_MS = LUNGE.ms * LUNGE.hold, KILL_RELEASE = 0.6, BACKLOG_MS = 900;
// 1.7 render.js:713 CLIP_WINDUP: how long a clip winds up before its shot leaves or its spell lets go.
const WINDUP = { melee: 170, ranged: 300, cast: 260 };
// Events that play without waiting and may ride along inside a group of moves.
const INSTANT = new Set(['sight', 'pulse', 'noticed', 'door', 'ground', 'status', 'log']);
const hex = s => Number('0x' + s.slice(1));
const DMG = Object.fromEntries(Object.entries(ui.damageColours).filter(([k]) => k !== 'src').map(([k, v]) => [k, hex(v)]));
// E45 (1.7 damage-adapter.js:33-34, :142, :159; effect-adapter.js:72, :104, :114): a word with no tone of its own floats
// in 1.7's colour for it: a blow turned away grey, ice breaking or forming frost; an absorbed blow takes its pool's colour
// (Ice Armor frost, Guard and Iron Hide plain, the wards magic).
const WORD_TONE = { immune: 'miss', block: 'miss', shell: 'miss', cracked: 'miss', ward: 'miss', shatter: 'ice', frozen: 'ice', hiss: 'ice' };
const POOL_TONE = { 'ice-armor': 'ice', guard: 'phys', ironhide: 'phys', sporecoat: 'heal' };   // EP48 (1.7 sporecaller.js:128): a Sporecoat's soak in the heal colour
const XP_COL = hex(DAMAGE_COLOUR.xp);   // 1.7 content/data.js DMG_COL.xp, a warm gold
// G37: the Forge's sparkles on the hero, [count, palette] (no palette: the element's own, 1.7 TRAIL_EL).
const FORGE_SPARK = { fused: [50], enchanted: [40], carved: [24, 'fire'], hero: [30, 'fire'] };
// A creature's shot flies as its move row names it (C14, render-08: monsters.json and bosses.json `shot`, set from 1.7's
// boltFx: the move's damage type as an element, the Underdark's globe dark, webs white silk, the Priestess's bolt blood,
// the Thought Eater's sap and lash magic, the harpoon a plain physical bolt; 'none' for a move used from a distance
// that strikes where it stands: the Heart's spikes, the Siren's song and the Drowned One's drag, the Djinn's cyclone, the
// reaching blows and the vent, Iron Brace). A support cast's `bolt` to its ally wins (EP19, EP33). A move with no row
// shot flies in the element its event names (PL7, CH7: the Prism Seer's turn, bile, the Lens Beam). shotOf: the bolt's
// element, or null for the plain streak or none.
const MOVE_EL = {}, NO_SHOT = new Set();
for (const mv of [...Object.values(monsters.rows ?? {}).flatMap(r => r.moves ?? []), ...Object.values(bosses.rows ?? {}).flatMap(r => (r.actions ?? []).flatMap(a => a.moves ?? []))]) {
  if (mv.shot === 'none') NO_SHOT.add(mv.id);
  else if (mv.shot) MOVE_EL[mv.id] ??= mv.shot;
  if (mv.bolt) MOVE_EL[mv.id] = mv.bolt;
}
const SHOT_EL = new Set(['fire', 'ice', 'lightning', 'poison', 'dark', 'magic', 'light', 'earth', 'phys', 'blood', 'web']);
export const shotOf = ev => (NO_SHOT.has(ev.move) ? null : MOVE_EL[ev.move] ?? (SHOT_EL.has(ev.element) ? ev.element : null));
// UD14: boss moves that are not a pose of their own: a channel's tick, a death, a body under the ground or leaving it.
const POSELESS = new Set(['channel', 'death', 'phylactery-broken', 'surfacing', 'erupt', 'dive', 'emerge']);

export function createPlayback(clock, map, { seen = () => true, player = () => null, cue = () => {}, ally = () => false } = {}) {
  // Sandbox item 43 (Justin 2026-10-16: "don't do that unless they are attacking"): a creature's move between two
  // unseen tiles, and a blow or death nobody can see that does not touch the hero, play at once with no tween.
  const hidden = ev => {
    if (ev.player || ev.id === player() || ev.target === player()) return false;
    if (ev.type === 'moved') return !seen(ev.from.x, ev.from.y) && !seen(ev.to.x, ev.to.y);
    const a = ev.id ? map.sprite(ev.id)?.root : null, t = ev.target ? map.sprite(ev.target)?.root : null;
    const unseen = r => !r || !seen(Math.floor(r.x / map.tile), Math.floor(r.y / map.tile - 0.5));
    return unseen(a) && unseen(t);
  };
  // RB27 (1.7 turn-presentation.js:10-15): a number, a flash or a miss shows only over a body the hero can see: the
  // hero always, a creature while a tile of its footprint is in sight.
  const shown = id => {
    if (!id) return false;
    if (id === player()) return true;
    const sp = map.sprite(id), r = sp?.root;
    if (!r || sp.destroyed) return false;
    const n = sp.size ?? 1, tx = Math.floor(r.x / map.tile), ty = Math.floor(r.y / map.tile - 0.5);
    for (let y = ty; y < ty + n; y++) for (let x = tx; x < tx + n; x++) if (seen(x, y)) return true;
    return false;
  };
  const listeners = [];
  let lastShot = null;   // the tiles of the shot a ranged move just flew, so its own bolt event does not fly it again
  const tileOf = r => ({ x: r.x / map.tile - 0.5, y: r.y / map.tile - 1 });
  let queue = Promise.resolve(), pending = 0;
  const leapt = new WeakMap();   // CH5: the swing a leaping body began in the air
  // Movement rebuild (feel spec 2.1, 2.2; Justin 2026-10-17: "the point was to right new code because the old code was
  // slow and all over the place"): a step is a slide in the clock's store, set at once and never awaited, so a turn of
  // moves holds nothing. Each frame the pose puts every slid body where its slide says at the frame's time, plus its
  // lunge or bump offsets (which the camera and the light leave out, item 89); a body lands exactly on its tile and
  // goes idle there. Blows, casts, shots and deaths still hold the turn, and wait for the bodies they name to land.
  const posed = new Set();
  const base = s => clock.pos?.(s) ?? { x: s.root.x - (s.root.offX ?? 0), y: s.root.y + (s.root.hop ?? 0) - (s.root.offY ?? 0) };
  const ensure = s => { if (clock.slide && !clock.slideOf(s)) clock.slide?.(s, base(s), { instant: true }); posed.add(s); };
  // The pose runs right after main's pump and before every other frame call (the camera, the light), on whole device
  // pixels (feel spec 2.1 step 3, 1.7 render.js:216-218).
  clock.onFrame?.(() => {
    const T = clock.now, u = map.scale && map.resolution ? 1 / (map.scale * map.resolution) : 0;
    for (const s of posed) {
      if (s.destroyed) { posed.delete(s); continue; }
      const at = clock.pos(s, T), r = s.root;
      if (!at) continue;
      r.hop = at.hop; r.x = devicePx(at.x + (r.offX ?? 0), u); r.y = devicePx(at.y + (r.offY ?? 0) - at.hop, u);
      if (at.p >= 1) {
        if (s.action === 'walk' && !leapt.has(s)) s.idle();
        if (!r.offX && !r.offY) posed.delete(s);
      }
    }
  }, true);
  // When the bodies an event names have all landed (the clock's time); a blow starts at max(now, their landings).
  const landing = ev => Math.max(-Infinity, ...[ev.id, ev.target].filter(Boolean).map(id => map.sprite(id)).filter(Boolean).map(sp => clock.landing?.(sp) ?? -Infinity));
  // RB30: each body's lunge under way, {x0, y0, stop, done}; a step or a blink stops it, a second blow starts from its rest.
  const lunges = new WeakMap();
  const lunge = (s, toX, toY, beat, windup) => {
    const r = s.root, prev = lunges.get(s);
    if (prev) prev.stop = true;
    ensure(s);
    const { x: x0, y: y0 } = base(s);
    const sx = Math.sign(Math.round(toX - x0)), sy = Math.sign(Math.round(toY - y0)), k = map.tile * LUNGE.reach;
    const tok = { x0, y0, stop: false, done: false };
    lunges.set(s, tok);
    return clock.tween(LUNGE.ms, p => {
      if (tok.stop || s.destroyed) return;
      const a = Math.sin(p * Math.PI) * k;
      r.offX = sx * a; r.offY = sy * a;   // item 89: an offset the pose adds, which the camera does not follow
    }, 'linear', beat, windup).then(() => { if (!tok.stop && !s.destroyed) { r.offX = r.offY = 0; posed.add(s); } tok.done = true; });
  };
  // CH10 (1.7 unmaker-encounter.js:32-249 'cast'): the Unmaker's specials play its cast clip, every other creature's its attack.
  const specialClip = s => SPECIAL_CLIP.get(s.sheet) ?? 'melee';   // render-19: monsters.json look.specialClip

  // The hero's spells as 1.7 drew them (spell-fx.js on the pieces kit, fx-kit.js): a bolt flies in its element and an
  // area spell's picture starts with its cast; its hits wait for the blow to land (impact) and the turn for the
  // picture (hold). spell: the hero's last cast this run.
  let spell = null;
  const tileAt = r => ({ x: Math.round(r.x / map.tile - 0.5), y: Math.round(r.y / map.tile - 1) });
  const boltType = (ev, rest) => {
    // 1.7 combat.js:594-597: the bolt takes the spell's damage type, an Earth spell's physical blow flying as earth
    const row = spell?.row, t = rest.find(e => e.type === 'damaged' && e.id === ev.target)?.dtype ?? row?.type ?? 'magic';
    return t === 'phys' && row?.element === 'earth' ? 'earth' : t;
  };
  function castPicture(ev, rest) {
    const K = map.pieces, row = abilities.rows[ev.ability] ?? prayers.rows[ev.ability], hero = map.sprite(ev.id), from = ev.from ?? (hero ? tileAt(hero.root) : null), at = ev.at;
    const cur = { ability: ev.ability, row, from, impactAt: 0, holdUntil: 0, prev: null };
    if (!K || !from || !row) return cur;
    const floor = map.floor?.(), open = t => !floor || walkable(floor, t.x, t.y);
    // the events this cast set off, up to the first a creature took its own turn with
    const own = [];
    for (const e of rest) { if (e.type === 'ability' || (e.id && e.id !== ev.id && (e.type === 'moved' || e.type === 'move-used' || (e.type === 'attacked' && !e.spell)))) break; own.push(e); }
    let plan = null;
    if (ev.ability === 'fireball' && at) {
      // 1.7 elements.js:314: a fire bolt that bursts into the blast, with the explosion sound
      const d = Math.max(1, Math.abs(at.x - from.x), Math.abs(at.y - from.y));
      K.bolt(from.x, from.y, at.x, at.y, 'fire', { explosion: true, at: spellFx.RELEASE, onLand: () => cue('explosion') });
      plan = { calls: [], impact: spellFx.RELEASE + 110 + 55 * d, hold: spellFx.RELEASE + 110 + 55 * d };
    } else if (ev.ability === 'frostcone' && at) plan = spellFx.frostCone({ from, at, floorTiles: (ev.area ?? []).filter(open) });
    else if (ev.ability === 'radiantbeam' && ev.area?.length) plan = spellFx.radiantBeam({ from, tiles: ev.area });
    else if (ev.ability === 'lance' && ev.area?.length) plan = spellFx.lance({ from, tiles: ev.area, release: WINDUP[ev.clip] ?? WINDUP.melee });
    else if (ev.ability === 'venom-burst') plan = spellFx.venomBurst({ at: from });
    else if (ev.ability === 'shadowswarm') plan = spellFx.shadowSwarm({ spots: own.filter(e => e.type === 'spawned' && e.summon).map(e => e.at) });
    else if (ev.ability === 'glacialtomb' && at) {
      const self = ev.target === player(), splash = [];
      if (!self) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) splash.push({ x: at.x + dx, y: at.y + dy });
      plan = spellFx.glacialTomb({ at, splash });
    } else if (ev.ability === 'livingflame' && at) plan = spellFx.livingFlame({ at });
    else if (ev.ability === 'upheaval' && at) {
      const walls = own.find(e => e.type === 'terrain' && e.what === 'upheaval')?.tiles ?? [], dead = new Set(own.filter(e => e.type === 'died').map(e => e.id));
      const struck = [...new Set(own.filter(e => e.type === 'attacked' && e.spell && e.id === ev.id && e.hit).map(e => e.target))].filter(id => !dead.has(id));
      plan = spellFx.upheaval({ from, at, walls, struck });
      map.heave?.(plan.heave);
    } else if (ev.ability === 'umbral' && at) plan = spellFx.umbralPassage({ from, to: at, echo: own.find(e => e.type === 'spawned' && /^echo-/.test(e.id ?? '') && e.at)?.at });
    else if (ev.ability === 'charge' || ev.ability === 'lunge') plan = runPlan(ev, own, from);
    else if (row.kind === 'prayer') plan = prayerPlan(ev, own, from);
    if (!plan) plan = selfPlan(ev, own, from, row);
    if (!plan) return cur;
    for (const c of plan.calls) {
      if (c.fn === 'quiver') K.quiver(map.sprite(c.id), ...c.args);
      else if (c.fn === 'ring') { if (seen(c.args[0], c.args[1])) map.pieces?.ring(...c.args); }
      else if (c.fn === 'fx') { if (seen(c.args[1], c.args[2])) map.pieces?.[c.args[0]]?.(...c.args.slice(1)); }   // the effects layer's own pieces (its web sparkle)
      else K[c.fn]?.(...c.args);
    }
    cur.impactAt = K.now + plan.impact; cur.holdUntil = K.now + plan.hold;
    return cur;
  }

  // G38, EQ10 (1.7 sigil-adapter.js:24-219, amulets.js:86-240): a sigil's seal and piece, and an amulet's own piece
  // (sigil-fx.js), laid as the read begins on the reader's tile; the events the read set off say whom it struck, where
  // it carried the reader and what the Hook dragged.
  function gearPicture(ev, rest, reader) {
    const K = map.pieces;
    if (!K || ev.failed || !reader?.root || reader.root.destroyed) return;
    const me = tileAt(reader.root), who = ev.by ?? ev.id;
    const own = [];
    for (const e of rest) { if (e.type === 'sigil' || e.type === 'amulet' || e.type === 'ability' || (e.id && e.id !== who && (e.type === 'move-used' || e.type === 'attacked'))) break; own.push(e); }
    const spot = id => { const sp = map.sprite(id); return sp?.root && !sp.root.destroyed ? tileAt(sp.root) : null; };
    const bodies = list => [...new Set(list.map(e => e.id))].map(spot).filter(Boolean);
    let plan;
    if (ev.type === 'sigil') {
      const hurt = type => bodies(own.filter(e => e.type === 'damaged' && e.by === who && e.id !== who && e.dtype === type && !e.cause));
      const foes = ev.id === 'storm' ? hurt('lightning') : ev.id === 'sunburst' ? hurt('light')
        : ev.id === 'mire' ? bodies(own.filter(e => e.type === 'status' && e.status === 'root' && e.change === 'applied' && e.id !== who)) : [];
      const hop = own.find(e => e.type === 'teleported' && e.id === who), floor = map.floor?.();
      const spots = ev.id === 'naturesbounty' ? (floor?.items ?? []).filter(i => i.item?.kind === 'food' && Math.max(Math.abs(i.x - me.x), Math.abs(i.y - me.y)) <= 2 && (i.x !== me.x || i.y !== me.y)) : [];
      // E21: what the chosen piece became (Rot, Ascension, Transmutation) and whether one piece was read (Knowledge)
      const changed = own.find(e => e.type === 'hero' && /^item-/.test(e.change ?? ''))?.change.slice(5) ?? null;
      const read = own.some(e => e.type === 'identified' && e.which === 'one-chosen') && !own.some(e => e.type === 'log' && e.words === 'All gear identified.');
      plan = sigilPlan(ev.id, { at: me, foes, spots, carry: hop ? { from: hop.from, to: hop.to } : null, changed, read });
    } else {
      const moved = own.filter(e => e.type === 'moved');
      const mine = moved.find(e => e.id === who), theirs = moved.find(e => e.id !== who);
      // Item 262: the Hook throws its iron grappling hook (map-words.js grapple) at the body it drags in, or at the anchor
      // it hauls the wearer to, and bites as the cast lets go, with a clink.
      if (ev.amulet === 'hook') { if (mine || theirs) map.grapple?.(who, mine ? { at: ev.at } : { id: theirs.id }, { bite: spellFx.RELEASE, onBite: () => cue('parry') }); return; }
      const lv = ev.level ?? 1, radius = amuletData.rows?.seeking?.values?.radius?.byLevel?.[lv - 1] ?? 16;
      plan = amuletPlan(ev.amulet, { at: me, radius, swap: ev.amulet === 'swap' && mine ? { from: mine.from, to: mine.to } : null });
    }
    for (const c of plan.calls) K[c.fn]?.(...c.args);
  }

  // CF21, CF22 (1.7 classes.js:107-129, :172-194): Lunge's steel streak into the foe and its glint as the blow lands, and
  // Charge's shake, dust streak, landing ripple and a bloom on each body it stuns. The hero turns toward the run's end
  // (1.7 faceOf), a foe or open ground alike. The run is the dash's 'moved' (MOVE_MS), the blow half a lunge after it.
  // Foes do not move in it, so their sprites stand on their tiles as the cast is read.
  function runPlan(ev, own, from) {
    const run = own.find(e => e.type === 'moved' && e.id === ev.id && e.dash), to = run?.to ?? from, land = run ? MOVE_MS : 0;
    const hero = map.sprite(ev.id), aim = ev.at ?? to;
    if (hero && aim.x !== from.x) hero.face(aim.x - from.x);
    if (ev.ability === 'lunge') {
      const foe = ev.target && map.sprite(ev.target), mark = foe ? tileAt(foe.root) : ev.at;
      if (!mark) return null;
      const hit = own.some(e => e.type === 'damaged' && e.id === ev.target && e.amount > 0 && !e.cause);
      return spellFx.lunge({ from, foe: mark, hit, blow: land + LUNGE_MS / 2 });
    }
    const stunned = own.filter(e => e.type === 'status' && e.status === 'stun' && e.change === 'applied' && e.id !== ev.id).map(e => map.sprite(e.id)).filter(Boolean).map(sp => tileAt(sp.root));
    return spellFx.charge({ from, to, land, stunned });
  }
  // CF23 (1.7 gods.js:416-488 prayerFx): a prayer's moment as the cast lets go, in its god's colour; Consecrate's light
  // catches on each unholy body it burned, later the farther off it stands.
  function prayerPlan(ev, own, from) {
    const release = (WINDUP[ev.clip] ?? WINDUP.cast) - 20, me = ev.id, mine = e => e.id === me;
    const hop = own.filter(e => e.type === 'teleported' && mine(e)).at(-1);
    // RB43: the spear's line as the rules walk it (effects.js 'line'), and the step of each body it ran through
    if (ev.ability === 'bonespear' && ev.at) {
      const f = map.floor?.(), dx = ev.at.x - from.x, dy = ev.at.y - from.y, steps = Math.max(Math.abs(dx), Math.abs(dy)), path = [];
      for (let i = 1; steps && i <= 6; i++) { const x = Math.round(from.x + dx * i / steps), y = Math.round(from.y + dy * i / steps); if (f && opaque(f, x, y)) break; path.push({ x, y }); }
      const pierced = [...new Set(own.filter(e => e.type === 'attacked' && e.spell && mine(e) && e.hit).map(e => e.target))].map(id => map.sprite(id)).filter(Boolean).map(sp => { const t = tileAt(sp.root); return path.findIndex(p => p.x === t.x && p.y === t.y); }).filter(k => k >= 0);
      return spellFx.boneSpear({ from, path, pierced, release });
    }
    if (ev.ability === 'arcaneblink') return hop ? spellFx.arcaneBlink({ from: hop.from, to: hop.to }) : null;   // CF25
    if (ev.ability === 'the-brood') return spellFx.theBrood({ at: from, landed: own.filter(e => e.type === 'spawned' && e.summon && e.at).map(e => e.at), release });   // CF26
    if (ev.ability === 'rolldice2') {
      // CF24: which way Tempt Fate fell, read from what it did
      const at = hop?.to ?? from, healed = own.some(e => e.type === 'healed' && mine(e) && e.amount > 0), mana = own.some(e => e.type === 'mana' && mine(e) && e.amount > 0);
      const gifts = own.filter(e => e.type === 'drops' && e.at).map(e => e.at), born = own.filter(e => e.type === 'spawned' && !mine(e) && e.at).map(e => e.at);
      const blind = own.some(e => e.type === 'status' && mine(e) && e.status === 'blind' && e.change === 'applied'), lost = own.some(e => e.type === 'essence' && mine(e) && e.amount < 0);
      const kind = healed || mana ? 'restore' : gifts.length ? 'gift' : born.length ? 'ambush' : blind ? 'splat' : hop ? 'teleport' : lost ? 'essence' : null;
      return spellFx.temptFate({ at, was: from, kind, cells: kind === 'gift' ? gifts : born, mana, release });
    }
    const caught = ev.ability === 'consecrate' ? [...new Set(own.filter(e => e.type === 'damaged' && e.id !== ev.id && e.dtype === 'light' && e.amount > 0).map(e => e.id))].map(id => map.sprite(id)).filter(Boolean).map(sp => { const t = tileAt(sp.root); return { ...t, d: Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y)) }; }) : [];
    return spellFx.prayer({ id: ev.ability, at: from, release, caught });
  }

  // E35, E38, E39, E40 (1.7 casting-adapter.js:3-42, :143-197): the invokes on the hero (Iron Body, Bellow, Heal,
  // Temper), Earthquake, Storm Form and Dawn. An invoke lets go at its own clip's release; Earthquake shakes what it
  // struck and left standing, Dawn sends a ray onto each body it struck.
  function selfPlan(ev, own, from, row) {
    const release = (WINDUP[ev.clip] ?? WINDUP.cast) - 20, dead = new Set(own.filter(e => e.type === 'died').map(e => e.id));
    const struck = [...new Set(own.filter(e => e.type === 'attacked' && e.spell && e.id === ev.id && e.hit).map(e => e.target))];
    if (ev.ability === 'ironbody') return spellFx.ironBody({ at: from, release });
    if (ev.ability === 'bellow') return spellFx.bellow({ at: from, release, healed: own.some(e => e.type === 'healed' && e.id === ev.id) });
    if (ev.ability === 'heal') return spellFx.heal({ at: from, release });
    if (ev.ability === 'temper') return spellFx.temper({ at: from, release });
    // E36 (1.7 casting-adapter.js:43-69, :202-211): the shadow invokes and Shadowstep, at the clip's release.
    if (ev.ability === 'unholyaura') return spellFx.unholyAura({ at: from });
    if (ev.ability === 'intothedark') return spellFx.intoTheDark({ at: from, release });
    if (ev.ability === 'shadowstep') return spellFx.shadowstep({ at: from, release });
    if (ev.ability === 'rolldice') return dicePlan(ev, own, from, release);
    if (ev.ability === 'stormform') return spellFx.stormForm({ at: from });
    if (ev.ability === 'dawn') return spellFx.dawn({ at: from, struck: struck.map(id => map.sprite(id)).filter(Boolean).map(sp => tileAt(sp.root)) });
    if (ev.ability === 'earthquake') {
      const n = (row.effects ?? []).find(e => e.target?.selector === 'radius')?.target.n ?? 5, f = map.floor?.(), tiles = [];
      for (let y = from.y - n; y <= from.y + n; y++) for (let x = from.x - n; x <= from.x + n; x++) if ((!f || (x >= 0 && y >= 0 && x < f.w && y < f.h)) && seen(x, y)) tiles.push({ x, y });
      return spellFx.earthquake({ at: from, radius: n, tiles, struck: struck.filter(id => !dead.has(id)) });
    }
    return null;
  }
  // E37 (1.7 casting-adapter.js:100-137 wobblesRollFx): the dice are thrown on every roll, and what the roll did is read
  // from the events it set off: the hero whisked away, healed, in a Rampage, his mana spilt, a prank on his body, what
  // it conjured and where its gift fell. The dice tumble one way or the other by the clock, as 1.7's did.
  function dicePlan(ev, own, from, release) {
    const me = ev.id, mine = e => e.id === me, got = st => own.some(e => e.type === 'status' && mine(e) && e.status === st && e.change === 'applied');
    const hop = own.filter(e => e.type === 'teleported' && mine(e)).at(-1);
    return spellFx.rollDice({
      at: hop?.to ?? from, was: from, side: Math.floor(performance.now()) % 2 ? 1 : -1, release,
      healed: own.some(e => e.type === 'healed' && mine(e) && e.amount > 0), rampage: got('rampage'),
      spilt: own.some(e => e.type === 'mana' && mine(e) && e.amount < 0), chill: got('chill'), root: got('root'), blind: got('blind'),
      born: own.filter(e => e.type === 'spawned' && e.id !== me && e.at).map(e => e.at),
      gifts: own.filter(e => e.type === 'drops' && e.at).map(e => e.at),
    });
  }

  // E41 (1.7 casting-adapter.js:89-99 doubleStrikeFx): each Double Strike blow that takes HP leaves a soft cut across
  // the foe as the body lunges in (60 ms into the lunge, after the swing's wind-up); the second crosses the first. Bare
  // fists leave a soft knock instead, one to each side.
  function doubleCut(ev, rest, s, target) {
    const K = map.pieces;
    if (!K || !target || target.destroyed || !shown(ev.target)) return;
    const took = rest.find(e => (e.type === 'damaged' && e.id === ev.target && !e.cause) || e.type === 'attacked');
    if (took?.type !== 'damaged' || !(took.amount > 0)) return;
    const n = spell?.ability === 'double' ? (spell.cuts = (spell.cuts ?? 0) + 1) : 1, me = tileAt(s.root), foe = tileAt(target.root);
    const plan = spellFx.doubleStrikeCut({ foe, side: foe.x < me.x ? -1 : 1, second: n % 2 === 0, unarmed: !!ev.unarmed, lean: (Math.random() - 0.5) * 0.12, at: (ally(ev.id) ? 0 : WINDUP.melee) + 60 });
    for (const c of plan.calls) K[c.fn]?.(...c.args);
  }

  // G30, E42 (1.7 actions-adapter.js:124-146 hitProc, fx.js procFx): what a blow sets off shows on the body it lands on
  // as a quarter-second flourish in its own kind: the hero's riders' extra packets in their damage type, a status the
  // blow lays (Burn a lick of flame, Chill a frost bloom, Root grit, Poison a drip, Bleed a spatter, Fear or Corrupt a
  // wisp of shadow, Blind a glint, Stun a snap or a puff), life drunk back a green lift on the hero. Only in sight, each
  // kind once a body a blow, at most three on a body, 70 ms apart. An area spell's own statuses are its picture's.
  const PROC_OF = { burn: 'fire', chill: 'ice', frozen: 'ice', root: 'earth', poison: 'poison', bleed: 'blood', fear: 'dark', corrupt: 'dark', hollow: 'dark', rot: 'dark', snuffed: 'dark', blind: 'light', coward: 'light', stun: 'phys' };
  const blows = new Map();
  let procShown = [];
  function hitProc(id, type, explicit = false) {
    const K = map.pieces, sp = id ? map.sprite(id) : null;
    if (!K || !sp || sp.destroyed || !sp.root.visible || !(sp.root.alpha > 0)) return;
    const t = tileAt(sp.root);
    if (!seen(t.x, t.y)) return;
    procShown = procShown.filter(q => q.when + 600 > K.now);
    const beside = procShown.filter(q => q.id === id && Math.abs(q.when - K.now) < 200);
    if (beside.length >= 3 || beside.some(q => q.type === type)) return;
    K.proc(t.x, t.y, type, { at: 70 * beside.length });
    procShown.push({ id, type, when: K.now, explicit });
  }
  // FX27 (1.7 fx.js:759 smiteFx, combos.js:68): Smite fires often, so it is a brief soft flare on the body, nothing
  // from the sky, no flash and no pale heart, with 10 light sparkles.
  function smiteLook(id) {
    const K = map.pieces, sp = id ? map.sprite(id) : null;
    if (!K || !sp || sp.destroyed || !shown(id)) return;
    const t = tileAt(sp.root);
    if (!seen(t.x, t.y)) return;
    K.sparkle(t.x, t.y, 'light', 10); K.flare(t.x, t.y, '#FFF1C4', { dur: 300, heart: false });
  }
  // EQ17 (1.7 shieldench.js:22-40 onShieldBlock hitProc): a blow the hero's shield blocks gets the same small flourish a
  // weapon's trigger has, from what the shield's enchantment did: fire thrown back flames on the attacker, a chill
  // frosts it, a thunderclap's stun snaps lightning, a corruption laid a wisp of shadow, the light shield's mend a green
  // lift on the hero. guard: the attacker of the blow just blocked, until the next blow.
  const BLOCK_PROC = { chill: 'ice', frozen: 'ice', stun: 'lightning', corrupt: 'dark' };
  let guard = null;
  function watchBlock(ev, K) {
    const g = guard && K.now - guard.at < 700 ? guard : null;
    if (ev.type === 'attacked') guard = ev.hit && ev.blocked && ev.id && ev.target === player() ? { by: ev.id, at: K.now, done: new Set() } : null;
    else if (!g) return;
    else if (ev.type === 'damaged' && ev.id === g.by && ev.dtype === 'fire' && ev.amount > 0 && !ev.cause) hitProc(g.by, 'fire', true);
    // A Water block chills even a body already chilled (1.7 addChill then hitProc 'ice' each time): a re-stack's
    // 'stacked' event counts as the fresh chill does; one ice flourish a block, should the chill also freeze it.
    else if (ev.type === 'status' && (ev.change === 'applied' || (ev.change === 'stacked' && ev.status === 'chill')) && ev.id === g.by && BLOCK_PROC[ev.status]) {
      const el = BLOCK_PROC[ev.status];
      if (!g.done.has(el)) { g.done.add(el); hitProc(g.by, el, true); }
    }
    else if (ev.type === 'healed' && ev.amount > 0 && ev.id === player()) hitProc(ev.id, 'heal', true);
  }
  function watchProcs(ev) {
    const K = map.pieces;
    if (!K) return;
    watchBlock(ev, K);
    const fresh = id => { const b = blows.get(id); return b && K.now - b.at < 700 ? b : null; };
    if (ev.type === 'attacked' && ev.hit && ev.target) blows.set(ev.target, { at: K.now, by: ev.id, area: !!ev.spell && !ev.bolt, n: 0, types: new Set(), crit: !!ev.crit });
    else if (ev.type === 'damaged' && ev.amount > 0 && !ev.cause) {
      const b = fresh(ev.id);
      if (!b) return;
      b.n += 1; b.types.add(ev.dtype);
      // FX27 (1.7 actions-adapter.js:232): the Light affinity's smite is a sparkle of light and one soft bloom on the
      // body (smiteFx, no pale heart), not a proc's glint. Swift Judgment's second smite marks itself (its 'proc' event).
      if (ev.tags?.includes('smite')) { if (!ev.tags.includes('smite-again')) smiteLook(ev.id); return; }
      if (b.n > 1 && !b.area && b.by === player()) hitProc(ev.id, ev.dtype ?? 'phys');
    } else if (ev.type === 'proc' && ev.id) {
      // E17: a combo's or an infusion's own mark (effects.js procAfter). Swift Judgment's second smite is a sparkle of
      // light and a pale bloom (1.7 sparkleFx 10, smiteFx); the fire orb's crit throws fire off the body first.
      const sp = map.sprite(ev.id), t = sp && !sp.destroyed && shown(ev.id) ? tileAt(sp.root) : null;
      if (ev.kind === 'smite') smiteLook(ev.id);
      else {
        if (ev.kind === 'fire-burst' && t && seen(t.x, t.y)) K.burst(t.x, t.y, 'fire', 16, 0.05);
        hitProc(ev.id, ev.kind === 'fire-burst' ? 'fire' : ev.kind, true);
      }
      if (ev.words && t) map.float(ev.id, ev.words, DMG[ev.tone] ?? DMG.phys);
    } else if (ev.type === 'status' && ev.change === 'applied' && PROC_OF[ev.status]) {
      const b = fresh(ev.id), marked = procShown.some(q => q.id === ev.id && q.explicit && K.now - q.when < 200);
      if (b && !b.area && !marked) hitProc(ev.id, ev.status === 'stun' && b.types.has('lightning') ? 'lightning' : PROC_OF[ev.status]);
    } else if (ev.type === 'healed' && ev.amount > 0 && ev.id === player()) {
      for (const b of blows.values()) if (b.by === ev.id && !b.area && K.now - b.at < 700) { hitProc(ev.id, 'heal'); break; }
    }
  }

  // CB22 (1.7 combat.js:411, :446, :620 floatText big): a critical hit's own number, and a boss's slam, shockwave or
  // charge, show big; a proc riding on the crit keeps the usual size.
  let bossBlow = null, lastBoom = null;
  const bigNumber = ev => {
    if (ev.cause) return false;
    if (bossBlow && ev.by === bossBlow.id && performance.now() - bossBlow.at < 1500) return true;
    const b = blows.get(ev.id);
    return !!(b?.crit && b.n <= 1 && (!map.pieces || map.pieces.now - b.at < 700));
  };

  async function play(ev, rest = [], step = null) {
    // CB45 (1.7 systems.js:484 deferScene 180): a barrel set off by the blast beside it goes off 180 ms after it, its
    // sound and its burst together, so a row of barrels goes one after another.
    if (ev.type === 'explosion' && ev.at) {
      const near = lastBoom && performance.now() - lastBoom.t < 1500 && Math.max(Math.abs(ev.at.x - lastBoom.x), Math.abs(ev.at.y - lastBoom.y)) <= 1;
      if (near) await clock.wait(180);
      lastBoom = { x: ev.at.x, y: ev.at.y, t: performance.now() };
    }
    for (const fn of listeners) fn(ev);
    watchProcs(ev);
    // E45 (1.7 effect-adapter.js:72, :104 onFrozen): a body frozen floats "frozen" in frost, one petrified "stone".
    if (ev.type === 'status' && ev.change === 'applied' && (ev.status === 'frozen' || ev.status === 'petrified') && shown(ev.id)) map.float(ev.id, ev.status === 'frozen' ? 'frozen' : 'stone', ev.status === 'frozen' ? DMG.ice : DMG.phys);
    // CB24 (1.7 combat.js:634-635): a body Sap leaves standing and stunned sees stars, pale motes wheeling over its head.
    if (ev.type === 'status' && ev.status === 'stun' && ev.change === 'applied' && spell?.ability === 'sap' && map.pieces && shown(ev.id)) { const t = tileAt(map.sprite(ev.id).root); map.pieces.swirl(t.x, t.y - 0.42, DAMAGE_COLOUR.light, 0.42, { dur: 640, at: 90 }); }
    if (ev.type === 'boss-move' && ev.id) bossBlow = { id: ev.id, at: performance.now() };
    else if (ev.type === 'attacked' && ev.id === bossBlow?.id) bossBlow = null;   // its ordinary blows after are not the move's
    if (ev.type === 'ability' && ev.id === player()) spell = castPicture(ev, rest);
    if (ev.type === 'boss-move' && ev.move === 'pylon-beam' && map.pieces && ev.tiles?.some(t => seen(t.x, t.y))) {
      // FX10 (1.7 unmaker-encounter.js:211): a pylon's shaft of light along its marked line, from its first cell, in the
      // pylon's colour; the blows wait for it to swell (1.7 fxAt hold 0.65). The pylon fires, not the boss: no pose.
      const dur = clock.instant ? 180 : 320;
      map.pieces.beam(ev.tiles.map(t => [t.x, t.y]), 'light', { col: ev.colour, dur });
      await map.pieces.wait(dur * 0.65);
      return;
    }
    const s = ev.id ? map.sprite(ev.id) : null;
    const r = s?.root;
    if (s && (ev.type === 'moved' || ev.type === 'teleported')) { const l = lunges.get(s); if (l) { l.stop = l.done = true; r.offX = r.offY = 0; } }   // RB30; item 89
    if (s && ['moved', 'attacked', 'move-used', 'died', 'swung', 'blocked', 'teleported'].includes(ev.type) && hidden(ev)) {
      if (ev.type === 'moved' || ev.type === 'teleported') { posed.add(s); clock.slide?.(s, map.centre(ev.to.x, ev.to.y), { from: base(s), instant: true }); }
      if (ev.type === 'died' && !ev.player) map.remove(ev.id);
    } else if (ev.type === 'moved' && ev.leap && s) {
      // CH5 (1.7 chaos-enemies.js:287-296): the Gorehound's Pounce is a leap, not a step: straight and linear over
      // max(180, 1.65 moves), arcing 0.7 tile high (hop 5), its attack clip winding up in the air so the bite lands with it.
      const b = map.centre(ev.to.x, ev.to.y), dur = Math.max(180, Math.round(MOVE_MS * 1.65)), peak = map.tile * 0.14 * 5;
      s.face(b.x - base(s).x);
      s.play('walk', false);
      const flight = s.animation;
      posed.add(s);
      clock.slide?.(s, b, { t0: step?.t0, from: base(s), unit: map.tile, ms: dur, exact: true, hop: peak });
      clock.wait(Math.max(0, dur - WINDUP.melee), flight ?? timeline(clock)).then(() => {
        if (s.destroyed || s.animation !== flight) return;
        const swing = s.play('melee'), leap = { swing, run: s.animation };
        leapt.set(s, leap); swing.then(run => { if (leapt.get(s) !== leap) return; leapt.delete(s); if (!s.destroyed) s.idle(run); });   // no bite came: back to its idle
      });
    } else if (ev.type === 'moved' && s) {
      const b = map.centre(ev.to.x, ev.to.y);
      s.face(b.x - base(s).x);
      if (s.action !== 'walk') s.play('walk', false);
      // The body's own step (body.js step: RC57's run rows, item 78's low hop); item 109: 200 ms.
      const hop = map.tile * (s.step ?? { hop: 0.05 }).hop;
      posed.add(s);
      // CV17: one of a body's several steps in a turn (step.append) follows on from the last, in its share of the time.
      if (step?.append) clock.slide?.(s, b, { unit: map.tile, ms: step.ms, append: true, hop });
      else if (step?.ms) clock.slide?.(s, b, { t0: step.t0, from: base(s), unit: map.tile, ms: step.ms, exact: true, hop });
      else clock.slide?.(s, b, { t0: step?.t0, from: base(s), unit: map.tile, ms: MOVE_MS, hop });
    } else if (ev.type === 'face' && s && ev.dx) {
      s.face(ev.dx);   // CF22: the rules turn the hero toward what he acts on (1.7 player.face)
    } else if (ev.type === 'ability' || ev.type === 'sigil' || ev.type === 'amulet') {
      // E10, E34, RC2, EQ31 (spec/magic.md D11): a spell, an invoke, a sigil read or an amulet plays the hero's cast (the Bellow its
      // straight swing; an ability that swings the weapon plays its blows instead), and what it does waits for the
      // wind-up, as 1.7's effects did (setClip and fxClock, render.js:860-894; casting-adapter.js selfCastReleaseAt).
      const c = ev.type === 'sigil' ? map.sprite(ev.by) : s;
      let clip = ev.type === 'ability' ? ev.clip : 'cast';
      // RB42 (1.7 recovery.js:55 setClip melee): Lance swings even when its beam strikes no one (its blows play their own)
      if (ev.type === 'ability' && ev.ability === 'lance' && !clip) { const blows = rest.slice(0, (k => (k < 0 ? rest.length : k))(rest.findIndex(e => e.type === 'ability'))); if (!blows.some(e => e.type === 'attacked' && e.id === ev.id)) clip = 'melee'; }
      if (c && ev.type !== 'ability') gearPicture(ev, rest, c);   // G38, EQ10
      if (c && clip) {
        const at = ev.at && map.centre(ev.at.x, ev.at.y);
        if (at) c.face(at.x - c.root.x);
        c.play(clip, true, { straight: !!ev.straight }).then(run => { if (!c.destroyed) c.idle(run); });
        if (ev.ability !== 'arcaneblink') await clock.wait(WINDUP[clip] ?? 0, c.animation ?? timeline(clock));   // CF25: a blink waits on no wind-up (1.7 gods.js:599)
      }
    } else if (ev.type === 'teleported' && s && (ev.blink || (spell?.ability === 'arcaneblink' && ev.id === player()))) {   // CF25: Vellum's Blink is there at once too
      // CH6 (chaos-enemies.js:250): a blink is there and gone at once, in its sparkles (event-fx.js).
      posed.add(s); clock.slide?.(s, map.centre(ev.to.x, ev.to.y), { from: base(s), instant: true });
    } else if (ev.type === 'teleported' && s) {
      // A teleport rune: a quick fade out and back in at the new tile.
      await clock.tween(120, p => { r.alpha = 1 - p; });
      posed.add(s); clock.slide?.(s, map.centre(ev.to.x, ev.to.y), { from: base(s), instant: true });
      await clock.tween(120, p => { r.alpha = p; });
    } else if (ev.type === 'attacked' && ev.spell && ev.id === player() && s && map.pieces) {
      // CB23, E03: the hero's spell bolt flies as its element (1.7 boltFx); Chain Lightning's first bolt flies from him and
      // each jump after it is a static discharge from the body before. An area's hits wait for its picture's blow.
      const target = map.sprite(ev.target), K = map.pieces;
      if (spell?.ability === 'bonespear') {
        // RB43: the spear is one bolt down the whole line (its cast picture); each body waits for it to pass
        if (spell.impactAt > K.now && !clock.instant) await K.wait(spell.impactAt - K.now);
        if (target && !ev.hit && shown(ev.target)) map.float(ev.target, 'miss', DMG.miss);
      } else if (ev.bolt || spell?.ability === 'chainbolt') {
        if (target) {
          const a = spell?.prev ?? tileAt(r), b = tileAt(target.root);
          if (!spell?.prev) s.face(target.root.x - r.x);
          await K.bolt(a.x, a.y, b.x, b.y, spell?.ability === 'chainbolt' ? 'lightning' : boltType(ev, rest), { staticDischarge: !!spell?.prev });
          if (spell?.ability === 'chainbolt') spell.prev = b;
        }
        if (target && !ev.hit && shown(ev.target)) map.float(ev.target, 'miss', DMG.miss);
      } else if (spell?.impactAt > K.now && !clock.instant) await K.wait(spell.impactAt - K.now);
    } else if (ev.type === 'move-used' && (!ev.ranged || NO_SHOT.has(ev.move)) && s && !s.hero) {
      // CR5: a creature's special that is not a shot plays its attack clip as it casts (1.7 setClip(e, 'attack')): a
      // summon, a heal or ward, a ritual. A blow that follows starts the same clip again at once, so it reads as one.
      s.play(specialClip(s)).then(run => { if (!s.destroyed) s.idle(run); });
    } else if ((ev.type === 'boss-move' && !POSELESS.has(ev.move) || ev.type === 'telegraph') && s && !s.hero) {
      // UD14: a caster's attack pose as it calls its mark, shrieks or lets its move go (1.7 setClip(e, 'attack')).
      s.play(specialClip(s)).then(run => { if (!s.destroyed) s.idle(run); });
    } else if (ev.type === 'ring' && ev.at && map.pieces) {
      // E16: a ring on a tile in sight (the Living Flame's every third shot, 1.7 ringFx).
      if (seen(ev.at.x, ev.at.y)) map.pieces.ring(ev.at.x, ev.at.y, ev.colour, ev.size);
    } else if ((ev.type === 'attacked' && ev.ranged || ev.type === 'move-used' && ev.ranged) && s) {
      // M4: a ranged blow or a ranged move (Firebolt, Root Spit) flies instead of a lunge.
      const target = map.sprite(ev.target);
      if (target) s.face(target.root.x - r.x);
      // RC2: the hero's bow shot plays the shoot row and leaves at its release; a spell's bolt leaves from the cast the
      // 'ability' event began (and waited out), so the hero does not swing it. A creature's shot plays its attack.
      if (s.hero && !ev.spell) { s.play('ranged').then(run => { if (!s.destroyed) s.idle(run); }); await clock.wait(WINDUP.ranged, s.animation ?? timeline(clock)); }
      else if (!s.hero) s.play(ev.type === 'move-used' ? specialClip(s) : 'melee').then(run => { if (!s.destroyed) s.idle(run); });
      const el = ev.type === 'move-used' && shotOf(ev);
      if (el && map.pieces && target) {
        const a = tileOf(r), b = tileOf(target.root);
        lastShot = `${Math.round(a.x)},${Math.round(a.y)}>${Math.round(b.x)},${Math.round(b.y)}`;
        await map.pieces.bolt(a.x, a.y, b.x, b.y, el, { whole: true });   // C9: the one effects layer; it holds its whole flight
      } else if (map.pieces && target) {
        // FX4, FX6: Firebolt and Root Spit fly as fire and earth (1.7 combat.js:293, :313); any other shot is an arrow,
        // drawn and loosed fast (1.7 actions-adapter.js:271). Each bursts where it lands, with or without the lighting.
        const a = tileOf(r), b = tileOf(target.root), own = ev.move === 'firebolt' ? 'fire' : ev.move === 'root-spit' ? 'earth' : null;
        await map.pieces.bolt(a.x, a.y, b.x, b.y, own ?? 'phys', { arrow: !own });
      } else await map.bolt(ev.id, ev.target);
      if (ev.type === 'attacked' && target && !ev.hit && shown(ev.target)) map.float(ev.target, ev.deflected ? 'deflected' : 'miss', DMG.miss);   // CB11
    } else if (ev.type === 'attacked' && s) {
      const target = map.sprite(ev.target), x0 = r.x, y0 = r.y;
      const dx = target ? target.root.x - x0 : 0;
      s.face(dx);
      const leap = leapt.get(s), airborne = leap && leap.run === s.animation;
      const swing = airborne ? leap.swing : s.play('melee'), run = s.animation;   // CH5: reuse the swing begun in the air
      const beat = run ?? timeline(clock);
      leapt.delete(s);
      if (ev.label === 'Double Strike' && ev.hit && ev.id === player()) doubleCut(ev, rest, s, target);
      // Justin 2026-10-17 ("ok, yes", 1.7's melee hold): the turn waits for the swing's wind-up (170 ms) and its lunge
      // (about 125 ms), then the rest of the swing plays on under the next command.
      // RB27 (1.7 pacing.js:40-42): an ally's swing at a foe holds the turn only for its lunge.
      const windup = !ally(ev.id) || ev.target === player() ? WINDUP.melee : 0;
      await clock.wait(windup, beat);
      if (target) lunge(s, target.root.x, target.root.y, beat, windup);   // RB30: 230 ms, 0.42 tile; the miss shows at its height
      await clock.wait(windup + LUNGE.ms / 2, beat);
      if (target && !ev.hit && shown(ev.target)) map.float(ev.target, ev.parried ? 'parry' : 'miss', DMG.miss);
      await clock.wait(windup + MELEE_LUNGE_MS, beat);
      Promise.race([swing, clock.wait(400, timeline(clock, beat.rate))]).then(() => { if (!s.destroyed) s.idle(run); });
    } else if (ev.type === 'damaged' && s && !shown(ev.id)) {
      // RB27: a blow on a body out of sight shows no number.
    } else if (ev.type === 'damaged' && s) {
      map.float(ev.id, String(ev.amount), (ev.cause === 'bleed' ? DMG.blood : DMG[ev.dtype] ?? DMG.phys), null, bigNumber(ev));
      // CB24 (1.7 combat.js:616-618): Sap lands as a soft dull thump about the head as its number shows.
      if (spell?.ability === 'sap' && !ev.cause && ev.by === player() && map.pieces) { const t = tileAt(r); map.pieces.flare(t.x, t.y - 0.16, DAMAGE_COLOUR.phys, { size: 0.6, dur: 340 }); }
      s.flash(true);
      s.play('hurt').then(run => { if (!s.destroyed) s.idle(run); });
      clock.wait(120).then(() => { if (!s.destroyed) s.flash(false); });
    } else if (ev.type === 'healed' && s && shown(ev.id)) {
      // E46 (1.7 damage-adapter.js:416): regeneration's trickle floats no number; the HP bar shows it.
      if (!ev.regen) map.float(ev.id, '+' + ev.amount, DMG.heal);
    } else if (ev.type === 'xp' && ev.amount > 0 && player() && map.sprite(player())) {
      // G36 (1.7 progression-adapter.js:135): XP earned floats over the hero in gold.
      map.float(player(), '+' + ev.amount + ' xp', XP_COL);
    } else if (ev.type === 'pickup' && (ev.what === 'essence' || ev.what === 'globe') && ev.n > 0 && player() && map.sprite(player())) {
      // CB35 (1.7 systems.js:126): essence taken floats '+N' in magic violet; E18 (1.7 capstones.js:33) a mana globe '+N mp' in ice.
      map.float(player(), ev.what === 'essence' ? '+' + ev.n : '+' + ev.n + ' mp', ev.what === 'essence' ? DMG.magic : DMG.ice);
    } else if (ev.type === 'level' && map.pieces && map.sprite(player())) {
      // G36 (1.7 progression-adapter.js:141): a level gained sparkles light on the hero in a gold ring.
      const t = tileAt(map.sprite(player()).root);
      map.pieces.sparkle(t.x, t.y, 'light', 40); map.pieces.ring(t.x, t.y, '#E8B44A', 2.5);
    } else if (FORGE_SPARK[ev.type] && map.pieces && map.sprite(player()) && (ev.type !== 'hero' || ev.change === 'upgrade')) {
      // G37 (1.7 forge-adapter.js:30, :48, :63, :89): the Forge's work sparkles on the hero, a mote or an enchantment in its
      // element's sparks (fused 50, enchanted 40), a carving (24) and an upgrade (30) in fire. The infusion itself is main's.
      const t = tileAt(map.sprite(player()).root), [n, type] = FORGE_SPARK[ev.type];
      map.pieces.sparkle(t.x, t.y, type ?? EL_TRAIL[ev.element] ?? 'magic', n);
    } else if (ev.type === 'absorbed' && s && shown(ev.id)) {
      map.float(ev.id, '-' + ev.amount, DMG[ev.tone ?? POOL_TONE[ev.pool] ?? 'magic']);   // E45: in its pool's colour (1.7 damage-adapter.js:40, :159)
    } else if (ev.type === 'float' && ev.at && !ev.id) {
      // A number over a tile in sight (WC13: the ritual's -2 over the cage, in blood red).
      if (seen(ev.at.x, ev.at.y)) map.float(null, ev.words, ev.tone === 'blood' ? 0xc8382e : DMG[ev.tone] ?? DMG.phys, ev.at);
    } else if (ev.type === 'float' && s && shown(ev.id)) {
      map.float(ev.id, ev.words, DMG[ev.tone ?? WORD_TONE[ev.words]] ?? DMG.phys, null, !!ev.big);   // UD16: big, as 1.7 floatText's last argument
    } else if (ev.type === 'noticed' && s && shown(ev.id)) {
      // RC40: a foe that notices the hero wears 1.7's standing '!' while its surprise lasts (status-badges.js), no float.
    } else if (ev.type === 'miss' && s && (ev.id === player() || seen(Math.floor(s.root.x / map.tile), Math.floor(s.root.y / map.tile - 0.5)))) {
      // CH12 (chaos-enemies.js:154, unmaker-encounter.js:136 floatText 'miss'): a creature's spell or shot that misses
      // floats 'miss' over the body it missed, after its bolt has flown; over a body in sight only.
      map.float(ev.id, 'miss', DMG.miss);
    } else if (ev.type === 'died' && ev.vanish && s) {
      // CH19 (1.7 unmaker-encounter.js:270): the Unmaker's demons go with it, gone in their magic burst (event-fx.js), no clip.
      map.remove(ev.id);
    } else if (ev.type === 'died' && s) {
      // FX15 (1.7 fx.js:144-147): a body that leaves no remains fades over the last quarter of its death clip while the
      // clip plays, not after it. FX16: the Living Flame fades itself as it dissipates (living-flame.js).
      const dieMs = Math.min(1200, s.clipMs('death') ?? 1200);
      if (!ev.player && !map.leavesRemains?.(ev.id) && !s.fadesOwnDeath) clock.wait(dieMs * 0.75).then(() => clock.tween(dieMs * 0.25, p => { if (!s.destroyed) r.alpha = 1 - p; }));
      // Justin 2026-10-17 ("yes", 1.7's pacing): a kill gives input back at 60% of the fall; the rest of the clip and the
      // fade play on under the next move. The hero's own death is seen through.
      // RB10: the fallen hero lies where he fell under the end screen (1.7 run-events.js:104-106).
      // FX14: a body that leaves remains lies where it fell (map-view.js).
      const gone = Promise.race([s.play('death'), clock.wait(1200)]).then(() => { if (!ev.player) map.remove(ev.id); });
      if (ev.player) await gone;
      else await Promise.race([gone, clock.wait(dieMs * KILL_RELEASE)]);
    } else if (ev.type === 'swung' && s) {
      // A blow at a prop (a crate, a pot, a bush): the melee swing and lunge toward its tile, as 1.7 (sandbox 56).
      const c = map.centre(ev.at.x, ev.at.y);
      s.face(c.x - r.x);
      // Item 122 (Justin 2026-10-17: "crates and things shash after the animation ends and not when the animation hits
      // strike"): the prop breaks on the strike, the wind-up and the lunge's share as a blow at a creature; the rest of
      // the swing plays on.
      const swing = s.play('melee'), run = s.animation, beat = run ?? timeline(clock);
      await clock.wait(WINDUP.melee, beat);
      lunge(s, c.x, c.y, beat, WINDUP.melee);   // RB30 (1.7 systems.js:363 lungeFx at a prop)
      await clock.wait(WINDUP.melee + MELEE_LUNGE_MS, beat);
      Promise.race([swing, clock.wait(400, timeline(clock, beat.rate))]).then(() => { if (!s.destroyed) s.idle(run); });
    } else if (ev.type === 'bolt' && ev.arrow && map.pieces && ev.from && ev.to) {
      // CB02 (1.7 shootProp): the hero's arrow at a crate or barrel, the shoot row first, as a shot at a foe.
      const shooter = ev.by && map.sprite(ev.by);
      if (shooter?.hero) { shooter.face(ev.to.x - ev.from.x); shooter.play('ranged').then(run => { if (!shooter.destroyed) shooter.idle(run); }); await clock.wait(WINDUP.ranged, shooter.animation ?? timeline(clock)); }
      await map.pieces.bolt(ev.from.x, ev.from.y, ev.to.x, ev.to.y, 'phys', { arrow: true });
    } else if (ev.type === 'bolt' && ev.arc && map.pieces && ev.from && ev.to) {
      // E42: an air arc jumps from the struck body to the next as a static discharge (1.7 damage-adapter.js:227)
      if (seen(ev.from.x, ev.from.y) || seen(ev.to.x, ev.to.y)) await map.pieces.bolt(ev.from.x, ev.from.y, ev.to.x, ev.to.y, 'lightning', { staticDischarge: true });
    } else if (ev.type === 'bolt' && map.pieces && ev.from && ev.to) {
      if (ev.acidSpit && s) {
        s.face(ev.to.x - ev.from.x);
        await clock.wait(WINDUP.cast, s.animation ?? timeline(clock));
      }
      // Beetle Arc and the Spark Jelly's chain jumps (1.7 boltFx 'lightning'); a shot its ranged move already flew is skipped.
      const key = `${ev.from.x},${ev.from.y}>${ev.to.x},${ev.to.y}`;
      if (key === lastShot) lastShot = null;
      else if (seen(ev.from.x, ev.from.y) || seen(ev.to.x, ev.to.y)) await map.pieces.bolt(ev.from.x, ev.from.y, ev.to.x, ev.to.y, ev.kind ?? ev.element ?? 'phys', { whole: true });   // FX9: the sentries' bolts are light
    } else if (ev.type === 'explosion' && ev.at && map.pieces) {
      // FX11 (1.7 explosionFx, fx.js:60-64): fire and earth thrown out, rolling smoke and a shake of 10; out of sight, the shake alone
      if (seen(ev.at.x, ev.at.y)) { map.pieces.explosion(ev.at.x, ev.at.y); map.flash?.(ev.at.x, ev.at.y, 0xff7a30); } else map.pieces.shake(10);
    } else if (ev.type === 'blocked' && s) {
      ensure(s);
      const { x: x0, y: y0 } = base(s), c = map.centre(ev.at.x, ev.at.y), dx = c.x - x0, dy = c.y - y0;
      await clock.tween(120, p => { const k = Math.sin(p * Math.PI) * 0.12; r.offX = dx * k; r.offY = dy * k; });
      r.offX = r.offY = 0; posed.add(s);   // item 89: the bump is an offset; the camera stays
    }
  }

  return {
    /**
     * Plays a turn's events; resolves when the ones that hold (blows, casts, shots, deaths) have played. Moves never
     * hold: with nothing else playing, a turn's moves are set at once, in the caller's frame, starting at o.t0.
     */
    run(events, o = {}) {
      const queuedAt = performance.now(), start = pending === 0;
      pending += 1;
      const go = async () => {
        // Justin 2026-10-17 (1.7's cap): a turn more than 900 ms behind plays at once (clock.rush, C6: not the Motion option).
        const late = performance.now() - queuedAt > BACKLOG_MS, wasRush = clock.rush;
        if (late) clock.rush = true;
        try {
        map.sprite(player())?.stir?.();   // RC59: a turn passing ends the hero's beer
        spell = null;
        // Moves that follow each other happen at the same time; everything else plays in turn. Instant events
        // between them (the hero's new sight, the world pulse) do not split the group, so the monsters walk with
        // the hero instead of after them (sandbox item 43: a step took two move lengths).
        for (let i = 0; i < events.length;) {
          let j = i;
          while (j < events.length && (events[j].type === 'moved' || (j > i && INSTANT.has(events[j].type) && events.slice(j).some(e => e.type === 'moved')))) j++;
          if (j > i) {
            // CV17: one body's steps in a group are waypoints of one slide (a Storm Beetle's charge slides down its lane),
            // each a share of one step's time, a dash's at half a step a tile.
            const runs = new Map(), loose = [], t0 = Math.max(o.t0 ?? -Infinity, clock.now);
            for (const e of events.slice(i, j)) if (e.type === 'moved' && e.id) (runs.get(e.id) ?? runs.set(e.id, []).get(e.id)).push(e); else loose.push(e);
            for (const list of runs.values()) list.forEach((e, k) => play(e, [], list.length > 1 ? { t0, ms: e.dash ? MOVE_MS / 2 : MOVE_MS / list.length, append: k > 0 } : { t0 }));
            for (const e of loose) play(e);
            i = j;
          } else {
            const ev = events[i], wait = landing(ev) - clock.now;
            if (wait > 0 && !clock.instant && !INSTANT.has(ev.type)) {
              // landing is already a wall-time deadline, scaled when the slide began; do not scale or re-anchor it.
              const arrival = timeline(clock, 1); arrival.fresh = false;
              await clock.wait(wait, arrival);
            }
            await play(ev, events.slice(i + 1)); i++;
          }
        }
        // 1.7 hold: a great spell is seen through before the next thing happens
        const K = map.pieces, left = spell && K ? spell.holdUntil - K.now : 0;
        if (left > 0 && !clock.instant) await K.wait(left);
        } finally { if (late) clock.rush = wasRush; }
      };
      queue = (start ? go() : queue.then(go)).finally(() => { pending -= 1; });
      return queue;
    },
    get busy() { return pending > 0; },
    listen(fn) { listeners.push(fn); },
  };
}
