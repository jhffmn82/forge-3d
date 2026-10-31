// How the elemental spells look as they are cast: 1.7's js/elements/elements.js:209-307 ("how five of these spells look",
// 2026-10-12; Justin: "more fluid and less procedural... hand crafted, so hard lines are out"; for rank 5, "these are
// epic spells... they should feel huge"). Each plan is a list of calls on the spells' kit (fx-kit.js), laid from its soft
// pieces and starting at the cast's release, 240 ms after the spell is chosen. A plan also says when the blow lands
// (impact: the numbers wait for it) and how long the turn waits on the picture (hold). Looks only: no state, no rolls.

import { TRAIL, ELEMENT_COLOUR as AFF_COL, DAMAGE_COLOUR as DMG_COL, GOD_COLOUR as GOD, ELEMENT_TRAIL as EL_TRAIL } from '../data/palette.js';   // C9 (render-11)

export const RELEASE = 240;
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const call = (fn, ...args) => ({ fn, args });

/** Frost Cone: one breath of cold mist rolls out over the cone, and rime breaks out of the floor behind its crest. */
export function frostCone({ from, at, floorTiles }) {
  const ice = TRAIL.ice.col, dur = 700, at0 = RELEASE;
  let reach = 1.5;
  for (const t of floorTiles) reach = Math.max(reach, Math.hypot(t.x - from.x, t.y - from.y) + 0.5);   // no farther than the cone reached
  const calls = [call('cone', from.x, from.y, at.x - from.x, at.y - from.y, ice[1], reach, { spread: Math.PI / 8 + 0.04, dur, at: at0 })];
  const patches = Math.min(4, floorTiles.length);
  for (let k = 0; k < patches; k++) {
    // a few patches spread over the cone, uneven in size, each starting as the crest reaches it (it runs out fast and slows)
    const t = floorTiles[Math.floor(floorTiles.length * (k + 0.5) / patches)], gone = Math.min(0.96, Math.hypot(t.x - from.x, t.y - from.y) / reach);
    calls.push(call('shard', t.x, t.y, ice[0], k % 2 ? 0.55 : 0.75, { n: k % 2 ? 2 : 3, dur: 520, at: at0 + dur * 0.72 * (1 - Math.pow(1 - gone, 1 / 2.2)) + 50 }));
  }
  return { calls, impact: RELEASE + dur * 0.4, hold: RELEASE + dur };
}

/** Shadow Swarm: the floor under each shade seethes. A pool of dusk wells up, wisps climb out, no two tiles together. */
export function shadowSwarm({ spots }) {
  const dusk = [TRAIL.dark.col[1], AFF_COL.shadow], calls = [];
  spots.forEach((s, i) => {
    calls.push(call('sparkle', s.x, s.y, 'dark', 4));
    calls.push(call('rise', s.x, s.y, dusk[i % 2], { n: 3, height: 0.9 + 0.08 * (i % 4), spread: 0.32 + 0.03 * (i % 3), dur: 620 + 40 * (i % 3), at: RELEASE + ((i * 4) % 9) * 26 }));
  });
  return { calls, impact: RELEASE, hold: RELEASE + 300 };
}

/** Glacial Tomb (epic of Water): the room's cold is drawn in, ice stands up round it in two rings, and it seals with a
 *  pale bloom, a swell of frost over the floor and the room lit blue. The turn waits for the cold to close. On an enemy
 *  the ice bursts on the tiles about it too (splash). */
export function glacialTomb({ at, splash = [] }) {
  const ice = TRAIL.ice.col, seal = RELEASE + 620, { x, y } = at;
  const calls = [
    call('swirl', x, y, DMG_COL.ice, 3.6, { inward: true, dur: 720, at: RELEASE }),
    call('swirl', x, y, ice[0], 1.7, { inward: true, dur: 560, at: RELEASE + 150 }),
    call('shard', x, y, ice[1], 1.5, { n: 16, dur: 1350, at: RELEASE + 400 }),
    call('shard', x, y, ice[0], 2.4, { n: 12, dur: 1150, at: RELEASE + 500 }),
    call('flare', x, y, ice[0], { size: 2.2, dur: 540, at: seal }),
    call('ripple', x, y, ice[1], 5.5, { rings: 2, dur: 1150, at: seal + 20 }),
    call('light', x, y, ice[1], { r: 9, s: 0.95, flash: 1150, at: seal }),
  ];
  if (splash.length) {
    for (const t of splash) calls.push(call('burst', t.x, t.y, 'ice', 12, 0.05));
    calls.push(call('burst', x, y, 'ice', 30, 0.06));
  }
  return { calls, impact: RELEASE + 720, hold: RELEASE + 720 };
}

/** Living Flame (epic of Fire): the floor splits with heat and a column of fire stands up out of it, a bloom breaks at its
 *  heart, a swell of fire rolls out and the room is lit. The blast it always had stays under it. */
