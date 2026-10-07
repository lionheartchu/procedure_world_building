import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { AIR, AIR_GLSL, KIND, hoverHeight, kindOf, makeFloor } from '../lib/air'
import { mulberry32 } from '../lib/noise'

/** Particles simulated on the GPU: SIDE² (Density draws a share of them). */
const SIDE = 128
const COUNT = SIDE * SIDE

/** The scene's fog density (Scene.jsx), so far particles fade with it. */
const FOG = 0.026

/** Each resident's lifespan, seconds: [shortest, range]. */
const LIFE = {
  [KIND.HAZE]: [60, 60],
  [KIND.FLAKE]: [80, 80],
  [KIND.MOTE]: [90, 110],
  [KIND.WISP]: [10, 15],
  [KIND.DUST]: [60, 90],
}

/** How far back along the flow a wisp reaches, in seconds of travel, and in how many steps. */
const WISP_REACH = 4
const WISP_STEPS = 4

/** GLSL constants for the residents. */
const KINDS_GLSL = Object.entries(KIND)
  .map(([name, i]) => `#define ${name} ${i}`)
  .join('\n')

/* --- the simulation (GPU) -------------------------------------------- */

/**
 * One step of the field for every particle. Position in xyz, life in w.
 * When a life ends the particle is reborn where its kind belongs:
 *
 *   haze   over the basins and low ground (the lowest of three tries)
 *   motes  around a colony, most of them
 *   wisps  where the air runs fastest (the fastest of four tries)
 *   dust   anywhere, leaning to the quieter of two places
 *   flakes anywhere
 */
const SIMULATE = /* glsl */ `
  ${KINDS_GLSL}
  uniform float uDelta;
  uniform sampler2D uTraits;
  ${AIR_GLSL}

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 airPick(vec2 uv, float e) {
    return (vec2(hash12(uv * 113.1 + e), hash12(uv * 71.7 + e + 5.3)) - 0.5) * ${(2 * AIR.halfWidth).toFixed(1)};
  }

  vec3 airSpawn(int kind, vec2 uv, float e, float pref) {
    vec2 xz = airPick(uv, e);
    if (kind == HAZE) {
      float best = -1e9;
      for (int k = 0; k < 3; k++) {
        vec2 c = airPick(uv, e + float(k) * 7.31);
        float s = -airFloor(c) - 0.25 * max(0.0, max(abs(c.x), abs(c.y)) - 10.0);
        if (s > best) { best = s; xz = c; }
      }
    } else if (kind == MOTE) {
      if (uColonyCount > 0 && hash12(uv * 37.9 + e) < 0.85) {
        int pick = int(floor(hash12(uv * 53.3 + e) * float(uColonyCount)));
        vec4 c = uColonies[0];
        for (int i = 0; i < ${AIR.maxColonies}; i++) if (i == pick) c = uColonies[i];
        float a = hash12(uv * 19.1 + e) * 6.2832;
        xz = c.xz + vec2(cos(a), sin(a)) * c.w * (0.4 + 0.9 * hash12(uv * 23.7 + e));
      }
    } else if (kind == WISP) {
      float best = -1.0;
      for (int k = 0; k < 4; k++) {
        vec2 c = airPick(uv, e + float(k) * 3.17);
        vec3 q = vec3(c.x, airFloor(c) + pref, c.y);
        float s = length(airVelocity(q, pref, airFlow(WISP), airHoldGain(WISP)).xz);
        if (s > best) { best = s; xz = c; }
      }
    } else if (kind == DUST) {
      vec2 c = airPick(uv, e + 11.3);
      if (airActivity(c, uTime) < airActivity(xz, uTime)) xz = c;
    }
    return vec3(xz.x, airFloor(xz) + pref, xz.y);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 s = texture2D(texturePosition, uv);
    vec4 traits = texture2D(uTraits, uv);
    int kind = airKind(traits.b);
    float pref = airHover(kind, traits.r);
    float life = s.w + uDelta / traits.g;
    vec3 p = s.xyz;
    if (life >= 1.0) {
      p = airSpawn(kind, uv, fract(uTime * 0.0173) * 91.0, pref);
      life = 0.0;
    } else {
      p += airVelocity(p, pref, airFlow(kind), airHoldGain(kind)).xyz * uDelta;
      float W = ${AIR.halfWidth.toFixed(1)};
      p.xz = mod(p.xz + W, 2.0 * W) - W;
      p.y = min(p.y, ${AIR.top.toFixed(1)});
    }
    gl_FragColor = vec4(p, life);
  }
`

