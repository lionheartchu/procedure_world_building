/**
 * Materials for the scattered forms: one vertex stage (growth and drift) and
 * two fragment stages, solid and film. Kept apart from the component so a
 * form can be looked at on its own, outside the scene.
 */

import * as THREE from 'three'
import { PALETTE } from './palette'

const hexUniform = (hex) => ({ value: new THREE.Color(hex) })

/**
 * The accumulation light (accumulation.js), shared by the ground, the colony
 * tissue and the forms, so all of them read one light held in the matter the
 * colonies laid down. R light, G density, B tone (pearl, icy lavender,
 * silver-blue); uAccumOn is 0 outside the Scatter view and rises with growth.
 */
export const ACCUMULATION_GLSL = /* glsl */ `
  uniform sampler2D uAccum;
  uniform float uAccumOn;
  uniform float uAccumSize;
  uniform vec3 uAccPearl;
  uniform vec3 uAccIcy;
  uniform vec3 uAccSilver;

  vec4 accumAt(vec2 xz) {
    if (uAccumOn <= 0.0) return vec4(0.0, 0.0, 0.5, 0.0);
    vec4 a = texture2D(uAccum, clamp(xz / uAccumSize + 0.5, 0.0, 1.0));
    return vec4(a.rg * uAccumOn, a.ba);
  }

  vec3 accumTone(float t) {
    return t < 0.5 ? mix(uAccPearl, uAccIcy, t * 2.0) : mix(uAccIcy, uAccSilver, t * 2.0 - 1.0);
  }
`

const BLANK_ACCUMULATION = new THREE.DataTexture(new Uint8Array([0, 0, 128, 255]), 1, 1)
BLANK_ACCUMULATION.needsUpdate = true

/**
 * Study 10's warm accent (dev A/B, LifecycleLayer): compiled only into the
 * lifecycle's own materials, and only while a variant is chosen (the WARM
 * define). Matter crossing from one state to another is shifted toward a
 * pale champagne at the brightness it already had: a change of state, not
 * more light, and not a line of its own. Only where the surface is lit:
 * beige on a dim surface reads as brown, so shadow keeps its violet.
 */
export const WARM_GLSL = /* glsl */ `
  #ifdef WARM
  uniform vec3 uWarmTint;
  float warmLuma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }
  // How much of a cue a surface this bright can carry.
  float warmGate(vec3 c) {
    return smoothstep(0.1, 0.32, warmLuma(c));
  }
  vec3 warmed(vec3 c, float w) {
    return mix(c, uWarmTint * (warmLuma(c) / warmLuma(uWarmTint)), clamp(w, 0.0, 1.0));
  }
  #endif
`

/** Uniforms for ACCUMULATION_GLSL; `size` is the world's width. */
export function accumulationUniforms(size = 26) {
  return {
    uAccum: { value: BLANK_ACCUMULATION },
    uAccumOn: { value: 0 },
    uAccumSize: { value: size },
    uAccPearl: hexUniform('#EEE7F4'),
    uAccIcy: hexUniform('#C9C3F0'),
    uAccSilver: hexUniform('#AEBFEC'),
  }
}

/**
 * The accumulation grid as a texture, with the value the materials read for
 * how far it has come up (driven by the growth clock in ScatterLayers).
 */
export function createAccumulationTexture(acc) {
  const texture = new THREE.DataTexture(acc.data, acc.res, acc.res)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return { texture, size: acc.size, rise: { value: 1 }, stats: acc.stats }
}

/**
 * Point every accumulation uniform of a material at the current light (or
 * at nothing).
 */
export function setAccumulation(uniforms, accumulation) {
  if (!uniforms.uAccum) return
  uniforms.uAccum.value = accumulation?.texture ?? BLANK_ACCUMULATION
  uniforms.uAccumOn.value = accumulation ? accumulation.rise.value : 0
  if (accumulation) uniforms.uAccumSize.value = accumulation.size
}

/**
 * Shared vertex stage. A part scales about its anchor as the growth clock
 * passes its birth window, then drifts very slowly — one phase per form, taken
 * from its anchor, so a form sways as a whole instead of shimmering.
 */
