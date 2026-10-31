// The effects each event shows on the map, as 1.7 called them (moved from fx-layer.js, consolidation C9, render-01):
// sparks, rings, shots and shakes, through the one effects layer (fx-kit.js, view.pieces). Positions are tiles (x + 0.5
// is a tile's middle). `seen(x, y)` limits tile bursts to what is in sight. Reads the game, never writes it.

import ui from '../../data/ui.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import { T as TILE, tileAt } from '../data/tiles.js';
import { GOD_COLOUR as GOD_COL, ELEMENT_TRAIL as EL_SPARK } from '../data/palette.js';

/** Where a body stands, in tiles (its sprite while it plays, else the game's record). */
function at(view, game, id) {
  const s = view.sprite?.(id)?.root;
  if (s && !s.destroyed) return { x: Math.round(s.x / view.tile - 0.5), y: Math.round(s.y / view.tile - 1) };
  const a = game?.actors?.[id];
  return a ? { x: a.x, y: a.y } : null;
}
const HAZARD_BURST = ui.eventBursts.planeHazard, TRAP_BURST = ui.eventBursts.trap;   // render-22: the numbers in ui.json

/**
 * The effects each event shows, as 1.7 called them: crypt.js:88, :298-366 (Morty and the poison clouds),
 * cavernmobs.js:186, :252, :374-375, :531-534, :575, :602, :614-620 (the Caverns and the Deep Maw), portals.js:277 and
 * planesfwa.js:343 (plane hazards), and every event's shake. `seen(x, y)` limits tile bursts to what is in sight.
 */
/**
 * 1.7 trapSpotFx (searchfx.js:14-19): every way of finding a trap (in passing, searching, Keen Eyes) rings its tile and
 * lifts an orange '!' off it as the chime plays. Nothing under reduced motion.
 */
export function trapSpotFx(fx, at, view) {
  if (fx.reduced) return;
  fx.ring(at.x, at.y, '#E2622B', 1.2);
  view.float?.(null, '!', 0xE2622B, at, false, { jitter: false });   // render-27: the map's floating words, held still (1.7 floatText)
}

/**
 * 1.7 searchSweepFx (searchfx.js:22-46): a ring opening to the edge of the searched square, a few motes of dust at
 * the hero's feet, and a glint on about half the tiles in sight, ring by ring outward 110 ms apart (walls skipped,
 * hidden doors not). The pad's quiet wait-and-search (P3, searchfx.js:27-28) is one faint ring and nothing else.
 * Nothing under reduced motion.
 */
export function searchSweepFx(fx, view, game, ev) {
  if (fx.reduced) return;
  const { x, y } = ev.at, f = game?.floor;
  if (ev.quiet) { fx.ring(x, y, '#E8D9A8', 2.4, { a: 0.22, w: 1.5, dur: 600 }); return; }
  fx.ring(x, y, '#E8D9A8', 2.6);
  fx.burst(x, y, 'magic', 8, 0.02);
  if (!f) return;
  for (let d = 1; d <= (ev.radius ?? 2); d++) {
    fx.after(d * 110, () => {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        const tx = x + dx, ty = y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || tx < 0 || ty < 0 || tx >= f.w || ty >= f.h || !game.vis?.[ty * f.w + tx]) continue;
        if (tileAt(f, tx, ty) === TILE.WALL) continue;
        if (Math.random() < 0.55) fx.sparkle(tx, ty, 'light', 2);
      }
    });
  }
}

const kindOf = (game, id) => game?.actors?.[id]?.kind;

/**
 * C14 (render-05): the move effects that are data, ui.json moveFx by event type and move: each op a burst, sparkle or
 * ring on the move's target, its user or its marked tiles, in sight unless it says seen: false. True when the table
 * named the move (the code below then leaves it alone).
 */
