// The browser's worker made to look as QuickJS does to the 2D game's code (runtime/web.js imports this first): with no
// OffscreenCanvas, its drawings go to the 2D renderer's stand-in canvas (pixi.js RecCanvas), which Godot paints, as on
// the PC.
for (const k of ['OffscreenCanvas', 'Worker']) Object.defineProperty(globalThis, k, { value: undefined, configurable: true, writable: true });
