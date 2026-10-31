// Experience and levels (spec/character.md A27-A30). Numbers: progression.json xp-curve and level-up.

import progression from '../../data/progression.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import { heroStats } from './derive.js';
import { tally } from './run-record.js';

const C = progression.rows['xp-curve'], UP = progression.rows['level-up'];

/** A27: XP from `level` to the next. */
export function toNext(level) {
  return C.toNext[level - 1] ?? Math.round(C.base * C.growth ** (level - 1) / C.roundTo) * C.roundTo;
}

/** A30: stat points for reaching `level` (Human +1 on every third, Tourist +1 on every second). */
function pointsAt(hero, level) {
  const every = [races.rows[hero.race]?.statPointEvery, classes.rows[hero.cls]?.statPointEvery];
  return UP.pointsPerLevel + every.filter(n => n && level % n === 0).length;
}

/** Wisdom (magic.md answer 23): one whole level, the progress toward the next kept. */
export function gainLevel(state, events) {
  const h = state.hero, keep = h.xp;
  h.xp = toNext(h.level);
  settle(state, events);
  h.xp = Math.min(keep, toNext(h.level) - 1);
}

/**
 * A29-A30: gives the hero `amount` XP (raised by xp-gain, Tourist +25%, rounded) and any levels it earns.
 * HP rises by the max-HP increase and mana refills on each level; several levels can come from one award.
 */
export function awardXp(state, amount, events) {
  const hero = state.hero, p = state.actors[state.playerId];
  const gain = Math.round(amount * (1 + heroStats(hero).xpPct / 100));
  if (gain <= 0) return;
  hero.xp += gain;
  tally(state, 'xp', gain);   // the score counts XP earned (1.7 recordRunEarning)
  events.push({ type: 'xp', amount: gain });
  settle(state, events);
}

/** The levels the hero's XP has earned. */
function settle(state, events) {
  const hero = state.hero, p = state.actors[state.playerId];
  while (hero.level < C.levelCap && hero.xp >= toNext(hero.level)) {
    const before = heroStats(hero).maxhp;
    hero.xp -= toNext(hero.level);
    hero.level += 1;
    hero.points += pointsAt(hero, hero.level);
    const s = heroStats(hero);
    p.maxhp = s.maxhp; p.hp = Math.min(s.maxhp, p.hp + (s.maxhp - before));
    p.maxmana = s.maxmana; if (UP.mpRefill) p.mana = s.maxmana;
    events.push({ type: 'level', level: hero.level }, { type: 'log', words: UP.log.replace('{level}', hero.level).replace(/<\/?b>/g, '') });
  }
  // A28: at the cap, XP is held one below the next level's cost.
  if (hero.level >= C.levelCap) hero.xp = Math.min(hero.xp, toNext(C.levelCap) - 1);
}
