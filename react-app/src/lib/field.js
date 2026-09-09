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
