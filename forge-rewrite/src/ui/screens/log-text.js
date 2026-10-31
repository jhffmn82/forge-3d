// Log lines for events, in 1.7's words (spec/combat.md "Log lines and feedback"). Terse, no narration.
// The strings move to data/strings.json with packet H.

import { color } from '../core/widgets.js';
import { unmark } from '../core/marked-words.js';
export { unmark };
import { tone } from '../core/look.js';
import { depthLine } from '../model/hud-model.js';
import gods from '../../../data/gods.json' with { type: 'json' };
import statuses from '../../../data/statuses.json' with { type: 'json' };
import ui from '../../../data/ui.json' with { type: 'json' };
import { keyTable, keyLabel } from '../../input/input.js';
import { toNum } from '../core/colour.js';
import { cap, say } from '../model/words.js';
import { itemView } from '../model/item-view.js';

/** WC2 (1.7 floors.js:140, systems.js:146): a rules line with touch words of its own ({ touch }) says them on touch. */
let touchWords = false;
export function setLogTouch(on) { touchWords = !!on; }

/**
 * CB33, CB34 (1.7 systems.js:112-150 ENTRY_HINTS): a stand-here hint, an item's pick-up line or a stair's way, shows on
 * the map once per spot and control, as 1.7's transient cue; said there again it goes to the journal only (quiet).
 * The pick-up line names the bound Pick up key, or says Pick up on touch (main.js: setLogTouch, setLogControls); item 145: its gear (ev.gear) in its quality colour.
 */
const ctl = { keys: null };
export function setLogControls(keys = null) { ctl.keys = keys && Object.keys(keys).length ? keys : null; }
// The key as Options names it (input.js keyLabel): a letter in capitals, a shifted one Shift+, a top-row digit bare.
const pickupKey = () => keyLabel(keyTable(ctl.keys).pickup?.[0] ?? 'g');
const gearMarks = (ev, state, words) => { const v = ev.gear && itemView(ev.gear, state), at = v?.colour != null ? words.indexOf(v.name) : -1; return at < 0 ? [] : [{ from: at, to: at + v.name.length, fill: v.colour }]; };
const cues = new WeakMap();
const STAIRS_LINE = /^(?:Down|Up) to floor \d+:/;
function cued(ev, state, line) {
  const p = state?.actors?.[state.playerId], f = state?.floor;
  const spot = ev.cue ?? (p && STAIRS_LINE.test(String(ev.words ?? '')) ? `${p.x},${p.y}:stairs` : null);
  if (!spot || !f || typeof f !== 'object') return line;
  const control = touchWords ? 'touch' : ev.hint === 'pickup' ? 'key:' + pickupKey() : 'keyboard';
  let seen = cues.get(f);
  if (!seen) cues.set(f, (seen = new Map()));
  const quiet = seen.get(spot) === control;
  seen.set(spot, control);
  return quiet ? { ...line, quiet: true } : line;
}

const name = (state, id) => id === state.playerId ? 'you' : (state.actors[id]?.name ?? 'it');
const TICK = { burn: 'Burn', poison: 'Poison', bleed: 'Bleed' };

/** Keeps the attack line open so the damage that follows can finish it ("You hit Goblin: 7 (crit)."). */
let open = null;
/** EP20 (1.7 enemy-teamwork.js:100-102, damage-adapter.js:491): a creature's move (a shaman's firebolt) opens its hit line. */
let moveOpen = null;
/**
 * Sandbox E1 (Justin 2026-10-16, "yes to all"): a finished hit line waits while the hit's procs (fire, drain, smite, the
 * enchant's extra packet) land on the same target from the same attacker, and they join it: "You hit Goblin: 12 + 3 fire
 * + 2 dark." Any other event, or flushLog() at the end of the action, sends it.
 */