export function livingFlame({ at }) {
  const fire = TRAIL.fire.col, { x, y } = at;
  return {
    calls: [
      call('explosion', x, y),
      call('glyph', x, y, fire[1], { size: 1.5, dur: 1200, at: RELEASE - 120 }),
      call('rise', x, y, fire[1], { n: 30, height: 3.2, spread: 0.75, dur: 1300, at: RELEASE, body: 1 }),
      call('rise', x, y, fire[0], { n: 18, height: 2.4, spread: 0.42, dur: 1150, at: RELEASE + 90, body: 0.9 }),
      call('rise', x, y, fire[2], { n: 12, height: 3.8, spread: 1.0, dur: 1400, at: RELEASE + 160 }),
      call('flare', x, y, fire[0], { size: 2.4, dur: 560, at: RELEASE + 60 }),
      call('ripple', x, y, fire[1], 4.2, { rings: 2, dur: 1050, at: RELEASE + 120 }),
      call('light', x, y, fire[1], { r: 10, s: 1.05, flash: 1300, at: RELEASE }),
    ],
    impact: RELEASE + 120, hold: RELEASE - 120 + 1200,
  };
}

/** Upheaval (epic of Earth): the floor breaks along the ridge from its middle out. Rock heaves up cell by cell (heave),
 *  teeth of stone stand at their feet, a low wave of dust is thrown across the ridge, a slower roll of dust goes out
 *  over the ground it struck, and everything caught in it and still standing shudders. */
export function upheaval({ from, at, walls, struck = [] }) {
  const rock = TRAIL.earth.col, ax = at.x - from.x, ay = at.y - from.y, far = Math.hypot(ax, ay) || 1, back = Math.min(1.2, Math.max(0, far - 0.9));
  const calls = [call('shake', 8)], heave = [];
  walls.forEach((t, i) => {
    const out = cheb(t, at);
    heave.push({ x: t.x, y: t.y, at: RELEASE + 70 * out });
    calls.push(call('burst', t.x, t.y, 'earth', 10, 0.05));
    calls.push(call('shard', t.x, t.y, rock[i % 2], i % 2 ? 1.0 : 1.3, { n: i % 2 ? 4 : 5, dur: 980 + 40 * out, at: RELEASE + 70 * out }));
    calls.push(call('rise', t.x, t.y, rock[2], { n: 5, height: 1.5, spread: 0.5, dur: 900, at: RELEASE + 70 * out + 60 }));
  });
  calls.push(call('cone', at.x - ax / far * back, at.y - ay / far * back, ax, ay, rock[2], 3.6, { spread: 1.2, dur: 1100, at: RELEASE + 90 }));
  calls.push(call('ripple', at.x, at.y, rock[0], 5.2, { rings: 2, dur: 1250, at: RELEASE + 160, plain: true }));
  for (const id of struck) calls.push({ fn: 'quiver', id, args: [{ at: RELEASE + 120, dur: 900, amp: 0.085 }] });
  return { calls, heave, impact: RELEASE + 120, hold: RELEASE + 120 + 900 };
}

/** Umbral Passage (epic of Shadow): where the hero stood the body comes apart into shadow and spirals away; two streaks
 *  of dusk run to the new spot (from nine tiles out at most), and there a dark bloom, a swell and a tall column rise. */
export function umbralPassage({ from, to, echo = null }) {
  const dusk = TRAIL.dark.col, dx = to.x - from.x, dy = to.y - from.y, far = Math.hypot(dx, dy) || 1, run = Math.min(far, 9), land = RELEASE + 420;
  // CB50 (1.7 shadow-clone.js:77-84): the echo wells up out of the shadow left at the departure, a sparkle of dark 10
  // as it is made, then dusk lifting off the floor about it and a soft bloom on its body after the dissolve (600 ms).
  const born = RELEASE + 600;
  const welling = echo ? [
    call('sparkle', echo.x, echo.y, 'dark', 10),
    call('rise', echo.x, echo.y, dusk[1], { n: 9, height: 1.3, spread: 0.42, dur: 780, at: born }),
    call('flare', echo.x, echo.y, TRAIL.dark.glow, { size: 0.9, dur: 400, at: born + 100 }),
  ] : [];
  return {
    calls: [
      ...welling,
      call('swirl', from.x, from.y, dusk[1], 2.6, { dur: 820, at: RELEASE }),
      call('swirl', from.x, from.y, dusk[0], 1.3, { dur: 600, at: RELEASE + 80 }),
      call('ripple', from.x, from.y, dusk[1], 4.5, { rings: 2, dur: 1000, at: RELEASE + 60, plain: true }),
      call('sweep', to.x - dx / far * run, to.y - dy / far * run, to.x, to.y, AFF_COL.shadow, { width: 1.1, dur: 520, at: RELEASE + 140 }),
      call('sweep', to.x - dx / far * run, to.y - dy / far * run, to.x, to.y, dusk[0], { width: 0.45, dur: 420, at: RELEASE + 220 }),
      call('sparkle', to.x, to.y, 'dark', 10),
      call('flare', to.x, to.y, dusk[1], { size: 2.3, dur: 600, at: land }),
      call('flare', to.x, to.y, dusk[0], { size: 1.1, dur: 380, at: land + 90 }),
      call('ripple', to.x, to.y, AFF_COL.shadow, 5, { rings: 2, dur: 1100, at: land + 20, plain: true }),
      call('rise', to.x, to.y, dusk[1], { n: 22, height: 2.4, spread: 0.7, dur: 1150, at: land + 40, body: 0.8 }),
      call('rise', to.x, to.y, dusk[0], { n: 9, height: 1.5, spread: 0.35, dur: 900, at: land + 140 }),
      call('light', to.x, to.y, dusk[1], { r: 7, s: 0.7, flash: 1000, at: land }),
    ],
    impact: RELEASE + 80, hold: RELEASE + 820,
  };
}

