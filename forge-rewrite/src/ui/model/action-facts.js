// The live numbers on an ability or prayer card (1.7 enchtext.js ABILITY_LIVE, PRAYER_LIVE and abilityDetails,
// :98-191 @3c8b312): its damage, healing and shield worked out for this hero now, each status it puts on a foe with
// its turns (bosses shorter where the status says so), how long its own buff lasts, and the cooldown with how soon it
// is ready. Read from the effect lists in abilities.json and prayers.json, so a new power needs no words here.

import abilities from '../../../data/abilities.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };
import statuses from '../../../data/statuses.json' with { type: 'json' };
import tuning from '../../../data/tuning.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };
import sigils from '../../../data/sigils.json' with { type: 'json' };
import strings from '../../../data/strings.json' with { type: 'json' };
import { buffTurns, amount, heroStats, value } from '../../engine/reads.js';
import { fill } from './words.js';

const TYPE_WORD = { phys: 'physical', fire: 'fire', ice: 'frost', lightning: 'lightning', poison: 'poison', dark: 'shadow', light: 'light', magic: 'magic' };
const BOSS_TURNS = tuning.rows.statuses.bossControlDuration;
// 1.7's fact labels for what a power puts on a foe (enchtext.js ACTION_FACT_ORDER).
const STATUS_LABEL = { stun: 'Stun', root: 'Root', burn: 'Burning', blind: 'Blind', fear: 'Fear', poison: 'Poison', chill: 'Chill', frozen: 'Freeze', wet: 'Wet', tomb: 'Duration' };
const turnsWord = n => `${n} turn${n === 1 ? '' : 's'}`;

/** The scaling keys amount.js reads, for the hero as the owner of the power. */
function ownerOf(state) {
  const h = state.hero, p = state.actors?.[state.playerId] ?? {}, s = heroStats(h);
  return { ...p, attr: h.attr, affinity: h.affinity ?? {}, level: h.level ?? 1, spellPower: s.spellPower ?? 1, divine: s.divine ?? 1,
    dmg: s.damageShown ?? s.dmg ?? p.dmg ?? [1, 2], maxhp: p.maxhp ?? s.maxhp, maxmana: p.maxmana ?? s.maxmana };
}

/** An amount as its lowest and highest value (amount.js forms; a roll gives both ends, the rest pass through amount). */
function range(a, ctx) {
  if (typeof a === 'number') return [a, a];
  if (a && typeof a === 'object' && 'roll' in a) return [a.roll[0], a.roll[1]];
  if (a && typeof a === 'object' && 'scaled' in a) {
    const s = a.scaled, ends = range(s.base ?? 0, ctx).map(v => {
      for (const [k, per] of Object.entries(s.per ?? {})) v += per * amount({ scaled: { base: 0, per: { [k]: 1 } } }, ctx);
      for (const k of s.mult ?? []) v *= amount({ scaled: { base: 1, mult: [k] } }, ctx);
      if (s.round === 'down') v = Math.floor(v); else if (s.round) v = Math.round(v);
      if (s.min !== undefined) v = Math.max(s.min, v);
      if (s.max !== undefined) v = Math.min(s.max, v);
      return v;
    });
    return ends;
  }
  const v = amount(a, ctx);
  return [v, v];
}

const span = ([lo, hi]) => (Math.round(lo) === Math.round(hi) ? String(Math.round(lo)) : `${Math.round(lo)}-${Math.round(hi)}`);

/** A choice left to chance (Roll the Dice's rewards and pranks): no option has a condition, so nothing in it is sure. */
const byChance = e => e.verb === 'choose' && e.by === 'weight' && (e.options?.length ?? 0) > 1 && e.options.every(o => !o.if);

/** Every effect in a list, nested ones too (then, else, choose options, on-event), but not a chance's outcomes (1.7
 * gives Roll the Dice its sentence only). */
function each(list, fn) {
  for (const e of list ?? []) {
    if (!e || typeof e !== 'object') continue;
    fn(e);
    each(e.then, fn); each(e.else, fn); each(e.effects, fn);
    if (!byChance(e)) for (const o of e.options ?? []) { each(o.effects, fn); each(o.else, fn); }
  }
}

const selfTarget = e => e.target?.selector === 'self';

/**
 * The facts rows for ability or prayer `id`, worked out for the hero in `state`: [label, value][].
 * @param {string} id @param {any} state the game (hero, player actor)
 */