let pending = null;
const DT = { fire: 'fire', ice: 'ice', lightning: 'lightning', poison: 'poison', dark: 'dark', light: 'light', magic: 'magic', phys: '' };
/** CB52 (1.7 data.js DMG_COL): a damage number's colour by its type, as the floating numbers. */
const dmgFill = t => toNum((ui.damageColours[t] ?? ui.damageColours.phys));

/**
 * E49 (1.7 death-adapter.js:76-88): deaths that come together with nothing said between them share a line ("Goblin, Rat
 * die."), as 1.7's receipt joins one action's kills. { names, by }.
 */
let deaths = null;
const GOLD_KILL = 0xe8b44a;
function flushDeaths() {
  if (!deaths) return [];
  const d = deaths; deaths = null;
  return [{ words: d.names.length === 1 ? `${d.names[0]} dies.` : `${d.names.join(', ')} die.`, fill: GOLD_KILL }];
}
/** The held hit line and deaths, if any, now (call when an action's events are done). */
export function flushLog() { return pending?.group ? [...flushHit(), ...flushDeaths()] : [...flushDeaths(), ...flushHit()]; }
function flushHit() {
  if (!pending) return [];
  const p = pending; pending = null;
  const marks = [], after = p.after ?? [];   // E48: riders on other bodies, said after the line they rode
  // G36 (1.7 actions-adapter.js:27-36, :196-207): a hero spell's hits share one line, each its target and numbers:
  // "Fireball: Goblin 5 (crit); Burning; Orc 7."
  if (p.group) return [{ words: [...p.done, p].reduce((w, r, i) => hitText(w + (i ? '; ' : ''), r, marks), `${p.group}: `) + '.', fill: p.fill, marks }, ...after];
  return [{ words: hitText('', p, marks) + '.', fill: p.fill, marks }, ...after];
}
/** One hit's words after `words`: its head and number, the procs joined to it, its tags and notes. */
function hitText(words, r, marks) {
  // CB52, G35 (1.7 damage-adapter.js:439-448 combatDamageBreakdown): each number in its damage type's colour (marks).
  const num = (at, n, t) => marks.push({ from: at, to: at + String(n).length, fill: dmgFill(t) });
  words += r.head;
  if (r.amount !== undefined) num(words.length - String(r.amount).length, r.amount, r.dtype);
  for (const q of r.procs) { num(words.length + 3, q.amount, q.dtype); words += ` + ${q.amount}${DT[q.dtype] ? ' ' + DT[q.dtype] : ''}`; }
  return words + r.tail + (r.notes?.length ? '; ' + r.notes.join('; ') : '');
}