/** Radiant Beam: a shaft of light along the struck cells and a few sparkles on every one (1.7 beamFx and sparkleFx). */
export function radiantBeam({ from, tiles }) {
  const calls = [call('beam', tiles.map(t => [t.x, t.y]), 'light', { from })];
  for (const t of tiles) calls.push(call('sparkle', t.x, t.y, 'light', 4));
  return { calls, impact: 520 * 0.65, hold: 520 };
}

/** FX28 (1.7 infuseFx): an infusion's two colours, the element's and its pale. */
export function infusionColours(el) {
  return { col: AFF_COL[el] ?? '#FFF1C4', pale: (TRAIL[EL_TRAIL[el]] ?? TRAIL.magic).col[0] };
}

/** FX10: Reginald's Lance, a pale shaft along the struck cells as the swing lands (1.7 recovery.js:56 beamFx 'phys'). */
export function lance({ from, tiles, release = 170 }) {
  return { calls: [call('beam', tiles.map(t => [t.x, t.y]), 'phys', { from, col: '#E8D9A8', at: release })], impact: release + 320 * 0.65, hold: release + 320 };
}

/** FX24: Sylla's Venom Burst, poison thrown out round the hero in drops that land as pools (1.7 sylla.js:163 splashFx). */
export function venomBurst({ at }) {
  return { calls: [call('splash', at.x, at.y, '#8FC45A', 3.2, { at: RELEASE }), call('sparkle', at.x, at.y, 'poison', 40)], impact: RELEASE + 340, hold: RELEASE + 1150 };
}

// ---- the invokes and the remaining great spells (1.7 js/engine/casting-adapter.js:3-42, :143-197). A self cast lets go
// at its clip's release (selfCastReleaseAt: the wind-up less 20 ms; Bellow's row is a swing played straight).
const AIR = AFF_COL.air;

/** Iron Body: Grom's bronze blooms over the body, a pale sheen runs up it from the feet, and it sets with one glint. */
export function ironBody({ at, release = RELEASE }) {
  const { x, y } = at;
  return {
    calls: [
      call('sparkle', x, y, 'earth', 8),
      call('flare', x, y, GOD.grom, { size: 1.1, dur: 480, at: release }),
      call('rise', x, y, DMG_COL.phys, { n: 7, height: 0.95, spread: 0.3, dur: 620, at: release + 60 }),
      call('flare', x, y, DMG_COL.phys, { size: 0.5, dur: 240, at: release + 330 }),
    ],
    impact: 0, hold: 0,
  };
}

/** Bellow: Grumbok's red swells at the chest and rolls out over the floor as one soft swell, as far as it stuns; the
 *  blood it stirs (when it heals) shows as a small green lift. */
export function bellow({ at, healed = false, release = RELEASE }) {
  const { x, y } = at, calls = [
    call('flare', x, y, GOD.grumbok, { size: 1.4, dur: 380, at: release }),
    call('ripple', x, y, GOD.grumbok, 3.5, { rings: 1, dur: 700, at: release + 40 }),
  ];
  if (healed) calls.push(call('rise', x, y, DMG_COL.heal, { n: 5, height: 0.7, spread: 0.25, dur: 420, at: release + 160 }));
  return { calls, impact: 0, hold: 0 };
}

/** Heal: Glimmer's warm light lifts off the floor about the hero, the green of mending climbs inside it a moment later,
 *  and the body takes a soft bloom. */
export function heal({ at, release = RELEASE }) {
  const { x, y } = at;
  return {
    calls: [
      call('sparkle', x, y, 'heal', 12),
      call('flare', x, y, TRAIL.heal.col[0], { size: 0.9, dur: 420, at: release }),
      call('rise', x, y, GOD.glimmer, { n: 12, height: 1.6, spread: 0.5, dur: 880, at: release }),
      call('rise', x, y, DMG_COL.heal, { n: 8, height: 1.2, spread: 0.34, dur: 700, at: release + 140 }),
    ],
    impact: 0, hold: 0,
  };
}