const VERTEX = /* glsl */ `
  attribute vec3 aAnchor;
  attribute vec2 aBirth;
  attribute vec4 aLook;
  attribute float aEdge;
  attribute float aSway;

  uniform float uGrowth;
  uniform float uTime;
  // Study 10 (lifecycle, dev flag only): a resident lying down. 0 leaves
  // every form exactly as it was.
  uniform float uRecline;
  uniform vec3 uBase;
  uniform vec2 uLean;
  #ifdef WIND
  // The Habitat's D1 (lifecycle residents): bent by the air their films
  // ride (its displacement at the crest, units), from the foot up.
  uniform vec4 uWind;
  #endif
  #ifdef RELEASE
  // D1: where this resident's films came away, as it stood before it lay
  // down (so the marks lie with it).
  varying vec3 vRest;
  #endif
  #ifdef ENCOUNTER
  // The Habitat's encounter (lib/encounter.js): one membrane's dent. Its
  // displacement at the centre, the centre and radius, and the foot it is
  // held at (height, span), its height and how far it leans with the dent.
  // The weight is Membrane.weightAt's.
  uniform vec3 uDent;
  uniform vec4 uDentAt;
  uniform vec4 uDentFoot;
  // How stretched the sheet is here (0..1): pressed in, it thins.
  varying float vStretch;
  #endif

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec4 vLook;
  varying float vEdge;
  varying float vPhase;
  varying float vAbove;
  #ifdef WARM
  // Study 10's warm accent (approach B): how far along its own surface this
  // point lies from its foot, as far as it has grown (the veil's uv.y is the
  // arc length up its column).
  varying float vAlong;
  #endif
  #ifdef CONDUIT_FOLD
  // Study 10's fold (dev flag only): where on the fold this point lies (along
  // it, across it, both in units), whether on its inner skin, and how much
  // of the matter in the tissue there shows as specks.
  attribute vec4 aFold;
  varying vec4 vFold;
  #endif

  #include <common>
  #include <fog_pars_vertex>

  void main() {
    float g = smoothstep(aBirth.x, aBirth.x + max(aBirth.y, 1e-3), uGrowth);
    vec3 p = aAnchor + (position - aAnchor) * g;
    #ifdef WARM
    vAlong = uv.y * g;
    #endif
    #ifdef CONDUIT_FOLD
    vFold = aFold;
    #endif
    vec3 nrm = normal;
    #ifdef RELEASE
    vRest = p;
    #endif
    if (uRecline > 0.0) {
      // It folds over toward its lean about its base: its height goes into
      // its length, until it lies low on the ground as its own outline.
      vec3 q = p - uBase;
      float h = max(q.y, 0.0);
      q.xz += uLean * h * 0.9 * uRecline;
      q.y = mix(q.y, q.y * 0.02 + 0.01, uRecline);
      p = uBase + q;
      nrm = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.8 * uRecline));
    }
    #ifdef ENCOUNTER
    {
      vec3 dd = position - uDentAt.xyz;
      float R2 = uDentAt.w * uDentAt.w;
      float local = exp(-dot(dd, dd) / R2);
      float lean = uDentFoot.w * smoothstep(uDentFoot.x, uDentFoot.x + uDentFoot.z, position.y);
      float wd = min(1.0, local + lean) * smoothstep(uDentFoot.x, uDentFoot.x + uDentFoot.y, position.y);
      p += uDent * wd;
      vStretch = local * clamp(length(uDent) / 0.2, 0.0, 1.0);
      // The surface's normal tilts with the dent's slope, so its light follows.
      vec3 grad = -2.0 * dd / R2 * local * smoothstep(uDentFoot.x, uDentFoot.x + uDentFoot.y, position.y);
      vec3 along = grad - nrm * dot(grad, nrm);
      nrm = normalize(nrm - dot(uDent, nrm) * along);
    }
    #endif
    // Height above the part's foot: how far light from the ground reaches.
    vAbove = p.y - aAnchor.y;

    vPhase = aAnchor.x * 0.23 + aAnchor.z * 0.17;
    #ifdef WIND
    {
      // A sheet bends from its foot: the displacement grows with the square
      // of the height above it, to the crest (uWind.w, its height).
      float hb = clamp((p.y - uBase.y) / max(uWind.w, 0.05), 0.0, 1.4);
      p += uWind.xyz * hb * hb;
    }
    #else
    p += vec3(0.6, 0.1, 0.45) * sin(uTime * 0.19 + vPhase) * aSway * 0.045;
    #endif

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * nrm);
    vUv = uv;
    vLook = aLook;
    vEdge = aEdge;

    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

/** Cellular noise: distance to the nearest feature point, and its cell hash. */
const WORLEY = /* glsl */ `
  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  vec2 worley(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float best = 8.0;
    float id = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 h = hash22(i + o);
        vec2 r = o + h - f;
        float d = dot(r, r);
        if (d < best) {
          best = d;
          id = h.x;
        }
      }
    }
    return vec2(sqrt(best), id);
  }
`

const SHARED_UNIFORMS = /* glsl */ `
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uPale;
  uniform vec3 uBright;
  uniform vec3 uRim;
  uniform vec3 uMint;
  uniform float uTime;
  uniform float uGlow;
  uniform float uWaterY;
  uniform vec3 uTint;
  uniform float uGain;
  uniform float uEdgeGlow;

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec4 vLook;
  varying float vEdge;
  varying float vPhase;
  varying float vAbove;

  ${ACCUMULATION_GLSL}
