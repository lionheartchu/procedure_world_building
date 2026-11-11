import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { AIR_GLSL } from '../lib/air'
import { SOURCE_GRAINS, WISP_CUE, WISPS, WISPS_GLSL } from '../lib/wisps'
import { colonyAirUniforms, setColonyAir } from '../lib/airColony'
import { mulberry32 } from '../lib/noise'

/*
 * Wisps — rework, phase 2.5: residue carried by moving air (lib/wisps.js).
 *
 * Simulated on the GPU, like the dust. Each grain belongs to a release point
 * and is released again whenever its own period comes round, so each point
 * lets out a steady trickle; the drawing then decides how much of it is seen.
 *
 * Drawn as soft quads, each stretched a little along its own motion on
 * screen (never more than the motion shows: a grain moving toward the camera
 * is round). Two kinds:
 *   grains  fine, faint; together they make traces, frayed with age
 *   mist    broad, very faint, growing as it ages; together soft patches
 *
 * What is seen of a grain: nothing near its release (no source is ever
 * visible): it fades in only once it has travelled and spread, and out at
 * the end; the puff it
 * was released in; the visibility field travelling with the air; its
 * point's intensity. Its colour is the local stain of the air (most of it
 * near silver), shifting slightly with the angle it is seen at.
 *
 * Drawn into its own buffer at half resolution and laid over the scene
 * through a soft ceiling (see RESOLUTION), with screen blending, so no amount
 * of stacking can glow and it never clips a bright surface. That buffer has no depth: residue fades as a whole where land
 * stands between it and the camera (hiddenBy), which also keeps it from
 * being cut along the ground in hard lines.
 */

const X = WISPS.sizeX
const Y = WISPS.sizeY
const COUNT = X * Y

/** Fog for the residue: a little lighter than the scene's (0.026). */
const FOG = 0.02

/** The density map: cells over ±DENSITY_EXTENT, and the density of a loose trace. */
const DENSITY_RES = 64
const DENSITY_EXTENT = 17
const DENSITY_REF = 8

/**
 * The residue is drawn into its own buffer at RESOLUTION of the screen and
 * laid over the scene through a soft ceiling: faint residue passes almost
 * unchanged, but however much stacks up on screen (along a line of sight,
 * in an eddy, where traces cross), no pixel exceeds CEILING.
 */
const RESOLUTION = 0.5
const CEILING = '0.36'

const COMPOSITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D uLight;
  varying vec2 vUv;
  void main() {
    vec3 L = texture2D(uLight, vUv).rgb;
    float lum = dot(L, vec3(0.3, 0.5, 0.2));
    float kept = lum > 1e-5 ? ${CEILING} * (1.0 - exp(-lum / ${CEILING})) / lum : 1.0;
    gl_FragColor = vec4(L * kept, 1.0);
  }
`

/**
 * The Habitat's M2 (`cue`): the buffer's alpha holds how much of each pixel's
 * residue is the cue's. That part is laid over the scene as tinted air, at a
 * set brightness a step above D's ground (at the ground's own brightness its
 * lilac and ice did not show at all), capped so it never reaches white; the
 * rest is screened as before. `CUE_OVER`: its most opacity, how
 * fast it reaches it, and its brightness.
 */
const CUE_OVER = { most: '0.6', rate: '0.05', value: '0.86' }

const COMPOSITE_CUE_FRAGMENT = /* glsl */ `
  uniform sampler2D uLight;
  uniform float uPart; // 0: the rest, screened; 1: the cue's part, laid over
  varying vec2 vUv;
  void main() {
    vec4 B = texture2D(uLight, vUv);
    vec3 L = B.rgb;
    float lum = dot(L, vec3(0.3, 0.5, 0.2));
    float share = clamp(B.a * 0.8 / max(lum, 1e-5), 0.0, 1.0);
    if (uPart < 0.5) {
      vec3 R = L * (1.0 - share);
      float l = lum * (1.0 - share);
      float kept = l > 1e-5 ? ${CEILING} * (1.0 - exp(-l / ${CEILING})) / l : 1.0;
      gl_FragColor = vec4(R * kept, 1.0);
    } else {
      float a = ${CUE_OVER.most} * (1.0 - exp(-B.a / ${CUE_OVER.rate}));
      vec3 hue = L / max(lum, 1e-5) * ${CUE_OVER.value};
      gl_FragColor = vec4(hue * a, a);
    }
  }