/** Temper: a lick of flame as the steel catches, the forge's glow over hero and weapon, Anvil's gold climbing off them as
 *  heat does, and a white-hot heart for a moment as the temper takes. */
export function temper({ at, release = RELEASE }) {
  const { x, y } = at, fire = TRAIL.fire.col;
  return {
    calls: [
      call('sparkle', x, y, 'fire', 12),
      call('proc', x, y, 'fire'),
      call('flare', x, y, fire[1], { size: 1.0, dur: 460, at: release }),
      call('rise', x, y, GOD.anvil, { n: 9, height: 1.1, spread: 0.36, dur: 640, at: release }),
      call('flare', x, y, fire[0], { size: 0.55, dur: 280, at: release + 220 }),
    ],
    impact: 0, hold: 0,
  };
}

/** Earthquake: the jolt, earth thrown up off every tile it shakes, everything left standing in it shudders for most of a
 *  second, and a low roll of dust goes out over the ground it struck. The turn waits for the shudder. tiles: the cells in
 *  its square that are in sight; struck: the ids it hit and left standing. */
export function earthquake({ at, radius = 5, tiles = [], struck = [] }) {
  const calls = [call('shake', 10)];
  for (const t of tiles) calls.push(call('burst', t.x, t.y, 'earth', 3, 0.04));
  for (const id of struck) calls.push({ fn: 'quiver', id, args: [{ at: RELEASE, dur: 820, amp: 0.075 }] });
  calls.push(call('ripple', at.x, at.y, TRAIL.earth.col[0], radius + 0.6, { rings: 2, dur: 900, at: RELEASE, plain: true }));
  return { calls, impact: RELEASE, hold: RELEASE + 820 };
}

/** Storm Form (epic of Air): a crackle on the body as the call goes out, the air of the whole room drawn in through the
 *  wind-up, then the break: a bolt comes down onto the hero, a white bloom, and the storm thrown off him as a whirl of
 *  wind and sparks over the floor, the room lit. It costs no time, so it holds the next turn about a second at most. */
export function stormForm({ at }) {
  const { x, y } = at, bolt = TRAIL.lightning.col, go = 0, brk = go + 520;
  return {
    calls: [
      call('proc', x, y, 'lightning'),
      call('swirl', x, y, AIR, 5.2, { inward: true, dur: 560, at: go }),
      call('swirl', x, y, bolt[2], 2.4, { inward: true, dur: 460, at: go + 90 }),
      call('pillar', x, y, bolt[2], { w: 0.8, dur: 820, at: brk - 60 }),
      call('flare', x, y, bolt[0], { size: 2.6, dur: 560, at: brk }),
      call('swirl', x, y, DMG_COL.lightning, 4.6, { dur: 900, at: brk }),
      call('swirl', x, y, AIR, 2.6, { dur: 700, at: brk + 80 }),
      call('ripple', x, y, bolt[2], 8.5, { rings: 2, dur: 1150, at: brk + 20 }),
      call('light', x, y, bolt[2], { r: 12, s: 1.15, flash: 1200, at: brk }),
      call('sparkle', x, y, 'lightning', 16),
    ],
    impact: 0, hold: brk + 480,
  };
}

/** Dawn (epic of Light): a beam of light comes down on the caster, a ripple runs outward from it, the room flashes (the
 *  floor then stays lit four turns: lightmap.js spell-dawn), and every enemy it strikes takes a ray of the same light. struck: the tiles of the bodies it hit. */
export function dawn({ at, struck = [] }) {
  const { x, y } = at, calls = [
    call('pillar', x, y, '#FFE2A0', { w: 1.5, dur: 1700, ray: true }),
    call('ripple', x, y, '#FFE3A0', 11, { at: 420, dur: 1500, rings: 3 }),
    call('light', x, y, '#FFE8B6', { r: 14, s: 1.2, flash: 1700 }),   // the four turns after are the light map's (lightmap.js spell-dawn)
  ];
  struck.forEach((t, i) => calls.push(call('pillar', t.x, t.y, '#FFEBC0', { w: 0.85, dur: 1400, at: 380 + Math.min(i, 10) * 70, ray: true })));
  calls.push(call('sparkle', x, y, 'light', 60));
  return { calls, impact: 380, hold: 1700 };
}

// ---- CF21, CF22: the warrior's runs (1.7 js/character/classes.js:107-129, :172-194, 2026-10-12). Looks only.

/** Lunge: a narrow streak of Sir Reginald's steel from where the knight stood, through where he stops, into the enemy,
 *  gone as the blow lands, and a pale glint at the point if it strikes. blow: ms from now until the hit shows. */
