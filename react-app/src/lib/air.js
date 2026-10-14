/**
 * Air: the field that moves the scene's ambient particles (assignment 3).
 *
 * Rework, phase 1 — the base atmosphere (dust only). See docs/07-air-study.md.
 *
 * Two rules from the baseline's failures:
 *
 *   1. The motion never piles matter up. The field is divergence-free in
 *      every horizontal layer (the curl of a stream function, plus a uniform
 *      drift); the only other term is each grain's pull back to its own
 *      height over the floor, which moves it up or down, never sideways.
 *      With no sinks or slowing zones there are no attractors, so no clumps
 *      and no hotspots, however long it runs.
 *   2. Unevenness comes from where matter is born, not from where it
 *      collects. A composed density map — loose bands over the low ground and
 *      water near the land, thin over ridges and the open water — decides
 *      where grains appear; the flow then carries and folds that pattern into
 *      drifting filaments without ever concentrating it.
 *
 * Rework, phase 3 — colonies change the air around them (COLONY_AIR). Each
 * membrane, and each colony as a whole, is a soft obstacle with a footprint
 * and a height. The air bends around it and slows inside it: the horizontal
 * flow is the curl of a stream function, and the obstacles reshape that
 * function (holding it near its value at their centre), so the flow stays
 * divergence-free: it curves and lingers, it never piles up. Inside a form
 * matter rises gently along it and its pull back to its own height eases,
 * so it drifts up and out over the top.
 *
 * The field and the map exist in JS (for tests and diagrams) and in GLSL (for
 * the particles); the GLSL is generated from the same tables.
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The volume the air lives in: wider than the field, so edges sit in fog. */
export const AIR = {
  halfWidth: 17,
  top: 6.5,
}

/**
 * Plane waves of the stream function: [kx, ky, kz, phase, speed, amp].
 * Wave lengths of roughly 8–30 units; vertical wave numbers kept small, so
 * the swirls are broad and mostly horizontal. Speeds are phase drift per
 * second: the pattern itself changes over minutes.
 */
const WAVES = [
  // broad
  [0.21, 0.05, 0.13, 0.4, 0.021, 1.0],
  [-0.09, 0.07, 0.24, 2.1, 0.017, 1.0],
  [0.17, -0.06, -0.19, 4.4, 0.025, 1.0],
  // middle
  [0.36, 0.11, -0.22, 1.3, 0.031, 0.62],
  [0.28, -0.09, 0.39, 5.2, 0.027, 0.62],
  [-0.41, 0.08, 0.18, 3.0, 0.035, 0.62],
  // finer
  [0.63, 0.14, 0.47, 0.9, 0.043, 0.34],
  [-0.52, -0.12, 0.66, 2.7, 0.039, 0.34],
  [0.71, 0.1, -0.38, 4.9, 0.047, 0.34],
]

/**
 * Per wave: the direction it moves the air (across its own wave vector, in
 * the horizontal plane), so each wave contributes its amplitude in speed.
 */
const ACROSS = WAVES.map(([kx, , kz]) => {
  const k = Math.hypot(kx, kz)
  return [-kz / k, kx / k]
})

/** The weak vertical undulation, relative to the horizontal swirl. */
const VERTICAL = 0.22

/** Typical speeds, world units per second, at the controls' default (0.5). */
const SPEED = { drift: 0.06, curl: 0.075, hover: 0.04 }

/** Scales the waves' summed amplitude to SPEED.curl. */
const CURL_GAIN = 0.7

/** Colonies in the air (phase 3). */
export const COLONY_AIR = {
  maxColonies: 6,
  maxObstacles: 28,
  membrane: 0.45, // how firmly a membrane holds the air at its middle (at Colony air 1)
  colony: 0.3, // and a colony as a whole: gently, or the air would all go round it
  rise: 0.11, // units/s, inside a form, at full hold
  cap: 0.9, // the most the air is ever held, where obstacles overlap
}

