/**
 * World data: every value a scatter rule is allowed to read.
 *
 * The scatter system never touches the height field, the simulation or the
 * mesh directly. It asks this object for named channels at a point:
 *
 *     sample(u, v)  -> { height, depth, shore, slope, hollow, trace, flow,
 *                        colony, downX, downZ }
 *     surface(u, v) -> world position on the ground and its normal
 *
 * That boundary is what keeps the scatter general. Anything that can answer
 * those two questions — a height field today, a meshed volume surface later —
 * can be populated by the same rules.
 *
 * Two channels are a record rather than a landform. `trace` and `flow` come
 * from a *history*: the sediment simulation run headless, deterministically,
 * for a number of seconds on this landform with the Field view's own sediment
 * settings. The live simulation is not touched, so the scatter is a pure
 * function of its inputs and a saved configuration always reproduces it.
 */

import { buildCellGrid } from './field'
import { fbm, makeSimplex2 } from './noise'
import { SED_DISPLAY, SedimentSim } from './sediment'

/**
 * History runs on a coarser clock than the live view. Measured on the default
 * landform, dt 0.1 gives the same sediment distribution as dt 1/30 at every
 * percentile to within a few hundredths, for a third of the cost: 40 s of
 * history is about 100 ms.
 */
const HISTORY_STEP = 0.1

/** Flow is averaged over this last fraction of the history, not one frame. */
const FLOW_WINDOW = 0.3

/** Colony field frequency, per world unit — about three zones across. */
const COLONY_SCALE = 0.11

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Run the sediment simulation headless and return what it left.
 *
 * @returns {{ sim: SedimentSim, flow: Float32Array }} the sim holds sediment
 *   and activity exactly as the terrain shader expects to read them.
 */
export function runHistory(field, simParams, waterLevel, seconds) {
  const sim = new SedimentSim()
  sim.setHeight(buildCellGrid(field, sim.res))

  const n = sim.res * sim.res
  const flowSum = new Float32Array(n)
  const steps = Math.round(seconds / HISTORY_STEP)
  const averageFrom = Math.floor(steps * (1 - FLOW_WINDOW))
  let samples = 0

  const stepParams = { ...simParams, waterLevel }
  for (let k = 0; k < steps; k++) {
    sim.step(HISTORY_STEP, stepParams)
    if (k >= averageFrom) {
      const { activity } = sim
      for (let i = 0; i < n; i++) flowSum[i] += activity[i]
      samples++
    }
  }

  // Normalised against its own 98th percentile. The raw average is well
  // below the instantaneous activity, and how far below depends on the
  // sediment settings, so a fixed threshold would mean something different
  // every time; ranked, "flow above 0.4" always picks out the live channels.
  const flow = new Float32Array(n)
  if (samples > 0) {
    for (let i = 0; i < n; i++) flow[i] = flowSum[i] / samples
    const reference = Math.max(1e-4, percentile(flow, 0.98))
    for (let i = 0; i < n; i++) flow[i] = clamp01(flow[i] / reference)
  }

  return { sim, flow }
}

/**
 * Build the world data for one landform, one water level and one history.
 *
 * @param field       the shared height field sampler
 * @param size        world width of the (square) field
 * @param elevation   vertical amplitude of the displacement
 * @param waterLevel  the tidal plane, in field units
 * @param history     the result of runHistory()
 * @param seed        colony field seed
 */
