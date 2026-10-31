// The library's first sigil (1.7 librarySigil; W6, world-24: one roll for the library room and the library puzzle):
// a grade by rooms.json library.firstSigil.gradePct (85 singles, 10 pairs, 4 plus or triple, 1 grand) within the list,
// else the list's singles, else the whole list. One draw for the grade, one for the pick.

import rooms from '../../data/rooms.json' with { type: 'json' };
import sigils from '../../data/sigils.json' with { type: 'json' };
import { next } from '../lib/rng.js';

const PCT = rooms.rows.library.firstSigil.gradePct, G7 = sigils.rows.groups ?? {};

/** A sigil id from `list` by grade, or null when the list is empty (the grade is drawn even then). */
export function gradeSigil(rng, list) {
  const r = next(rng) * 100, s = PCT.singles, p = s + PCT.pairs, q = p + PCT.plus;
  const grade = r < s ? G7.singles : r < p ? G7.pairs : r < q ? [...(G7.plus ?? []), ...(G7.triple ?? [])] : G7.grand;
  const inGrade = list.filter(id => grade?.includes(id)), singles = list.filter(id => G7.singles?.includes(id));
  const from = inGrade.length ? inGrade : singles.length ? singles : list;
  return from.length ? from[Math.floor(next(rng) * from.length)] : null;
}
