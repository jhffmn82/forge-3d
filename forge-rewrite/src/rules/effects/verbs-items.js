import { amount } from '../amount.js';
import { applyStatus } from '../statuses.js';
import { next } from '../../lib/rng.js';
import { makeCreature } from '../monsters.js';
import sigilData from '../../../data/sigils.json' with { type: 'json' };
import { transmute } from '../hero.js';
import loot from '../../../data/loot.json' with { type: 'json' };
import { itemName } from '../item-names.js';
import { gainLevel } from '../progression.js';
import { recycleValue } from '../sigils.js'; import { nearFree } from '../space.js';
import { walkable, T } from '../../data/tiles.js';
import { springTrap, revealSecret } from '../traps.js';
import { learnItem } from '../gear-use.js';
import { giftDrop } from '../god-powers.js';


export const sigilRows = sigilData.rows;

/** The item a picker chose: {bag: i} or {slot}. */
export const chosen = c => c.choice?.slot ? c.state.hero.worn[c.choice.slot] : c.choice?.bag !== undefined ? c.state.hero.bag[c.choice.bag] : null;

export const ITEM_VERBS = {
  identify(e, c) {
    const s = c.state, h = s.hero, know = id => { const k = (s.run ??= {}).knownSigils ??= []; if (!k.includes(id)) k.push(id); };
    if (e.which === 'sigils') for (const it of h.bag) if (it.kind === 'sigil') know(it.id);
    if (e.which === 'all-sigils') for (const [id, r] of Object.entries(sigilRows)) if (r.kind === 'sigil') know(id);
    if (e.which === 'all' || e.which === 'worn') for (const it of [...Object.values(h.worn), ...(e.which === 'all' ? h.bag : [])]) if (it && it.known === false) learnItem(s, it);   // I52: a ring or amulet's kind is learned too
    if (e.which === 'one-chosen') { const it = chosen(c); if (it) { if (it.kind === 'sigil') know(it.id); else learnItem(s, it); } }
    c.events.push({ type: 'identified', which: e.which, sfx: 'identify' });   // 1.7 gear.js:116, sigils.js:320
  },
  /** Items: uncurse what is worn; destroy, upgrade or transmute the chosen piece. */
  'item-change'(e, c) {
    const s = c.state, h = s.hero, it = e.which === 'chosen' ? chosen(c) : null;
    if (e.change === 'uncurse') { for (const w of Object.values(h.worn)) if (w?.cursed) { w.cursed = false; if (w.plus < 0) w.plus = 0; learnItem(s, w); } }
    else if (e.change === 'recycle' && it) {
      // CD1 Field Smelt: the chosen carried item for its full recycling value (1.7 gods.js prayFieldSmelt).
      const i = h.bag.indexOf(it), n = i >= 0 ? recycleValue(s, it) : 0;
      if (!n) return;
      h.bag.splice(i, 1); h.essence += n;
      c.events.push({ type: 'recycled', count: 1, essence: n, sfx: 'forge-recycle' }, { type: 'log', words: `Field Smelt: ${n} essence.` });
    }
    else if (e.change === 'destroy' && it) {
      const nm = itemName(it, s);
      for (const k of Object.keys(h.worn)) if (h.worn[k] === it) h.worn[k] = null;
      if (e.log) c.events.push({ type: 'log', words: e.log.replace('{item}', nm), ...(e.logCls ? { cls: e.logCls } : {}) });   // E42 Rot (1.7 sigils.js:343)
    }
    else if (e.change === 'upgrade' && it) { it.plus = Math.max(0, it.plus) + (e.amount ?? 1); it.cursed = false; learnItem(s, it); }
    else if (e.change === 'transmute' && it) {
      // G26 (1.7 sigils.js:150-190): keeps quality, upgrades, enchant and curse; rings and amulets too.
      const before = itemName(it, s), r = transmute(h, it, next(s.rng));
      if (r.why) { c.events.push({ type: 'log', words: r.why === 'bag-full' ? 'Bag full; changed gear may need space.' : 'No gear to transmute.', cls: 'c-info' }); return; }
      c.events.push({ type: 'log', words: `Your <b>${before}</b> becomes <b>${itemName(it, s)}</b>${r.moved ? ' and moves into your bag' : ''}.`, cls: 'c-kill' });
    } else { s.unbuilt['item-change:' + e.change] = (s.unbuilt['item-change:' + e.change] ?? 0) + 1; return; }
    c.events.push({ type: 'hero', change: 'item-' + e.change });
  },
  /**
   * The map, traps or hidden doors become known: within `where` (a radius round the user, or everything in sight), else
   * the whole floor (Mapping). Item 288: the Amulet of Seeking's "Reveal terrain, traps and hidden doors" showed the whole
   * floor's map and neither of the others.
   */
  reveal(e, c) {
    const s = c.state, f = s.floor, n = f.w * f.h, who = c.owner ?? c.target;
    const r = e.where?.selector === 'radius' ? amount(e.where.n, c) : Infinity, sight = e.where?.selector === 'all-visible';
    const within = k => (!sight || !!s.vis?.[k]) && (r === Infinity || Math.max(Math.abs((k % f.w) - who.x), Math.abs(((k / f.w) | 0) - who.y)) <= r);
    if (e.what === 'traps') {
      const found = (f.traps ?? []).filter(t => !t.found && within(t.y * f.w + t.x));
      for (const t of found) { t.found = true; c.events.push({ type: 'trap-found', at: { x: t.x, y: t.y }, kind: t.kind }); }
      if (found.length) c.events.push({ type: 'log', words: `${found.length === 1 ? 'A trap is' : `${found.length} traps are`} revealed.`, cls: 'c-info' });
      return;
    }
    if (e.what === 'secret-doors') { for (let k = 0; k < n; k++) if (f.tiles[k] === T.SECRET && within(k)) revealSecret(s, k % f.w, (k / f.w) | 0, c.events); return; }
    if (e.what !== 'map') { s.unbuilt['reveal:' + e.what] = (s.unbuilt['reveal:' + e.what] ?? 0) + 1; return; }
    if (!s.seen || s.seen.length !== n) s.seen = new Array(n).fill(0);
    for (let k = 0; k < n; k++) {
      const x = k % f.w, y = (k / f.w) | 0;
      if (within(k) && (walkable(f, x, y) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkable(f, x + dx, y + dy)))) s.seen[k] = 1;
    }
    c.events.push({ type: 'revealed', what: 'map' }, { type: 'log', words: r === Infinity ? 'The floor is revealed.' : 'The ground around you is revealed.' });
  },
  /**
   * Item 288 (1.7 amulets.js failCursedAmulet): a trap of the named kind springs under the target, as if stepped on there
   * (a cursed amulet's failure: "A curse unleashes a trap instead!"). It lies on the floor only while it springs.
   */
  'trigger-trap'(e, c) {
    const t = c.target, f = c.state.floor;
    if (!t || t.hp <= 0) return;
    const trap = { kind: e.trap, x: t.x, y: t.y };
    (f.traps ??= []).push(trap);
    springTrap(c.state, t, trap, c.events);
    const i = f.traps.indexOf(trap);
    if (i >= 0) f.traps.splice(i, 1);
  },
  /**
   * CF06 (1.7 gods.js:150-154): one visible foe, not a boss, becomes a harmless creature of `to` on its own tile
   * (Wobbles' Very Confused Rat: wandering, no loot, no XP).
   */
  transform(e, c) {
    const s = c.state, p = c.owner;
    const foes = s.order.map(id => s.actors[id]).filter(a => a.hp > 0 && a.side === 'foe' && !!s.vis?.[a.y * s.floor.w + a.x] && !(e.notBoss && (a.boss || a.set)));
    if (!foes.length) return;
    const t = foes[Math.floor(next(s.rng) * foes.length)], at = { x: t.x, y: t.y };
    t.hp = 0;
    c.events.push({ type: 'died', id: t.id, dismissed: true });
    const m = makeCreature(e.to, at.x, at.y);
    Object.assign(m, { name: c.ability?.sheepName ?? m.name, hunting: false, asleep: false, noXp: true, drops: 'kill-none', t: p?.t ?? 0 });
    s.actors[m.id] = m; s.order.push(m.id);
    c.events.push({ type: 'spawned', id: m.id, at }, { type: 'log', words: `Wobbles: ${t.name} becomes a rat.` });
    if (e.sparkle) c.events.push({ type: 'sparkle', at, kind: e.sparkle.kind, n: e.sparkle.n });   // CF27 (1.7 gods.js:154)
  },
  /** Food (Nature's Bounty) on free tiles near the owner. */
  'create-item'(e, c) {
    if (loot.rows?.[e.item]?.kind === 'table') { giftDrop(e, c); return; }
    const s = c.state, spots = nearFree(s, c.owner, 2).filter(t => !s.floor.items.some(i => i.x === t.x && i.y === t.y));
    const n = Math.round(amount(e.count ?? 1, c));
    for (let k = 0; k < n && spots.length; k++) { const t = spots.shift(); s.floor.items.push({ x: t.x, y: t.y, item: { ...makeItem(e.item), count: 1 } }); }
    c.events.push({ type: 'drops', at: { x: c.owner.x, y: c.owner.y } });
  },
  /** Resources: a whole level with progress kept (Wisdom); others as their packets land. */
  gain(e, c) {
    const s = c.state;
    if (e.resource === 'level') { gainLevel(s, c.events); return; }
    if (e.resource === 'pummel' && s.hero) { s.hero.pummel = Math.round(amount(e.amount, c)); return; }   // CD1 Pummel (1.7 gods.js:556)
    if (e.resource === 'affinity') return;   // Kindled's point of Light is faith.js syncKindled's
    // CD2 Second Heat (1.7 religion.js secondHeat): the motes the Forge work just took are handed back.
    if (e.resource === 'motes' && e.amount?.['from-source'] === 'motesSpent') {
      const spent = c.packet?.motesSpent ?? {}, h = s.hero;
      let back = 0;
      for (const [m, n] of Object.entries(spent)) if (n > 0) { h.motes[m] = (h.motes[m] ?? 0) + n; back += n; }
      if (back) c.events.push({ type: 'log', words: `Second Heat. Old Anvil hands your mote${back > 1 ? 's' : ''} back.` }, { type: 'hero', change: 'motes' });
      return;
    }
    // CF24 (1.7 religion.js:126): Tempt Fate's butterfingers, half the hero's essence lost (rounded down) and said.
    // pct-of floors at 0, so a share of essence is worked out here: a negative share is a loss.
    if (e.resource === 'essence' && s.hero) {
      const h = s.hero, share = e.amount?.['pct-of']?.stat === 'essence' ? e.amount['pct-of'].pct : null;
      const n = share !== null ? Math.trunc((h.essence ?? 0) * share / 100) : Math.round(amount(e.amount, c)), was = h.essence ?? 0;
      h.essence = Math.max(0, was + n);
      const d = h.essence - was;
      if (d) c.events.push({ type: 'essence', id: s.playerId, amount: d }, { type: 'log', words: d < 0 ? `<b>${c.ability?.name ?? 'Tempt Fate'}:</b> ${-d} essence lost.` : `${d} essence gained.` });   // essence: looks only (playback's Tempt Fate picture)
      return;
    }
    s.unbuilt['gain:' + e.resource] = (s.unbuilt['gain:' + e.resource] ?? 0) + 1;
  },
  /** CD2 Warrior's Discipline: every running cooldown, the hero's and the faith's, a turn shorter ('all', reduce n). */
  cooldown(e, c) {
    const h = c.state.hero;
    if (e.ability !== 'all' || !e.reduce || c.owner?.side !== 'player' || !h) { c.state.unbuilt['cooldown:' + e.ability] = (c.state.unbuilt['cooldown:' + e.ability] ?? 0) + 1; return; }
    for (const cd of [h.cooldowns, h.faith?.cooldowns]) if (cd) for (const k in cd) if (cd[k] > 0) cd[k] = Math.max(0, cd[k] - e.reduce);
  },
  /** Removes bodies (the hero's previous Shade swarm). */
  dismiss(e, c) {
    const s = c.state, w = e.who ?? {};
    for (const id of s.order.slice()) {
      const a = s.actors[id];
      if (a.hp <= 0 || !(w.selector === 'own-summons' ? a.summon && a.owner === c.owner?.id && (!w.kind || a.kind === w.kind) : false)) continue;
      a.hp = 0;
      c.events.push({ type: 'died', id: a.id, dismissed: true });
    }
  },
  /** Hidden for `turns` game turns; breakPursuit sends every hunter back to wandering. */
  hide(e, c) {
    const s = c.state, o = c.owner;
    applyStatus(s, o, 'hidden', { turns: e.turns }, c.events);
    if (e.breakPursuit) for (const id of s.order) {
      const a = s.actors[id];
      if (a.side === 'foe' && a.hunting) { a.hunting = false; a.goal = null; a.lastSeen = null; }
    }
  },
};
