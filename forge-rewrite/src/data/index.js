// One split of every data table into its content rows and its rule rows (consolidation C5, engine-rules-36). A table's
// `rows` map holds both; rule rows carry kind 'rule'. Consumers ask here instead of filtering by hand.

const SPLIT = new WeakMap();

/** {rows, rules}: the table's content rows and its rule rows, each by id (split once per table). */
export function split(table) {
  let s = SPLIT.get(table);
  if (s) return s;
  const rows = {}, rules = {};
  for (const [id, r] of Object.entries(table.rows ?? table)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    (r.kind === 'rule' ? rules : rows)[id] = r;
  }
  s = { rows, rules };
  SPLIT.set(table, s);
  return s;
}

/** The content rows by id; only those of one kind when kind is given. */
export function rowsOf(table, kind = null) {
  const { rows } = split(table);
  return kind === null ? rows : Object.fromEntries(Object.entries(rows).filter(([, r]) => r.kind === kind));
}

/** One content row (never a rule row), or null. */
export const row = (table, id) => split(table).rows[id] ?? null;