export function buildWorldData({ field, size, elevation, waterLevel, history, seed }) {
  const { sim, flow } = history
  const res = sim.res
  const n = res * res
  const cell = size / res
  const H = sim.height
  const S = sim.sediment

  // Displayed ground, exactly as the terrain draws it: base height centred on
  // the origin, lifted by the sediment the texture can carry.
  const lift = (s) => Math.min(s, SED_DISPLAY) * elevation
  const ground = new Float32Array(n)
  for (let i = 0; i < n; i++) ground[i] = (H[i] - 0.5) * elevation + lift(S[i])
  const waterY = (waterLevel - 0.5) * elevation

  const trace = new Float32Array(n)
  const depth = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    trace[i] = clamp01(S[i] / SED_DISPLAY)
    depth[i] = ground[i] - waterY
  }

  // Slope and downhill direction from central differences on the ground.
  const slope = new Float32Array(n)
  const downX = new Float32Array(n)
  const downZ = new Float32Array(n)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const c = j * res + i
      const l = ground[j * res + Math.max(0, i - 1)]
      const r = ground[j * res + Math.min(res - 1, i + 1)]
      const d = ground[Math.max(0, j - 1) * res + i]
      const u = ground[Math.min(res - 1, j + 1) * res + i]
      const gx = (r - l) / (2 * cell)
      const gz = (u - d) / (2 * cell)
      const g = Math.hypot(gx, gz)
      slope[c] = (Math.atan(g) * 180) / Math.PI
      downX[c] = g > 1e-6 ? -gx / g : 0
      downZ[c] = g > 1e-6 ? -gz / g : 0
    }
  }

  // Signed distance to the waterline. A cell is wet when the displayed ground
  // sits below the plane, which is what the eye sees as shore.
  const wet = new Uint8Array(n)
  const dry = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    wet[i] = depth[i] < 0 ? 1 : 0
    dry[i] = 1 - wet[i]
  }
  const toWater = chamfer(wet, res)
  const toLand = chamfer(dry, res)
  const shore = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    shore[i] = wet[i]
      ? -Math.max(0, toLand[i] - 0.5) * cell
      : Math.max(0, toWater[i] - 0.5) * cell
  }

  // Broad curvature: Laplacian of a blurred ground, ranked by its own spread.
  // Absolute curvature changes by an order of magnitude between landforms;
  // ranked, "hollow above 0.6" means the same kind of place on any of them.
  const blurred = boxBlur(boxBlur(ground, res, 2), res, 2)
  const lap = new Float32Array(n)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const c = j * res + i
      const l = blurred[j * res + Math.max(0, i - 1)]
      const r = blurred[j * res + Math.min(res - 1, i + 1)]
      const d = blurred[Math.max(0, j - 1) * res + i]
      const u = blurred[Math.min(res - 1, j + 1) * res + i]
      lap[c] = (l + r + d + u - 4 * blurred[c]) / (cell * cell)
    }
  }
  const lapScale = Math.max(1e-5, percentile(lap.map(Math.abs), 0.9))
  const hollow = new Float32Array(n)
  for (let i = 0; i < n; i++) hollow[i] = clamp01(0.5 + 0.5 * (lap[i] / lapScale))

  // Colony field: slow noise in world units, rank-normalised so that a Quiet
  // of 0.4 leaves exactly 40% of the world below the colony threshold.
  const colonyNoise = makeSimplex2(seed + 3131)
  const raw = new Float32Array(n)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * size
      const z = ((j + 0.5) / res - 0.5) * size
      raw[j * res + i] = fbm(colonyNoise, x * COLONY_SCALE, z * COLONY_SCALE, 3, 2, 0.45)
    }
  }
  const colony = rank(raw)

  const channels = { trace, flow, shore, slope, hollow, colony, depth, downX, downZ }

  /** Bilinear read of every channel at field coordinates (u, v) in 0..1. */
  function sample(u, v, out = {}) {
    const x = clamp01(u) * res - 0.5
    const y = clamp01(v) * res - 0.5
    const i0 = Math.max(0, Math.min(res - 1, Math.floor(x)))
    const j0 = Math.max(0, Math.min(res - 1, Math.floor(y)))
    const i1 = Math.min(res - 1, i0 + 1)
    const j1 = Math.min(res - 1, j0 + 1)
    const fx = clamp01(x - i0)
    const fy = clamp01(y - j0)
    const a = j0 * res + i0
    const b = j0 * res + i1
    const c = j1 * res + i0
    const d = j1 * res + i1
    const w00 = (1 - fx) * (1 - fy)
    const w10 = fx * (1 - fy)
    const w01 = (1 - fx) * fy
    const w11 = fx * fy
    for (const key in channels) {
      const g = channels[key]
      out[key] = g[a] * w00 + g[b] * w10 + g[c] * w01 + g[d] * w11
    }
    // Direction is renormalised after blending so it stays a unit vector.
    const len = Math.hypot(out.downX, out.downZ)
    if (len > 1e-6) {
      out.downX /= len
      out.downZ /= len
    }
    return out
  }

  /** Displayed sediment lift at (u, v), bilinear like the terrain texture. */
  function sedimentLift(u, v) {
    const x = clamp01(u) * res - 0.5
    const y = clamp01(v) * res - 0.5
    const i0 = Math.max(0, Math.min(res - 1, Math.floor(x)))
    const j0 = Math.max(0, Math.min(res - 1, Math.floor(y)))
    const i1 = Math.min(res - 1, i0 + 1)
    const j1 = Math.min(res - 1, j0 + 1)
    const fx = clamp01(x - i0)
    const fy = clamp01(y - j0)
    const s =
      lift(S[j0 * res + i0]) * (1 - fx) * (1 - fy) +
      lift(S[j0 * res + i1]) * fx * (1 - fy) +
      lift(S[j1 * res + i0]) * (1 - fx) * fy +
      lift(S[j1 * res + i1]) * fx * fy
    return s
  }

  /**
   * Ground height at (u, v). The base comes straight from the field sampler
   * rather than from the 128-cell grid, so forms sit on the rendered surface
   * rather than on a coarser copy of it.
   */
  function groundY(u, v) {
    return (field.sample(clamp01(u), clamp01(v)) - 0.5) * elevation + sedimentLift(u, v)
  }

  /** World position and normal of the ground at (u, v). */
  function surface(u, v) {
    const e = 0.5 / res
    const y = groundY(u, v)
    const dx = (groundY(u + e, v) - groundY(u - e, v)) / (2 * e * size)
    const dz = (groundY(u, v + e) - groundY(u, v - e)) / (2 * e * size)
    const len = Math.hypot(dx, 1, dz)
    return {
      x: (u - 0.5) * size,
      y,
      z: (v - 0.5) * size,
      nx: -dx / len,
      ny: 1 / len,
      nz: -dz / len,
    }
  }

  return {
    res,
    size,
    elevation,
    waterLevel,
    waterY,
    channels,
    sample,
    surface,
    groundY,
    /** World x/z to field u/v. */
    toUV: (x, z) => [x / size + 0.5, z / size + 0.5],
  }
}

