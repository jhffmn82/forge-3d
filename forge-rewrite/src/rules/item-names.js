// What the player calls an item or a sigil (consolidation C17, moved from pickup.js and sigils.js, which needed each
// other's names): the run's rune looks, a sigil's known or rune name, a ring's or amulet's look until its kind is
// learned, and an item's floor and bag words.

import sigils from '../../data/sigils.json' with { type: 'json' };
import runes from '../../data/runes.json' with { type: 'json' };
import loot from '../../data/loot.json' with { type: 'json' };
import { stream, next } from '../lib/rng.js';
import { itemRow } from './items.js';
import { trinketLook } from './loot.js';

const S = sigils.rows, L = loot.rows;

/** D49: the run's rune look for each sigil kind (runes.json assignment), built once and kept in the run. */
export function runeOf(state, id) {
  const run = (state.run ??= {});
  if (!run.runes) {
    const R = runes.rows, rng = stream((state.seed ^ Number(R.assignment.seedXor)) >>> 0);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next(rng) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const futhark = shuffle(Object.keys(R).filter(k => R[k].kind === 'futhark')), binds = shuffle(Object.keys(R).filter(k => R[k].kind === 'bind-rune'));
    const G = S.groups, order = [...new Set([...G.singles, ...G.plus, ...G.pairs, ...G.triple, ...G.quadruple, ...G.grand])];
    let f = 0, b = 0;
    run.runes = {};
    for (const sid of order) run.runes[sid] = R.assignment.rare.includes(sid) ? binds[b++ % binds.length] : futhark[f++ % futhark.length];
  }
  return run.runes[id] ?? null;
}

/** A sigil's name as the player knows it: its real name once known, else its rune ('Fehu rune'). */
export function sigilName(state, id) {
  return sigilKnown(state, id) ? S[id].name : runes.rows[runeOf(state, id)]?.name ?? 'Unknown rune';
}

/** D49: is this sigil kind known this run (read, carved or identified)? */
export const sigilKnown = (state, id) => !!state.run?.knownSigils?.includes(id);

/** I52: has this ring or amulet kind been learned this run (worn, used, identified)? */
export const trinketKnown = (state, id) => !!state?.run?.knownTrinkets?.includes(id);
/** I52: the hero learns a ring or amulet kind for the run; every later one of that kind shows its kind. */
export function learnTrinket(state, id) { const k = (state.run ??= {}).knownTrinkets ??= []; if (!k.includes(id)) k.push(id); }

/**
 * I50-I52 (1.7 gearName): a ring or amulet has no quality. Until its kind is learned it shows only its look for the run
 * ('Jade ring', 'Sun amulet'); a learned kind still unidentified shows 'Ring of Mending?'; identified, its plus or level.
 */
function trinketName(it, row, state) {
  const kind = row.kind;
  if (it.known === false) {
    if (!trinketKnown(state, it.id)) {
      const look = it.look ?? (state ? trinketLook(state, kind, it.id) : null);
      return look ? `${look[0].toUpperCase()}${look.slice(1)} ${kind}` : `Unknown ${kind}`;
    }
    return row.name + '?';
  }
  const cursed = it.cursed ? ' (cursed)' : '';
  if (kind === 'amulet') return `${row.name} (${['I', 'II', 'III'][Math.min(3, Math.max(1, it.level ?? 1)) - 1]})${cursed}`;
  const plus = it.plus ?? 0;
  return `${row.name} ${plus >= 0 ? '+' : ''}${plus}${cursed}`;
}

export function itemName(it, state = null) {
  if (it.kind === 'sigil') return state ? sigilName(state, it.id) : sigils.rows[it.id]?.name ?? it.id;
  if (it.kind === 'essence') return `${it.n} essence`;
  // G25 (1.7 itemLabel, gear-adapter.js:161-172): the floor words: 'an air mote', 'a heart (heals 25% of max HP)'.
  if (it.kind === 'mote') return `${/^[aeiou]/.test(it.el) ? 'an' : 'a'} ${it.el} mote`;
  if (it.kind === 'heart') return `a heart (heals ${L.globes.heartHealPct}% of max HP)`;
  if (it.kind === 'globe') return `a mana globe (restores ${L.globes.globeManaPct}% of max mana)`;
  if (it.kind === 'key') return 'an iron key';
  if (it.kind === 'core') return `the ${it.name}`;
  if (it.kind === 'relic') return it.name;
  const row = itemRow(it.id).row;
  if (row.kind === 'ring' || row.kind === 'amulet') return trinketName(it, row, state);
  const prefix = ['Worn ', '', 'Fine ', 'Masterwork '][it.tier ?? 1] ?? '';
  if (it.kind === 'food') return row.name;
  // G24 (1.7 gearName, gear-adapter.js:155-159): an identified piece adds its plus, ' of Fire' for an enchant and
  // ' (cursed)' when the curse is known.
  if (it.known === false) return prefix + row.name + '?';
  const el = it.enchant ? ` of ${it.enchant[0].toUpperCase()}${it.enchant.slice(1)}` : '';
  return prefix + row.name + (it.plus ? ` ${it.plus > 0 ? '+' : ''}${it.plus}` : '') + el + (it.cursed ? ' (cursed)' : '');
}