`

/** How fast the rising third of the residue lifts among a colony's forms (units/s). */
const COLONY_LIFT = '0.055'

/** The most a colony slows the residue arriving at it (a share of its speed). */
const COLONY_SLOWING = '0.6'

/** How much denser than a loose trace a colony's filaments may be before they dim. */
const COLONY_DENSITY = '3.0'

/** The most light overlapping mist puffs may give together (summed opacity). */
const MIST_CEILING = '0.3'

/** Peak opacity per grain and per mist puff at Wisp strength 0.5. */
const ALPHA = { grain: 0.75, mist: 0.24 }

const SIMULATE = /* glsl */ `
  uniform float uDelta;
  uniform sampler2D uTraitsA; // source, phase, kind, tone
  uniform sampler2D uTraitsB; // release offset x, z, height, wander angle
  ${AIR_GLSL}
  ${WISPS_GLSL}

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 s = texture2D(texturePosition, uv);
    vec4 a = texture2D(uTraitsA, uv);
    vec4 b = texture2D(uTraitsB, uv);
    float src = a.x;
    float period = sourcePeriod(src) * (0.9 + 0.2 * fract(a.w * 7.7));
    float age = fract(uTime / period + a.y);
    float born = uTime - age * period;
    vec3 place = sourcePlace(src, born);
    float pref = place.y + 0.3 * b.z * spread(src, born);
    vec3 p = s.xyz;
    // Released before its colony existed (parked outside the world): join it now.
    bool stranded = colonySource(src) && p.x > 500.0 && sourceColony(src).x < 500.0;
    if (age < s.w || stranded) {
      // Released again: at its point, spread as the point is spreading now.
      vec2 xz = place.xz + b.xy * spread(src, born);
      p = vec3(xz.x, airFloor(xz) + pref, xz.y);
    }
    #ifdef CUE
    else if (cueSource(src)) {
      // M2: the cue's own air is carried as the commons carries the cue (its
      // open waves, at the cue's share of their speed, at the cue's height,
      // on the commons' clock), so what is drawn goes where the simulated cue
      // goes; colony air does not hold it, as it does not hold the cue. A
      // little fraying with age, for the drawing only.
      vec2 w = airWaves(vec3(p.x, airFloor(p.xz) + uCueHeight, p.z), uCueTime).xy * uCueCarry;
      p.xz += (w + eddies(p.xz, uTime) * 0.04 * age) * uDelta;
      // Drawn opening upward as it goes, as smoke leaving a source does: thin
      // where it left the sheet, rising and fraying downwind. (The cue itself
      // is a field over the ground; its height here is the drawing's.)
      p.y = airFloor(p.xz) + 0.22 + 0.12 * b.z + (0.15 + 0.95 * fract(a.w * 3.3)) * age;
    }
    #endif
    else {
      // About a third of the residue rises among a colony's forms (it flows
      // between the membranes, where their own lift is slight, so this lift
      // follows the colony itself), drifting up and over before it falls back.
      bool riser = fract(a.w * 5.7) < 0.33;
      airRiseGain = riser ? 4.0 : 0.6;
      vec3 v = airVelocity(p, pref);
      float among = smoothstep(0.08, 0.42, colonyNear(p));
      if (riser) v.y += ${COLONY_LIFT} * among - (pref - (p.y - airFloor(p.xz))) * 0.024 * among;
      // Older residue folds in small eddies and wanders off on its own.
      v.xz += eddies(p.xz, uTime) * 0.08 * age;
      v.xz += vec2(cos(b.w), sin(b.w)) * 0.045 * (0.4 + fract(a.w * 3.1)) * age;
      // Near a colony all of its motion is held back, easing in from about
      // 1.6 colony radii out: it slows as it arrives and lingers. (This is
      // the one place matter may crowd, by at most about 2.5×; each grain
      // dims as it slows, so it reads as fuller air, never a glow.)
      v.xz *= 1.0 - ${COLONY_SLOWING} * smoothstep(0.02, 0.42, colonyNear(p));
      p += v * uDelta;
      p.y = max(p.y, airFloor(p.xz) + 0.05);
    }
    gl_FragColor = vec4(p, age);
  }
`

const LOOK_GLSL = /* glsl */ `
  ${AIR_GLSL}
  ${WISPS_GLSL}
  uniform sampler2D uPositions;
  uniform sampler2D uPrevious;
  uniform sampler2D uTraitsA;
  uniform sampler2D uTraitsB;
  uniform float uAspect;
  uniform float uActive; // regions shown
  uniform float uStrength;
  uniform float uDelta;
  uniform sampler2D uDensity; // grains per cell over the land, this frame
  uniform float uDensityRef;
  uniform float uDebug;

  // Whether release point s is in use: a region shown at this Wisps amount,
  // or an existing colony while Colony air is on.
  float sourceShown(float s) {
    #ifdef CUE
    if (cueSource(s)) return step(0.001, cueSlot(s).w);
    #endif
    if (!colonySource(s)) return step(floor(s / SOURCES_PER_REGION) + 0.5, uActive);
    float ci = floor((s - REGION_SOURCES) / PER_COLONY);
    return step(ci + 0.5, float(uColonyCount)) * step(0.001, uColonyAir) * step(0.5, uActive);
  }

  // Seen only once it has travelled and spread, never near where it was
  // released. A colony's incoming air is released well upwind, so it may
  // show sooner: it is seen arriving.
  float ageFade(float s, float age) {
    #ifdef CUE
    // The cue's air is seen leaving the sheet it left.
    if (cueSource(s)) return smoothstep(0.015, 0.08, age) * (1.0 - smoothstep(0.7, 1.0, age));
    #endif
    float rise = colonySource(s) ? smoothstep(0.03, 0.15, age) : smoothstep(0.12, 0.42, age);
    return rise * (1.0 - smoothstep(colonySource(s) ? 0.78 : 0.7, 1.0, age));
  }

  // How much a grain counts toward the density map: what is released and
  // shown, before the camera has a say.
  float presence(float src, float age, float born) {
    return sourceShown(src) * release(src, born) * ageFade(src, age);
  }

  const vec3 SILVER = vec3(0.8, 0.82, 0.92);
  // Mint only as a narrow, pale accent: as a broad band it stained the
  // whole scene teal.
  const vec3 MINT = vec3(0.62, 0.93, 0.88);
  const vec3 ICE = vec3(0.6, 0.8, 1.0);
  const vec3 LILAC = vec3(0.9, 0.64, 1.0);
  const vec3 PEARL = vec3(1.0, 0.86, 0.66);

  vec3 palette(float h) {
    if (h < 0.12) return mix(MINT, ICE, h / 0.12);
    if (h < 0.75) return mix(ICE, LILAC, (h - 0.12) / 0.63);
    return mix(LILAC, PEARL, smoothstep(0.85, 1.0, h));
  }

  // Land between p and the camera: 0 clear, 1 hidden.
  float hiddenBy(vec3 p) {
    float h = 0.0;
    for (int k = 1; k < 8; k++) {
      vec3 q = mix(p, cameraPosition, float(k) / 8.0);
      h = max(h, smoothstep(0.15, -0.45, q.y - airFloor(q.xz)));
    }
    return h;
  }

  // Only sky behind p: 1, else 0.
  float skyBehind(vec3 p) {
    vec3 dir = normalize(p - cameraPosition);
    float clear = 1e3;
    for (int k = 1; k <= 6; k++) {
      vec3 q = p + dir * (float(k) * 3.0);
      clear = min(clear, q.y - airFloor(q.xz));
    }
    return smoothstep(-0.3, 0.6, clear);
  }
