/**
 * Air: the scene's resident particles and the field that moves them
 * (assignment 3).
 *
 * One velocity field for the whole habitat, at three scales:
 *
 *   global    a slow drift, its heading turning over many minutes, and gentle
 *             curl: a stream function in every horizontal layer, so it swirls
 *             without piling matter up. Both are scaled by a slowly moving
 *             activity map: quiet zones where the air almost stills (and
 *             matter collects), active ones where it runs.
 *   terrain   near the ground the air slides downhill, as cold air does at
 *             night: it gathers in hollows into streams, and over the basins,
 *             where the floor is flat water, it pools and stills. Every
 *             particle also keeps its own height over the floor.
 *   colonies  a colony slows the air around it, draws it in, turns it about
 *             itself, and lifts it through a slow convection cell: rising
 *             through the colony, spilling outward above it, sinking around
 *             it and drawn back in low.
 *
 * The residents read the same field differently (RESIDENTS): wisps run with
 * it, flakes and haze lag, motes are held hardest by the colonies.
 *
 * The field exists in JS (for tests and the plan diagrams) and in GLSL (for
 * the particles); the GLSL is generated from the same tables.
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The volume the air lives in: wider than the field, so edges sit in fog. */
export const AIR = {
  halfWidth: 17,
  top: 6.5,
  maxColonies: 6,
}

/**
 * The residents, in the order their shares are laid out over 0..1.
 *   flow   how fully it is carried by the global and terrain field
 *   hold   how strongly the colonies hold it
 */
export const RESIDENTS = [
  { name: 'haze', share: 0.035, flow: 0.5, hold: 0.7 },
  { name: 'flake', share: 0.005, flow: 0.7, hold: 1.0 },
  { name: 'mote', share: 0.06, flow: 0.8, hold: 1.6 },
  { name: 'wisp', share: 0.1, flow: 1.3, hold: 0.5 },
  { name: 'dust', share: 0.8, flow: 1.0, hold: 1.0 },
]
export const KIND = Object.fromEntries(RESIDENTS.map((r, i) => [r.name.toUpperCase(), i]))

/** Upper edge of each resident's share of 0..1. */
export const KIND_EDGES = RESIDENTS.reduce((edges, r) => [...edges, (edges.at(-1) ?? 0) + r.share], [])