/** Every line one event makes: the held hit line first when this event is not one of its procs. */
export function logLines(ev, state) {
  // G36: the next hit of the same hero spell is held with the line it joins.
  if (pending?.group && ev.type === 'attacked' && ev.hit && ev.spell && ev.label === pending.group && ev.id === pending.by) { logLine(ev, state); return []; }
  if (pending && !open && ev.type === 'damaged' && ev.id === pending.target && ev.by === pending.by && !ev.cause) { pending.procs.push(ev); return []; }
  // E48 (1.7 damage-adapter.js:487-491, death-adapter.js:119, :144): a rider on another body is its own line, named:
  // "Arc → Bat: 5.", "Reflection → You: 4.", "Wildfire: Goblin Burning.", "Smoke: Hidden."; a held hit line keeps it after.
  const rider = !open || ev.type !== 'damaged' || ev.id !== open.target ? riderLine(ev, state) : null;
  if (rider) {
    if (pending) { (pending.after ??= []).push(rider); return []; }
    return [...flushDeaths(), rider];
  }
  // G37 (1.7 actions-adapter.js:367-372, damage-adapter.js:456-465): a harmful status the blow puts on its target rides
  // the line as a note: "You hit Goblin: 12 + 3 fire; Burning."
  if (pending && ev.type === 'status' && ev.change === 'applied' && ev.id === pending.target) {
    const row = statuses.rows[ev.status];
    // E47 (1.7 damage-adapter.js:277): a Gloom Moth's blow says "light snuffed"; a petrifying root rides as "Petrified".
    const note = NOTE[ev.status] ?? (row?.name && ((row.tags ?? []).includes('harmful') || row.log?.apply?.includes('{name}')) ? row.name : null);
    if (note && !pending.notes.includes(note)) pending.notes.push(note);
    return [];
  }
  // E47 (1.7 combatActionNotes, damage-adapter.js:456-462): what the blow heals rides it too: "...: 6; +3 HP."
  if (pending && ev.type === 'healed' && ev.amount > 0 && ev.id !== pending.target) {
    pending.notes.push(`${ev.id === pending.by ? '' : name(state, ev.id) + ' '}+${Math.round(ev.amount)} HP`);
    return [];
  }
  // E21 (1.7 combatActionNote): a defence that answered the blow rides its line: "Orc hits you: 6; Fortitude."
  if (pending && ev.type === 'note' && ev.id === pending.target) { if (!pending.notes.includes(ev.words)) pending.notes.push(ev.words); return []; }
  if (pending && (ev.type === 'healed' || ev.type === 'status' || ev.type === 'absorbed' || ev.type === 'float')) return [];   // a proc's riders keep the line open
  if (ev.type === 'died' && !ev.player) return deathLines(ev, state);
  if (pending?.group) {
    // G36: a hit of the same spell joins the line; an event that says nothing (XP, drops, knockback) leaves it open.
    const g = pending; pending = null;
    const lines = said(ev, state), fresh = pending;
    if (fresh?.group === g.group && fresh.by === g.by) { const { done, ...cur } = g; pending = { ...fresh, done: [...done, cur] }; return lines; }
    pending = g;
    if (!lines.length && !fresh) return [];
    const out = [...flushHit(), ...flushDeaths(), ...lines];
    pending = fresh;
    return out;
  }
  const out = [...flushHit(), ...said(ev, state)];
  // E49: held deaths go out before anything said after them; events that say nothing (XP, drops) leave them held.
  return out.length || pending || ev.type === 'floor' ? [...flushDeaths(), ...out] : out;
}

function said(ev, state) {
  // E47 (1.7 effect-adapter.js:72, combatActionNote): a status that lands outside a blow has its own line: "You: Afraid.",
  // "Bleeding. Heal to stop it.", "Ghoul: Petrified." (statuses.json log applyPlayer, apply with {name}).
  if (ev.type === 'status' && ev.change === 'applied') { const l = statusLine(ev, state); return l ? [l] : []; }
  // RB13, RB14, WC1: a new floor opens with its lines; one come back to as it was left says so instead (G38, 1.7 restoreFloor).
  if (ev.type === 'floor') return ev.back ? [] : floorIntro(state);
  const line = logLine(ev, state);
  if (line?.hold) { pending = line.hold; return []; }
  return line ? [ev.type === 'log' ? cued(ev, state, line) : line] : [];   // CB33, CB34
}