/** The density map's limits: see `airDensity`. */
const DENSITY = {
  floor: 0.03, // the open water and the sky are never quite empty
  reach: [9, 14], // the land's reach, from its centre (units)
  low: [0.15, 1.5], // how high above the water the ground still counts as low
}

/* --- JS --------------------------------------------------------------- */

/** Ground floor at (x, z): the land, or the water's surface where higher. */
export function makeFloor(field, { size, elevation, waterLevel }) {
  const n = 96
  const grid = new Float32Array(n * n)
  const waterY = (waterLevel - 0.5) * elevation
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const g = (field.sample((i + 0.5) / n, (j + 0.5) / n) - 0.5) * elevation
      grid[j * n + i] = Math.max(g, waterY)
    }
  }
  let min = Infinity
  let max = -Infinity
  for (const v of grid) {
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  const at = (x, z) => {
    // Beyond the field the floor is the water.
    if (Math.abs(x) > size / 2 || Math.abs(z) > size / 2) return waterY
    const gx = clamp01(x / size + 0.5) * n - 0.5
    const gz = clamp01(z / size + 0.5) * n - 0.5
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(gx)))
    const j0 = Math.max(0, Math.min(n - 2, Math.floor(gz)))
    const fx = clamp01(gx - i0)
    const fz = clamp01(gz - j0)
    return (
      grid[j0 * n + i0] * (1 - fx) * (1 - fz) +
      grid[j0 * n + i0 + 1] * fx * (1 - fz) +
      grid[(j0 + 1) * n + i0] * (1 - fx) * fz +
      grid[(j0 + 1) * n + i0 + 1] * fx * fz
    )
  }
  return { n, grid, min, max: Math.max(max, min + 1e-3), size, waterY, at }
}

/** A grain's preferred height above the floor: most low, few high. */
export const hoverHeight = (h) => 0.08 + 2.8 * Math.pow(h, 2.2)

/**
 * Where dust is born (0..1) at (x, z), time t. Two crossing families of
 * narrow bands about 9 units apart (raised sinusoids), each strongly warped
 * by slower waves so they meander and cross irregularly, kept to the land's
 * reach and leaning toward the low ground and water. The bands drift very slowly,
 * so the composition changes over many minutes. Mirrors the GLSL.
 */
export function airDensity(x, z, t, floor) {
  const w1 = Math.sin(0.23 * z + 0.002 * t + 1.3) + 0.6 * Math.sin(0.31 * x - 0.0015 * t + 4.0)
  const w2 = Math.sin(0.27 * x + 0.0017 * t + 2.1) + 0.6 * Math.sin(0.19 * z - 0.001 * t + 0.6)
  const a = Math.pow(0.5 + 0.5 * Math.sin(0.55 * x + 0.36 * z + 2.4 * w1), 5)
  const b = Math.pow(0.5 + 0.5 * Math.sin(-0.4 * x + 0.62 * z + 2.0 * w2), 5)
  const bands = Math.max(a, 0.6 * b)
  const low = 1 - smoothstep(DENSITY.low[0], DENSITY.low[1], floor.at(x, z) - floor.waterY)
  const reach = 1 - smoothstep(DENSITY.reach[0], DENSITY.reach[1], Math.max(Math.abs(x), Math.abs(z)))
  return Math.max(DENSITY.floor, reach * (0.05 + 0.95 * bands) * (0.45 + 0.55 * low))
}

/**
 * The colonies as the air sees them: each membrane (a bloom anchor or veil)
 * and each colony as a whole, as a soft obstacle:
 *   { c: [x, baseY, z], h, b: [bx, bz] (its base line), la, lc (half extents
 *     along and across it), s (how firmly it holds the air) }
 * A membrane leans toward the water and stands on its base line; its
 * obstacle sits a little toward the lean, as long as the membrane is wide.
 */