/**
 * Two-pass chamfer distance transform: for every cell, the distance in cells
 * to the nearest cell where `mask` is set. Within about 8% of Euclidean, which
 * is plenty for "how far from the water".
 */
function chamfer(mask, res) {
  const INF = 1e9
  const D = Math.SQRT2
  const d = new Float32Array(res * res)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const c = j * res + i
      let v = d[c]
      if (i > 0) v = Math.min(v, d[c - 1] + 1)
      if (j > 0) {
        v = Math.min(v, d[c - res] + 1)
        if (i > 0) v = Math.min(v, d[c - res - 1] + D)
        if (i < res - 1) v = Math.min(v, d[c - res + 1] + D)
      }
      d[c] = v
    }
  }
  for (let j = res - 1; j >= 0; j--) {
    for (let i = res - 1; i >= 0; i--) {
      const c = j * res + i
      let v = d[c]
      if (i < res - 1) v = Math.min(v, d[c + 1] + 1)
      if (j < res - 1) {
        v = Math.min(v, d[c + res] + 1)
        if (i < res - 1) v = Math.min(v, d[c + res + 1] + D)
        if (i > 0) v = Math.min(v, d[c + res - 1] + D)
      }
      d[c] = v
    }
  }
  return d
}

/** Separable box blur, clamped at the edges. */
function boxBlur(src, res, radius) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const span = radius * 2 + 1
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let s = 0
      for (let k = -radius; k <= radius; k++) {
        s += src[j * res + Math.max(0, Math.min(res - 1, i + k))]
      }
      tmp[j * res + i] = s / span
    }
  }
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let s = 0
      for (let k = -radius; k <= radius; k++) {
        s += tmp[Math.max(0, Math.min(res - 1, j + k)) * res + i]
      }
      out[j * res + i] = s / span
    }
  }
  return out
}

function percentile(values, q) {
  const sorted = Float32Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

/** Replace each value with its rank, 0..1 — an empirical CDF. */
function rank(values) {
  const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b])
  const out = new Float32Array(values.length)
  const last = Math.max(1, values.length - 1)
  for (let k = 0; k < order.length; k++) out[order[k]] = k / last
  return out
}