export function logLine(ev, state) {
  const P = state.playerId;
  if (ev.type === 'move-used') { moveOpen = ev.id !== P && ev.target ? { id: ev.id, target: ev.target } : null; return null; }
  // EP20: the move's damage is "Goblin Shaman → you: 15; Burning." (the burn joins as a note, G37), in blood when it is you.
  if (ev.type === 'damaged' && moveOpen && ev.by === moveOpen.id && ev.id === moveOpen.target && !ev.cause) {
    const m = moveOpen; moveOpen = null;
    const head = `${cap(name(state, m.id))} → ${name(state, ev.id)}: ${ev.amount}`, fill = ev.id === P ? color.hp : color.ink;
    return { words: `${head}.`, fill, hold: { head, tail: '', fill, target: ev.id, by: m.id, amount: ev.amount, dtype: ev.dtype, procs: [], notes: [] } };
  }
  if (ev.type === 'attacked') {
    open = null; moveOpen = null;
    if (ev.parried) return { words: `You parry ${name(state, ev.id)}.`, fill: color.ash };
    if (ev.deflected) return null;   // CB11: 1.7 deflects with a float and the miss sound, no line
    if (!ev.hit && ev.spell && ev.label && ev.id === P) return { words: `${ev.label} misses ${name(state, ev.target)}.`, fill: color.dim };   // CB52 (1.7 combat.js:606)
    if (!ev.hit) return { words: ev.id === P ? `You miss ${name(state, ev.target)}.` : `${cap(name(state, ev.id))} misses ${name(state, ev.target)}.`, fill: color.dim };
    open = ev;
    return null;
  }
  if (ev.type === 'damaged' && open && ev.id === open.target) {
    const a = open; open = null;
    const tags = [a.crit && '(crit)', a.surprise && '(surprise)', a.blocked && '(blocked)'].filter(Boolean).join(' ');
    // G34, CB51 (1.7 actions-adapter.js:265-266, :425-427): the blow names its target: "Spider hits Goblin: 4.", and any
    // blow not the hero's is logged c-you (blood), the hero's c-hit (ink).
    const who = a.id === P ? `You hit ${name(state, a.target)}` : `${cap(name(state, a.id))} hits ${name(state, a.target)}`;
    const label = a.label ? `${a.label}: ` : '';
    const fill = a.id === P ? color.ink : color.hp;
    // G36 (1.7 spellDamageResult): a hero spell's hit is "Goblin 5 (crit)" on its spell's one line.
    if (a.spell && a.label && a.id === P) return { hold: { head: `${name(state, ev.id)} ${ev.amount}`, tail: `${tags ? ' ' + tags : ''}`, fill, group: a.label, done: [], target: ev.id, by: a.id, amount: ev.amount, dtype: ev.dtype, procs: [], notes: [] } };
    return { words: `${label}${who}: ${ev.amount}${tags ? ' ' + tags : ''}.`, fill, hold: { head: `${label}${who}: ${ev.amount}`, tail: `${tags ? ' ' + tags : ''}`, fill, target: ev.id, by: a.id, amount: ev.amount, dtype: ev.dtype, procs: [], notes: [] } };
  }
  if (ev.type === 'damaged' && ev.id === P && TICK[ev.cause]) return { words: `${TICK[ev.cause]}: ${ev.amount}.`, fill: color.hp };
  if (ev.type === 'note') return { words: `${ev.id === P ? 'You' : cap(name(state, ev.id))}: ${ev.words}.`, fill: ev.id === P ? color.hp : color.ink };   // E21: outside a blow, its own line
  // CH-30: 1.7 logs a death as c-kill, the theme's gold (#e8b44a in Obsidian; journal.css:48 via forge-skin.css:297).
  if (ev.type === 'died' && ev.player) return { words: 'You die.', fill: GOLD_KILL };
  if (ev.type === 'unbuilt') return { words: `[not built yet: ${ev.verb}]`, fill: color.dim };
  // CB34 (1.7 systems.js:130-131): the pick-up hint names the bound key, or says Pick up on touch.
  if (ev.type === 'log' && ev.hint === 'pickup' && ev.item) { const words = `${ev.item} · ${touchWords ? 'Pick up' : pickupKey() + ' to pick up'}.`; const marks = gearMarks(ev, state, words); return { words, fill: logFill(ev), ...(marks.length ? { marks } : {}) }; }
  // PL14: the rules' own lines keep 1.7's ink (index.html:97-98 log classes); P8: the markup goes, its bold stays as marks.
  if (ev.type === 'log' && ev.words) {
    const fill = logFill(ev), { words, marks } = unmark(touchWords && ev.touch ? ev.touch : ev.words, fill); marks.push(...gearMarks(ev, state, words));
    return { words, fill, ...(marks.length ? { marks } : {}), ...(ev.warning ? { warning: true } : {}) };
  }
  return null;
}

const NOTE = { snuffed: 'light snuffed' };