/* --- the look ----------------------------------------------------------- */

/**
 * Shared by every resident's drawing: the field (wisps need its velocity),
 * the palette, and the fades that set the depth hierarchy.
 *
 * Silver and pale lavender for ambient matter, icy blue for the flow, and a
 * restrained aqua only where a colony holds the air. Everything is additive,
 * so it brightens what is behind it, and fades with the scene's fog, at the
 * volume's sides (where particles wrap), at birth and death, and with height
 * over the ground, so the far sky stays nearly empty.
 */
const LOOK_GLSL = /* glsl */ `
  ${KINDS_GLSL}
  ${AIR_GLSL}
  uniform sampler2D uPositions;
  uniform sampler2D uTraits;
  uniform float uScale;
  uniform float uDpr;
  uniform vec2 uViewport;

  const vec3 SILVER = vec3(0.85, 0.86, 0.92);
  const vec3 LAVENDER = vec3(0.80, 0.77, 0.95);
  const vec3 ICE = vec3(0.70, 0.84, 1.0);
  const vec3 AQUA = vec3(0.68, 0.93, 0.87);

  float airFog(float dist) {
    return exp(-${FOG} * ${FOG} * dist * dist);
  }

  float airEdge(vec3 p) {
    vec2 a = abs(p.xz);
    return 1.0 - smoothstep(${(AIR.halfWidth - 3).toFixed(1)}, ${AIR.halfWidth.toFixed(1)}, max(a.x, a.y));
  }

  float airBorn(float life, float rise, float fall) {
    return smoothstep(0.0, rise, life) * (1.0 - smoothstep(1.0 - fall, 1.0, life));
  }

  // Thins away between these heights over the ground.
  float airSky(vec3 p, float from, float to) {
    return 1.0 - smoothstep(from, to, p.y - airFloor(p.xz));
  }

  // How firmly a colony holds this point (as in the field), for colour.
  float airHeld(vec3 p, float gain) {
    float held = 0.0;
    for (int i = 0; i < ${AIR.maxColonies}; i++) {
      if (i >= uColonyCount) break;
      vec4 c = uColonies[i];
      float r = length(p.xz - c.xz) / (c.w * 1.7);
      float dy = (p.y - (c.y + 0.9)) / 1.8;
      held = max(held, min(1.0, uColony * gain * exp(-r * r - dy * dy)));
    }
    return held;
  }

  void hide() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`

/**
 * Dust and motes, as points.
 *
 *   dust   most of the air: very fine, most of it tiny and a few a little
 *          larger, silver and lavender. It carries the field in the middle
 *          distance; close by it thins, and far off it is gone, so it never
 *          reads as snow or a star field.
 *   motes  colony residents: a little larger, a soft body with a dim seed
 *          a little off its centre, like a spore. Held by a colony they brighten
 *          and lean toward aqua. They may pass closer to the camera.
 *
 * Neither has an outline: a rim would read as a bubble or a lens.
 */
const POINT_VERTEX = /* glsl */ `
  ${LOOK_GLSL}
  attribute vec2 aRef;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vMote;

  void main() {
    vec4 s = texture2D(uPositions, aRef);
    vec4 traits = texture2D(uTraits, aRef);
    int kind = airKind(traits.b);
    vAlpha = 0.0;
    if (kind != DUST && kind != MOTE) {
      hide();
      gl_PointSize = 0.0;
      return;
    }
    vec3 p = s.xyz;
    float tone = traits.a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float held = airHeld(p, airHoldGain(kind));

    float size;
    float alpha;
    if (kind == MOTE) {
      size = mix(0.07, 0.13, tone);
      alpha = 0.26 * (0.55 + 0.45 * held);
      vColor = mix(mix(LAVENDER, SILVER, 0.4), AQUA, 0.45 * held);
      alpha *= smoothstep(0.9, 2.4, dist) * (1.0 - 0.85 * smoothstep(16.0, 28.0, dist));
      alpha *= airSky(p, 2.5, 5.0);
      vMote = 1.0;
    } else {
      size = mix(0.016, 0.05, tone * tone);
      // Most grains faint, a few brighter.
      alpha = mix(0.06, 0.4, pow(fract(tone * 7.3), 1.8));
      vColor = mix(LAVENDER, SILVER, smoothstep(0.2, 0.8, fract(tone * 3.7)));
      vColor = mix(vColor, AQUA, 0.12 * held);
      alpha *= smoothstep(1.8, 4.5, dist) * (1.0 - smoothstep(13.0, 25.0, dist));
      alpha *= airSky(p, 1.0, 4.0);
      vMote = 0.0;
    }
    float breath = 0.85 + 0.15 * sin(uTime * 0.23 + tone * 40.0);
    alpha *= airFog(dist) * airEdge(p) * airBorn(s.w, 0.1, 0.14) * breath;

    // Below a pixel and a half the light is spread rather than drawn as a
    // crisp dot, and fades.
    float px = size * uScale / max(dist, 0.1);
    float least = 1.5 * uDpr;
    alpha *= min(1.0, (px / least) * (px / least));
    vAlpha = alpha;
    gl_PointSize = clamp(px, least, 48.0 * uDpr);
    gl_Position = projectionMatrix * mv;
  }
`

