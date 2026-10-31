// The sheet a creature row's look names (data/monsters.json look.sheet): a creature's own sheet is mob-<sheet>; a body
// drawn on a hero's cast sheet names that sheet whole (item 289: the freed traveler, 1.7's escort-human-m, is the human
// cast's body, as 1.7 mobSheet draws it).
export const bodySheet = look => (look.sheet.startsWith('cast-') ? look.sheet : 'mob-' + look.sheet);