`

/**
 * Solid: struts, footings, beads. Opaque, because structure should read
 * clearly, but lit to look translucent — grazing parts glow as if thin, most
 * of all looking toward the light, which the default camera does.
 */
const SOLID_FRAGMENT = /* glsl */ `
  ${SHARED_UNIFORMS}
  uniform float uPores;
  uniform float uFibre;
  uniform float uGrain;
  uniform float uBody;

  #include <common>
  #include <fog_pars_fragment>

  ${WORLEY}

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float wrap = dot(n, uLightDir) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);

    // Pores: small pits over part of the surface, in world units so they are
    // the same size on a strut and on a footing.
    vec2 w = worley(vUv * 9.0);
    float pore = (1.0 - smoothstep(0.1, 0.19, w.x)) * step(0.5, w.y) * uPores;

    vec3 body = mix(uMid, uPale, 0.4 + 0.45 * vLook.x) * uBody;
    body *= 1.0 - pore * 0.4;

    // Tension: fine fibres running the length of a strand (vUv.y goes round
    // it), so it reads as drawn taut rather than as a smooth glass tube.
    body *= 1.0 - uFibre * 0.2 * (0.5 + 0.5 * sin(vUv.y * 70.0));

    // Sediment: granular and matte, tinted toward the record's own colour,
    // lighter on faces turned to the sky, as settled material is.
    vec2 g = worley(vWorld.xz * 26.0 + vWorld.y * 9.0);
    body = mix(body, mix(body, uTint, 0.55) * (0.78 + 0.34 * g.x) * (0.85 + 0.2 * max(n.y, 0.0)), uGrain);

    vec3 lit = body * (ambient * 0.9 + uLightColor * wrap * 0.8);

    // Glass-like light — thin edges glowing, held light — belongs to
    // membrane and strand, much less to deposited material.
    float glassy = 1.0 - 0.8 * uGrain;
    float thin = pow(1.0 - facing, 1.8);
    float toward = pow(clamp(dot(v, -uLightDir), 0.0, 1.0), 1.5);
    vec3 emit = uBright * thin * (0.14 + 0.45 * toward) * glassy;
    emit += uRim * pow(1.0 - facing, 3.0) * 0.2 * glassy;
    // A faint light held inside, and a sheen on whatever faces the sky.
    emit += uPale * 0.07 * facing * glassy;
    emit += uBright * 0.05 * max(n.y, 0.0);
    // Settled material holds a little light of its own, so plates read as
    // pale deposit rather than as dark debris.
    emit += uTint * 0.12 * uGrain;
    // A strand under tension catches one crisp line of light.
    emit += uBright * pow(max(dot(n, normalize(uLightDir + v)), 0.0), 60.0) * uFibre * 0.9;

    emit *= uGain;

    // Light held in the matter at the foot rises a little way into whatever
    // stands in it, most where it is thin.
    vec4 acc = accumAt(vWorld.xz);
    emit += accumTone(acc.b) * acc.r * exp(-max(vAbove, 0.0) / 0.5) * (0.05 + 0.22 * thin) * glassy;

    // Mint only where the site is live — the scarcity rule, carried by data.
    float breath = 0.7 + 0.3 * sin(uTime * 0.45 + vPhase * 6.0);
    emit += uMint * vLook.y * uGlow * breath * 0.9;

    // Under water the forms read denser, so the waterline crosses them too.
    float under = smoothstep(0.0, 0.25, uWaterY - vWorld.y);
    lit *= 1.0 - under * 0.5;
    emit *= 1.0 - under * 0.6;

    gl_FragColor = vec4(lit + emit, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * Film: membranes and shards. Transparent, thicker-looking at grazing angles
 * like a soap film, brighter toward free edges and around apertures, as if
 * held in tension there.
 *
 * Apertures are cells of a Worley pattern in the surface's own world-unit
 * coordinates. Below an openness of about a third nothing opens: the pores
 * are thin spots, *lighter* than the skin around them. Above it, most cells
 * open at once and openness decides how far, so an open membrane is lace.
 *
 * Both earlier passes let a nearly closed sheet show a few isolated holes.
 * Against the dark ground a hole is a dark dot, and two dark dots on a pale
 * rounded sheet are a face — first pupils, then a sheet-ghost's eyes. Pores
 * that are light, or holes that are many, never read that way. None open
 * near a free edge, so a sheet is perforated, not eaten.
 * Colour drifts from pale lavender toward blue-white with the angle — a
 * thin-film shift kept inside the palette, never a rainbow.
 */
const FILM_FRAGMENT = /* glsl */ `
  ${SHARED_UNIFORMS}
  uniform float uOpenness;
  // Study 10 (lifecycle, dev flag only): an old contour fading. 1 everywhere else.
  uniform float uFade;
  uniform float uSpecular;
  uniform float uFlow;
  // How strongly the closed sheet's thin spots show (1 everywhere but the
  // Habitat's look=soft comparison, docs/15-habitat-c-visual.md).
  uniform float uSpots;
  #ifdef ENCOUNTER
  varying float vStretch;
  #endif
  #ifdef STAIN
  // The Habitat's M1: the cue a resident has gathered from the air (a
  // signal, not matter), as a cool stain in its film: colour, and how much.
  uniform vec4 uStain;
  #endif
  #ifdef RELEASE
  // D1: where each of its films came away (across its width from the foot,
  // height above the foot, radius, how far it has come away: 0..1), and
  // the direction across it. The sheet is thinner there, opening where
  // most has gone: that much of its body has left.
  uniform vec4 uLeft[4];
  uniform vec2 uAcross;
  uniform vec3 uBase;
  varying vec3 vRest;
  #endif
  #ifdef NEAR_FADE
  // The Habitat (first person): the back-lit rim light and the fold light
  // fade near the camera (from x to y units), where a curving sheet would
  // flare white and show its facets (docs/11-presence-study.md).
  uniform vec2 uNearFade;
  #endif

  #include <common>
  #include <fog_pars_fragment>

  ${WORLEY}
  ${WARM_GLSL}
  #ifdef WARM
  // Where matter is crossing into or out of this body (xyz), how far the
  // cue reaches (w), how strongly now, and the little light it adds.
  uniform vec4 uWarmAt;
  uniform float uWarmIn;
  uniform float uWarmGlow;
  // Approach B: matter taken in lately at the foot (0..1), how far along the
  // surface it has come, its light, and how much denser it makes the sheet.
  uniform vec4 uGrow;
  varying float vAlong;
  #endif
  #ifdef CONDUIT_FOLD
  // The fold's matter: its colour, and how far it has moved along the fold.
  uniform vec3 uFoldWarm;
  uniform float uFoldPhase;
  varying vec4 vFold;
  #endif

  void main() {
    float open = clamp(vLook.w * uOpenness, 0.0, 1.0);
    // Stretched along the surface's length, so openings are ovals that follow
    // the growth rather than round punched holes.
    // Small and many, so an open surface reads as lace — never as a pair
    // of holes, which is a face.
    vec2 w = worley(vec2(vUv.x, vUv.y * 0.62) * 5.2);
    float margin = smoothstep(0.2, 0.55, vEdge);
    float lace = smoothstep(0.35, 1.0, open);
    // About half the cells open, more as the sheet opens toward lace: on the
    // large anchor sheets every cell open read as dense dark spotting.
    float opens = step(w.y, 0.5 + 0.4 * lace) * step(0.001, lace);
    float r = mix(0.12, 0.42, lace) * (0.55 + 0.45 * fract(w.y * 7.31)) * opens * margin;
    #ifdef RELEASE
    float gone = 0.0;
    for (int k = 0; k < 4; k++) {
      vec4 L = uLeft[k];
      if (L.w <= 0.0) continue;
      vec2 d = vec2(dot(vRest.xz - uBase.xz, uAcross) - L.x, vRest.y - uBase.y - L.y) / L.z;
      gone = max(gone, L.w * exp(-dot(d, d)));
    }
    // Where it left, the sheet opens into fine lace (small, many, uneven:
    // never one hole, which reads as an eye), most at the mark's middle.
    vec2 wl = worley(vec2(vUv.x, vUv.y * 0.62) * 17.0);
    if (wl.x < 0.3 * smoothstep(0.45, 1.0, gone) * step(wl.y, 0.6) * (0.5 + 0.5 * fract(wl.y * 5.17)) * margin) discard;
    #endif
    if (w.x < r) discard;
    float lip = r > 0.0 ? (1.0 - smoothstep(r, r + 0.05, w.x)) * smoothstep(0.12, 0.3, r) : 0.0;
    // Thin spots: the closed membrane's pores, lighter rather than dark.
    float thinSpot = (1.0 - smoothstep(0.08, 0.16, w.x)) * step(w.y, 0.7) * (1.0 - lace) * step(0.001, vLook.w) * margin * uSpots;

    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(n, v));
    float fres = pow(1.0 - facing, 1.5);
    float wrap = dot(n, uLightDir) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);

    vec3 tint = mix(uTint, uRim, fres * 0.6);
    tint = mix(uMid, tint, 0.55 + 0.35 * vLook.x);
    vec3 lit = tint * (ambient * 0.8 + uLightColor * wrap * 0.6);

    float toward = pow(clamp(dot(v, -uLightDir), 0.0, 1.0), 1.5);
    #ifdef NEAR_FADE
    float nearK = smoothstep(uNearFade.x, uNearFade.y, length(cameraPosition - vWorld));
    toward *= nearK;
    #endif
    float edge = 1.0 - smoothstep(0.0, 0.35, vEdge);
    vec3 emit = uBright * (fres * (0.14 + 0.36 * toward) + lip * 0.16 + edge * uEdgeGlow + thinSpot * 0.05);
    // Light held inside the sheet, strongest face-on, so a membrane glows
    // as a surface rather than only at its outline.
    emit += uTint * 0.11 * (1.0 - 0.5 * fres);
    // Light travelling slowly along the surface's length (vUv.y): sparse
    // soft pulses, two speeds, so a film can carry movement without blinking.
    float flow = uFlow * max(
      pow(0.5 + 0.5 * sin(vUv.y * 1.3 - uTime * 0.45), 14.0),
      0.8 * pow(0.5 + 0.5 * sin(vUv.y * 0.47 + uTime * 0.21 + 1.7), 20.0)
    );
    emit += uBright * flow * 0.55;
    emit *= uGain;
    // Wet highlight on membranes; a sharper glint on the shards.
    float spec = pow(max(dot(n, normalize(uLightDir + v)), 0.0), 28.0);
    emit += uBright * spec * uSpecular;
    float breath = 0.7 + 0.3 * sin(uTime * 0.45 + vPhase * 6.0);
    emit += uMint * vLook.y * uGlow * breath * 0.6 * (0.4 + 0.6 * fres);

    // Lips and glints only where the film is present at all, so a skirt
    // fading into the ground does not leave its rim drawn in highlights.
    float presence = smoothstep(0.0, 0.08, vLook.z);

    // Light from the accumulated matter at the sheet's foot rises into it:
    // strongest at the base and where the sheet is seen thin, fading with
    // height. Folds (where the surface turns sharply: curvature from the
    // normal's change per unit of surface) hold more of it, as a doubled
    // sheet does.
    vec4 acc = accumAt(vWorld.xz);
    vec3 tone = accumTone(acc.b);
    float rise = acc.r * exp(-max(vAbove, 0.0) / 0.6);
    float curve = length(fwidth(n)) / max(length(fwidth(vWorld)), 1e-4);
    float fold = smoothstep(2.5, 8.0, curve) * presence;
    #ifdef NEAR_FADE
    fold *= nearK;
    #endif
    #ifdef CONDUIT_FOLD
    // The fold's lofted mesh shows this per-triangle measure as facets; its
    // roll is lit along its lip instead (aEdge).
    fold = 0.0;
    #endif
    vec3 held = tone * (rise * (0.03 + 0.13 * fres) + fold * (0.02 + 0.08 * acc.r));
    #ifdef CONDUIT_FOLD
    // The matter carried through the fold: small champagne specks in its
    // inner skin, as many as there is matter, moving at the matter's own
    // speed (they stand still where it does not move).
    // (They carry their own alpha: the inner skin itself is faint.)
    vec2 sp = worley(vec2(vFold.x - uFoldPhase, vFold.y) * 12.0);
    float speck = (1.0 - smoothstep(0.05, 0.11, sp.x)) * step(sp.y, vFold.w) * vFold.z * smoothstep(0.0, 0.03, vLook.z);
    // Its own colour at a moderate brightness, so it stays champagne rather than white.
    lit = mix(lit, uFoldWarm * 0.65, speck * 0.9);
    emit = mix(emit, uFoldWarm * 0.2, speck * 0.9);
    #endif
    #ifdef WARM
    float wd = length(vWorld - uWarmAt.xyz) / uWarmAt.w;
    float wa = uWarmIn * exp(-wd * wd) * presence * warmGate(lit + emit);
    lit = warmed(lit, wa);
    emit = warmed(emit, wa) + uWarmTint * wa * uWarmGlow;
    // B: from the foot up into the sheet along its own columns, unevenly
    // across them, as far as the recent uptake reaches.
    // Fuller low down, with a soft front a little brighter where it has got to.
    float reach = uGrow.y * (0.8 + 0.25 * sin(vUv.x * 11.0 + 1.3) + 0.15 * sin(vUv.x * 27.0 + 0.4));
    float along = vAlong / max(reach, 1e-3);
    float front = exp(-pow((along - 0.78) / 0.2, 2.0));
    float gb = uGrow.x * (0.75 * (1.0 - smoothstep(0.5, 1.0, along)) + 0.3 * front) * presence;
    lit = warmed(lit, gb);
    emit = warmed(emit, gb) + uWarmTint * gb * uGrow.z;
    #endif
    float alpha = vLook.z * (0.45 + 0.75 * fres) + (lip * 0.2 + spec * uSpecular * 0.5) * presence + edge * uEdgeGlow * 1.3 + flow * 0.35;
    #ifdef RELEASE
    // Thinner where its films have come away.
    alpha *= 1.0 - 0.55 * gone;
    #endif
    #ifdef WARM
    alpha += gb * uGrow.w;
    #endif
    #ifdef CONDUIT_FOLD
    alpha += speck * 0.7;
    #endif
    #ifdef ENCOUNTER
    // Pressed, the sheet stretches thin: clearer, and a little lighter in its own colour.
    alpha *= 1.0 - 0.45 * vStretch;
    emit += uTint * 0.22 * vStretch;
    #endif

    #ifdef STAIN
    // Toward the cue's own colour at the sheet's brightness, strongest low
    // down where the air reaches it first.
    {
      float k = uStain.w * (0.55 + 0.45 * exp(-max(vAbove, 0.0) / 0.5)) * presence;
      float lum = dot(lit + emit, vec3(0.3, 0.5, 0.2));
      vec3 hue = uStain.rgb * (lum / max(dot(uStain.rgb, vec3(0.3, 0.5, 0.2)), 1e-3));
      lit = mix(lit, hue * 0.8, k);
      emit = mix(emit, hue * 0.2, k * 0.6);
    }
    #endif

    float under = smoothstep(0.0, 0.25, uWaterY - vWorld.y);
    lit *= 1.0 - under * 0.45;
    emit *= 1.0 - under * 0.6;

    // Part of the sheet's light passes through stacked films instead of
    // being blended over what lies behind, so where membranes overlap the
    // light in them builds up, as in layered tissue. (Premultiplied: the
    // material blends ONE, ONE_MINUS_SRC_ALPHA.)
    vec3 layered = emit * 0.2 + held;
    // (uFade over 1, a D1 resident fuller than a placed veil, is capped short of opaque.)
    gl_FragColor = vec4(lit + emit * 0.8, min(clamp(alpha, 0.0, 0.92) * uFade, 0.95));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    vec3 add = layered * smoothstep(0.0, 0.15, alpha) * uFade;
    #ifdef TONE_MAPPING
      add = toneMapping(add);
    #endif
    add = linearToOutputTexel(vec4(add, 1.0)).rgb;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        add *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        add *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    gl_FragColor.rgb = gl_FragColor.rgb * gl_FragColor.a + add;
  }
`

/**
 * Three material kinds. Film writes no depth and draws after the water, so
 * overlapping sheets stay see-through; glass (the shards) writes depth and
 * draws *before* the water, because shards lie in the shallows and the water
 * veil has to fall over them rather than under.
 */
/**
 * Material kinds, so the three languages stop reading as one glass:
 *
 *   film      membrane — transparent, luminous, soft (blooms, webs)
 *   solid     opaque but lit as if thin (beads)
 *   tension   solid with fibres and a crisp highlight (strands, ribs)
 *   sediment  solid, matte and granular (plates, grains)
 *   tissue    the colony's ground skin
 *   halo      additive light on the terrain (now only the debug splines:
 *             the colony's light comes from accumulation.js instead)
 */
export function createFormMaterial({ kind, tint = PALETTE.paleLavender, gain = 1, edgeGlow = 0.12, specular, body = 1, flow = 0, nearFade = null, encounter = false, filmGain = 1, spots = 1, light = null, wind = false, release = false, stain = false }) {
  if (kind === 'halo') return createHaloMaterial(tint)
  if (kind === 'tissue') return withLight(createTissueMaterial(tint), light?.tissue)
  const film = kind === 'film'
  // The Habitat's options (off everywhere else, and then not compiled):
  // `nearFade` [from, to] units, films only; `encounter`, the dent.
  const defines = {}
  const extra = {}
  if (nearFade && film) {
    defines.NEAR_FADE = ''
    extra.uNearFade = { value: new THREE.Vector2(...nearFade) }
  }
  // The Habitat's D1: `wind` (a resident bent by its own air) and
  // `release` (where its films came away), both lifecycle residents only.
  if (wind) {
    defines.WIND = ''
    extra.uWind = { value: new THREE.Vector4(0, 0, 0, 1) }
  }
  if (stain && film) {
    defines.STAIN = ''
    extra.uStain = { value: new THREE.Vector4(0.6, 0.8, 1.0, 0) }
  }
  if (release && film) {
    defines.RELEASE = ''
    extra.uLeft = { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }
    extra.uAcross = { value: new THREE.Vector2(1, 0) }
  }
  if (encounter) {
    defines.ENCOUNTER = ''
    extra.uDent = { value: new THREE.Vector3() }
    extra.uDentAt = { value: new THREE.Vector4(0, 0, 0, 0.2) }
    extra.uDentFoot = { value: new THREE.Vector4(0, 0.1, 1, 0) }
  }
  const material = new THREE.ShaderMaterial({
    defines,
    fog: true,
    transparent: film,
    premultipliedAlpha: film,
    depthWrite: kind !== 'film',
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uGrowth: { value: 1 },
        uTime: { value: 0 },
        uGlow: { value: 0.5 },
        uWaterY: { value: 0 },
        uPores: { value: kind === 'tension' ? 0 : kind === 'sediment' ? 0.6 : 0.8 },
        uFibre: { value: kind === 'tension' ? 1 : 0 },
        uGrain: { value: kind === 'sediment' ? 1 : 0 },
        uBody: { value: body },
        uFlow: { value: flow },
        uOpenness: { value: 0 },
        uRecline: { value: 0 },
        uFade: { value: 1 },
        uBase: { value: new THREE.Vector3() },
        uLean: { value: new THREE.Vector2(1, 0) },
        uSpecular: { value: specular ?? (kind === 'glass' ? 0.45 : 0.3) },
        uTint: hexUniform(tint),
        // `filmGain`: the Habitat's `look=soft` comparison quietens films only.
        uGain: { value: film ? gain * filmGain : gain },
        uSpots: { value: spots },
        uEdgeGlow: { value: edgeGlow },
        // The terrain's own light, so ground and forms share one scene.
        uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
        uLightColor: hexUniform('#8E88C0'),
        uSkyAmbient: hexUniform('#4C4A7E'),
        uGroundAmbient: hexUniform('#22243F'),
        uDeep: hexUniform(PALETTE.greyViolet),
        uMid: hexUniform(PALETTE.fadedLavender),
        uPale: hexUniform(PALETTE.paleLavender),
        uBright: hexUniform('#E2DEF6'),
        uRim: hexUniform('#A9B0E8'),
        uMint: hexUniform(PALETTE.moonlitMint),
        ...accumulationUniforms(),
        ...extra,
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: film ? FILM_FRAGMENT : SOLID_FRAGMENT,
  })
  return withLight(material, light?.[kind])
}

/**
 * `light` (the Habitat's D1): the scene's own light for one kind of form,
 * { sky, ground, color }, where the look lifts the ground's light, so forms
 * are lit as the ground they stand on is. None: as authored.
 */
function withLight(material, L) {
  if (!L) return material
  const u = material.uniforms
  if (L.sky && u.uSkyAmbient) u.uSkyAmbient.value.set(L.sky)
  if (L.ground && u.uGroundAmbient) u.uGroundAmbient.value.set(L.ground)
  if (L.color && u.uLightColor) u.uLightColor.value.set(L.color)
  return material
}

/**
 * The colony's ground glow: additive light on the terrain under a colony,
 * coming up with its growth, breathing slowly, broken by a drifting noise so
 * it reads as a stain in the ground and not as a disc. Additive light must
 * fade into fog rather than toward the fog colour, so fog is applied by hand.
 */
const HALO_VERTEX = /* glsl */ `
  attribute vec2 aBirth;
  attribute vec4 aLook;

  uniform float uGrowth;

  varying float vIntensity;
  varying vec2 vUv;
  varying vec3 vWorld;

  #include <common>
  #include <fog_pars_vertex>

  void main() {
    vIntensity = aLook.x * smoothstep(aBirth.x, aBirth.x + aBirth.y, uGrowth);
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform float uTime;
  uniform float uWaterY;

  varying float vIntensity;
  varying vec2 vUv;
  varying vec3 vWorld;

  #include <common>
  #include <fog_pars_fragment>

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    float n = valueNoise(vUv * 0.9 + vec2(uTime * 0.01, -uTime * 0.008)) * 0.6
            + valueNoise(vUv * 2.3 - uTime * 0.012) * 0.4;
    float breath = 0.78 + 0.22 * sin(uTime * 0.3 + vUv.x * 0.2 + vUv.y * 0.15);
    float under = smoothstep(0.0, 0.3, uWaterY - vWorld.y);
    vec3 col = uTint * vIntensity * (0.35 + 0.65 * n) * breath * 0.3 * (1.0 - 0.5 * under);

    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      col *= 1.0 - fogFactor;
    #endif

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function createHaloMaterial(tint) {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uGrowth: { value: 1 },
        uTime: { value: 0 },
        uWaterY: { value: 0 },
        uTint: hexUniform(tint),
      },
    ]),
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
  })
}

/**
 * The colony tissue: a milky skin over the ground that thickens into mounds
 * around every base, carries a slow light along its veins, and turns
 * granular where residue settled. It fades in rather than scaling — it
 * spreads — and while it is spreading its growing front glows faintly.
 */
const TISSUE_VERTEX = /* glsl */ `
  attribute vec2 aBirth;
  attribute vec4 aLook;

  uniform float uGrowth;

  varying vec4 vLook;
  varying float vGrow;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  #ifdef WARM
  // Study 10's warm accent: how recently matter arrived here (x) and was
  // taken up from here (y), 1 now, 0 once it has faded.
  attribute vec2 aWarm;
  varying vec2 vWarm;
  #endif

  #include <common>
  #include <fog_pars_vertex>

  void main() {
    vGrow = smoothstep(aBirth.x, aBirth.x + aBirth.y, uGrowth);
    vLook = aLook;
    #ifdef WARM
    vWarm = aWarm;
    #endif
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const TISSUE_FRAGMENT = /* glsl */ `
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uMid;
  uniform vec3 uBright;
  uniform vec3 uTint;
  uniform vec3 uSediment;
  uniform float uTime;
  uniform float uWaterY;

  varying vec4 vLook;
  varying float vGrow;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;

  #include <common>
  #include <fog_pars_fragment>

  ${ACCUMULATION_GLSL}
  ${WARM_GLSL}
  #ifdef WARM
  // A fresh deposit's thin edge (x), its body (y), where it is being taken
  // up (z), and the little light the cue adds (w).
  uniform vec4 uWarm;
  // Approach A: how strongly matter being taken up from here shows (its
  // amount arrives as vWarm.y), its light, how much denser it makes the
  // skin, and how far the skin's own grain breaks it up.
  uniform vec4 uAbsorb;
  varying vec2 vWarm;
  #endif

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    if (vGrow <= 0.001) discard;
    float thick = vLook.x;
    float vein = vLook.y;
    float presence = vLook.z;
    float crust = vLook.w;

    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float wrap = dot(n, uLightDir) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);

    // Milky, faintly mottled, paler where it is thicker.
    float mottle = valueNoise(vUv * 3.0) * 0.6 + valueNoise(vUv * 9.0) * 0.4;
    vec3 col = mix(uMid * 0.85, uTint, 0.3 + 0.45 * thick + 0.15 * mottle);
    // Crust: granular sediment where residue settled — paler than the
    // tissue, coarse, with a scatter of bright grains in it.
    float grain = valueNoise(vUv * 38.0) * 0.6 + valueNoise(vUv * 95.0) * 0.4;
    float specks = step(0.82, valueNoise(vUv * 140.0));
    float crusted = smoothstep(0.02, 0.7, crust);
    col = mix(col, uSediment * (0.55 + 0.7 * grain) + uBright * specks * 0.25, crusted);
    vec3 lit = col * (ambient * 0.9 + uLightColor * wrap * 0.75);

    // The light held in what the colony gathered (accumulation.js): the
    // skin takes its tone, and the thicker and denser it is, the more light
    // it holds — mounds and crust over a dense core glow, a thin skin far out
    // barely does.
    vec4 acc = accumAt(vWorld.xz);
    vec3 tone = accumTone(acc.b);
    col = mix(col, tone, 0.3 * acc.r);

    // Veins carry a slow light between the colony's parts.
    float pulse = 0.72 + 0.28 * sin(uTime * 0.4 + vUv.x * 0.7 + vUv.y * 0.55);
    vec3 emit = uBright * vein * 0.55 * pulse * (0.7 + 0.5 * acc.r);
    emit += uTint * thick * 0.07;
    emit += tone * acc.r * (0.03 + 0.1 * acc.g + 0.08 * thick + 0.06 * crusted) * (0.85 + 0.3 * mottle);
    // The growing front glows as the tissue spreads, then settles.
    float front = smoothstep(0.0, 0.35, vGrow) * (1.0 - smoothstep(0.35, 1.0, vGrow));
    emit += uBright * front * 0.4 * presence;
    #ifdef WARM
    // The deposit's fold light (vein) marks where it thins out: its edge.
    // Its body carries the cue as far as the deposit itself is there.
    float body = smoothstep(0.2, 0.8, presence);
    float wa = vWarm.x * (uWarm.x * clamp(vein / 0.35, 0.0, 1.0) + uWarm.y * body) + vWarm.y * uWarm.z * body;
    wa = clamp(wa, 0.0, 1.0) * smoothstep(0.0, 0.3, presence) * warmGate(lit + emit);
    lit = warmed(lit, wa);
    emit = warmed(emit, wa) + uWarmTint * wa * uWarm.w;
    // A: matter being drawn out of the skin, unevenly: a slow, broad
    // variation (the skin's grain is too fine to see from any distance, and
    // its mottling too fine and too regular).
    float seep = valueNoise(vUv * 2.1 + 7.3) * 0.65 + valueNoise(vUv * 4.7 + 2.9) * 0.35;
    float grainy = mix(1.0, 0.35 + 1.3 * smoothstep(0.3, 0.75, seep), uAbsorb.w);
    float ab = clamp(vWarm.y * uAbsorb.x * grainy, 0.0, 1.0) * smoothstep(0.0, 0.25, presence);
    // Where the skin is dim it shows as a little light rather than a hue,
    // which there would turn olive.
    float abHue = ab * mix(0.35, 1.0, warmGate(lit + emit));
    lit = warmed(lit, abHue);
    emit = warmed(emit, abHue) + uWarmTint * ab * uAbsorb.y;
    #endif

    float under = smoothstep(0.0, 0.25, uWaterY - vWorld.y);
    lit *= 1.0 - under * 0.5;
    emit *= 1.0 - under * 0.6;

    float alpha = presence * (0.5 + 0.3 * (1.0 - facing)) + vein * 0.2 + crusted * 0.4;
    #ifdef WARM
    alpha += ab * uAbsorb.z;
    #endif
    alpha = clamp(alpha, 0.0, 0.88) * vGrow;

    gl_FragColor = vec4(lit + emit, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

function createTissueMaterial(tint) {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uGrowth: { value: 1 },
        uTime: { value: 0 },
        uWaterY: { value: 0 },
        uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
        uLightColor: hexUniform('#8E88C0'),
        uSkyAmbient: hexUniform('#4C4A7E'),
        uGroundAmbient: hexUniform('#22243F'),
        uMid: hexUniform(PALETTE.fadedLavender),
        uBright: hexUniform('#E2DEF6'),
        uTint: hexUniform(tint),
        uSediment: hexUniform('#CEC8E6'),
        ...accumulationUniforms(),
      },
    ]),
    vertexShader: TISSUE_VERTEX,
    fragmentShader: TISSUE_FRAGMENT,
  })
}

/**
 * The branching network (branching.js), in two materials.
 *
 * The tissue on the ground is a draped surface showing the network's tissue
 * map (R coverage, G core, B fineness, A surfaced). It is shaded as part of
 * the ground, not as light over it: lit by the scene's own light, raised a
 * little (the coverage bumps the normal), translucent, paler at the cores
 * and on the finest growth. Where a branch runs beneath the surface it is
 * diffuse and faint (a blurred read of the map); where it has come through,
 * defined. Blended, never added; a very little local light at the cores.
 * It spreads out from the anchor with the growth clock.
 *
 * The veins in the membranes are faint translucent ribbons in the sheet,
 * rounded across, thinning to nothing at their tips.
 */
const SCENE_LIGHT = {
  uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
  uLightColor: hexUniform('#8E88C0'),
  uSkyAmbient: hexUniform('#4C4A7E'),
  uGroundAmbient: hexUniform('#22243F'),
}

const TISSUE_MAP_VERTEX = /* glsl */ `
  attribute vec2 aBirth;

  uniform float uGrowth;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vGrow;

  #include <common>
  #include <fog_pars_vertex>

  void main() {
    vGrow = smoothstep(aBirth.x, aBirth.x + aBirth.y, uGrowth);
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const TISSUE_MAP_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uTissue;
  uniform vec3 uPearl;
  uniform vec3 uSilver;
  uniform float uWaterY;
  uniform float uBump;
  uniform float uOpacity;
  uniform float uMapSize;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vGrow;

  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec4 t = texture2D(uMap, vUv);
    // Beneath the surface the tissue spreads and blurs: a coarser read.
    vec4 under = texture2D(uMap, vUv, 2.5);
    float surfaced = smoothstep(0.3, 0.75, t.a);
    // A branch is present at full strength well before full coverage: the
    // map gives thin branches only a share of a texel.
    // Further away the mipmapped map averages fine branches into their
    // surroundings; hold them up by how many texels fall in a pixel, so the
    // growth stays a lacy texture instead of vanishing.
    float texPerPx = length(fwidth(vUv)) * uMapSize;
    float hold = clamp(texPerPx, 1.0, 5.0);
    float sharp = smoothstep(0.0, 0.45 / hold, t.r);
    float soft = smoothstep(0.0, 0.3, under.r);
    // Beneath the surface a branch is still there, softer and fainter, so
    // it does not break into dashes.
    float body = mix(max(soft * 0.7, sharp * 0.45), sharp, surfaced);
    // Where growth is dense the tissue between the branches thickens too:
    // a faint pale spread under the mat.
    float presence = max(body, soft * 0.42) * vGrow;
    if (presence < 0.004) discard;

    // Raised a little: the coverage, slightly softened, as a height.
    float h = texture2D(uMap, vUv, 0.7).r * uBump;
    vec3 sx = dFdx(vWorld);
    vec3 sy = dFdy(vWorld);
    vec3 n0 = normalize(vNormal);
    vec3 r1 = cross(sy, n0);
    vec3 r2 = cross(n0, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    vec3 n = normalize(abs(det) * n0 - grad);

    vec3 v = normalize(cameraPosition - vWorld);
    float wrap = dot(n, uLightDir) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);
    float spec = pow(max(dot(n, normalize(uLightDir + v)), 0.0), 24.0);

    // Pale tissue, paler at the cores and on the finest growth; what lies
    // beneath is cooler.
    vec3 colour = mix(uTissue, uPearl, clamp(t.g * 0.7 + t.b * 0.35, 0.0, 1.0));
    colour = mix(uSilver, colour, 0.35 + 0.65 * surfaced);
    // Lit as part of the ground, and paler than it: a little light held in
    // the tissue itself (more at the cores, where it is densest), so it
    // reads as pale matter in the surface, as in the reference, rather than
    // as a stain of the ground's own colour.
    vec3 col = colour * (ambient * 1.25 + uLightColor * wrap * 1.1)
             + colour * (0.22 + 0.25 * t.g) * (0.5 + 0.5 * surfaced)
             + uPearl * 0.12 * spec * body;

    float alpha = presence * mix(0.45, 0.95, surfaced) * uOpacity;
    float underWater = smoothstep(-0.02, 0.2, uWaterY - vWorld.y);
    alpha *= 1.0 - 0.6 * underWater;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export function createTissueMapMaterial(map) {
  const material = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: null },
        uGrowth: { value: 1 },
        uWaterY: { value: 0 },
        uBump: { value: 0.006 },
        uOpacity: { value: 1 },
        uMapSize: { value: 2048 },
        uTissue: hexUniform('#CFC6EC'),
        uPearl: hexUniform('#F2ECF4'),
        uSilver: hexUniform('#AFBDEB'),
        ...SCENE_LIGHT,
      },
    ]),
    vertexShader: TISSUE_MAP_VERTEX,
    fragmentShader: TISSUE_MAP_FRAGMENT,
  })
  // Set after the merge, which would otherwise copy the texture.
  material.uniforms.uMap.value = map
  return material
}