function tableFx(fx, game, ev, places, vis) {
  const ops = ui.moveFx[ev.type]?.[ev.move];
  if (!ops) return false;
  for (const o of ops) {
    if ((o.if === 'hit' && !ev.hit) || (o.kind_of && kindOf(game, ev.id) !== o.kind_of)) continue;
    for (const c of o.at === 'tiles' ? ev.tiles ?? [] : [places[o.at]]) {
      if (!c || (o.seen !== false && !vis(c)) || (o.chance !== undefined && !(Math.random() < o.chance))) continue;
      if (o.op === 'burst') fx.burst(c.x, c.y, o.kind, o.n, o.spread);
      else if (o.op === 'sparkle') fx.sparkle(c.x, c.y, o.kind, o.n);
      else if (o.op === 'ring') fx.ring(c.x, c.y, o.colour, o.r);
    }
  }
  return true;
}

/**
 * The Crypt's, the Underdark's and the planes' move effects, as 1.7 called them: crypt.js:204 (the Necro-Acolyte's
 * raise), deepmobs.js:203-570 (darkness, webs, the Priestess, cocoons, the Matron's ritual, brood, tithe and venom) and
 * planesfwa.js:329-523 (vents, Cinder Imp, Wind Wisp, Emberlord, Leviathan, Djinn). Bursts on tiles out of sight are
 * left out, as 1.7 drew nothing there.
 */
export function moveFx(fx, view, game, ev, seen = () => true) {
  const vis = c => !!c && seen(c.x, c.y), me = () => at(view, game, ev.id), body = id => (id ? at(view, game, id) : null);
  if ((ev.type === 'move-used' || ev.type === 'boss-move') && tableFx(fx, game, ev, { target: body(ev.target), self: me() }, vis)) return;
  if (ev.type === 'move-used') {
    if (ev.move === 'raise-skeleton') {
      // crypt.js:204: the skeleton rises in a dark sparkle where it stands
      const m = game?.actors?.[game?.actors?.[ev.id]?.minion], c = m ? { x: m.x, y: m.y } : null;
      if (vis(c)) fx.sparkle(c.x, c.y, 'dark', 24);
    }
    // CH8 (chaos-enemies.js:183): the brood flies from the carrier to each child's tile in its element, all at once
    else if (ev.move === 'brood' && ev.children) { const c = me() ?? ev.from; if (c) for (const q of ev.children) if (vis(c) || vis(q)) fx.bolt(c.x, c.y, q.x, q.y, ev.element ?? 'poison', { whole: true }); }
  } else if (ev.type === 'boss-move') {
    const c = me();
    if ((ev.move === 'tithe' || ev.move === 'brood') && c) {
      fx.ring(c.x, c.y, '#D0203A', 6);
      const p = body(game?.playerId);
      if (ev.move === 'tithe' && p) { fx.bolt(p.x, p.y, c.x, c.y, 'blood', { whole: true }); fx.burst(p.x, p.y, 'blood', 40, 0.08); }
    }
  } else if (ev.type === 'telegraph' && ev.warning === 'warn.matron.venom') {
    // deepmobs.js:579: the venom flies at the hero as it is called
    const c = me(), p = body(game?.playerId);
    if (c && p) fx.bolt(c.x, c.y, p.x, p.y, 'poison', { whole: true });
  } else if (ev.type === 'teleported' && game?.actors?.[ev.id]?.set === 'matron' && ev.from && ev.to) {
    // deepmobs.js:480-481: she leaves in silk and lands on the circle in blood
    if (vis(ev.from)) fx.sparkle(ev.from.x, ev.from.y, 'web', 30);
    fx.bolt(ev.from.x, ev.from.y, ev.to.x, ev.to.y, 'web', { whole: true });
    if (vis(ev.to)) fx.sparkle(ev.to.x, ev.to.y, 'blood', 30);
  } else if (ev.type === 'teleported' && ev.blink && ev.sparkle && ev.from && ev.to) {
    // CH6 (chaos-enemies.js:250-251): the Rift Skitter's blink, a light sparkle where it leaves and where it lands
    if (vis(ev.from)) fx.sparkle(ev.from.x, ev.from.y, 'light', ev.sparkle);
    if (vis(ev.to)) fx.sparkle(ev.to.x, ev.to.y, 'light', ev.sparkle);
  } else if (ev.type === 'teleported' && ev.leap && kindOf(game, ev.id) === 'cinderimp' && vis(ev.to)) fx.burst(ev.to.x, ev.to.y, 'fire', 14, 0.05);
  else if (ev.type === 'teleported' && kindOf(game, ev.id) === 'nightwarden' && ev.from && ev.to) {
    // PL6 (portals.js:354-356): the Night Warden's shadow step leaves in a dark sparkle and a deep violet ring and lands
    // in another, its ring paler
    if (vis(ev.from)) { fx.sparkle(ev.from.x, ev.from.y, 'dark', 30); fx.ring(ev.from.x, ev.from.y, '#7A4FE0', 2); }
    if (vis(ev.to)) { fx.sparkle(ev.to.x, ev.to.y, 'dark', 30); fx.ring(ev.to.x, ev.to.y, '#B98CFF', 2); }
  }
  else if (ev.type === 'float' && ev.words === 'broken!' && game?.actors?.[ev.id]?.set === 'matron') { const c = me(); if (c) fx.ring(c.x, c.y, '#FFFFFF', 2); }
  else if (ev.type === 'float' && ev.sparkle) { const c = me(); if (c) fx.sparkle(c.x, c.y, ev.tone ?? 'magic', ev.sparkle); }   // CF17: Wobbles' Prank! and Gift! (1.7 sparkleFx 24)
  else if (ev.type === 'spawned' && ev.at && vis(ev.at)) {
    const a = game?.actors?.[ev.id], owner = game?.actors?.[a?.owner];
    if (a?.matronBrood) fx.sparkle(ev.at.x, ev.at.y, 'web', a.kind === 'drider' ? 24 : 12);
    else if (a?.kind === 'spiderling' && owner?.kind === 'drowpriestess') fx.sparkle(ev.at.x, ev.at.y, 'web', 14);
  } else if (ev.type === 'hatched') { for (const q of ev.tiles ?? [ev.at]) if (vis(q)) fx.burst(q.x, q.y, 'web', 26, 0.08); }
  else if (ev.type === 'plane-vent' && vis(ev.at)) fx.burst(ev.at.x, ev.at.y, 'lightning', 14, 0.05);
}