export function lunge({ from, foe, hit = false, blow = 280 }) {
  const calls = [call('sweep', from.x, from.y, foe.x, foe.y, GOD.reginald, { dur: 380, width: 0.32 })];
  if (hit) calls.push(call('flare', foe.x, foe.y, DMG_COL.phys, { size: 0.5, dur: 260, at: blow }));
  return { calls, impact: 0, hold: 0 };
}

/** Charge: the shake, a broad warm streak of dust and force from where the warrior stood to where he stops, the ground
 *  heaving softly round him as he arrives, and a dull bloom on each enemy he staggers. land: ms from now until he arrives
 *  (0 when he did not move); stunned: the tiles of the bodies stunned. */
export function charge({ from, to, land = 0, stunned = [] }) {
  const calls = [call('shake', 5)];
  if (from.x !== to.x || from.y !== to.y) calls.push(call('sweep', from.x, from.y, to.x, to.y, DMG_COL.xp, { dur: 420, width: 0.62 }));
  calls.push(call('ripple', to.x, to.y, DMG_COL.xp, 1.7, { rings: 1, dur: 460, at: land }));
  for (const t of stunned) calls.push(call('flare', t.x, t.y, DMG_COL.phys, { size: 0.5, dur: 280, at: land + 60 }));
  return { calls, impact: 0, hold: 0 };
}

// ---- CF23: the moment of a prayer (1.7 js/faith/gods.js:416-488 prayerFx, :554-584, 2026-10-12: "these are epic spells
// that deserve some effects... hard lines are out"). Each is laid from the kit's soft pieces in its god's own colour, as
// the cast lets go (release). The lasting buffs keep their aura (auras.js); this is only the moment they begin. None
// holds the turn. caught: the tiles of the unholy bodies Consecrate burned, each with its distance from the hero.
export function prayer({ id, at, release = RELEASE, caught = [] }) {
  const { x, y } = at, a = release, c = [];
  if (id === 'ironhide') {
    // Chad's hide: bronze drawn in out of the air onto bare skin, which sets with one dull gleam
    c.push(call('swirl', x, y, GOD.grom, 0.9, { inward: true, dur: 420, at: a }), call('flare', x, y, GOD.grom, { size: 0.95, dur: 380, at: a + 300 }), call('flare', x, y, DMG_COL.phys, { size: 0.45, dur: 260, at: a + 400 }));
  } else if (id === 'pummel') {
    // three blows put into the fists: a bloom on one hand, on the other, then the big one, and the heat off them
    c.push(call('flare', x - 0.22, y + 0.1, GOD.grom, { size: 0.36, dur: 240, at: a }), call('flare', x + 0.22, y + 0.1, GOD.grom, { size: 0.42, dur: 260, at: a + 110 }),
      call('flare', x, y, DMG_COL.xp, { size: 0.72, dur: 320, at: a + 220 }), call('rise', x, y, GOD.grom, { n: 5, height: 0.8, spread: 0.3, dur: 560, at: a + 220 }));
  } else if (id === 'rampage') {
    // Grumbok's temper: it bursts off the body red, throws embers wide, and the heat goes on climbing
    c.push(call('flare', x, y, GOD.grumbok, { size: 1.15, dur: 420, at: a }), call('swirl', x, y, TRAIL.fire.col[1], 1.2, { dur: 520, at: a }), call('rise', x, y, GOD.grumbok, { n: 12, height: 1.5, spread: 0.4, dur: 760, at: a + 80 }));
  } else if (id === 'trollblood') {
    // the blood surges red under the skin, then the wounds close: green lifting off the whole body
    c.push(call('flare', x, y, GOD.grumbok, { size: 0.85, dur: 340, at: a }), call('flare', x, y, DMG_COL.heal, { size: 1.0, dur: 520, at: a + 160 }), call('rise', x, y, DMG_COL.heal, { n: 14, height: 1.4, spread: 0.42, dur: 880, at: a + 100 }));
  } else if (id === 'laststand') {
    // Reginald's ground: a seal of pale steel opens under the boots, and slow banners of light stand up out of it
    c.push(call('glyph', x, y, GOD.reginald, { size: 1.15, dur: 900, at: a }), call('flare', x, y, GOD.reginald, { size: 0.8, dur: 360, at: a + 60 }), call('rise', x, y, DMG_COL.phys, { n: 8, height: 1.5, spread: 0.5, dur: 850, at: a + 140 }));
  } else if (id === 'luckystreak') {
    // Wobbles tosses luck at the hero: a giddy whirl of pink, and gold thrown up through it
    c.push(call('swirl', x, y, GOD.wobbles, 1.3, { dur: 620, at: a }), call('flare', x, y, TRAIL.light.col[1], { size: 0.6, dur: 300, at: a }), call('rise', x, y, DMG_COL.xp, { n: 8, height: 1.3, spread: 0.5, dur: 700, at: a + 90 }));
  } else if (id === 'consecrate') {
    // Saint Glimmer: the ground under the one who prays is made holy, and what was on him lifts away as light; the same
    // light catches on each unholy thing in reach, later the farther off it stands, and flares white
    for (const t of caught) {
      const when = a + 120 + 70 * Math.min(4, t.d);
      c.push(call('flare', t.x, t.y, GOD.glimmer, { size: 1.0, dur: 460, at: when }), call('flare', t.x, t.y, TRAIL.light.col[0], { size: 0.5, dur: 300, at: when + 120 }));
    }
    c.push(call('sparkle', x, y, 'light', 40), call('glyph', x, y, GOD.glimmer, { size: 1.0, dur: 820, at: a }), call('rise', x, y, TRAIL.light.col[1], { n: 8, height: 1.5, spread: 0.4, dur: 800, at: a + 60 }));
  } else if (id === 'manaward') {
    // Vellum's ward is written before it is worn: a seal in blue, the shell drawn in about the body, one bloom as it closes
    c.push(call('glyph', x, y, GOD.vellum, { size: 0.95, dur: 820, at: a }), call('swirl', x, y, GOD.vellum, 0.7, { inward: true, dur: 400, at: a + 60 }), call('flare', x, y, TRAIL.magic.col[1], { size: 1.0, dur: 380, at: a + 400 }));
  } else if (id === 'sanctuary') {
    c.push(call('ring', x, y, '#FFE4A0', 3));   // 1.7 gods.js:569 ringFx
  } else if (id === 'anviltoll') {
    c.push(call('ring', x, y, GOD.anvil, 2.5), call('shake', 8));   // 1.7 gods.js:572: the toll rings out and the floor jumps
  } else return null;
  return { calls: c, impact: 0, hold: 0 };
}