const POINT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vMote;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = dot(q, q);
    if (d > 1.0 || vAlpha <= 0.0) discard;
    float shape;
    if (vMote > 0.5) {
      // A soft body with a dim seed a little off its centre.
      vec2 seed = q - vec2(0.18, -0.12);
      shape = 0.55 * exp(-d * 2.6) * (1.0 - d) + 0.45 * exp(-dot(seed, seed) * 22.0);
    } else {
      shape = exp(-d * 4.5) * (1.0 - d);
    }
    gl_FragColor = vec4(vColor * vAlpha * shape, 1.0);
  }
`

/**
 * Wisps: soft threads laid along the flow, low over the ground where the air
 * drains and runs. Each reaches back from its particle along the field in
 * four steps, so it bends with the swirls and the land, and is drawn as a
 * soft ribbon that swells from nothing at its tail and fades again just
 * before its head. Lengths and widths vary. They show only where the air
 * runs (they are born there, too), only now and then, as a gust catches
 * them, and never as a dot: a thread too short on screen fades out.
 */
const WISP_VERTEX = /* glsl */ `
  ${LOOK_GLSL}
  attribute vec2 aRef;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;

  vec4 clipOf(vec3 w) {
    return projectionMatrix * modelViewMatrix * vec4(w, 1.0);
  }

  void main() {
    vec4 st = texture2D(uPositions, aRef);
    vec4 traits = texture2D(uTraits, aRef);
    float pref = airHover(WISP, traits.r);
    float flow = airFlow(WISP);
    float gain = airHoldGain(WISP);
    float step = ${(WISP_REACH / WISP_STEPS).toFixed(3)} * mix(0.55, 1.15, fract(traits.a * 9.7));

    // Stations from the head (k = ${WISP_STEPS}) back to the tail (k = 0).
    vec3 at[${WISP_STEPS + 1}];
    at[${WISP_STEPS}] = st.xyz;
    vec3 v0 = airVelocity(st.xyz, pref, flow, gain).xyz;
    vec3 v = v0;
    for (int k = ${WISP_STEPS - 1}; k >= 0; k--) {
      at[k] = at[k + 1] - v * step;
      if (k > 0) v = airVelocity(at[k], pref, flow, gain).xyz;
    }

    float s = position.x;
    float side = position.y;
    int k = int(floor(s * ${WISP_STEPS}.0 + 0.5));
    vec3 w = at[0];
    vec3 a = at[0];
    vec3 b = at[1];
    for (int i = 0; i <= ${WISP_STEPS}; i++) {
      if (i == k) {
        w = at[i];
        a = at[max(i - 1, 0)];
        b = at[min(i + 1, ${WISP_STEPS})];
      }
    }
    vec4 ca = clipOf(a);
    vec4 cb = clipOf(b);
    vec4 cw = clipOf(w);
    vec2 dir = (cb.xy / cb.w - ca.xy / ca.w) * uViewport * 0.5;
    float len = length(dir);
    vec2 n = len > 1e-4 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);
    float halfWidth = mix(1.8, 3.4, fract(traits.a * 4.3)) * uDpr;
    cw.xy += n * side * halfWidth / (uViewport * 0.5) * cw.w;

    vec4 ct = clipOf(at[0]);
    vec4 cp = clipOf(st.xyz);
    float lenPx = length((cp.xy / cp.w - ct.xy / ct.w) * uViewport * 0.5);
    float dist = cp.w;
    float alpha = mix(0.07, 0.13, fract(traits.a * 5.1));
    alpha *= smoothstep(0.08, 0.2, length(v0));
    alpha *= smoothstep(8.0 * uDpr, 24.0 * uDpr, lenPx);
    alpha *= smoothstep(1.5, 4.0, dist) * (1.0 - smoothstep(14.0, 26.0, dist));
    alpha *= airSky(st.xyz, 0.6, 2.0) * airFog(dist) * airEdge(st.xyz) * airBorn(st.w, 0.15, 0.2);
    // Each shows only now and then, as a gust catches it.
    alpha *= smoothstep(0.2, 0.8, sin(uTime * mix(0.15, 0.4, fract(traits.a * 6.1)) + traits.a * 50.0));
    if (ct.w < 0.1 || cp.w < 0.1) alpha = 0.0;
    vAlpha = alpha;
    vColor = mix(ICE, SILVER, 0.3 * fract(traits.a * 3.3));
    vUv = vec2(s, side);
    gl_Position = cw;
  }