const UNMAKER_BLOWS = new Set(['cleave', 'rupture', 'ring', 'pulse']);
/**
 * The Unmaker's bursts (1.7 unmaker-encounter.js): its arrival in a magic sparkle 32 (:57); a form change bursts 38
 * of magic into the Unbound, of light into the Heart of Discord (:82); each big blow lands as two sparks of its type on
 * every marked tile (:187: cleave phys, Inversion Pulse lightning, Rupture and both Discord Pulse beats magic); a
 * pylon's line flashes three sparks of light a tile under its beam (:210); each summoned demon arrives in a dark burst
 * 20 (:247); at its fall its demons vanish in a magic burst 12 (:270) and it bursts 70 of light (:273).
 */
function unmakerFx(fx, view, game, ev, vis) {
  const a = game?.actors?.[ev.id];
  if (ev.type === 'boss-move' && a?.set === 'unmaker') {
    if (UNMAKER_BLOWS.has(ev.move)) { for (const c of ev.tiles ?? []) if (vis(c)) fx.burst(c.x, c.y, ev.element ?? 'magic', 2, 0.02); }
    else if (ev.move === 'pylon-beam') { for (const c of ev.tiles ?? []) if (vis(c)) fx.burst(c.x, c.y, 'light', 3, 0.025); }
  } else if (ev.type === 'spawned' && ev.at) {
    if (a?.set === 'unmaker' && a.boss) fx.sparkle(ev.at.x, ev.at.y, 'magic', 32);
    else if (a?.summoned && game?.actors?.[a.owner]?.set === 'unmaker' && vis(ev.at)) fx.burst(ev.at.x, ev.at.y, 'dark', 20, 0.06);
  } else if (ev.type === 'boss-form' && a?.set === 'unmaker') {
    const c = at(view, game, ev.id);
    if (c) fx.burst(c.x, c.y, ev.phase === 2 ? 'magic' : 'light', 38, 0.08);
  } else if (ev.type === 'died' && ev.vanish) {
    const c = at(view, game, ev.id) ?? ev.at;
    if (vis(c) && !ev.statue) fx.burst(c.x, c.y, ev.burst?.kind ?? 'magic', ev.burst?.n ?? 12, ev.burst?.spread ?? 0.04);   // WC14: the library keepers' light 16
  } else if (ev.type === 'boss' && ev.state === 'dead' && a?.set === 'unmaker') {
    const c = at(view, game, ev.id);
    if (c) fx.burst(c.x, c.y, 'light', 70, 0.1);
  }
}