export function actionFacts(id, state) {
  const h = state?.hero;
  const row = abilities.rows[id] ?? prayers.rows[id];
  if (!row || !h) return [];
  const owner = ownerOf(state), ctx = { state, owner, rank: h.faith?.rank ?? 0 };
  const out = [], seen = new Set(), foeStatus = new Map();
  let duration = 0, durationOf = null;
  const once = (label, value) => { if (!seen.has(label) && value) { seen.add(label); out.push([label, value]); } };
  const safe = fn => { try { return fn(); } catch { return null; } };
  const extra = owner.fx?.foeStatusTurns ?? 0;
  each(row.effects, e => {
    if ((e.verb === 'spell-strike' || e.verb === 'damage') && e.amount !== undefined) {
      const r = safe(() => range(e.amount, ctx));
      if (r) once('Damage', `${span(r)} ${TYPE_WORD[e.type ?? row.type] ?? ''}`.trim());
    }
    if (e.verb === 'weapon-attack') {
      const m = safe(() => range(e.multiplier ?? 1, ctx)) ?? [1, 1];
      once('Damage', `${Math.round(owner.dmg[0] * m[0])}-${Math.round(owner.dmg[1] * m[1])} physical`);
    }
    if (e.verb === 'heal' && e.amount !== undefined) { const r = safe(() => range(e.amount, { ...ctx, target: owner })); if (r) once('Healing', `${span(r)} HP`); }
    if (e.verb === 'shield' && e.amount !== undefined) { const r = safe(() => range(e.amount, ctx)); if (r) once('Shield', `${span(r)} HP`); }
    if (e.verb === 'apply-status' && e.status && statuses.rows[e.status]) {
      const st = statuses.rows[e.status];
      // A status that is not harmful (and has no per-bearer turns) is the power's own buff: its length is the Duration.
      if (selfTarget(e) || (!st.tags?.includes('harmful') && !st.turnsByBearer)) { if ((e.turns ?? 0) > duration) { duration = e.turns; durationOf = e.status; } return; }
      const t = foeStatus.get(e.status) ?? [];
      if (e.turns) t.push(e.turns + extra);
      foeStatus.set(e.status, t);
    }
  });
  for (const [sid, t] of foeStatus) {
    if (!t.length) continue;
    const st = statuses.rows[sid], lo = Math.min(...t), hi = Math.max(...t), by = st.turnsByBearer;
    let words = by ? `${turnsWord(by.creature)}; elites ${by.elite}, bosses ${by.boss}` : lo === hi ? turnsWord(lo) : `${lo}-${hi} turns`;
    if (!by && st.bossControl && BOSS_TURNS !== lo) words += `; bosses ${turnsWord(BOSS_TURNS)}`;
    once(STATUS_LABEL[sid] ?? st.name ?? sid, words);
  }
  // F57: the hero's own buff lasts longer under a Holy Symbol, as the rules lengthen it (statuses.js buffTurns).
  if (duration) once('Duration', turnsWord(buffTurns(state.actors?.[state.playerId] ?? {}, durationOf, duration)));
  // The cooldown, and how long until it is ready (1.7 actionCooldown). The Cleric's invoke keeps its cooldown with the
  // hero's under the god's prayer id; prayers keep theirs in faith (hud/hotbar.js entryView).
  if (row.cooldown) {
    const invoke = gods.rows[h.faith?.god ?? h.god]?.invoke;
    const left = Math.ceil((prayers.rows[id] && id !== invoke ? h.faith?.cooldowns?.[id] : h.cooldowns?.[id]) ?? 0);
    once('Cooldown', turnsWord(row.cooldown) + (left > 0 ? ` · ready in ${turnsWord(left)}` : ''));
  }
  return out;
}

/**
 * 1.7 enchtext.js SIGIL_LIVE and sigilDetails (:192-235 @3c8b312): what a read sigil does, with this hero's numbers now:
 * damage by the floor, healing and mana by the hero's pools, the turns a foe keeps a status (bosses shorter where the
 * status says so), and how long the hero's own buff lasts with a holy symbol. {summary, rows, notes}, or null without a hero.
 */
export function sigilFacts(id, state) {
  const h = state?.hero, p = state?.actors?.[state.playerId];
  if (!h || !p) return null;
  const floor = state.floorNo ?? 1, maxhp = p.maxhp ?? heroStats(h).maxhp, maxmp = p.maxmana ?? heroStats(h).maxmana;
  const own = (n, id = null) => turnsWord(buffTurns(p, id, n));   // F57 (statuses.js buffTurns)
  const extra = p.fx?.foeStatusTurns ?? 0;
  const foe = (sid, n) => { const t = n + extra, st = statuses.rows[sid]; return turnsWord(t) + (st?.bossControl && BOSS_TURNS < t ? `; bosses ${turnsWord(BOSS_TURNS)}` : ''); };
  // U6 (ui-13): the card is a strings.json template (sigil-card.<id>, 1.7 SIGIL_LIVE's words and order) whose numbers
  // point into the sigil's effects and the status rows: summary, then label TAB value rows, then '- ' notes.
  const t = strings.rows['sigil-card.' + id];
  if (!t) return null;
  const [summary, ...lines] = fill(t, { n: floor, floor, maxhp, maxmp, healMult: p.fx?.healMult ?? 1, own, foe }).split('\n');
  return { summary, rows: lines.filter(l => !l.startsWith('- ')).map(l => l.split('\t')), notes: lines.filter(l => l.startsWith('- ')).map(l => l.slice(2)) };
}