`

const WISP_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    float along = smoothstep(0.0, 0.7, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
    float across = exp(-3.0 * vUv.y * vUv.y) * (1.0 - vUv.y * vUv.y);
    gl_FragColor = vec4(vColor * vAlpha * along * across, 1.0);
  }
`

/**
 * Flakes: a very few translucent membrane fragments, the colonies' own
 * material shed into the air. Flat, irregular, torn along one side, each
 * turning slowly in space: a slow yaw, a tilt that rocks, a roll in its own
 * plane. Mostly body, thicker toward one side, with only a faint rim; edge-on
 * it cools toward icy blue. Close to
 * the camera one softens as if out of focus, so the odd one passing near
 * reads as depth, not as an object in the way.
 */
const FLAKE_VERTEX = /* glsl */ `
  ${LOOK_GLSL}
  attribute vec2 aRef;
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vBlur;
  varying float vSeed;
  varying float vEdgeOn;

  void main() {
    vec4 st = texture2D(uPositions, aRef);
    vec4 traits = texture2D(uTraits, aRef);
    vec3 p = st.xyz;
    float tone = traits.a;

    float yaw = tone * 40.0 + uTime * mix(-0.14, 0.14, fract(tone * 13.7));
    float tilt = 0.55 + 0.5 * sin(uTime * (0.05 + 0.07 * fract(tone * 5.3)) + tone * 20.0);
    float roll = tone * 9.0 + uTime * mix(0.05, 0.18, fract(tone * 3.9));
    vec3 nrm = vec3(sin(tilt) * cos(yaw), cos(tilt), sin(tilt) * sin(yaw));
    vec3 e1 = vec3(-sin(yaw), 0.0, cos(yaw));
    vec3 e2 = cross(nrm, e1);
    vec3 u = cos(roll) * e1 + sin(roll) * e2;
    vec3 v = -sin(roll) * e1 + cos(roll) * e2;
    float size = mix(0.08, 0.2, fract(tone * 7.1));
    if (fract(tone * 23.0) > 0.85) size *= 1.6;
    float aspect = mix(0.4, 0.75, fract(tone * 2.9));
    vec3 world = p + (u * position.x + v * position.y * aspect) * size;

    float dist = -(modelViewMatrix * vec4(p, 1.0)).z;
    float facing = abs(dot(nrm, normalize(cameraPosition - p)));
    float nearness = 1.0 - smoothstep(0.7, 3.5, dist);
    vBlur = mix(0.04, 0.4, nearness);
    float alpha = 0.34 * mix(1.0, 0.5, nearness) * smoothstep(0.35, 0.8, dist);
    alpha *= 1.0 - 0.8 * smoothstep(16.0, 28.0, dist);
    alpha *= airFog(dist) * airEdge(p) * airBorn(st.w, 0.1, 0.12) * airSky(p, 3.0, 6.0);
    vColor = mix(mix(LAVENDER, SILVER, 0.35), AQUA, 0.25 * airHeld(p, airHoldGain(FLAKE)));
    vEdgeOn = 1.0 - facing;
    vAlpha = alpha;
    vQ = position.xy;
    vSeed = tone;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`

