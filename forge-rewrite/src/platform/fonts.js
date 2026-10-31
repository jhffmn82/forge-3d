// Loads the game's fonts before the first paint, so text is measured with the right faces.
// The files are in assets/fonts (tools/assets/sync.mjs writes them); a face that fails to load falls back to the browser's.

import ui from '../../data/ui.json' with { type: 'json' };

const FILES = [
  [ui.fonts.display, 'assets/fonts/grenze-gotisch-500.woff2', '500'],
  [ui.fonts.display, 'assets/fonts/grenze-gotisch-700.woff2', '700'],
  [ui.fonts.body, 'assets/fonts/spectral-400.woff2', '400'],
  [ui.fonts.body, 'assets/fonts/spectral-400-italic.woff2', '400', 'italic'],   // 1.7 css/fonts.css:7-8 (CSS-36)
  [ui.fonts.body, 'assets/fonts/spectral-600.woff2', '600'],
  [ui.fonts.mono, 'assets/fonts/ibm-plex-mono-400.woff2', '400'],
  [ui.fonts.mono, 'assets/fonts/ibm-plex-mono-600.woff2', '600'],
];

export async function loadFonts() {
  await Promise.all(FILES.map(async ([family, url, weight, style = 'normal']) => {
    try {
      const face = new FontFace(family, `url(${url})`, { weight, style });
      document.fonts.add(await face.load());
    } catch { /* missing file: the fallback face is used */ }
  }));
}
