/**
 * The base height field.
 *
 * This module owns the whole height pipeline, and every consumer reads from it:
 *
 *     noise stack (layer A + layer B)
 *       -> shaping operation
 *       -> base height field H(u, v) in 0..1
 *       -> 3D terrain vertices / 2D field map / sediment simulation
 *
 * `createField()` is built once per parameter set in `App.jsx` and passed down,
 * so the map, the mesh and the simulation are always looking at the same
 * numbers. The field is pure: identical parameters always give identical H.
 */

import { fbm, makeSimplex2 } from './noise'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * Shaping operations. Each takes the raw 0..1 field and one adaptive amount,
 * and returns a 0..1 field. `slider` describes what that amount means so the
 * UI can relabel a single control per mode.
 */
export const SHAPING_OPS = {
  raw: {
    label: 'Raw',
    note: 'Untouched field. Broad drifting sediment.',
    slider: { label: 'Contrast', min: 0.25, max: 2.5, step: 0.01, default: 1 },
    apply: (n, contrast) => clamp01(0.5 + (n - 0.5) * contrast),
  },

  power: {
    label: 'Power',
    note: 'Pushes the field down into broad basins.',
    slider: { label: 'Exponent', min: 0.35, max: 3.5, step: 0.01, default: 1.7 },
    apply: (n, exponent) => clamp01(Math.pow(n, exponent)),
  },

  ridge: {
    label: 'Ridge',
    note: 'Folds the field at its midline into low banks.',
    slider: { label: 'Sharpness', min: 0.4, max: 4, step: 0.01, default: 1.4 },
    apply: (n, sharpness) => clamp01(Math.pow(1 - Math.abs(n * 2 - 1), sharpness)),
  },

  terrace: {
    label: 'Terrace',
    note: 'Quantises elevation into deposited layers.',
    slider: { label: 'Layers', min: 2, max: 24, step: 1, default: 5 },
    apply: (n, layers) => {
      const q = n * layers
      const step = Math.floor(q)
      // Flat treads with soft risers between them.
      const riser = smoothstep(0.2, 0.8, q - step)
      return clamp01((step + riser) / layers)
    },
  },

  fill: {
    label: 'Fill',
    note: 'Floods everything under the level into flat tidal pan.',
    slider: { label: 'Fill level', min: 0, max: 0.9, step: 0.005, default: 0.32 },
    apply: (n, level) => {
      // Soft max(n, level): a plateau with a gently blended shoreline.
      const d = n - level
      return clamp01(level + 0.5 * (d + Math.sqrt(d * d + 0.004)))
    },
  },
}

export const SHAPING_KEYS = Object.keys(SHAPING_OPS)

/**
 * Build a sampler for the current parameters.
 *
 * sample(u, v) takes normalised field coordinates in 0..1 and returns the
 * shaped height in 0..1.
 */
export function createField({
  seed,
  landformScale,
  detailScale,
  detailAmount,
  shaping,
  shapingAmount,
}) {
  const landformNoise = makeSimplex2(seed)
  const detailNoise = makeSimplex2(seed + 977)
  const op = SHAPING_OPS[shaping] ?? SHAPING_OPS.raw

  // Layer B never fully takes over layer A; it stays a modifier on the landform.
  const blend = detailAmount * 0.45

  function sample(u, v) {
    const a = fbm(landformNoise, u * landformScale, v * landformScale, 4) * 0.5 + 0.5
    const b = fbm(detailNoise, u * detailScale, v * detailScale, 4) * 0.5 + 0.5
    const raw = a * (1 - blend) + b * blend
    return op.apply(clamp01(raw), shapingAmount)
  }

  return { sample, op }
}

/**
 * Relief: a conservative revision layered on top of the base field, so every
 * study keeps reading one base. It changes how the existing landform stands,
 * not where it is: the shoreline does not move, and neither does the
 * silhouette.
 *
 * The added height is computed from a *smoothed* copy of the base — a coarse
 * blurred grid read back with a smooth (Catmull-Rom) interpolation — and
 * then added to the original. So the new relief is broad and gentle, and the
 * original detail rides on top of it unchanged. Shaping the original height
 * directly multiplied its small-scale roughness and turned shoulders into
 * cliffs (land slopes up to 63° against a base maximum of 41°).
 *
 *   lift       land stands higher, more so on some plateaus than others
 *              (hierarchy), so they read at different levels
 *   shoulder   a soft rounded rise just inland of the shore, so an edge
 *              reads as thickness rather than as a cloth's hem
 *   swell      a gentle pillowing on plateau tops, low frequency only
 *   deepen     basins sit a little deeper, with a soft step down just off
 *              the shore, so the land rises from a shelf
 */
