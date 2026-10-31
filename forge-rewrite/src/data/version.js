// The game's version name and the patch notes, from data/patch-notes.json (consolidation C17: every layer reads them
// here; platform/version.js keeps the update check).

import notes from '../../data/patch-notes.json' with { type: 'json' };

export const VERSION = notes.rows[notes.current].name;
export const PATCHES = Object.values(notes.rows).map(r => ({ version: r.name, notes: r.notes }));