/** A particle's resident, from its own random 0..1. */
export const kindOf = (b) => {
  const i = KIND_EDGES.findIndex((e) => b < e)
  return i < 0 ? KIND.DUST : i
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
 * The activity map: three broad waves [kx, kz, speed, phase, amp], 25–50
 * units long. It moves far slower than the air, so matter carried into a
 * quiet zone has time to collect there.
 */
const ACTIVITY = [
  [0.11, 0.07, 0.003, 1.3, 1.0],
  [-0.08, 0.13, -0.0025, 4.1, 1.0],
  [0.19, -0.15, 0.004, 2.2, 0.6],
]
/** Activity runs from QUIET (the stillest pockets) to 1. */
const QUIET = 0.15

/** The weak vertical undulation, relative to the horizontal swirl. */
const VERTICAL = 0.22

/**
 * Per wave: the direction it moves the air (across its own wave vector, in
 * the horizontal plane), so each wave contributes its amplitude in speed.
 */
const ACROSS = WAVES.map(([kx, , kz]) => {
  const k = Math.hypot(kx, kz)
  return [-kz / k, kx / k]
})

/** Typical speeds, world units per second, at the controls' default. */
const SPEED = { drift: 0.12, curl: 0.17, hover: 0.05 }

/** Scales the waves' summed amplitude to SPEED.curl. */
const CURL_GAIN = 0.7

/**
 * Downhill air: speed per unit of slope, the depth of the layer that slides
 * (falling off over this height above the floor), and the step the slope is
 * read over.
 */
const DRAIN = { speed: 0.3, depth: 0.9, step: 0.6 }

/**
 * Over the basins (water within the land's reach, not the open water beyond),
 * near the surface, the air stills by up to this much.
 */
const POOL = 0.6
const POOL_REACH = 11

/**
 * Colonies: how much they slow the air at most, how fast they draw it in and
 * turn it, and the strength of the convection cell.
 */
const HOLD = 0.85
const PULL = 0.06
const SWIRL = 0.045
const CELL = 0.06

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

/** A resident's preferred height above the floor, from its own random 0..1. */
export function hoverHeight(kind, h) {
  if (kind === KIND.HAZE) return 0.35 + 1.4 * h
  if (kind === KIND.FLAKE) return 0.5 + 2.6 * h
  if (kind === KIND.MOTE) return 0.3 + 1.9 * h
  if (kind === KIND.WISP) return 0.12 + 1.3 * Math.pow(h, 1.5)
  return 0.12 + 3.8 * Math.pow(h, 2.6)
}

/** Quiet (QUIET) to active (1): where the global air runs or stills. */
export function activity(x, z, t) {
  let n = 0
  for (const [kx, kz, s, ph, a] of ACTIVITY) n += Math.sin(kx * x + kz * z + s * t + ph) * a
  return QUIET + (1 - QUIET) * smoothstep(-1.1, 1.0, n)
}

/**
 * The velocity at p (world space) for a resident that prefers to hover
 * `pref` above the floor. `colonies` are [x, y, z, radius]. Returns
 * [vx, vy, vz, held]. Mirrors `AIR_GLSL` exactly.
 */
export function airVelocity(p, pref, t, controls, colonies, floor, resident = RESIDENTS[KIND.DUST]) {
  const [x, y, z] = p
  const { drift, curl, colony } = controls

  // Global: curl of the stream function, plus a turning drift.
  let cx = 0
  let cz = 0
  let up = 0
  WAVES.forEach((w, i) => {
    const theta = w[0] * x + w[1] * y + w[2] * z + w[3] + w[4] * t
    const c = Math.cos(theta) * w[5]
    cx += ACROSS[i][0] * c
    cz += ACROSS[i][1] * c
    up += Math.sin(theta + 1.1) * w[5]
  })
  const k = curl * 2 * SPEED.curl * CURL_GAIN
  // Mostly across the default view (along x), turning ±0.65 rad over many minutes.
  const heading = -0.2 + 0.45 * Math.sin(t * 0.0075) + 0.2 * Math.sin(t * 0.0031 + 1.7)
  let gx = cx * k + Math.cos(heading) * drift * 2 * SPEED.drift
  let gy = up * k * VERTICAL
  let gz = cz * k + Math.sin(heading) * drift * 2 * SPEED.drift

  // Quiet zones, and pools over the water.
  const f = floor.at(x, z)
  const above = y - f
  const basin = (1 - smoothstep(0.0, 0.3, f - floor.waterY)) * (1 - smoothstep(POOL_REACH - 2, POOL_REACH, Math.max(Math.abs(x), Math.abs(z))))
  const still = activity(x, z, t) * (1 - POOL * basin * Math.exp(-above / 1.5))
  gx *= still
  gy *= still
  gz *= still

  // Downhill air near the ground.
  const e = DRAIN.step
  const sx = (floor.at(x + e, z) - floor.at(x - e, z)) / (2 * e)
  const sz = (floor.at(x, z + e) - floor.at(x, z - e)) / (2 * e)
  const low = Math.exp(-Math.max(above, 0) / DRAIN.depth) * drift * 2 * DRAIN.speed
  gx -= sx * low
  gz -= sz * low

  // Colonies.
  let held = 0
  let lx = 0
  let ly = 0
  let lz = 0
  colonies.forEach((c, i) => {
    const dx = x - c[0]
    const dz = z - c[2]
    const r = Math.hypot(dx, dz)
    const R = c[3] * 1.7
    const ringY = c[1] + 0.9
    const fall = Math.exp(-((r / R) ** 2)) * Math.exp(-(((y - ringY) / 1.8) ** 2))
    const s = colony * resident.hold * fall
    held = Math.max(held, Math.min(1, s))
    const inv = 1 / Math.max(r, 1e-3)
    const pull = PULL * s * smoothstep(0.35 * R, 0.9 * R, r)
    const turn = (i % 2 ? -1 : 1) * SWIRL * s
    lx += -dx * inv * pull - dz * inv * turn
    lz += -dz * inv * pull + dx * inv * turn
    // The convection cell: an axisymmetric stream function r²·g(r)·h(y),
    // so it circulates without piling matter up.
    const Rc = c[3] * 1.1
    const yc = c[1] + 1.0
    const Hc = 1.2
    const g = Math.exp(-((r / Rc) ** 2))
    const h = Math.exp(-(((y - yc) / Hc) ** 2))
    const A = CELL * colony * resident.hold
    ly += A * h * g * (2 - (2 * r * r) / (Rc * Rc))
    const out = (A * g * h * 2 * (y - yc)) / (Hc * Hc)
    lx += dx * out
    lz += dz * out
  })

  // Hover: drawn back to its own height, firmly near the ground or water.
  let hy = (pref - above) * SPEED.hover * 0.6
  if (above < 0.12) hy += (0.12 - above) * 1.5

  const keep = (1 - HOLD * held) * resident.flow
  return [gx * keep + lx, gy * keep + ly + hy * (1 - 0.7 * held), gz * keep + lz, held]
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/* --- GLSL ------------------------------------------------------------- */

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${+v.toFixed(5)}`)

/** The waves, unrolled from WAVES: swirl in cu.xz, undulation in cu.y. */
const curlGLSL = WAVES.map((w, i) => {
  const theta = `${f(w[0])} * p.x + ${f(w[1])} * p.y + ${f(w[2])} * p.z + ${f(w[3])} + ${f(w[4])} * t`
  return `{ float th = ${theta}; cu.xz += vec2(${f(ACROSS[i][0])}, ${f(ACROSS[i][1])}) * cos(th) * ${f(w[5])}; cu.y += sin(th + 1.1) * ${f(w[5])}; }`
}).join('\n    ')

const activityGLSL = ACTIVITY.map(
  ([kx, kz, s, ph, a]) => `n += sin(${f(kx)} * xz.x + ${f(kz)} * xz.y + ${f(s)} * t + ${f(ph)}) * ${f(a)};`,
).join('\n    ')

/**
 * The floor in GLSL: a texture of heights normalised over (uFloorMin,
 * uFloorSpan) in R.
 */
const FLOOR_GLSL = /* glsl */ `
  uniform sampler2D uFloor;
  uniform float uFloorMin;
  uniform float uFloorSpan;
  uniform float uFieldSize;
  uniform float uWaterY;

  float airFloor(vec2 xz) {
    if (abs(xz.x) > uFieldSize * 0.5 || abs(xz.y) > uFieldSize * 0.5) return uWaterY;
    vec2 uv = clamp(xz / uFieldSize + 0.5, 0.0, 1.0);
    return uFloorMin + texture2D(uFloor, uv).r * uFloorSpan;
  }
`

/** Per resident: kind from its random, its hover height, flow and hold. */
const RESIDENT_GLSL = /* glsl */ `
  int airKind(float b) {
    ${KIND_EDGES.slice(0, -1)
      .map((e, i) => `if (b < ${f(e)}) return ${i};`)
      .join('\n    ')}
    return ${KIND.DUST};
  }
  float airHover(int kind, float h) {
    if (kind == ${KIND.HAZE}) return 0.35 + 1.4 * h;
    if (kind == ${KIND.FLAKE}) return 0.5 + 2.6 * h;
    if (kind == ${KIND.MOTE}) return 0.3 + 1.9 * h;
    if (kind == ${KIND.WISP}) return 0.12 + 1.3 * pow(h, 1.5);
    return 0.12 + 3.8 * pow(h, 2.6);
  }
  float airFlow(int kind) {
    ${RESIDENTS.map((r, i) => `if (kind == ${i}) return ${f(r.flow)};`).join('\n    ')}
    return 1.0;
  }
  float airHoldGain(int kind) {
    ${RESIDENTS.map((r, i) => `if (kind == ${i}) return ${f(r.hold)};`).join('\n    ')}
    return 1.0;
  }
`

/** GLSL for the same field, with the uniforms it reads. */
export const AIR_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uDrift;
  uniform float uCurl;
  uniform float uColony;
  uniform vec4 uColonies[${AIR.maxColonies}];
  uniform int uColonyCount;
  ${FLOOR_GLSL}
  ${RESIDENT_GLSL}

  float airActivity(vec2 xz, float t) {
    float n = 0.0;
    ${activityGLSL}
    return ${f(QUIET)} + ${f(1 - QUIET)} * smoothstep(-1.1, 1.0, n);
  }

  // Velocity in xyz; how much the colonies hold this point in w.
  vec4 airVelocity(vec3 p, float pref, float flow, float holdGain) {
    float t = uTime;
    vec3 cu = vec3(0.0);
    ${curlGLSL}
    float k = uCurl * 2.0 * ${f(SPEED.curl)} * ${f(CURL_GAIN)};
    float heading = -0.2 + 0.45 * sin(t * 0.0075) + 0.2 * sin(t * 0.0031 + 1.7);
    vec3 g = vec3(cu.x * k, cu.y * k * ${f(VERTICAL)}, cu.z * k);
    g.xz += vec2(cos(heading), sin(heading)) * uDrift * 2.0 * ${f(SPEED.drift)};

    float fl = airFloor(p.xz);
    float above = p.y - fl;
    float basin = (1.0 - smoothstep(0.0, 0.3, fl - uWaterY)) * (1.0 - smoothstep(${f(POOL_REACH - 2)}, ${f(POOL_REACH)}, max(abs(p.x), abs(p.z))));
    g *= airActivity(p.xz, t) * (1.0 - ${f(POOL)} * basin * exp(-above / 1.5));

    float e = ${f(DRAIN.step)};
    vec2 slope = vec2(
      airFloor(p.xz + vec2(e, 0.0)) - airFloor(p.xz - vec2(e, 0.0)),
      airFloor(p.xz + vec2(0.0, e)) - airFloor(p.xz - vec2(0.0, e))
    ) / (2.0 * e);
    g.xz -= slope * exp(-max(above, 0.0) / ${f(DRAIN.depth)}) * uDrift * 2.0 * ${f(DRAIN.speed)};

    float held = 0.0;
    vec3 l = vec3(0.0);
    for (int i = 0; i < ${AIR.maxColonies}; i++) {
      if (i >= uColonyCount) break;
      vec4 c = uColonies[i];
      vec2 d = p.xz - c.xz;
      float r = length(d);
      float R = c.w * 1.7;
      float ringY = c.y + 0.9;
      float fall = exp(-(r / R) * (r / R)) * exp(-((p.y - ringY) / 1.8) * ((p.y - ringY) / 1.8));
      float s = uColony * holdGain * fall;
      held = max(held, min(1.0, s));
      vec2 dir = d / max(r, 1e-3);
      float pull = ${f(PULL)} * s * smoothstep(0.35 * R, 0.9 * R, r);
      float turn = (mod(float(i), 2.0) < 0.5 ? 1.0 : -1.0) * ${f(SWIRL)} * s;
      l.xz += -dir * pull + vec2(-dir.y, dir.x) * turn;
      float Rc = c.w * 1.1;
      float yc = c.y + 1.0;
      float Hc = 1.2;
      float gr = exp(-(r / Rc) * (r / Rc));
      float h = exp(-((p.y - yc) / Hc) * ((p.y - yc) / Hc));
      float A = ${f(CELL)} * uColony * holdGain;
      l.y += A * h * gr * (2.0 - 2.0 * r * r / (Rc * Rc));
      l.xz += d * (A * gr * h * 2.0 * (p.y - yc) / (Hc * Hc));
    }

    float hy = (pref - above) * ${f(SPEED.hover)} * 0.6;
    if (above < 0.12) hy += (0.12 - above) * 1.5;

    float keep = (1.0 - ${f(HOLD)} * held) * flow;
    vec3 v = g * keep + l;
    v.y += hy * (1.0 - 0.7 * held);
    return vec4(v, held);
  }
`