/**
 * RB43 Bone Spear (1.7 recovery.js:61-80, 2026-10-12): the hero pays in blood as he winds up; a grey mote flies the
 * line inside a soft pale streak of bone with Murk's violet about it; each body it runs through blooms pale as it
 * passes; where it stops, bone breaks out of the floor and sinks back. path: the line's tiles (stopped by walls);
 * pierced: the step on the path of each body it struck. Looks only.
 */
export function boneSpear({ from, path, pierced = [], release = RELEASE }) {
  if (!path.length) return null;
  const end = path.at(-1), fly = 110 + 55 * path.length, bone = TRAIL.phys.col[0];
  const c = [
    call('proc', from.x, from.y, 'blood'),
    call('bolt', from.x, from.y, end.x, end.y, 'blood', { at: release }),
    call('sweep', from.x, from.y, end.x, end.y, GOD.murk, { width: 0.6, dur: fly * 1.55, at: release + fly * 0.25 }),
    call('sweep', from.x, from.y, end.x, end.y, bone, { width: 0.3, dur: fly * 1.55, at: release + fly * 0.25 }),
    call('shard', end.x, end.y, bone, 0.9, { n: 7, dur: 520, at: release + fly - 30 }),
    call('flare', end.x, end.y, GOD.murk, { size: 0.8, dur: 340, at: release + fly - 30 }),
  ];
  for (const step of pierced) { const p = path[step]; if (p) c.push(call('flare', p.x, p.y, bone, { size: 0.55, dur: 260, at: release + fly * (step + 1) / path.length })); }
  const first = pierced.length ? Math.min(...pierced) : path.length - 1;
  return { calls: c, impact: release + fly * (first + 1) / path.length, hold: release + fly };
}

/**
 * CF25 Blink (1.7 gods.js:589-609): the hero stands at the far end at once, so nothing waits on his wind-up. Magic
 * sparkles at both ends; a bloom of Vellum's blue is left where he was, a soft streak crosses to where he is, and the
 * light unfolds off him as it lands.
 */
export function arcaneBlink({ from, to }) {
  return {
    calls: [
      call('sparkle', from.x, from.y, 'magic', 20), call('sparkle', to.x, to.y, 'magic', 20),
      call('flare', from.x, from.y, GOD.vellum, { size: 0.95, dur: 360 }),
      call('sweep', from.x, from.y, to.x, to.y, GOD.vellum, { width: 0.42, dur: 320 }),
      call('swirl', to.x, to.y, TRAIL.magic.col[1], 1.0, { dur: 480, at: 150 }),
      call('flare', to.x, to.y, GOD.vellum, { size: 0.8, dur: 320, at: 150 }),
    ],
    impact: 0, hold: 0,
  };
}

/**
 * CF26 The Brood (1.7 sylla.js:145-158, Justin: "spiderlings should drop in on silk"): her web opens on the floor under
 * the one who called them; each spiderling comes down out of the dark above on a thread of silk, one after another and
 * none quite plumb, with a small bloom of her red where it lands. landed: the tiles they came down on.
 */
