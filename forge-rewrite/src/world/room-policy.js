// Room policy flags from rooms.json (consolidation W2): what the shared passes ask of a room kind, read from its row
// instead of each pass keeping its own list.

import rooms from '../../data/rooms.json' with { type: 'json' };

/** A room with residents of its own (rooms.json ownResidents): no wanderers and no random floor traps (1.7 world.js:417, :445). */
export const ownResidents = kind => !!(kind && rooms.rows[kind]?.ownResidents);