`

const VERTEX = /* glsl */ `
  ${LOOK_GLSL}
  attribute vec2 aRef;
  uniform float uMist; // 1 for the mist mesh
  uniform float uProj; // projectionMatrix[1][1]
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;
  #ifdef CUE
  varying float vCue;
  #endif
  float vAlphaScale;

  void main() {
    vec4 s = texture2D(uPositions, aRef);
    vec4 prev = texture2D(uPrevious, aRef);
    vec4 a = texture2D(uTraitsA, aRef);
    vec3 p = s.xyz;
    float age = s.w;
    float src = a.x;
    float tone = a.w;
    float period = sourcePeriod(src) * (0.9 + 0.2 * fract(tone * 7.7));
    float born = uTime - age * period;
    float nearColony = colonyNear(p);
    float inColony = smoothstep(0.05, 0.35, nearColony);
    // M2: how much of the simulated cue is where this grain is (0..1), and
    // whether it was let out with the cue itself.
    float cueK = 0.0;
    float cueT = 0.0;
    bool fromCue = false;
    #ifdef CUE
    vec2 cc = cueAt(p.xz);
    cueK = (1.0 - exp(-cc.x / uCueRef)) * (colonySource(src) ? uCueFilaments : 1.0);
    cueT = cc.y;
    fromCue = cueSource(src);
    #endif

    // How much of it is seen.
    float alpha = (uMist > 0.5 ? ${ALPHA.mist} : ${ALPHA.grain}) * 2.0 * uStrength;
    alpha *= sourceShown(src);
    alpha *= ageFade(src, age);
    alpha *= release(src, born) * sourceIntensity(src);
    // A colony's incoming air comes and goes less, so it reads as one flow,
    // and is mostly fine grains: its streaks show the air, a mist would hide it.
    float vis = colonySource(src) ? mix(visibility(p, uTime), 1.0, 0.6) : visibility(p, uTime);
    float mistShare = colonySource(src) && uMist > 0.5 ? 0.3 : 1.0;
    // M2: air the cue is in shows wherever it is (the visibility field does
    // not hide it); the cue's own air shows only where the cue is. Without
    // the cue both are as before.
    alpha *= (fromCue ? 1.0 : mix(vis, 1.0, cueK)) * mistShare;
    if (fromCue) alpha *= cueK;
    // The cue is shown by fine grains only, streaked along their motion: mist
    // drawn with it made one soft blob of the whole cue. Its own release
    // points let out no mist.
    if (fromCue && uMist > 0.5) alpha = 0.0;
    // Fewer of them, each longer, so they read as filaments, not a mass.
    if (fromCue && fract(tone * 17.3) > 0.4) alpha = 0.0;
    alpha *= 0.55 + 0.45 * fract(tone * 13.1);

    vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0);
    float dist = c0.w;
    alpha *= exp(-${FOG} * ${FOG} * dist * dist);
    // Residue is seen in the middle distance; close to the camera it would
    // be large on screen and read as light streaks, so it goes.
    // (In a colony, where it moves slowly and its streaks are short, it may
    // come nearer.)
    // (M2: air the cue is in may come nearer, to a little over a unit.)
    float nearIn = mix(inColony, 1.0, cueK);
    alpha *= uMist > 0.5
      ? smoothstep(mix(5.0, mix(3.0, 1.2, cueK), nearIn), mix(10.0, mix(6.5, 3.0, cueK), nearIn), dist) * (1.0 - smoothstep(30.0, 46.0, dist))
      : smoothstep(mix(4.0, mix(2.0, 0.8, cueK), nearIn), mix(9.0, mix(5.0, 2.2, cueK), nearIn), dist) * (1.0 - smoothstep(26.0, 42.0, dist));
    alpha *= mix(1.0, 0.25, skyBehind(p));
    // Drawn off screen without the scene's depth: the land hides residue here.
    alpha *= 1.0 - hiddenBy(p);
    // Released this frame: no motion to read yet.
    if (prev.w > age) alpha = 0.0;

    // Residue shows where the air runs. In slow air it lingers and would
    // pile up into a glow; there it fades (its density grows as its speed
    // falls, so this keeps the light even).
    vec3 vel = s.xyz - prev.xyz;
    float speed = length(vel) / max(uDelta, 1e-4);
    // In a colony slowing is the point, so there it fades only as the square
    // root of its speed: where the air slows the residue crowds, and the
    // slowed core is only a little denser than the air arriving, while its
    // streaks shorten into grains.
    float moving = clamp(speed / 0.08, 0.0, 1.0);
    alpha *= mix(moving, sqrt(moving), inColony);
    // Residue caught circling in an eddy stays near where it was released.
    vec3 origin = sourcePlace(src, born);
    float carried = length(p.xz - origin.xz) / max(age * period * 0.075, 0.4);
    if (!fromCue) alpha *= smoothstep(0.25, 0.6, carried);
    // Wherever residue gathers more densely than a loose trace (an eddy, slow
    // air, overlapping traces), each grain gives less light, so no place can
    // glow beyond what a loose trace gives.
    float dens = texture2D(uDensity, p.xz / ${(2 * DENSITY_EXTENT).toFixed(1)} + 0.5).r;
    // (The ceiling does not rise with Wisp strength: dense places give the
    // same light at any strength; the slider only brightens loose residue.)
    // (A colony's filaments are dense by design: thin lines of many grains.
    // They may be denser before dimming; the on-screen ceiling still holds.)
    float ref = uDensityRef * (colonySource(src) ? ${COLONY_DENSITY} : 1.0);
    alpha *= min(1.0, ref / (2.0 * uStrength) / max(dens, 1e-3));

    // Its colour: the local stain of the air, shifting a little with the
    // angle it is seen at, like a thin film.
    vec3 dir = length(vel) > 1e-7 ? normalize(vel) : vec3(1.0, 0.0, 0.0);
    vec3 view = normalize(cameraPosition - p);
    // Residue moving toward or away from the camera stacks along the line of
    // sight into a glow: let it go.
    alpha *= 1.0 - smoothstep(0.4, 0.75, abs(dot(view, dir)));
    float hue = fract(stainHue(p, uTime) + 0.12 * dot(view, dir) + 0.05 * fract(tone * 5.3));
    vColor = mix(SILVER, palette(hue), 0.75 * stain(p, uTime));
    // Near a colony, a passing tint of its own colours.
    vColor = mix(vColor, colonyHue(p, uTime), 0.6 * colonyTint(p, uTime));
    #ifdef CUE
    // The cue's own colour, by how far it has travelled: a pinker lilac as it
    // leaves, ice, then silver as it fades (MorphAir's, M1).
    vec3 cueCol = mix(vec3(0.765, 0.608, 0.875), vec3(0.565, 0.714, 0.925), smoothstep(0.0, 0.45, cueT));
    cueCol = mix(cueCol, vec3(0.70, 0.73, 0.85), smoothstep(0.45, 1.0, cueT));
    vColor = mix(vColor, cueCol, 0.9 * cueK);
    // (Mist keeps the cue's colour, screened as the rest; only grains lay it over the scene.)
    vCue = uMist > 0.5 ? 0.0 : cueK;
    #endif
    if (uDebug > 0.5) {
      // Only the colonies' incoming air, in mint: slowed grains brighter.
      alpha *= colonySource(src) ? 1.5 : 0.0;
      vColor = mix(vec3(0.5, 0.6, 0.75), vec3(0.45, 1.0, 0.8), 1.0 - moving);
    }

    // Size: fine grains, broad mist that grows as it ages. (M2: the cue's own
    // grains twice as wide, so they read at a middle distance.)
    float width = uMist > 0.5
      ? mix(0.3, 0.7, fract(tone * 3.7)) * (0.7 + 1.6 * age)
      : mix(0.035, 0.075, fract(tone * 3.7)) * (fromCue ? 2.0 : 1.0);
    if (uMist > 0.5) {
      // A mist puff spans many cells of the density map, so the cap above
      // does not bound it: count the puffs overlapping this one (the mist's
      // share of the residue over its own footprint) and share a fixed
      // ceiling of light between them.
      vec2 uvc = p.xz / ${(2 * DENSITY_EXTENT).toFixed(1)} + 0.5;
      float o = 0.6 * width / ${(2 * DENSITY_EXTENT).toFixed(1)};
      float around = 0.2 * (texture2D(uDensity, uvc).r + texture2D(uDensity, uvc + vec2(o, 0.0)).r + texture2D(uDensity, uvc - vec2(o, 0.0)).r
        + texture2D(uDensity, uvc + vec2(0.0, o)).r + texture2D(uDensity, uvc - vec2(0.0, o)).r);
      float cells = 3.14159 * pow(width / ${((2 * DENSITY_EXTENT) / DENSITY_RES).toFixed(4)}, 2.0) * 0.5;
      float overlapping = ${WISPS.mist} * around * cells;
      alpha = min(alpha, ${MIST_CEILING} / max(overlapping, 1.0));
    }
    // Grains streak along their motion, as in a long exposure.
    float stretch = uMist > 0.5
      ? mix(1.3, 2.0, fract(tone * 9.1))
      : 1.0 + (speed * mix(2.5, 5.0, fract(tone * 9.1)) * (fromCue ? 2.2 : 1.0)) / width;

    // Stretched along its motion on screen, as far as the motion shows.
    vec4 c1 = projectionMatrix * viewMatrix * vec4(p + dir * 0.2, 1.0);
    vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * vec2(uAspect, 1.0);
    float shown = clamp(length(d) / (0.2 * uProj / max(dist, 0.1)), 0.0, 1.0);
    d = length(d) > 1e-6 ? normalize(d) : vec2(1.0, 0.0);
    // Steep on screen would read as rain: there it stays round.
    float steep = abs(d.y);
    shown *= 1.0 - smoothstep(0.55, 0.85, steep);
    float halfLen = width * mix(1.0, stretch, shown);
    // A streak spreads the same light over its length, never more.
    vAlphaScale = 1.0 / mix(1.0, halfLen / width, 0.7);
    vec2 n = vec2(-d.y, d.x);
    vec2 offset = (d * position.x * halfLen + n * position.y * width) * uProj;
    offset.x /= uAspect;
    gl_Position = c0 + vec4(offset, 0.0, 0.0);

    vAlpha = alpha * vAlphaScale;
    vQ = position.xy;
    vSeed = tone;
  }
