// The Underdark, floors 16-20: built its own way by floor.js (registry.js hooks attempt and complete).

import { registerBiome } from '../registry.js';
import { underdarkAttempt, underdarkComplete } from './floor.js';

registerBiome('underdark', { attempt: underdarkAttempt, complete: underdarkComplete });