/** E48: 1.7 combatDamageName, by the packet's tags, first match. */
const RIDER_DAMAGE = [['murk-drain', 'Life Drain'], ['venomtouch', 'Venomtouch'], ['fire-affinity', 'Fire affinity'], ['water-light', 'Clear Waters'], ['shadow-earth', 'Venom Strike'],
  ['smite', 'Smite'], ['molten-ring', 'Molten Ring'], ['gust', 'Gust'], ['enchant', 'Enchantment'], ['arc', 'Arc'], ['reflected', 'Reflection'], ['elemental-attack', 'Elemental attack']];
/** E48: the statuses 1.7 said by their rider's name (death-adapter.js:119 Wildfire c-fire, :144 Smoke c-good). */
const RIDER_STATUS = { 'fire-rank6': { name: 'Wildfire', fill: () => EMBER }, 'shadow-fire': { name: 'Smoke', fill: () => MOSS } };

/**
 * E48: a rider's damage that is not its blow's own (an arc, a reflection, a proc on someone else), or a named rider's
 * status: its line, or null. 1.7 left out the blow itself, ticks, and anything on a body the hero cannot see.
 */
function riderLine(ev, state) {
  const P = state.playerId, seen = id => id === P || visibleTo(state, state.actors[id]);
  if (ev.type === 'status' && ev.change === 'applied' && RIDER_STATUS[ev.rider] && seen(ev.id)) {
    const r = RIDER_STATUS[ev.rider], st = statuses.rows[ev.status]?.name ?? ev.status;
    return { words: `${r.name}: ${ev.id === P ? '' : cap(name(state, ev.id)) + ' '}${st}.`, fill: r.fill() };
  }
  if (ev.type !== 'damaged' || ev.cause || !ev.tags || !(ev.amount > 0)) return null;
  const tags = ev.tags;
  if (tags.includes('attack') || tags.includes('periodic') || !['proc', 'arc', 'reflected'].some(t => tags.includes(t))) return null;
  if (pending && ev.id === pending.target && ev.by === pending.by && !tags.includes('arc') && !tags.includes('reflected')) return null;
  if (!seen(ev.id)) return null;
  const label = RIDER_DAMAGE.find(([t]) => tags.includes(t))?.[1] ?? 'Bonus damage';
  const words = `${label} → ${ev.id === P ? 'You' : cap(name(state, ev.id))}: `;
  return { words: `${words}${ev.amount}.`, fill: ev.id === P ? color.hp : color.ink, marks: [{ from: words.length, to: words.length + String(ev.amount).length, fill: dmgFill(ev.dtype) }] };
}
/** A body the hero can see now (state.vis, as deathLines reads it; without one, any body). */
function visibleTo(state, a) {
  const w = state.floor?.w;
  return !state.vis || !a || !w || !!state.vis[a.y * w + a.x];
}

/**
 * E49 (1.7 commitCreatureDeath): an ally "falls" (c-info); a creature's death is said when it is seen or when you or an
 * ally made the kill (1.3.2 ruling 2), never for one dismissed or run out (a Worm Tender sent away, a brood replaced);
 * a boss's or an elite's stands alone, the rest share a line.
 */
function deathLines(ev, state) {
  const out = pending?.group ? [] : flushHit(), a = state.actors?.[ev.id];   // G36: a spell's line waits for its other hits
  // CB52 (1.7 combat.js:495): an ally whose time runs out expires (a Shade has no time of its own).
  if (ev.expired && a?.side === 'ally' && !a.shade) { out.unshift(...flushDeaths()); out.push({ words: `Your ${a.name} expires.`, fill: color.ash }); return out; }
  if (ev.dismissed || ev.expired) return out;
  if (a?.side === 'ally') { out.unshift(...flushDeaths()); out.push({ words: `${cap(name(state, ev.id))} falls.`, fill: color.ash }); return out; }
  const w = state.floor?.w, seen = !state.vis || !a || !w || !!state.vis[a.y * w + a.x];
  const ours = !!ev.creditPlayer || state.actors?.[ev.by]?.side === 'ally';
  if (!seen && !ours) return out;
  const nm = cap(name(state, ev.id));
  if (a?.boss || a?.elite || a?.set || (a?.flags ?? []).includes('elite')) { out.unshift(...flushDeaths()); out.push({ words: `${nm} dies.`, fill: GOLD_KILL }); return out; }
  if (deaths && deaths.by === (ev.by ?? null)) deaths.names.push(nm);
  else { out.unshift(...flushDeaths()); deaths = { names: [nm], by: ev.by ?? null }; }
  return out;
}

