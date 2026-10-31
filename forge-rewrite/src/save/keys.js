// Every storage key the game keeps (consolidation C15, C17: its own file, so save.js and slots.js both read it).

/** Every key the game keeps in the browser: the runs (save.js), the options, the record (journal.js), the old build's import flag (legacy.js). */
export const KEYS = { options: 'forge2-options', tutorial: 'forge2-tutorial', tutorialSeen: 'forge2-tutorial-seen', probe: 'forge2-probe', journal: 'forge2-journal', runs: 'forge2-runs', legacy: 'forge2-legacy-import', slot: id => 'forge2-slot-' + id, at: id => 'forge2-at-' + id };