export function theBrood({ at, landed = [], release = RELEASE }) {
  const c = [call('glyph', at.x, at.y, GOD.sylla, { size: 1.3, dur: 950, at: release })];
  landed.forEach((t, k) => {
    const drop = release + k * 200;
    c.push(call('fx', 'sparkle', t.x, t.y, 'web', 18));
    c.push(call('sweep', t.x + [-0.3, 0.22, 0.4][k % 3], t.y - 2.4, t.x, t.y, '#F2F0E8', { width: 0.16, dur: 400, at: drop }));   // her silk, 1.7 DMG_COL.web (sylla.js:61)
    c.push(call('flare', t.x, t.y, GOD.sylla, { size: 0.5, dur: 280, at: drop + 220 }));
  });
  return { calls: c, impact: 0, hold: 0 };
}

/**
 * CF24 Tempt Fate (1.7 gods.js:494-533 wobblesFateFx): the spin closes on the hero in pink, then the outcome shows.
 * kind: 'restore' (healed, with mana: arcane too), 'gift' (cells: where the presents fell), 'ambush' (cells: where the
 * creatures came), 'splat' (half his HP and blinded), 'teleport' (set down elsewhere), 'essence' (his gold flung out).
 * was: where he stood before he was moved (a puff of pink is all that is left there).
 */
export function temptFate({ at, was = at, kind, cells = [], mana = false, release = RELEASE }) {
  const pink = GOD.wobbles, { x, y } = at, c = [];
  let a = release;
  if (was.x !== x || was.y !== y) c.push(call('flare', was.x, was.y, pink, { size: 1.0, dur: 380 }), call('rise', was.x, was.y, pink, { n: 6, height: 0.9, spread: 0.35, dur: 520 }));
  c.push(call('swirl', x, y, pink, 1.1, { inward: true, dur: 260, at: a }));
  a += 230;
  const spots = cells.filter((t, i) => t && cells.findIndex(b => b && b.x === t.x && b.y === t.y) === i);
  if (kind === 'restore') {
    c.push(call('flare', x, y, pink, { size: 0.9, dur: 380, at: a }), call('rise', x, y, DMG_COL.heal, { n: 11, height: 1.4, spread: 0.42, dur: 740, at: a }));
    if (mana) c.push(call('rise', x, y, DMG_COL.magic, { n: 5, height: 1.1, spread: 0.5, dur: 620, at: a + 100 }));
  } else if (kind === 'gift') {
    spots.forEach((t, i) => {
      const land = a + 110 * i;
      if (t.x !== x || t.y !== y) c.push(call('sweep', x, y, t.x, t.y, pink, { width: 0.28, dur: 300, at: land }));
      c.push(call('flare', t.x, t.y, DMG_COL.xp, { size: 0.62, dur: 340, at: land + 160 }), call('rise', t.x, t.y, pink, { n: 4, height: 0.7, spread: 0.25, dur: 520, at: land + 160 }));
    });
  } else if (kind === 'ambush') {
    spots.forEach((t, i) => c.push(call('flare', t.x, t.y, pink, { size: 1.0, dur: 380, at: a + 90 * i }), call('rise', t.x, t.y, TRAIL.dark.col[1], { n: 6, height: 0.9, spread: 0.35, dur: 560, at: a + 90 * i })));
  } else if (kind === 'splat') {
    c.push(call('splash', x, y, pink, 1.2, { at: a, dur: 700 }), call('flare', x, y - 0.2, DMG_COL.dark, { size: 0.75, dur: 500, at: a + 90 }));
  } else if (kind === 'teleport') {
    c.push(call('flare', x, y, pink, { size: 0.95, dur: 360, at: a }));
  } else if (kind === 'essence') {
    c.push(call('swirl', x, y, DMG_COL.xp, 1.4, { dur: 620, at: a }), call('flare', x, y, pink, { size: 0.6, dur: 300, at: a }));
  }
  return { calls: c, impact: 0, hold: 0 };
}

// ---- E36, E37 (1.7 js/engine/casting-adapter.js:43-69, :100-137, :202-211, 2026-10-12): the shadow invokes, Shadowstep and
// Roll the Dice. Looks only.

/** Unholy Aura: dark sparkles off the body as it takes hold (the lasting murk is auras.js's). */
export function unholyAura({ at }) {
  return { calls: [call('sparkle', at.x, at.y, 'dark', 40)], impact: 0, hold: 0 };
}

/** Into the Dark: shadow closes in on the hero from all about, quickening as it comes, and shuts with one glint of
 *  Sylla's red. */