export function colonyAirData(colonies, blooms) {
  const obstacles = []
  for (const m of blooms ?? []) {
    const D = [Math.cos(m.lean), Math.sin(m.lean)]
    obstacles.push({
      c: [m.p[0] + D[0] * 0.2 * m.height, m.p[1], m.p[2] + D[1] * 0.2 * m.height],
      h: m.height,
      b: [-D[1], D[0]],
      la: 0.5 * m.width + 0.3,
      lc: 0.3 * m.height + 0.25,
      s: COLONY_AIR.membrane * (m.role === 'anchor' ? 1 : 0.8),
    })
  }
  for (const c of colonies ?? []) {
    obstacles.push({ c: [c.x, c.y, c.z], h: 2.4, b: [1, 0], la: 0.9 * c.radius, lc: 0.9 * c.radius, s: COLONY_AIR.colony })
  }
  return {
    colonies: (colonies ?? []).slice(0, COLONY_AIR.maxColonies).map((c) => [c.x, c.y, c.z, c.radius]),
    obstacles: obstacles.slice(0, COLONY_AIR.maxObstacles),
  }
}

/** The global flow at p: horizontal velocity, the undulation, and the stream function. */
function airWaves(x, y, z, t, controls) {
  const { drift, curl } = controls
  let cx = 0
  let cz = 0
  let up = 0
  let psi = 0
  WAVES.forEach((w, i) => {
    const theta = w[0] * x + w[1] * y + w[2] * z + w[3] + w[4] * t
    const c = Math.cos(theta) * w[5]
    cx += ACROSS[i][0] * c
    cz += ACROSS[i][1] * c
    up += Math.sin(theta + 1.1) * w[5]
    psi -= (w[5] / Math.hypot(w[0], w[2])) * Math.sin(theta)
  })
  const k = curl * 2 * SPEED.curl * CURL_GAIN
  // A slow current, mostly across the default view, turning over many minutes.
  const heading = -0.2 + 0.45 * Math.sin(t * 0.0075) + 0.2 * Math.sin(t * 0.0031 + 1.7)
  const ux = Math.cos(heading) * drift * 2 * SPEED.drift
  const uz = Math.sin(heading) * drift * 2 * SPEED.drift
  return { vx: cx * k + ux, vz: cz * k + uz, up: up * k * VERTICAL, psi: psi * k + ux * z - uz * x }
}

/** How firmly obstacle o holds the air at (x, y, z), before Colony air. */
function obstacleMask(o, x, y, z) {
  const dx = x - o.c[0]
  const dz = z - o.c[2]
  const a = (dx * o.b[0] + dz * o.b[1]) / o.la
  const c = (-dx * o.b[1] + dz * o.b[0]) / o.lc
  const vert = smoothstep(o.c[1] - 0.4, o.c[1] + 0.1, y) * (1 - smoothstep(o.c[1] + 0.75 * o.h, o.c[1] + 1.15 * o.h, y))
  return o.s * Math.exp(-(a * a + c * c)) * vert
}

/**
 * The stream function reshaped by the obstacles, at q: held toward each
 * obstacle's own value (psiJ) by its mask, the masks scaled down together
 * where they overlap so the air is never held more than COLONY_AIR.cap.
 */
function heldPsi(q, t, controls, near, psiJ, strength) {
  const psi = airWaves(q[0], q[1], q[2], t, controls).psi
  let G = 0
  let held = 0
  for (const [j, o] of near) {
    const g = obstacleMask(o, q[0], q[1], q[2]) * strength
    G += g
    held += g * psiJ[j]
  }
  const s = 1 / Math.max(1, G / COLONY_AIR.cap)
  return { Psi: psi * (1 - s * G) + s * held, G: s * G }
}

/**
 * The velocity at p (world space) for a grain that prefers to hover `pref`
 * above the floor; `colonyAir` (optional) is { strength, obstacles } from
 * colonyAirData. Mirrors `AIR_GLSL` exactly.
 */