const FLAKE_FRAGMENT = /* glsl */ `
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vBlur;
  varying float vSeed;
  varying float vEdgeOn;
  const vec3 ICE = vec3(0.70, 0.84, 1.0);
  void main() {
    float rr = length(vQ);
    float th = atan(vQ.y, vQ.x);
    // An irregular, slightly torn outline, and one side cut across, as a
    // fragment of a larger membrane.
    float edge = 0.78 + 0.07 * sin(2.0 * th + vSeed * 31.0) + 0.08 * sin(3.0 * th + vSeed * 47.0) + 0.05 * sin(5.0 * th + vSeed * 19.0) + 0.03 * sin(9.0 * th + vSeed * 13.0);
    float inside = 1.0 - smoothstep(edge - vBlur - 0.04, edge + vBlur * 0.5, rr);
    float cutAngle = vSeed * 61.0;
    float cut = dot(vQ, vec2(cos(cutAngle), sin(cutAngle)));
    inside *= 1.0 - smoothstep(0.25 - vBlur, 0.32 + vBlur, cut);
    if (inside <= 0.0 || vAlpha <= 0.0) discard;
    // Thicker toward one side, thinning to the free edge: a body of
    // material, not an outline.
    float body = 0.26 * (0.4 + 0.6 * smoothstep(0.6, -0.8, dot(vQ, vec2(0.6, 0.8))));
    float rim = 0.22 * exp(-pow((rr - edge * 0.92) / (0.06 + vBlur), 2.0));
    // A faint shift of hue across it, as in a thin film.
    vec3 col = mix(vColor, ICE, 0.3 * vEdgeOn + 0.2 * rim + 0.25 * smoothstep(-0.7, 0.9, vQ.x + 0.3 * vQ.y));
    float a = (body + rim) * inside * (1.0 + 0.5 * vEdgeOn);
    gl_FragColor = vec4(col * vAlpha * a, 1.0);
  }
`

/**
 * Haze: a broad, soft veil per haze particle, facing the camera and wider
 * than tall; they pool over the basins and low ground and lift the palette.
 * A point sprite is capped in size and would show as separate discs, so
 * veils are quads. They are not depth-tested, which would cut them along the
 * ground in hard lines; instead each veil looks back along its line to the
 * camera and fades as a whole where the land stands in between.
 */
const VEIL_VERTEX = /* glsl */ `
  ${LOOK_GLSL}
  attribute vec2 aRef;
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 st = texture2D(uPositions, aRef);
    vec4 traits = texture2D(uTraits, aRef);
    vec3 p = st.xyz;
    float tone = traits.a;

    float clear = 1.0;
    for (int k = 1; k < 8; k++) {
      vec3 q = mix(p, cameraPosition, float(k) / 8.0);
      clear = min(clear, smoothstep(-0.25, 0.35, q.y - airFloor(q.xz)));
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float size = mix(3.0, 6.0, tone);
    mv.xy += position.xy * vec2(size * 0.62, size * 0.32);

    float held = airHeld(p, airHoldGain(HAZE));
    vColor = mix(mix(SILVER, LAVENDER, tone), AQUA, 0.2 * held);
    float near = smoothstep(2.5, 7.0, dist);
    float breath = 0.8 + 0.2 * sin(uTime * 0.11 + tone * 23.0);
    vAlpha = 0.017 * clear * airFog(dist) * near * airBorn(st.w, 0.15, 0.2) * breath * airEdge(p) * (1.0 + 0.5 * held);
    vQ = position.xy;
    gl_Position = projectionMatrix * mv;
  }
`

const VEIL_FRAGMENT = /* glsl */ `
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = dot(vQ, vQ);
    if (d > 1.0) discard;
    float shape = exp(-d * 3.0) * (1.0 - d);
    gl_FragColor = vec4(vColor * vAlpha * shape, 1.0);
  }
`

const additive = (extra) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...extra,
  })

/** One instanced quad mesh drawing the residents listed in `refs`. */
function instanced(quad, refs, material) {
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.attributes.position)
  geo.setAttribute('aRef', new THREE.InstancedBufferAttribute(refs, 2))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 40)
  return new THREE.Mesh(geo, material)
}

/** A wisp's ribbon: a station per step along it, tail to head, two sides. */
function ribbon() {
  const geo = new THREE.BufferGeometry()
  const pos = []
  const index = []
  for (let k = 0; k <= WISP_STEPS; k++) {
    pos.push(k / WISP_STEPS, -1, 0, k / WISP_STEPS, 1, 0)
    if (k > 0) index.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k)
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(index)
  return geo
}