export const RELIEF = {
  lift: [0.25, 0.7],
  shoulder: 0.07,
  softness: 0.06,
  hierarchy: 1.2,
  swell: 0.02,
  deepen: 0.16,
  shelf: 0.014,
  /** Coarse grid the smooth copy is taken on, and its blur radius. */
  grid: 48,
  blur: 2,
}

export function withRelief(field, { waterLevel, seed, amount = 1 }) {
  const levels = makeSimplex2(seed + 4241)
  const pillows = makeSimplex2(seed + 5179)
  const R = RELIEF
  const smooth = smoothCopy(field, R.grid, R.blur)

  function sample(u, v) {
    const h = field.sample(u, v)
    const d = h - waterLevel
    const ds = smooth(u, v) - waterLevel
    let add = 0
    if (d > 0) {
      // 0..1, slowly across the field: which plateaus stand higher.
      const level = clamp01(fbm(levels, u * R.hierarchy, v * R.hierarchy, 2) * 0.7 + 0.5)
      const land = Math.max(0, ds)
      add =
        land * (R.lift[0] + (R.lift[1] - R.lift[0]) * level) +
        R.shoulder * (0.6 + 0.8 * level) * (1 - Math.exp(-land / R.softness)) +
        R.swell * smoothstep(0, 0.12, land) * (fbm(pillows, u * 3, v * 3, 2) * 0.5 + 0.5)
      // Nothing is added at the water line itself, so the shore stays put,
      // and the more is added, the further inland it takes to arrive: at a
      // pond's rim a fixed narrow ramp built a wall.
      add *= smoothstep(0, Math.max(0.05, add * 3), d)
    } else {
      const water = Math.max(0, -ds)
      add = -(water * R.deepen + R.shelf * smoothstep(0, 0.08, water))
      add *= smoothstep(0, Math.max(0.05, -add * 3), -d)
    }
    return h + add * amount
  }

  return { sample, op: field.op, relief: amount }
}

/**
 * A smooth, low-detail copy of a field: sampled on a coarse grid, blurred,
 * and read back with Catmull-Rom interpolation so it has no creases.
 */
function smoothCopy(field, n, radius) {
  const size = n + 1
  let grid = new Float32Array(size * size)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) grid[j * size + i] = field.sample(i / n, j / n)
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(grid.length)
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let sum = 0
        let count = 0
        for (let dj = -radius; dj <= radius; dj++) {
          for (let di = -radius; di <= radius; di++) {
            const x = Math.max(0, Math.min(n, i + di))
            const y = Math.max(0, Math.min(n, j + dj))
            sum += grid[y * size + x]
            count++
          }
        }
        next[j * size + i] = sum / count
      }
    }
    grid = next
  }
  const at = (i, j) => grid[Math.max(0, Math.min(n, j)) * size + Math.max(0, Math.min(n, i))]
  const cr = (p0, p1, p2, p3, t) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  return (u, v) => {
    const x = clamp01(u) * n
    const y = clamp01(v) * n
    const i = Math.min(n - 1, Math.floor(x))
    const j = Math.min(n - 1, Math.floor(y))
    const tx = x - i
    const ty = y - j
    const row = (jj) => cr(at(i - 1, jj), at(i, jj), at(i + 1, jj), at(i + 2, jj), tx)
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), ty)
  }
}

/**
 * Sample the field into a row-major grid of (res + 1)^2 values, with u varying
 * fastest. Used for terrain vertices and the 2D map, where samples sit on the
 * grid lines.
 */
export function buildHeightGrid(field, res) {
  const size = res + 1
  const grid = new Float32Array(size * size)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      grid[j * size + i] = field.sample(i / res, j / res)
    }
  }
  return grid
}

/**
 * Sample the field at cell centres into a res^2 grid. Used by the simulation,
 * which works on cells rather than on grid lines.
 */
export function buildCellGrid(field, res) {
  const grid = new Float32Array(res * res)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      grid[j * res + i] = field.sample((i + 0.5) / res, (j + 0.5) / res)
    }
  }
  return grid
}