const VEIN_VERTEX = /* glsl */ `
  attribute vec2 aBirth;
  attribute vec4 aLook;

  uniform float uGrowth;

  varying vec2 vUv;
  varying vec4 vLook;
  varying float vGrow;
  varying vec3 vWorld;

  #include <common>
  #include <fog_pars_vertex>

  void main() {
    vGrow = smoothstep(aBirth.x, aBirth.x + aBirth.y, uGrowth);
    vLook = aLook;
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const VEIN_FRAGMENT = /* glsl */ `
  uniform vec3 uTissue;
  uniform vec3 uPearl;
  uniform vec3 uSilver;

  varying vec2 vUv;
  varying vec4 vLook;
  varying float vGrow;
  varying vec3 vWorld;

  #include <common>
  #include <fog_pars_fragment>

  void main() {
    float across = clamp(abs(vUv.x), 0.0, 1.0);
    float body = pow(1.0 - across * across, 2.0);
    // Stretches of the vein sink into the sheet.
    float surfaced = 0.35 + 0.65 * smoothstep(0.25, 0.75, fract(sin(floor(vUv.y * 6.0 + vLook.y * 17.0) * 43.1) * 917.3) * 0.5 + 0.5 * sin(vUv.y * 5.0 + vLook.y * 9.0));
    vec3 col = mix(uSilver, mix(uTissue, uPearl, 0.5), surfaced) * 0.85;
    float alpha = body * vLook.x * surfaced * vGrow * 0.6;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.5));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export function createVeinMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uGrowth: { value: 1 },
        uTissue: hexUniform('#CFC6EC'),
        uPearl: hexUniform('#F2ECF4'),
        uSilver: hexUniform('#AFBDEB'),
      },
    ]),
    vertexShader: VEIN_VERTEX,
    fragmentShader: VEIN_FRAGMENT,
  })
}

