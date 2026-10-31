// The Caverns' floor hooks (registry.js): floors 11-15 are built their own way by floor.js.
import { registerBiome } from '../registry.js';
import { cavernAttempt, cavernComplete } from './floor.js';

registerBiome('caverns', { attempt: cavernAttempt, complete: cavernComplete });