`

const FRAGMENT = /* glsl */ `
  uniform float uMist;
  varying vec2 vQ;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;
  #ifdef CUE
  varying float vCue;
  #endif
  void main() {
    if (vAlpha <= 0.001) discard;
    float r = length(vQ);
    // Mist has a soft, unsettled edge.
    float th = atan(vQ.y, vQ.x);
    float edge = 1.0 - uMist * 0.22 * (0.5 + 0.5 * sin(3.0 * th + vSeed * 40.0)) * (0.6 + 0.4 * sin(5.0 * th + vSeed * 17.0));
    float d = r / edge;
    if (d > 1.0) discard;
    float shape = exp(-d * d * mix(3.0, 2.2, uMist)) * (1.0 - d * d);
    #ifdef CUE
    // The cue's part of this light, kept in alpha for the composite.
    gl_FragColor = vec4(vColor * vAlpha * shape, vCue * vAlpha * shape);
    #else
    gl_FragColor = vec4(vColor * vAlpha * shape, 1.0);
    #endif
  }
`

/** Counts each grain into the density map (additively, one texel each). */
const SPLAT_VERTEX = /* glsl */ `
  ${LOOK_GLSL}
  attribute vec2 aRef;
  varying float vWeight;
  void main() {
    vec4 s = texture2D(uPositions, aRef);
    vec4 a = texture2D(uTraitsA, aRef);
    float src = a.x;
    float period = sourcePeriod(src) * (0.9 + 0.2 * fract(a.w * 7.7));
    float born = uTime - s.w * period;
    vWeight = presence(src, s.w, born);
    gl_Position = vec4(s.xz / ${DENSITY_EXTENT.toFixed(1)}, 0.0, 1.0);
    gl_PointSize = 1.0;
  }