// CB44 (1.7 systems.js:618-636): what a sprung trap throws off the body on it, in sight: the fire vent's flames, the
// frost jet, the spark plate's sparks, the gas vent's poison cloud; a teleport rune sparkles where the body was taken
// from and again where it lands (trapHop: the body a rune is moving, until its 'teleported' plays).
let trapHop = null;
function trapFx(fx, ev, seen) {
  const b = TRAP_BURST[ev.kind], on = seen(ev.at.x, ev.at.y);
  if (b && on) fx.burst(ev.at.x, ev.at.y, ...b);
  if (ev.kind === 'teleport') { trapHop = ev.id; if (on) fx.sparkle(ev.at.x, ev.at.y, 'magic', 20); }
}

// 1.7 combat.js:177 TRAIL_EL: a mote's element as its sparks.
// EQ15 (1.7 foods.js:38): a food with a buff sparkles on the hero as it is eaten, 18: Might and Fireward fire, Manaflow
// and Shadeward magic, the rest heal. A plain ration has no buff and no sparkle.
const EAT_SPARK = id => { const b = (foods.rows[id]?.effects ?? []).find(e => e.verb === 'apply-status')?.status; return !b ? null : b === 'might' || b === 'fireward' ? 'fire' : b === 'manaflow' || b === 'shadeward' ? 'magic' : 'heal'; };
/**
 * The hero's own moments about his body: CB35 (1.7 systems.js:127) a mote taken sparkles in its element, 16; E18 (1.7
 * capstones.js:32-33) a heart sparkles heal 12, a mana globe ice 12; CF54 (1.7 gods.js:208) swearing to a god sparkles
 * light 40; CD20 (1.7 progression-adapter.js:86) a piety rank gained rings him in the god's colour, 3. The floats
 * that go with them are playback's.
 */
function pickupFx(fx, view, game, ev) {
  const me = game?.playerId ? at(view, game, game.playerId) : null;
  if (!me) return;
  if (ev.type === 'pickup' && ev.what === 'mote') fx.sparkle(me.x, me.y, EL_SPARK[ev.el] ?? 'magic', 16);
  else if (ev.type === 'pickup' && ev.what === 'heart') fx.sparkle(me.x, me.y, 'heal', 12);
  else if (ev.type === 'pickup' && ev.what === 'globe') fx.sparkle(me.x, me.y, 'ice', 12);
  else if (ev.type === 'hero' && ev.change === 'swear') fx.sparkle(me.x, me.y, 'light', 40);
  else if (ev.type === 'hero' && ev.change === 'eat' && EAT_SPARK(ev.food)) fx.sparkle(me.x, me.y, EAT_SPARK(ev.food), 18);
  else if (ev.type === 'piety-rank') fx.ring(me.x, me.y, GOD_COL[ev.god] ?? '#FFFFFF', 3);
}
/**
 * CB21 (1.7 combat.js:447, :453): each goblin Grukk calls comes in a sparkle of earth, 10, and a charge that meets no
 * one leaves him Dazed in a sparkle of lightning, 20.
 */