/** E47: a status's own apply line, from its statuses.json log row; the hero's in blood (c-you), another's in moss (c-good). */
function statusLine(ev, state) {
  const log = statuses.rows[ev.status]?.log, strip = s => String(s).replace(/<[^>]+>/g, '');
  if (ev.id === state.playerId && log?.applyPlayer) return { words: strip(log.applyPlayer), fill: color.hp };
  if (ev.id !== state.playerId && log?.apply?.includes('{name}') && state.actors[ev.id]) return { words: strip(log.apply.replace('{name}', state.actors[ev.id].name)), fill: MOSS };
  return null;
}

// 1.7's log classes: c-hit ink, c-miss dim, c-you blood, c-kill gold, c-good moss, c-info ash (the default), c-fire ember.
const MOSS = 0x7fa05a, EMBER = 0xe2622b, GOLD = 0xe8b44a;
const CLS_FILL = { 'c-hit': () => color.ink, 'c-miss': () => color.dim, 'c-you': () => color.hp, 'c-danger': () => color.hp, 'c-warning': () => color.hp,
  'c-kill': () => GOLD, 'c-gold': () => GOLD, 'c-good': () => MOSS, 'c-info': () => color.ash, 'c-fire': () => EMBER };

/** A 'log' event's ink: its fill, its class (cls 'c-kill' or tone 'kill'), kill gold, a warning in c-you, else c-info. */
export function logFill(ev) {
  if (typeof ev.fill === 'number') return ev.fill;
  const cls = ev.cls ?? (ev.tone ? 'c-' + ev.tone : null);
  if (cls && CLS_FILL[cls]) return CLS_FILL[cls]();
  if (ev.kill) return GOLD;
  if (ev.warning) return color.hp;
  return color.ash;
}

// RB14 (1.7 run-events.js:4-33), for saves from before note ids (U9, ui-28): the old prose notes' short forms.
const FLOOR_ENTRY_NOTICES = {
  'Bones and claw marks litter one doorway. A crowd of monsters sleeps behind it.': 'Monster zoo: sleeping enemies.',
  'An iron door confines a room packed with sleeping monsters.': 'Locked zoo: packed with sleeping monsters.',
  'One room swallows light. Only Light or Fire affinity cuts through it.': 'Dark room: Light or Fire reveals it.',
  '<b>A crystal vault</b> glints somewhere on this floor. Its crystal key lies about; inside, you may take one treasure.': 'Crystal vault: find key; choose one treasure.',
  '<b>Chasm vault.</b> A chasm splits a side room with treasure beyond. Floating would carry you over.': 'Chasm vault: levitation crosses the gap.',
  '<b>Drowned cellar.</b> A flooded cellar: swimming across is possible, but the cold water takes its toll.': 'Drowned cellar: cold water hurts; levitate across.',
  '<b>Burning chamber.</b> ': 'Burning chamber.',
  '<b>Frozen hoard.</b> Treasure sealed in blocks of ice. Weapons only glance off them; fire will melt them.': 'Frozen hoard: Fire melts the ice.',
  '<b>Everburning door.</b> A doorway wreathed in flame that never dies. Water would put it out.': 'Everburning door: Water puts out the flames.',
  '<b>Scalding baths.</b> ': 'Scalding baths.',
  '<b>Spike gauntlet.</b> A room bristling with spikes. Skin of stone would shrug them off.': 'Spike gauntlet: Stoneskin protects against spikes.',
  '<b>Stone sentinels.</b> Two stone sentinels guard a hoard. They let their own kind pass.': 'Stone sentinels: pass as stone.',
  '<b>Lightless room.</b> A room of perfect darkness, and the smell of old blood. Light would show what waits in it.': 'Lightless room: Light reveals it.',
  '<b>Sentry gallery.</b> Statues with glowing eyes watch over a gallery. Unseen, you could pass.': 'Sentry gallery: pass unseen.',
  '<b>Silent library.</b> A hushed library. Any sound here would wake what keeps it.': 'Silent library: noise wakes its keeper.',
  'A chasm splits the caverns. Rope bridges cross it; the drop does not forgive.': 'Rope bridges cross the chasm.',
  'Five islands drift in the void, linked by paired portals. A magical current on the last island carries you deeper.': 'Chaos: paired portals link five islands. Final current leads deeper.',
  'There are no god shrines in the Realm of Chaos.': 'No shrines in Chaos.',
  "The Unmaker's Crucible, the last floor. You are safe here until you open the gate.": "Unmaker's Crucible: safe until you open the gate.",
  'Open the entrance gate when you are ready; it seals behind you for the fight. Defeat all three forms of the Unmaker to reach the Forge of the Elements.': 'Entrance gate seals behind you. Defeat all three forms to reach the Forge.',
}, PORTAL_NOTE = /^Something hums on this floor: <b>a portal to .*<\/b> stands open\.$/;