export function airVelocity(p, pref, t, controls, floor, colonyAir = null) {
  const [x, y, z] = p
  const w = airWaves(x, y, z, t, controls)
  let vx = w.vx
  let vz = w.vz
  let vy = w.up
  let G = 0

  const strength = colonyAir?.strength ?? 0
  if (strength > 0) {
    const near = []
    const psiJ = {}
    colonyAir.obstacles.forEach((o, j) => {
      if (obstacleMask(o, x, y, z) * strength * 2 > 0.002 || obstacleMask({ ...o, la: o.la * 1.6, lc: o.lc * 1.6 }, x, y, z) > 0.002) {
        near.push([j, o])
        psiJ[j] = airWaves(o.c[0], y, o.c[2], t, controls).psi
      }
    })
    if (near.length) {
      const e = 0.05
      const at = (dx, dz) => heldPsi([x + dx, y, z + dz], t, controls, near, psiJ, strength).Psi
      vx = (at(0, e) - at(0, -e)) / (2 * e)
      vz = -(at(e, 0) - at(-e, 0)) / (2 * e)
      G = heldPsi([x, y, z], t, controls, near, psiJ, strength).G
      vy += COLONY_AIR.rise * G
    }
  }

  // Hover: drawn back to its own height, firmly near the ground or water;
  // inside a form the pull eases, so matter can drift up along it.
  const above = y - floor.at(x, z)
  vy += (pref - above) * SPEED.hover * 0.6 * (1 - 0.8 * G)
  if (above < 0.08) vy += (0.08 - above) * 1.5
  return [vx, vy, vz]
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/* --- GLSL ------------------------------------------------------------- */

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${+v.toFixed(5)}`)

/** The waves, unrolled from WAVES: swirl in cu.xz, undulation in cu.y, stream function in psi. */
const curlGLSL = WAVES.map((w, i) => {
  const theta = `${f(w[0])} * p.x + ${f(w[1])} * p.y + ${f(w[2])} * p.z + ${f(w[3])} + ${f(w[4])} * t`
  const toPsi = f(w[5] / Math.hypot(w[0], w[2]))
  return `{ float th = ${theta}; cu.xz += vec2(${f(ACROSS[i][0])}, ${f(ACROSS[i][1])}) * cos(th) * ${f(w[5])}; cu.y += sin(th + 1.1) * ${f(w[5])}; psi -= ${toPsi} * sin(th); }`
}).join('\n    ')

/** GLSL for the floor, the density map and the field, with their uniforms. */
export const AIR_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uDrift;
  uniform float uCurl;
  uniform sampler2D uFloor;
  uniform float uFloorMin;
  uniform float uFloorSpan;
  uniform float uFieldSize;
  uniform float uWaterY;
  // Colonies in the air (phase 3).
  uniform float uColonyAir;
  uniform float uColonyRise; // how much this matter rises inside a form (0..1)
  uniform vec4 uObsA[${COLONY_AIR.maxObstacles}]; // centre x, base y, centre z, height
  uniform vec4 uObsB[${COLONY_AIR.maxObstacles}]; // base line x, z; half extent along, across
  uniform float uObsS[${COLONY_AIR.maxObstacles}]; // how firmly it holds the air
  uniform int uObsCount;
  uniform vec4 uColonies[${COLONY_AIR.maxColonies}]; // x, ground y, z, radius
  uniform int uColonyCount;

  // The ground floor: heights normalised over (uFloorMin, uFloorSpan) in R.
  float airFloor(vec2 xz) {
    if (abs(xz.x) > uFieldSize * 0.5 || abs(xz.y) > uFieldSize * 0.5) return uWaterY;
    vec2 uv = clamp(xz / uFieldSize + 0.5, 0.0, 1.0);
    return uFloorMin + texture2D(uFloor, uv).r * uFloorSpan;
  }

  float airHover(float h) {
    return 0.08 + 2.8 * pow(h, 2.2);
  }

  float airDensity(vec2 xz, float t) {
    float w1 = sin(0.23 * xz.y + 0.002 * t + 1.3) + 0.6 * sin(0.31 * xz.x - 0.0015 * t + 4.0);
    float w2 = sin(0.27 * xz.x + 0.0017 * t + 2.1) + 0.6 * sin(0.19 * xz.y - 0.001 * t + 0.6);
    float a = pow(0.5 + 0.5 * sin(0.55 * xz.x + 0.36 * xz.y + 2.4 * w1), 5.0);
    float b = pow(0.5 + 0.5 * sin(-0.4 * xz.x + 0.62 * xz.y + 2.0 * w2), 5.0);
    float bands = max(a, 0.6 * b);
    float low = 1.0 - smoothstep(${f(DENSITY.low[0])}, ${f(DENSITY.low[1])}, airFloor(xz) - uWaterY);
    float reach = 1.0 - smoothstep(${f(DENSITY.reach[0])}, ${f(DENSITY.reach[1])}, max(abs(xz.x), abs(xz.y)));
    return max(${f(DENSITY.floor)}, reach * (0.05 + 0.95 * bands) * (0.45 + 0.55 * low));
  }

  // The global flow at p: horizontal velocity (xz in .xy), the undulation
  // (.z) and the stream function (.w).
  vec4 airWaves(vec3 p, float t) {
    vec3 cu = vec3(0.0);
    float psi = 0.0;
    ${curlGLSL}
    float k = uCurl * 2.0 * ${f(SPEED.curl)} * ${f(CURL_GAIN)};
    float heading = -0.2 + 0.45 * sin(t * 0.0075) + 0.2 * sin(t * 0.0031 + 1.7);
    vec2 u = vec2(cos(heading), sin(heading)) * uDrift * 2.0 * ${f(SPEED.drift)};
    return vec4(cu.xz * k + u, cu.y * k * ${f(VERTICAL)}, psi * k + u.x * p.z - u.y * p.x);
  }

  // How firmly obstacle i holds the air at q (with Colony air), spread by
  // 'reach' for finding which are near.
  float obstacleMask(int i, vec3 q, float reach) {
    vec4 A = uObsA[i];
    vec4 B = uObsB[i];
    vec2 d = q.xz - A.xz;
    float a = dot(d, B.xy) / (B.z * reach);
    float c = dot(d, vec2(-B.y, B.x)) / (B.w * reach);
    float vert = smoothstep(A.y - 0.4, A.y + 0.1, q.y) * (1.0 - smoothstep(A.y + 0.75 * A.w, A.y + 1.15 * A.w, q.y));
    return uObsS[i] * uColonyAir * exp(-(a * a + c * c)) * vert;
  }

  // Set per particle before airVelocity, to let only some matter rise.
  float airRiseGain = 1.0;

  vec3 airVelocity(vec3 p, float pref) {
    float t = uTime;
    vec4 w = airWaves(p, t);
    vec3 v = vec3(w.x, w.z, w.y);
    float G = 0.0;

    if (uColonyAir > 0.0 && uObsCount > 0) {
      // Which obstacles are near, and the stream function at each centre.
      float psiJ[${COLONY_AIR.maxObstacles}];
      bool near[${COLONY_AIR.maxObstacles}];
      bool any = false;
      for (int j = 0; j < ${COLONY_AIR.maxObstacles}; j++) {
        near[j] = false;
        psiJ[j] = 0.0;
        if (j >= uObsCount) break;
        if (obstacleMask(j, p, 1.6) > 0.002) {
          near[j] = true;
          any = true;
          psiJ[j] = airWaves(vec3(uObsA[j].x, p.y, uObsA[j].z), t).w;
        }
      }
      if (any) {
        // The reshaped stream function at four points round p; the flow is
        // its curl (so it stays divergence-free), and G how firmly p is held.
        float Psi[4];
        float e = 0.05;
        for (int d = 0; d < 5; d++) {
          vec3 q = p + (d == 0 ? vec3(0.0, 0.0, e) : d == 1 ? vec3(0.0, 0.0, -e) : d == 2 ? vec3(e, 0.0, 0.0) : d == 3 ? vec3(-e, 0.0, 0.0) : vec3(0.0));
          float Gq = 0.0;
          float held = 0.0;
          for (int j = 0; j < ${COLONY_AIR.maxObstacles}; j++) {
            if (j >= uObsCount) break;
            if (!near[j]) continue;
            float g = obstacleMask(j, q, 1.0);
            Gq += g;
            held += g * psiJ[j];
          }
          float s = 1.0 / max(1.0, Gq / ${f(COLONY_AIR.cap)});
          if (d < 4) Psi[d] = airWaves(q, t).w * (1.0 - s * Gq) + s * held;
          else G = s * Gq;
        }
        v.x = (Psi[0] - Psi[1]) / (2.0 * e);
        v.z = -(Psi[2] - Psi[3]) / (2.0 * e);
        v.y += ${f(COLONY_AIR.rise)} * G * uColonyRise * airRiseGain;
      }
    }

    float above = p.y - airFloor(p.xz);
    // Inside a form the pull back to its own height eases, fully for matter
    // that rises, so its lift carries it up and over.
    v.y += (pref - above) * ${f(SPEED.hover)} * 0.6 * (1.0 - min(1.0, 2.4 * G * uColonyRise * airRiseGain));
    if (above < 0.08) v.y += (0.08 - above) * 1.5;
    return v;
  }

  // How near a colony p is (0..1): within about its radius and the height of
  // its forms. For colour and residents.
  float colonyNear(vec3 p) {
    float n = 0.0;
    for (int i = 0; i < ${COLONY_AIR.maxColonies}; i++) {
      if (i >= uColonyCount) break;
      vec4 c = uColonies[i];
      float r = length(p.xz - c.xz) / (1.15 * c.w);
      float up = p.y - c.y;
      n = max(n, exp(-r * r) * smoothstep(-0.5, 0.2, up) * (1.0 - smoothstep(2.6, 4.2, up)));
    }
    return n * uColonyAir;
  }

  // A local, intermittent tint near colonies: patches that come and go.
  float colonyTint(vec3 p, float t) {
    float n = colonyNear(p);
    if (n <= 0.001) return 0.0;
    float a = 0.5 + 0.5 * sin(0.9 * p.x + 0.7 * p.z + 0.6 * p.y + 0.05 * t) * sin(0.6 * p.z - 0.8 * p.x - 0.04 * t + 1.7);
    float b = 0.5 + 0.5 * sin(0.021 * t + 0.4 * p.x - 0.3 * p.z);
    return n * smoothstep(0.35, 0.85, a) * smoothstep(0.2, 0.7, b);
  }

  // Its colour there: pale mint, silver-blue, pearl or faint lilac.
  vec3 colonyHue(vec3 p, float t) {
    float h = 0.5 + 0.5 * sin(0.37 * p.x - 0.29 * p.z + 0.5 * p.y + 0.011 * t + 2.3);
    vec3 mint = vec3(0.62, 0.96, 0.84);
    vec3 silverBlue = vec3(0.72, 0.84, 1.0);
    vec3 pearl = vec3(1.0, 0.9, 0.76);
    vec3 lilac = vec3(0.86, 0.76, 1.0);
    // Mint only as a narrow accent (a broad band of it read as teal).
    if (h < 0.15) return mix(mint, silverBlue, h / 0.15);
    if (h < 0.65) return mix(silverBlue, pearl, (h - 0.15) / 0.5);
    return mix(pearl, lilac, (h - 0.65) / 0.35);
  }
`
