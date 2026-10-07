/**
 * Materials for the scattered forms: one vertex stage (growth and drift) and
 * two fragment stages, solid and film. Kept apart from the component so a
 * form can be looked at on its own, outside the scene.
 */

import * as THREE from 'three'
import { PALETTE } from './palette'

const hexUniform = (hex) => ({ value: new THREE.Color(hex) })

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

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec4 vLook;
  varying float vEdge;
  varying float vPhase;

  #include <common>
  #include <fog_pars_vertex>

  void main() {
    float g = smoothstep(aBirth.x, aBirth.x + max(aBirth.y, 1e-3), uGrowth);
    vec3 p = aAnchor + (position - aAnchor) * g;

    vPhase = aAnchor.x * 0.23 + aAnchor.z * 0.17;
    p += vec3(0.6, 0.1, 0.45) * sin(uTime * 0.19 + vPhase) * aSway * 0.045;

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
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
  uniform float uSpecular;
  uniform float uFlow;

  #include <common>
  #include <fog_pars_fragment>

  ${WORLEY}

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
    if (w.x < r) discard;
    float lip = r > 0.0 ? (1.0 - smoothstep(r, r + 0.05, w.x)) * smoothstep(0.12, 0.3, r) : 0.0;
    // Thin spots: the closed membrane's pores, lighter rather than dark.
    float thinSpot = (1.0 - smoothstep(0.08, 0.16, w.x)) * step(w.y, 0.7) * (1.0 - lace) * step(0.001, vLook.w) * margin;

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
    float alpha = vLook.z * (0.45 + 0.75 * fres) + (lip * 0.2 + spec * uSpecular * 0.5) * presence + edge * uEdgeGlow * 1.3 + flow * 0.35;

    float under = smoothstep(0.0, 0.25, uWaterY - vWorld.y);
    lit *= 1.0 - under * 0.45;
    emit *= 1.0 - under * 0.6;

    gl_FragColor = vec4(lit + emit, clamp(alpha, 0.0, 0.92));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
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
 *   halo      the colony's light on the terrain
 */
export function createFormMaterial({ kind, tint = PALETTE.paleLavender, gain = 1, edgeGlow = 0.12, specular, body = 1, flow = 0 }) {
  if (kind === 'halo') return createHaloMaterial(tint)
  if (kind === 'tissue') return createTissueMaterial(tint)
  const film = kind === 'film'
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: film,
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
        uSpecular: { value: specular ?? (kind === 'glass' ? 0.45 : 0.3) },
        uTint: hexUniform(tint),
        uGain: { value: gain },
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
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: film ? FILM_FRAGMENT : SOLID_FRAGMENT,
  })
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

    // Veins carry a slow light between the colony's parts.
    float pulse = 0.72 + 0.28 * sin(uTime * 0.4 + vUv.x * 0.7 + vUv.y * 0.55);
    vec3 emit = uBright * vein * 0.55 * pulse;
    emit += uTint * thick * 0.07;
    // The growing front glows as the tissue spreads, then settles.
    float front = smoothstep(0.0, 0.35, vGrow) * (1.0 - smoothstep(0.35, 1.0, vGrow));
    emit += uBright * front * 0.4 * presence;

    float under = smoothstep(0.0, 0.25, uWaterY - vWorld.y);
    lit *= 1.0 - under * 0.5;
    emit *= 1.0 - under * 0.6;

    float alpha = presence * (0.5 + 0.3 * (1.0 - facing)) + vein * 0.2 + crusted * 0.4;
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
      },
    ]),
    vertexShader: TISSUE_VERTEX,
    fragmentShader: TISSUE_FRAGMENT,
  })
}