function grukkFx(fx, view, game, ev, vis) {
  const a = ev.id ? game?.actors?.[ev.id] : null;
  if (!a) return;
  if (ev.type === 'spawned' && a.summoned && game.actors[a.guardOf]?.set === 'grukk' && vis(ev.at)) fx.sparkle(ev.at.x, ev.at.y, 'earth', 10);
  else if (ev.type === 'status' && ev.status === 'dazed' && ev.change === 'applied' && a.set === 'grukk') { const c = at(view, game, ev.id); if (vis(c)) fx.sparkle(c.x, c.y, 'lightning', 20); }
}

export function eventFx(fx, view, game, ev, seen = () => true) {
  if (ev.shake) fx.shake(ev.shake);
  if (ev.type === 'trap' && ev.at) trapFx(fx, ev, seen);
  // EQ9 (1.7 amulets.js:208, :216, :240, :256): the Tide's wave bursts icy where it lands and on each trap it washes
  // away; a raised Pillar throws earth, and earth again as it crumbles.
  if (ev.type === 'terrain' && ev.what === 'tide' && ev.at) { if (seen(ev.at.x, ev.at.y)) fx.burst(ev.at.x, ev.at.y, 'ice', 40, 0.08); for (const t of ev.tripped ?? []) if (seen(t.x, t.y)) fx.burst(t.x, t.y, 'ice', 10, 0.05); }
  if (ev.type === 'terrain' && (ev.what === 'pillar' || ev.what === 'pillar-ends')) for (const t of ev.tiles ?? []) if (seen(t.x, t.y)) fx.burst(t.x, t.y, 'earth', ev.what === 'pillar' ? 24 : 14, ev.what === 'pillar' ? 0.06 : 0.05);
  if (ev.type === 'teleported' && ev.id && ev.id === trapHop) { trapHop = null; if (ev.to && seen(ev.to.x, ev.to.y)) fx.sparkle(ev.to.x, ev.to.y, 'magic', 20); }
  moveFx(fx, view, game, ev, seen);
  if (ev.type === 'trap-found' && ev.at) trapSpotFx(fx, ev.at, view);
  // FX23 (1.7 searchfx.js searchDoorFx): a hidden door found rings its tile in pale gold. 1.7 rang it only after a
  // search; here every way of finding one rings, as a spotted trap does.
  if (ev.type === 'door' && ev.found && ev.at) { fx.ring(ev.at.x, ev.at.y, '#FFE08A', 1.4); fx.sparkle(ev.at.x, ev.at.y, 'light', 14); }   // P5 (1.7 puzzles.js:467 sparkleFx light 14)
  // E19 (1.7 cores.js:97, :118): the gate drinks the core in a pale blue ring and sixty motes of light; a core taken up
  // sparkles magic about the hero.
  if (ev.type === 'door' && ev.gate && ev.at) { fx.ring(ev.at.x, ev.at.y, '#9FD8FF', 4); fx.sparkle(ev.at.x, ev.at.y, 'light', 60); }
  if (ev.type === 'pickup' && ev.what === 'core' && ev.at) fx.sparkle(ev.at.x, ev.at.y, 'magic', 30);
  // E20 (1.7 sigils.js:272 raiseSmoke): smoke raised bursts dark off the hero.
  if (ev.type === 'field' && ev.kind === 'smoke' && game?.playerId) { const p = at(view, game, game.playerId); if (p) fx.burst(p.x, p.y, 'dark', 80, 0.1); }
  // E44 (1.7 death-adapter.js:16, :24, :33-35, :40): the death set pieces' bursts (their shakes ride on their events):
  // the Magma Crawler's molten spray, the Matron's blood, the Deep Maw's earth from its middle and each Worm Tender and
  // Shroomling sinking back into the ground with it, the Crystal Golem's shards.
  if (ev.type === 'boss-move' && ev.move === 'magma-burst') { const c = at(view, game, ev.id); if (c && seen(c.x, c.y)) fx.burst(c.x, c.y, 'fire', 34, 0.09); }
  if (ev.type === 'boss-move' && ev.move === 'death' && game?.actors?.[ev.id]?.kind === 'deepmaw') { const c = at(view, game, ev.id); if (c) fx.burst(c.x + 0.5, c.y + 0.5, 'earth', 60, 0.1); }
  if (ev.type === 'died' && ev.id) {
    const a = game?.actors?.[ev.id], c = a ? at(view, game, ev.id) : null;
    if (c && seen(c.x, c.y)) {
      if (a.set === 'matron') fx.burst(c.x, c.y, 'blood', 60, 0.1);
      else if (a.kind === 'crystalgolem') fx.burst(c.x, c.y, 'earth', 30, 0.08);
      else if (ev.dismissed && (a.kind === 'wormtender' || a.kind === 'shroomling') && game.floor?.maw?.phase === 'dead') fx.burst(c.x, c.y, 'earth', 16, 0.05);
    }
  }
  if (ev.type === 'searched' && ev.at) searchSweepFx(fx, view, game, ev);
  // PL6 (portals.js:222): a plane's rune chest opens in a sparkle of light (planes.json plane-rune-chest sparkle 40)
  // CB43 (1.7 systems.js:687): any chest opens in a sparkle of light, 14 (a plane's rune chest names its own 40).
  if (ev.type === 'chest' && ev.at && seen(ev.at.x, ev.at.y)) fx.sparkle(ev.at.x, ev.at.y, 'light', ev.sparkle ?? 14);
  pickupFx(fx, view, game, ev);
  if (ev.type === 'shake') fx.shake(ev.amount);
  const vis = c => c && seen(c.x, c.y);
  // A broken prop's own puff (a cut web curtain's white strands, underdark.js; 1.7 burst(x, y, type, n, spread)).
  if (ev.type === 'sparkle' && vis(ev.at)) fx.sparkle(ev.at.x, ev.at.y, ev.kind, ev.n);   // CF27 Wobbles' heal and rat (1.7 sparkleFx)
  // CB14 (1.7 raiseShade riseFx): the Shade stands up out of the body, wisps and motes climbing off it 180 ms on.
  // CB15: the rise is a pieces-kit piece (fx-kit.js rise: the dark pool, wisps and motes); the effects layer has none.
  if (ev.type === 'sparkle' && ev.rise && vis(ev.at)) view.pieces?.rise(ev.at.x, ev.at.y, '#B58BFF', { n: 4, height: 1.0, spread: 0.34, dur: 340, at: 180 });
  if (ev.type === 'prop-broken' && ev.burst && vis(ev.at)) fx.burst(ev.at.x, ev.at.y, ev.burst.type, ev.burst.n, ev.burst.spread);
  // P11 (1.7 puzzles.js:296, :495): a hoard block melting goes in a burst of ice; P11 :426, :542 the shattered crystal
  // treasures and the chips off bumped hoard ice come as plain 'burst' events (puzzles.js).
  if (ev.type === 'prop-broken' && ev.melted && vis(ev.at)) fx.burst(ev.at.x, ev.at.y, 'ice', 16, 0.05);
  if (ev.type === 'burst' && (ev.seen || vis(ev.at))) fx.burst(ev.at.x, ev.at.y, ev.kind, ev.n, ev.spread);   // EP33: seen, the rules found some of it in sight
  // P10 (1.7 puzzles.js:404): each stone sentinel wakes in a burst of stone dust (the shake 8 is its own event).
  if (ev.type === 'spawned' && game?.actors?.[ev.id]?.sentinelRoom && vis(ev.at)) fx.burst(ev.at.x, ev.at.y, 'earth', 20, 0.06);
  unmakerFx(fx, view, game, ev, vis);
  // WC6: tall Crypt mushroom grass trampled short in sight gives a small magic sparkle, whoever walks it (1.7 world.js:21 setG).
  if (ev.type === 'ground' && ev.ground === 2 && ev.by && game?.floor?.biome === 'crypt' && vis(ev.at)) fx.burst(ev.at.x, ev.at.y, 'magic', 10, 0.035);
  grukkFx(fx, view, game, ev, vis);
  if (ev.type === 'boss-move') {
    const me = at(view, game, ev.id);
    if (ev.move === 'bone-nova' && me) fx.ring(me.x, me.y, '#8CFF6A', 8);
    else if (ev.move === 'grave-grasp') for (const c of ev.tiles ?? []) { if (vis(c)) fx.burst(c.x, c.y, 'dark', 10, 0.05); }
    else if (ev.move === 'phylactery-broken' && me) fx.sparkle(me.x, me.y, 'light', 60);
    else if (ev.move === 'static-field' && vis(me)) fx.burst(me.x, me.y, 'lightning', 24, 0.06);
    else if (ev.move === 'water-zap') for (const c of ev.tiles ?? []) { if (vis(c) && Math.random() < 0.35) fx.burst(c.x, c.y, 'lightning', 5, 0.05); }
    else if (ev.move === 'surfacing' && ev.at) fx.burst(ev.at.x, ev.at.y, 'earth', 26, 0.07);
    else if (ev.move === 'erupt') for (const c of ev.tiles ?? []) { if (vis(c) && Math.random() < 0.5) fx.burst(c.x, c.y, 'earth', 8, 0.06); }
    else if (ev.move === 'dive' && me && game?.actors?.[ev.id]?.kind !== 'leviathaneel') fx.burst(me.x, me.y, 'earth', 30, 0.08);
  } else if (ev.type === 'tremor' && ev.at) fx.burst(ev.at.x, ev.at.y, 'earth', 10, 0.05);
  else if (ev.type === 'spawned' && ev.at) {
    const a = game?.actors?.[ev.id];
    if (ev.surfaced) fx.ring(ev.at.x + 0.5, ev.at.y + 0.5, '#C08A50', 3);   // the Maw's 2 x 2 body: the ring opens from its middle
    else if (a?.kind === 'shroomling' && vis(ev.at)) fx.sparkle(ev.at.x, ev.at.y, 'poison', 16);
    else if (a?.kind === 'wormtender' && vis(ev.at)) fx.burst(ev.at.x, ev.at.y, 'earth', 20, 0.06);
  } else if (ev.type === 'teleported' && game?.actors?.[ev.id]?.set === 'morty') {
    fx.sparkle(ev.from.x, ev.from.y, 'dark', 30); fx.sparkle(ev.to.x, ev.to.y, 'dark', 30);
  } else if (ev.type === 'boss' && ev.revived) {
    const me = at(view, game, ev.id);
    if (me) fx.sparkle(me.x, me.y, 'dark', 60);
  } else if (ev.type === 'field' && (ev.kind === 'gas' || ev.kind === 'spores')) {
    // A poison cloud forming: 1.7 addCloud's burst at its middle (crypt.js:88).
    const f = game?.floor, r = f?.fields?.find(q => q.id === ev.id);
    if (r?.cells?.length) {
      const xs = r.cells.map(k => k % f.w), ys = r.cells.map(k => (k / f.w) | 0);
      const c = { x: Math.round(xs.reduce((s, v) => s + v, 0) / xs.length), y: Math.round(ys.reduce((s, v) => s + v, 0) / ys.length) };
      if (vis(c)) fx.burst(c.x, c.y, 'poison', 40, 0.06);
    }
  } else if (ev.type === 'plane-hazard') {
    const [type, n] = HAZARD_BURST[ev.plane] ?? [];
    if (type) for (const c of ev.tiles ?? []) if (vis(c)) fx.burst(c.x, c.y, type, n, 0.05);
  }
}