/** 1.7 floorEntryNote: a note id's words; an old save's prose in short form, any markup taken out (the log has no bold). */
export function floorEntryNote(note, floor) {
  const t = say('floor-note.' + (note?.id ?? note), note?.id ? note : {}); if (t || typeof note !== 'string') return t;   // an id (strings.json)
  if (Object.hasOwn(FLOOR_ENTRY_NOTICES, note)) return FLOOR_ENTRY_NOTICES[note];
  if (PORTAL_NOTE.test(note) && floor?.portal?.plane) return `${cap(floor.portal.plane)} portal open.`;
  return note.replace(/<[^>]+>/g, '').trim();
}

/**
 * 1.7 floorIntro (run-events.js:34-51), on every arrival: the gold line "Crypt · Floor 6 · Elemental Forge · Grom
 * shrine.", the iron vault, the boss hall, then the floor's notes in short form, each text once.
 */
export function floorIntro(state) {
  const f = state?.floor;
  if (!f) return [];
  const out = [];
  const shrineGod = f.shrine?.god && gods.rows[f.shrine.god]?.name;
  out.push({ words: [depthLine(state), f.forge && 'Elemental Forge', shrineGod && `${shrineGod} shrine`].filter(Boolean).join(' · ') + '.', fill: tone.gold });
  if (f.vault) out.push({ words: 'Iron vault: key carried by a monster.', fill: color.ash });
  const deep = f.biome === 'underdark', bfloor = ((state.floorNo ?? 1) - 1) % 5 + 1;
  if (f.boss && !f.plane) {
    if (f.biome === 'crypt') out.push({ words: "Morty's hall. Break his phylactery to keep him dead.", fill: color.hp });
    else if (f.biome === 'caverns') out.push({ words: "Deep Maw's hall. Burrows cover the ground.", fill: color.hp });
    else if (deep) out.push({ words: "Matron's hall. Break her rituals before they finish.", fill: color.hp });
    else if (f.biome !== 'chaos') out.push({ words: "Warchief's hall. Bring his core to the gate.", fill: color.hp });
  }
  if (deep && !f.boss && !f.plane && bfloor === 1) out.push({ words: 'Silk rustles in the dark.', fill: color.ash });
  const seen = new Set();
  for (const n of f.notes ?? []) {
    const text = floorEntryNote(n, f);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ words: text, fill: color.ash });
  }
  return out;
}
