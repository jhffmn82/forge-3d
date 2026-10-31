// The card pass's program (lighting-design.md F5); the shared irradiance and admission are light-glsl.js's.

import { SHARED } from './light-glsl.js';

/**
 * F5, bodies and props: each is a card standing on its foot, facing the viewer at 45 degrees. Its normal is its map
 * (a prop's at 2.16, a body's at 1.224) and, for every body and every prop without a map, its form: the slope of its
 * blurred silhouette at four sizes (1.7 normal-lighting.js:58-68). Lit at its foot, height rising up the card; the
 * hero lit under his own lamp at 0.48, his card no higher than it. Glowing art keeps its glow; then the knee.
 */
export const CARD_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vTextureCoord;
in vec2 vGlobal;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uScreen;       // map root x, y (screen px), 1 / (scale x tile), 0
uniform vec4 uForm;         // form strength, hand map gain, z a tile up the card, classic (1)
uniform vec4 uHero;         // the hero's foot x, y (tiles), his own-lamp share, the height his card stops at
uniform sampler2D uEmitTex; // the actors drawn as paint x emission
uniform vec4 uEmitWin;      // emission crop origin and allocated size (screen CSS px)
uniform sampler2D uNormTex; // normal maps drawn in place
uniform vec4 uEmit;         // screen width, height (css px), emission on, normal maps on
uniform sampler2D uFormTex; // the formed sprites' silhouettes, mipmapped: red a body, green screen pixels a texel / 2, blue the hero
uniform vec4 uFormK;        // forms on, a prop map's gain
uniform sampler2D uFootTex; // each sprite's foot row (red, 32 a tile modulo 8 tiles) and its footprint's rows behind it (green, 32 a tile)
uniform sampler2D uField;   // F3 (classic: bodies take the field where they are)
uniform vec4 uFieldWin;
${SHARED}
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a <= 0.0) { finalColor = c; return; }
  vec2 p = (vGlobal - uScreen.xy) * uScreen.z;
  vec3 paint = c.rgb / c.a, light;
  if (uForm.w > 0.5) light = texture(uField, (p - uFieldWin.xy) / uFieldWin.zw).rgb * 2.0;
  else {
    // The card's foot: the row the sprite this pixel belongs to stands on (its body's, plant's or prop's own, item 178),
    // so a whole body is lit from one foot as 1.7 lights each record from its own point, and a plant above another
    // never takes the light of the lower one's tile. A pixel no sprite claims (a drawn shape) stands where it is; so does
    // one over the floor a piece's footprint covers (item 186), only what rises above its back row standing on that row.
    vec2 suv = vGlobal / uEmit.xy;
    vec4 fr = textureLod(uFootTex, suv, 0.0);
    float up = fr.a > 0.1 ? max(0.0, mod(fr.r / fr.a * 255.0 - p.y * 32.0 + 8.0, 256.0) - 8.0 - fr.g / fr.a * 255.0) / 32.0 : 0.0;
    vec2 foot = vec2(p.x, p.y + up);
    vec4 fk = uFormK.x > 0.5 ? textureLod(uFormTex, suv, 0.0) : vec4(0.0);
    // The hero's own pixels (marked in the form picture; without it, a foot within his footprint). His whole card is lit
    // at his render position, straight under his own lamp, its height from his own foot line (1.7 render.js:1148-1155).
    bool hero = uFormK.x > 0.5 ? fk.a > 0.5 && fk.b > 0.5 * fk.a : abs(foot.x - uHero.x) < 0.42 && abs(foot.y - uHero.y) < 0.2;
    float z = hero ? max(0.0, uHero.y - p.y) * uForm.z : up * uForm.z;
    if (hero) z = min(z, uHero.w);
    bool formed = fk.a > 0.5, body = formed && fk.r > 0.5 * fk.a;
    bool held = fr.a > 0.1 && fr.b > 0.5 * fr.a;   // item 218: held gear (blue in the foot picture), one flat card in every clip
    vec3 n = vec3(0.0, 0.0, 1.0);
    if (uEmit.w > 0.5 && !held) {
      vec4 hn = textureLod(uNormTex, suv, 0.0);
      if (hn.a > 0.5) { n = vec3(((hn.rg / hn.a) * 255.0 - 128.0) / 127.0, (hn.b / hn.a) * 2.0 - 1.0); n.xy *= body ? uForm.y : uFormK.y; n = normalize(n); }
    }
    if (formed && !held) {
      // 1.7's form: the mask's slope at mip levels 1-4, 2^lod of its art's texels apart, weighted .55 + .2 lod.
      float k = max(0.05, 2.0 * fk.g / fk.a);
      vec2 tx = 1.0 / vec2(textureSize(uFormTex, 0)), slope = vec2(0.0);
      for (int l = 1; l <= 4; l++) {
        float lod = float(l) + log2(k);
        vec2 o = tx * exp2(float(l)) * k;
        slope += (0.55 + 0.2 * float(l)) * vec2(textureLod(uFormTex, suv + vec2(o.x, 0.0), lod).a - textureLod(uFormTex, suv - vec2(o.x, 0.0), lod).a,
                                                textureLod(uFormTex, suv + vec2(0.0, o.y), lod).a - textureLod(uFormTex, suv - vec2(0.0, o.y), lod).a);
      }
      n = normalize(vec3(n.xy / max(n.z, 0.25) + vec2(-slope.x, slope.y) * uForm.x, 1.0));
    }
    vec3 plain = vec3(0.0, -0.70710678, 0.70710678);
    n = vec3(n.x, (n.y - n.z) * 0.70710678, (n.y + n.z) * 0.70710678);
    // The receiver: the body's tile centre row (1.7 surface y = its render position), at this column; the hero's at his.
    vec2 rec = hero ? vec2(uHero.x, uHero.y - 0.1667) : vec2(foot.x, foot.y - 0.1667);
    Adm a = admitAt(rec);
    light = limitLight(ambAt(rec).rgb + lightSum(a, vec3(rec, z), n, plain, formed, rec, -1e9, hero ? uHero.z : 1.0));
  }
  vec3 outc = graded(kneeOf(paint, light)) * c.a;
  if (uEmit.z > 0.5) {
    vec2 euv = (vGlobal - uEmitWin.xy) / uEmitWin.zw;
    if (all(greaterThanEqual(euv, vec2(0.0))) && all(lessThan(euv, vec2(1.0)))) outc = max(outc, texture(uEmitTex, euv).rgb);
  }
  finalColor = vec4(outc, c.a);
}`;
