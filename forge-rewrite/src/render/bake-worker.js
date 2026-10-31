// The one worker entry for the terrain bakes (consolidation M8, render-04): the Realm's and the planes' rock raster
// (realm-worker.js, lane 'realm') and the Underdark's cave chunks (underdark-worker.js, lane 'deep'), each message
// handed to its lane (bake-pool.js adds the lane). Bundled by tools/dev/serve.mjs as build/bake-worker.js.

import { onRealm } from './realm-worker.js';
import { onDeep } from './underdark-worker.js';

self.onmessage = e => (e.data.lane === 'deep' ? onDeep : onRealm)(e.data);