export function intoTheDark({ at, release = RELEASE }) {
  const { x, y } = at;
  return {
    calls: [
      call('sparkle', x, y, 'dark', 10),
      call('swirl', x, y, TRAIL.dark.col[1], 2.2, { inward: true, dur: 640, at: release }),
      call('flare', x, y, GOD.sylla, { size: 0.5, dur: 240, at: release + 520 }),
    ],
    impact: 0, hold: 0,
  };
}

/** Shadowstep: a Scoundrel's trick, quick and close: two wisps of shadow peel off him, and the dark about his feet folds
 *  in over the body. */
export function shadowstep({ at, release = RELEASE }) {
  const { x, y } = at;
  return {
    calls: [
      call('sparkle', x, y, 'dark', 8),
      call('proc', x, y, 'dark'),
      call('swirl', x, y, AFF_COL.shadow, 1.2, { inward: true, dur: 400, at: release }),
    ],
    impact: 0, hold: 0,
  };
}

/**
 * Roll the Dice: two dice leave the hand on every roll, one a moment after the other, and each pops where it comes to
 * rest; then whatever the roll did shows. at: where the hero ends up; was: where he stood (whisked away when they
 * differ); side: which way the dice tumble (1 or -1); healed, rampage, mana (spilt), chill, root, blind: what it did to
 * him; born: the tiles of what it conjured (rats, or the rat a foe became); gifts: the tiles a gift fell on.
 */
export function rollDice({ at, was = at, side = 1, release = RELEASE, healed = false, rampage = false, spilt = false, chill = false, root = false, blind = false, born = [], gifts = [] }) {
  const { x, y } = at, pink = GOD.wobbles, gold = DMG_COL.xp, show = release + 230, calls = [];
  [[0.8 * side, 0.3, pink], [-0.55 * side, 0.55, gold]].forEach(([dx, dy, c], i) => {
    calls.push(call('sweep', x, y, x + dx, y + dy, c, { width: 0.26, dur: 300, at: release + i * 90 }));
    calls.push(call('flare', x + dx, y + dy + 0.05, c, { size: 0.4, dur: 260, at: release + i * 90 + 160 }));
  });
  // whisked away: a pop where he stood, and the place he lands draws him in; he is there already, so no waiting on the dice
  if (was.x !== x || was.y !== y) calls.push(call('flare', was.x, was.y, pink, { size: 1.1, dur: 380 }), call('swirl', x, y, pink, 1.6, { inward: true, dur: 460 }));
  if (healed) calls.push(call('rise', x, y, DMG_COL.heal, { n: 14, height: 1.6, spread: 0.5, dur: 820, at: show }));
  if (rampage) calls.push(call('flare', x, y, GOD.grumbok, { size: 1.2, dur: 420, at: show }), call('rise', x, y, TRAIL.fire.col[1], { n: 8, height: 1.0, spread: 0.34, dur: 620, at: show }));
  if (spilt) calls.push(call('splash', x, y, TRAIL.magic.col[2], 1.3, { at: show, dur: 760 }));
  if (chill) calls.push(call('shard', x, y, DMG_COL.ice, 0.8, { n: 7, dur: 640, at: show }));
  if (root) calls.push(call('shard', x, y, AFF_COL.earth, 0.8, { n: 7, dur: 680, at: show }));
  if (blind) calls.push(call('swirl', x, y, TRAIL.dark.col[1], 0.9, { inward: true, dur: 480, at: show }));
  born.slice(0, 3).forEach((t, i) => calls.push(call('flare', t.x, t.y, pink, { size: 0.95, dur: 360, at: i * 110 }), call('rise', t.x, t.y, TRAIL.magic.col[1], { n: 6, height: 0.8, spread: 0.3, dur: 520, at: i * 110 })));
  gifts.slice(0, 3).forEach((t, i) => calls.push(call('rise', t.x, t.y, gold, { n: 6, height: 0.9, spread: 0.3, dur: 640, at: show + i * 90 })));
  return { calls, impact: 0, hold: 0 };
}

/**
 * E41 Double Strike (1.7 casting-adapter.js:89-99 doubleStrikeFx): a blow that lands leaves one soft cut across the foe,
 * and the second crosses the first; bare fists leave a soft knock instead, one to each side. side: -1 when the foe
 * stands left of the hero; lean: a small tilt so no two cuts are alike; at: ms from now as the body lunges in.
 */
export function doubleStrikeCut({ foe, side = 1, second = false, unarmed = false, lean = 0, at = 0 }) {
  const s = side * (second ? -1 : 1), { x, y } = foe;
  if (unarmed) return { calls: [call('flare', x + 0.16 * s, y + (second ? 0.1 : -0.08), DMG_COL.phys, { size: 0.5, dur: 220, at: at + 40 })], impact: 0, hold: 0 };
  return { calls: [call('sweep', x - 0.42 * s, y - 0.4 + lean, x + 0.42 * s, y + 0.34 - lean, DMG_COL.phys, { width: 0.2, dur: 190, at })], impact: 0, hold: 0 };
}