/**
 * The scene's air: one particle system for the whole habitat, in which five
 * residents live — dust, wisps, motes, flakes and haze — moved by one field
 * (lib/air.js) that each reads in its own way.
 */
export default function AmbientAir({ field, elevation, waterLevel, density, drift, curl, colony, colonies }) {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)

  const floor = useMemo(() => makeFloor(field, { size: 26, elevation, waterLevel }), [field, elevation, waterLevel])
  const floorTexture = useMemo(() => {
    const data = new Uint8Array(floor.n * floor.n * 4)
    for (let i = 0; i < floor.n * floor.n; i++) {
      const v = Math.round(((floor.grid[i] - floor.min) / (floor.max - floor.min)) * 255)
      data[i * 4] = v
      data[i * 4 + 3] = 255
    }
    const t = new THREE.DataTexture(data, floor.n, floor.n, THREE.RGBAFormat)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [floor])
  useEffect(() => () => floorTexture.dispose(), [floorTexture])

  // Each particle's own constants: hover, lifespan, resident, tone. And, per
  // resident drawn as instances, which particles it is.
  const { traits, seedTraits, refs } = useMemo(() => {
    const random = mulberry32(4207)
    const data = new Float32Array(COUNT * 4)
    const lists = { [KIND.WISP]: [], [KIND.FLAKE]: [], [KIND.HAZE]: [] }
    for (let i = 0; i < COUNT; i++) {
      const b = random()
      const kind = kindOf(b)
      const [shortest, range] = LIFE[kind]
      data[i * 4] = random()
      data[i * 4 + 1] = shortest + random() * range
      data[i * 4 + 2] = b
      data[i * 4 + 3] = random()
      lists[kind]?.push(i)
    }
    const t = new THREE.DataTexture(data, SIDE, SIDE, THREE.RGBAFormat, THREE.FloatType)
    t.needsUpdate = true
    const refs = {}
    for (const [kind, list] of Object.entries(lists)) {
      const uv = new Float32Array(list.length * 2)
      list.forEach((i, k) => {
        uv[k * 2] = ((i % SIDE) + 0.5) / SIDE
        uv[k * 2 + 1] = (Math.floor(i / SIDE) + 0.5) / SIDE
      })
      refs[kind] = { uv, index: Uint32Array.from(list) }
    }
    return { traits: t, seedTraits: data, refs }
  }, [])

  // The simulation. Built once per landform; the controls are uniforms.
  const sim = useMemo(() => {
    const gpu = new GPUComputationRenderer(SIDE, SIDE, gl)
    const start = gpu.createTexture()
    const random = mulberry32(911)
    const a = start.image.data
    for (let i = 0; i < COUNT; i++) {
      const kind = kindOf(seedTraits[i * 4 + 2])
      const x = (random() - 0.5) * 2 * AIR.halfWidth
      const z = (random() - 0.5) * 2 * AIR.halfWidth
      a[i * 4] = x
      a[i * 4 + 1] = floor.at(x, z) + hoverHeight(kind, seedTraits[i * 4])
      a[i * 4 + 2] = z
      // Motes and haze are reborn soon, where they belong.
      a[i * 4 + 3] = kind === KIND.MOTE || kind === KIND.HAZE ? 0.8 + 0.2 * random() : random()
    }
    const variable = gpu.addVariable('texturePosition', SIMULATE, start)
    gpu.setVariableDependencies(variable, [variable])
    variable.material.uniforms = {
      ...variable.material.uniforms,
      ...airUniforms(),
      uDelta: { value: 0 },
      uTraits: { value: traits },
    }
    const error = gpu.init()
    if (error) {
      console.warn('Ambient air disabled:', error)
      return null
    }
    return { gpu, variable }
  }, [gl, traits, seedTraits, floor])
  useEffect(() => () => sim?.gpu.dispose(), [sim])

  // The residents' drawings.
  const layers = useMemo(() => {
    const material = (vertexShader, fragmentShader, extra = {}) =>
      additive({
        uniforms: {
          ...airUniforms(),
          uPositions: { value: null },
          uTraits: { value: traits },
          uScale: { value: 1 },
          uDpr: { value: 1 },
          uViewport: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader,
        fragmentShader,
        ...extra,
      })

    const geo = new THREE.BufferGeometry()
    const ref = new Float32Array(COUNT * 2)
    for (let i = 0; i < COUNT; i++) {
      ref[i * 2] = ((i % SIDE) + 0.5) / SIDE
      ref[i * 2 + 1] = (Math.floor(i / SIDE) + 0.5) / SIDE
    }
    geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 2))
    // Positions come from the texture; this is only for three's bookkeeping.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 40)
    const points = new THREE.Points(geo, material(POINT_VERTEX, POINT_FRAGMENT))

    const plane = new THREE.PlaneGeometry(2, 2)
    const wisps = instanced(ribbon(), refs[KIND.WISP].uv, material(WISP_VERTEX, WISP_FRAGMENT, { side: THREE.DoubleSide }))
    const flakes = instanced(plane, refs[KIND.FLAKE].uv, material(FLAKE_VERTEX, FLAKE_FRAGMENT, { side: THREE.DoubleSide }))
    const veils = instanced(plane, refs[KIND.HAZE].uv, material(VEIL_VERTEX, VEIL_FRAGMENT, { depthTest: false }))
    return {
      points,
      instanced: [
        { mesh: veils, index: refs[KIND.HAZE].index, order: 4 },
        { mesh: wisps, index: refs[KIND.WISP].index, order: 5 },
        { mesh: flakes, index: refs[KIND.FLAKE].index, order: 6 },
      ],
    }
  }, [traits, refs])
  useEffect(
    () => () => {
      layers.points.geometry.dispose()
      layers.points.material.dispose()
      for (const { mesh } of layers.instanced) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    },
    [layers],
  )

  const colonyData = useMemo(
    () => (colonies ?? []).slice(0, AIR.maxColonies).map((c) => new THREE.Vector4(c.x, c.y, c.z, c.radius)),
    [colonies],
  )

  const time = useRef(0)

  useFrame((_, delta) => {
    if (!sim) return
    const dt = Math.min(delta, 0.05)
    time.current += dt
    const state = { t: time.current, drift, curl, colony, floor, floorTexture, colonyData }

    // Simulate.
    const u = sim.variable.material.uniforms
    setAir(u, state)
    u.uDelta.value = dt
    sim.gpu.compute()

    // Draw: every resident among the particles Density draws.
    const positions = sim.gpu.getCurrentRenderTarget(sim.variable).texture
    const dpr = gl.getPixelRatio()
    const fov = (camera.fov * Math.PI) / 180
    const drawn = Math.round(COUNT * density)
    for (const material of [layers.points.material, ...layers.instanced.map((l) => l.mesh.material)]) {
      const mu = material.uniforms
      setAir(mu, state)
      mu.uPositions.value = positions
      mu.uScale.value = (size.height * dpr) / (2 * Math.tan(fov / 2))
      mu.uDpr.value = dpr
      mu.uViewport.value.set(size.width * dpr, size.height * dpr)
    }
    layers.points.geometry.setDrawRange(0, drawn)
    for (const { mesh, index } of layers.instanced) {
      let shown = 0
      while (shown < index.length && index[shown] < drawn) shown++
      mesh.geometry.instanceCount = shown
    }
  })

  if (!sim) return null
  return (
    <group>
      {layers.instanced.map(({ mesh, order }) => (
        <primitive key={mesh.uuid} object={mesh} frustumCulled={false} renderOrder={order} />
      ))}
      <primitive object={layers.points} frustumCulled={false} renderOrder={5} />
    </group>
  )
}

/** Uniforms the field's GLSL declares (lib/air.js). */
function airUniforms() {
  return {
    uTime: { value: 0 },
    uDrift: { value: 0.5 },
    uCurl: { value: 0.5 },
    uColony: { value: 0.5 },
    uColonies: { value: Array.from({ length: AIR.maxColonies }, () => new THREE.Vector4()) },
    uColonyCount: { value: 0 },
    uFloor: { value: null },
    uFloorMin: { value: 0 },
    uFloorSpan: { value: 1 },
    uFieldSize: { value: 26 },
    uWaterY: { value: 0 },
  }
}

function setAir(u, { t, drift, curl, colony, floor, floorTexture, colonyData }) {
  u.uTime.value = t
  u.uDrift.value = drift
  u.uCurl.value = curl
  u.uColony.value = colony
  u.uFloor.value = floorTexture
  u.uFloorMin.value = floor.min
  u.uFloorSpan.value = floor.max - floor.min
  u.uWaterY.value = floor.waterY
  u.uColonyCount.value = colonyData.length
  colonyData.forEach((v, i) => u.uColonies.value[i].copy(v))
}