`

const SPLAT_FRAGMENT = /* glsl */ `
  varying float vWeight;
  void main() {
    gl_FragColor = vec4(vWeight, 0.0, 0.0, 1.0);
  }
`

function airUniforms() {
  return {
    uTime: { value: 0 },
    uDrift: { value: 0.5 },
    uCurl: { value: 0.5 },
    uFloor: { value: null },
    uFloorMin: { value: 0 },
    uFloorSpan: { value: 1 },
    uFieldSize: { value: 26 },
    uWaterY: { value: 0 },
    ...colonyAirUniforms(),
  }
}

function setAir(u, { t, drift, curl, floor, floorTexture, colonyData, colony }) {
  u.uTime.value = t
  u.uDrift.value = drift
  u.uCurl.value = curl
  u.uFloor.value = floorTexture
  u.uFloorMin.value = floor.min
  u.uFloorSpan.value = floor.max - floor.min
  u.uWaterY.value = floor.waterY
  // The floor's own extent: 26 units, or a wider world's (the Habitat's D).
  u.uFieldSize.value = floor.size ?? 26
  setColonyAir(u, colonyData, colony)
}

const clearColor = new THREE.Color()

/** The cue's uniforms (M2), on each of the wisps' materials. */
function cueUniforms() {
  return {
    uCueSlot: { value: Array.from({ length: WISP_CUE.slots }, () => new THREE.Vector4()) },
    uCuePuff: { value: Array.from({ length: WISP_CUE.puffs }, () => new THREE.Vector4()) },
    uCueTravelled: { value: new Float32Array(WISP_CUE.puffs) },
    uCueRef: { value: WISP_CUE.ref },
    // The commons' clock and carriage (lib/morph.js MORPH), for the cue's own air.
    uCueTime: { value: 0 },
    uCueCarry: { value: 0.9 },
    uCueHeight: { value: 0.5 },
    // Whether the colonies' incoming filaments take the cue's colour (M2: 1).
    // They follow the visitor's nearest colonies, so in M3 (0) they do not:
    // the cue's colour is then the same wherever the visitor stands.
    uCueFilaments: { value: 1 },
  }
}

/**
 * The cue near the visitor, for the wisps (M2): its strongest puffs within
 * `near`, and the places films came away from within the last `recent` s,
 * one slot per resident, kept while the cue is still leaving there (how
 * much: the simulated cue at that place now). Read from the commons; it
 * changes nothing there.
 */
function cueNear(commons, at, slots, global = false) {
  const K = commons.K
  // M3 (`global`): what is drawn does not depend on where the visitor stands,
  // only on what the cue is doing: the strongest puffs and the most active
  // release sites anywhere in sight (WISP_CUE.visible), not the nearest. (In
  // M2, choosing the nearest made colour appear as the visitor approached,
  // which could read as the visitor's own doing.)
  const reach = global ? WISP_CUE.visible : WISP_CUE.near
  const puffs = []
  for (const q of commons.now()) {
    const d = Math.hypot(q.x - at[0], q.z - at[1])
    if (d < reach + q.r) puffs.push(q)
  }
  puffs.sort((a, b) => b.s - a.s)
  puffs.length = Math.min(puffs.length, WISP_CUE.puffs)
  const since = commons.n - WISP_CUE.recent / K.step
  const latest = new Map()
  for (let i = commons.releases.length - 1; i >= 0; i--) {
    const e = commons.releases[i]
    if (e.n < since) break
    const key = e.colony + ':' + e.resident
    if (!latest.has(key) && Math.hypot(e.x - at[0], e.z - at[1]) < reach) latest.set(key, e)
  }
  // Keep each slot with its resident while it is still letting cue out; fill free ones nearest first.
  const now = commons.n
  for (const slot of slots) {
    if (!slot.key) continue
    const e = latest.get(slot.key)
    if (e) {
      slot.x = e.x
      slot.z = e.z
      latest.delete(slot.key)
    }
    slot.w = Math.min(1, commons.cueAt(slot.x, slot.z, now) / 0.003)
    if (slot.w < 0.01) slot.key = null
  }
  const free = slots.filter((s) => !s.key)
  // Nearest first (M2), or (M3) most cue leaving there now first.
  const strength = (e) => commons.cueAt(e.x, e.z, now)
  const waiting = [...latest.entries()].sort(global ? (a, b) => strength(b[1]) - strength(a[1]) : (a, b) => Math.hypot(a[1].x - at[0], a[1].z - at[1]) - Math.hypot(b[1].x - at[0], b[1].z - at[1]))
  for (const slot of free) {
    const next = waiting.shift()
    if (!next) {
      slot.w = 0
      continue
    }
    const [key, e] = next
    slot.key = key
    slot.x = e.x
    slot.z = e.z
    slot.w = Math.min(1, commons.cueAt(e.x, e.z, now) / 0.003)
  }
  return puffs
}

/** The regions shown at a Wisps amount (0..1): none at 0, 4 at 0.5, all 5 at 1. */
const regionsShown = (amount) => (amount <= 0 ? 0 : Math.min(WISPS.regions, Math.round(2 + amount * 3)))

/**
 * The wisps: residue carried by the air in a few loose regions, from the
 * same field as the dust. `time` is the air's own clock and `floor` its floor
 * (AmbientAir).
 */
export default function AirWisps({ floor, floorTexture, time, drift, curl, amount, strength, colonyData, colony, debug, cue = null, colonyRef = null, cueGlobal = false }) {
  // M2 (`cue`, the commons): the cue drawn in the wisps; `colonyRef`, the
  // visitor's nearest colonies (AmbientAir's, following), so the colonies'
  // incoming air is drawn where the visitor is.
  const cueOn = !!cue
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  // Each grain's constants: its release point, phase, kind and tone; and
  // its release offset and wander.
  const traits = useMemo(() => {
    const random = mulberry32(7307)
    const A = new Float32Array(COUNT * 4)
    const B = new Float32Array(COUNT * 4)
    const mist = []
    const grains = []
    let src = 0
    for (let i = 0; i < COUNT; i++) {
      // Grains are dealt to release points in blocks (a colony's are larger);
      // the few left over belong to none and are never shown.
      while (src < SOURCE_GRAINS.length && i >= SOURCE_GRAINS[src][0] + SOURCE_GRAINS[src][1]) src++
      const [first, count] = SOURCE_GRAINS[Math.min(src, SOURCE_GRAINS.length - 1)]
      const isMist = random() < WISPS.mist
      A[i * 4] = src < SOURCE_GRAINS.length ? src : 999
      A[i * 4 + 1] = (i - first + random()) / count
      A[i * 4 + 2] = isMist ? 1 : 0
      A[i * 4 + 3] = random()
      // A release offset within a disc, denser toward its middle.
      const ang = random() * Math.PI * 2
      const rad = Math.sqrt(random()) * (0.4 + 0.6 * random())
      B[i * 4] = Math.cos(ang) * rad
      B[i * 4 + 1] = Math.sin(ang) * rad
      B[i * 4 + 2] = random() - 0.5
      B[i * 4 + 3] = random() * Math.PI * 2
      ;(isMist ? mist : grains).push(i)
    }
    const texture = (data) => {
      const t = new THREE.DataTexture(data, X, Y, THREE.RGBAFormat, THREE.FloatType)
      t.needsUpdate = true
      return t
    }
    return { A: texture(A), B: texture(B), mist, grains }
  }, [])

  // The simulation, warmed up so the air is already moving on the first
  // frame. Rebuilt for a new landform only; the controls are uniforms.
  const sim = useMemo(() => {
    const gpu = new GPUComputationRenderer(X, Y, gl)
    const start = gpu.createTexture()
    const d = start.image.data
    for (let i = 0; i < COUNT; i++) {
      d[i * 4 + 1] = -100 // out of sight until its first release
      d[i * 4 + 3] = 1
    }
    const variable = gpu.addVariable('texturePosition', SIMULATE, start)
    gpu.setVariableDependencies(variable, [variable])
    if (cueOn) variable.material.defines = { ...variable.material.defines, CUE: '' }
    variable.material.uniforms = {
      ...variable.material.uniforms,
      ...airUniforms(),
      ...(cueOn ? cueUniforms() : {}),
      // Residue bends round and slows among a colony's forms; only some of it
      // rises (airRiseGain): a little, so it does not pool at their tops.
      uColonyRise: { value: 0.25 },
      uDelta: { value: 0 },
      uTraitsA: { value: traits.A },
      uTraitsB: { value: traits.B },
    }
    const error = gpu.init()
    if (error) {
      console.warn('Wisps disabled:', error)
      return null
    }
    const u = variable.material.uniforms
    for (let t = -WISPS.warmup; t < 0; t += WISPS.warmupStep) {
      setAir(u, { t, drift: 0.5, curl: 0.5, floor, floorTexture, colonyData: null, colony: 0 })
      u.uDelta.value = WISPS.warmupStep
      gpu.compute()
    }
    return { gpu, variable }
  }, [gl, traits, floor, floorTexture, cueOn])
  useEffect(() => () => sim?.gpu.dispose(), [sim])
  const meshes = useMemo(() => {
    const quad = new THREE.PlaneGeometry(2, 2)
    const make = (list, mist) => {
      const ref = new Float32Array(list.length * 2)
      list.forEach((i, k) => {
        ref[k * 2] = ((i % X) + 0.5) / X
        ref[k * 2 + 1] = (Math.floor(i / X) + 0.5) / Y
      })
      const geo = new THREE.InstancedBufferGeometry()
      geo.index = quad.index
      geo.setAttribute('position', quad.attributes.position)
      geo.setAttribute('aRef', new THREE.InstancedBufferAttribute(ref, 2))
      geo.instanceCount = list.length
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 40)
      const material = new THREE.ShaderMaterial({
        defines: cueOn ? { CUE: '' } : {},
        transparent: true,
        depthWrite: false,
        depthTest: false,
        // (M2: the cue's part is summed in alpha too.)
        blending: cueOn ? THREE.CustomBlending : THREE.AdditiveBlending,
        ...(cueOn ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor } : {}),
        uniforms: {
          ...airUniforms(),
          ...(cueOn ? cueUniforms() : {}),
          uPositions: { value: null },
          uPrevious: { value: null },
          uTraitsA: { value: traits.A },
          uTraitsB: { value: traits.B },
          uAspect: { value: 1 },
          uActive: { value: 3 },
          uStrength: { value: 0.5 },
          uMist: { value: mist ? 1 : 0 },
          uProj: { value: 1 },
          uDelta: { value: 1 / 60 },
          uDensity: { value: null },
          uDensityRef: { value: DENSITY_REF },
          uDebug: { value: debug ? 1 : 0 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      })
      return new THREE.Mesh(geo, material)
    }
    return [make(traits.mist, true), make(traits.grains, false)]
  }, [traits, debug, cueOn])

  // The residue's own buffer, and the quad that lays it over the scene.
  const layer = useMemo(() => {
    const scene = new THREE.Scene()
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // Screen, not add: over dark air the same, over a bright membrane
        // less and less, so the residue never clips what it lies over.
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneMinusDstColorFactor,
        blendDst: THREE.OneFactor,
        uniforms: { uLight: { value: target.texture }, uPart: { value: 0 } },
        vertexShader: COMPOSITE_VERTEX,
        fragmentShader: cueOn ? COMPOSITE_CUE_FRAGMENT : COMPOSITE_FRAGMENT,
      }),
    )
    quad.frustumCulled = false
    // M2: the cue's part, laid over the scene (premultiplied) after the rest is screened.
    const over = cueOn
      ? new THREE.Mesh(
          quad.geometry,
          new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            uniforms: { uLight: { value: target.texture }, uPart: { value: 1 } },
            vertexShader: COMPOSITE_VERTEX,
            fragmentShader: COMPOSITE_CUE_FRAGMENT,
          }),
        )
      : null
    if (over) over.frustumCulled = false
    return { scene, target, quad, over }
  }, [cueOn])
  // The meshes join the residue's own scene here, not in the memo above: a
  // memo may run twice, and moving them twice leaves the kept scene empty.
  useEffect(() => {
    for (const m of meshes) {
      m.frustumCulled = false
      layer.scene.add(m)
    }
    return () => {
      for (const m of meshes) layer.scene.remove(m)
    }
  }, [layer, meshes])
  useEffect(
    () => () => {
      layer.target.dispose()
      layer.quad.geometry.dispose()
      layer.quad.material.dispose()
      layer.over?.material.dispose()
    },
    [layer],
  )

  const density = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(DENSITY_RES, DENSITY_RES, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    })
    const ref = new Float32Array(COUNT * 2)
    for (let i = 0; i < COUNT; i++) {
      ref[i * 2] = ((i % X) + 0.5) / X
      ref[i * 2 + 1] = (Math.floor(i / X) + 0.5) / Y
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 2))
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    const material = new THREE.ShaderMaterial({
      defines: cueOn ? { CUE: '' } : {},
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...airUniforms(),
        ...(cueOn ? cueUniforms() : {}),
        uPositions: { value: null },
        uPrevious: { value: null },
        uTraitsA: { value: traits.A },
        uTraitsB: { value: traits.B },
        uAspect: { value: 1 },
        uActive: { value: 3 },
        uStrength: { value: 0.5 },
        uDelta: { value: 1 / 60 },
        uDensity: { value: null },
        uDensityRef: { value: DENSITY_REF },
      },
      vertexShader: SPLAT_VERTEX,
      fragmentShader: SPLAT_FRAGMENT,
    })
    const points = new THREE.Points(geo, material)
    points.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(points)
    return { target, scene, points, camera: new THREE.Camera() }
  }, [traits, cueOn])
  useEffect(
    () => () => {
      density.target.dispose()
      density.points.geometry.dispose()
      density.points.material.dispose()
    },
    [density],
  )
  useEffect(
    () => () => {
      for (const m of meshes) {
        m.geometry.dispose()
        m.material.dispose()
      }
    },
    [meshes],
  )

  // M2: the slots' places and how much cue leaves there, kept between frames.
  const slots = useMemo(() => Array.from({ length: WISP_CUE.slots }, () => ({ key: null, x: 0, z: 0, w: 0 })), [])

  useFrame((_, delta) => {
    if (!sim) return
    const dt = Math.min(delta, 0.05)
    const state = { t: time.current, drift, curl, floor, floorTexture, colonyData: colonyRef?.current?.data ?? colonyData, colony }
    const u = sim.variable.material.uniforms
    setAir(u, state)
    if (cueOn) {
      const puffs = cueNear(cue, [camera.position.x, camera.position.z], slots, cueGlobal)
      const K = cue.K
      const apply = (cu) => {
        cu.uCueTime.value = cue.n * K.step
        cu.uCueFilaments.value = cueGlobal ? 0 : 1
        cu.uCueCarry.value = K.carry
        cu.uCueHeight.value = K.height
        slots.forEach((sl, k) => cu.uCueSlot.value[k].set(sl.x, 0.35, sl.z, sl.w))
        for (let i = 0; i < WISP_CUE.puffs; i++) {
          const q = puffs[i]
          if (q) {
            cu.uCuePuff.value[i].set(q.x, q.z, q.r, q.s)
            cu.uCueTravelled.value[i] = Math.min(1, q.age / (K.fade * 1.6))
          } else cu.uCuePuff.value[i].set(0, 0, 1, 0)
        }
      }
      apply(u)
      apply(density.points.material.uniforms)
      for (const m of meshes) apply(m.material.uniforms)
    }
    u.uDelta.value = dt
    sim.gpu.compute()
    const current = sim.gpu.getCurrentRenderTarget(sim.variable).texture
    const previous = sim.gpu.getAlternateRenderTarget(sim.variable).texture

    // Count this frame's residue into the density map.
    const du = density.points.material.uniforms
    setAir(du, state)
    du.uPositions.value = current
    du.uActive.value = regionsShown(amount)
    const target = gl.getRenderTarget()
    const autoClear = gl.autoClear
    gl.getClearColor(clearColor)
    const clearAlpha = gl.getClearAlpha()
    gl.setRenderTarget(density.target)
    gl.setClearColor(0x000000, 0)
    gl.clear(true, false, false)
    gl.autoClear = false
    gl.render(density.scene, density.camera)
    gl.autoClear = autoClear
    gl.setClearColor(clearColor, clearAlpha)
    gl.setRenderTarget(target)

    for (const m of meshes) {
      const mu = m.material.uniforms
      setAir(mu, state)
      mu.uPositions.value = current
      mu.uPrevious.value = previous
      mu.uAspect.value = size.width / size.height
      mu.uActive.value = regionsShown(amount)
      mu.uStrength.value = strength
      mu.uProj.value = camera.projectionMatrix.elements[5]
      mu.uDelta.value = dt
      mu.uDensity.value = density.target.texture
    }

    // Draw the residue into its own buffer; the quad lays it over the scene.
    const dpr = gl.getPixelRatio()
    const w = Math.max(1, Math.round(size.width * dpr * RESOLUTION))
    const h = Math.max(1, Math.round(size.height * dpr * RESOLUTION))
    if (layer.target.width !== w || layer.target.height !== h) layer.target.setSize(w, h)
    const before = gl.getRenderTarget()
    const clearBefore = gl.autoClear
    gl.getClearColor(clearColor)
    const alphaBefore = gl.getClearAlpha()
    gl.setRenderTarget(layer.target)
    gl.setClearColor(0x000000, 0)
    gl.clear(true, false, false)
    gl.autoClear = false
    gl.render(layer.scene, camera)
    gl.autoClear = clearBefore
    gl.setClearColor(clearColor, alphaBefore)
    gl.setRenderTarget(before)
  })

  if (!sim) return null
  return (
    <>
      <primitive object={layer.quad} renderOrder={7} />
      {layer.over && <primitive object={layer.over} renderOrder={8} />}
    </>
  )
}