/**
 * The transition strands (branching.js): fibres of the membranes' own
 * substance drawn out thin. Translucent like the film, thicker-looking where
 * the surface turns away (so a fibre reads as a fine hollow filament, not a
 * line), faintly striated along its length, lit by the scene's light.
 * Pale lilac to silver-blue; no glow. Blended, never added.
 */
const TENDRIL_VERTEX = /* glsl */ `
  attribute vec2 aBirth;
  attribute vec4 aLook;

  uniform float uGrowth;

  varying vec2 vUv;
  varying vec4 vLook;
  varying float vGrow;
  varying vec3 vWorld;
  varying vec3 vNormal;

  #include <common>
  #include <fog_pars_vertex>

  void main() {
    vGrow = smoothstep(aBirth.x, aBirth.x + aBirth.y, uGrowth);
    vLook = aLook;
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const TENDRIL_FRAGMENT = /* glsl */ `
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uTissue;
  uniform vec3 uPearl;
  uniform vec3 uSilver;
  uniform float uWaterY;

  varying vec2 vUv;
  varying vec4 vLook;
  varying float vGrow;
  varying vec3 vWorld;
  varying vec3 vNormal;

  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(n, v));
    float fres = pow(1.0 - facing, 1.5);
    float wrap = dot(n, uLightDir) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);
    float spec = pow(max(dot(n, normalize(uLightDir + v)), 0.0), 30.0);
    // Faint fibres along the strand.
    float fibre = 0.85 + 0.15 * sin(vUv.y * 6.2832 * 3.0 + vLook.y * 5.0 + sin(vUv.x * 9.0) * 1.5);
    vec3 colour = mix(uTissue, uSilver, 0.35 + 0.4 * fres);
    // Some light held in it, as in the membranes, so it does not go dark
    // against the ground.
    vec3 col = colour * (ambient * 0.9 + uLightColor * wrap * 0.7) * fibre + colour * 0.16;
    // Brighter toward its outline, as a membrane is: a strand is all edge.
    col += uPearl * ((0.07 + 0.2 * fres) * fibre + 0.18 * spec);
    float alpha = (0.45 + 0.4 * fres) * vLook.z * vGrow * fibre;
    float under = smoothstep(-0.02, 0.2, uWaterY - vWorld.y);
    alpha *= 1.0 - 0.6 * under;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export function createTendrilMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uGrowth: { value: 1 },
        uWaterY: { value: 0 },
        uTissue: hexUniform('#CFC6EC'),
        uPearl: hexUniform('#F2ECF4'),
        uSilver: hexUniform('#AFBDEB'),
        ...SCENE_LIGHT,
      },
    ]),
    vertexShader: TENDRIL_VERTEX,
    fragmentShader: TENDRIL_FRAGMENT,
  })
}
