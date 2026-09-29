/**
 * Seeded simplex noise + fBm, in 2D for the height field and 3D for the
 * density volume.
 *
 * Written inline rather than pulled from a library so the sampling maths stays
 * visible: the 2D field map and the 3D terrain call the exact same function.
 */

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

/** Small deterministic PRNG (mulberry32) so a seed number is reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Build a shuffled permutation table for one seed. */
function buildPermutation(seed) {
  const random = mulberry32(seed)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = p[i]
    p[i] = p[j]
    p[j] = tmp
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  return perm
}

/**
 * Returns a simplex2(x, y) function in roughly [-1, 1] for the given seed.
 * Seeds are cached because the permutation build is the expensive part.
 */
const noiseCache = new Map()

export function makeSimplex2(seed) {
  const key = seed | 0
  const cached = noiseCache.get(key)
  if (cached) return cached

  const perm = buildPermutation(key)

  function simplex2(xin, yin) {
    // Skew the input space to determine which simplex cell we are in.
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2

    const x0 = xin - (i - t)
    const y0 = yin - (j - t)

    // Which of the two triangles of the cell are we in?
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1

    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2

    const ii = i & 255
    const jj = j & 255

    let n = 0
    const corners = [
      [x0, y0, perm[ii + perm[jj]] & 7],
      [x1, y1, perm[ii + i1 + perm[jj + j1]] & 7],
      [x2, y2, perm[ii + 1 + perm[jj + 1]] & 7],
    ]

    for (let c = 0; c < 3; c++) {
      const [x, y, gi] = corners[c]
      let tt = 0.5 - x * x - y * y
      if (tt <= 0) continue
      tt *= tt
      const g = GRAD[gi]
      n += tt * tt * (g[0] * x + g[1] * y)
    }

    return 70 * n
  }

  noiseCache.set(key, simplex2)
  return simplex2
}

/**
 * Fractal Brownian motion: stacked octaves of simplex noise.
 * Output is normalised back into [-1, 1] by the total amplitude.
 */
export function fbm(simplex2, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0

  for (let o = 0; o < octaves; o++) {
    sum += simplex2(x * frequency, y * frequency) * amplitude
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }

  return norm > 0 ? sum / norm : 0
}

/* --- 3D ------------------------------------------------------------------ */

const F3 = 1 / 3
const G3 = 1 / 6

// The usual 12 mid-edge gradients of a cube.
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
]

const noise3Cache = new Map()

/**
 * Returns a simplex3(x, y, z) function in roughly [-1, 1] for the given seed.
 * Same construction as the 2D version, one dimension up: skew into a simplex
 * lattice, find which of the six tetrahedra in the cell the point sits in, then
 * sum the four corner contributions.
 */
export function makeSimplex3(seed) {
  const key = seed | 0
  const cached = noise3Cache.get(key)
  if (cached) return cached

  const perm = buildPermutation(key)

  function simplex3(xin, yin, zin) {
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const k = Math.floor(zin + s)
    const t = (i + j + k) * G3

    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const z0 = zin - (k - t)

    // Rank the coordinates to pick the tetrahedron.
    let i1, j1, k1
    let i2, j2, k2
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0
      }
    }

    const ii = i & 255
    const jj = j & 255
    const kk = k & 255

    const corners = [
      [x0, y0, z0, perm[ii + perm[jj + perm[kk]]] % 12],
      [
        x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3,
        perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12,
      ],
      [
        x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3,
        perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12,
      ],
      [
        x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3,
        perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12,
      ],
    ]

    let n = 0
    for (let c = 0; c < 4; c++) {
      const [x, y, z, gi] = corners[c]
      let tt = 0.6 - x * x - y * y - z * z
      if (tt <= 0) continue
      tt *= tt
      const g = GRAD3[gi]
      n += tt * tt * (g[0] * x + g[1] * y + g[2] * z)
    }

    return 32 * n
  }

  noise3Cache.set(key, simplex3)
  return simplex3
}

/** fBm over 3D simplex noise, normalised back into [-1, 1]. */
export function fbm3(simplex3, x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0

  for (let o = 0; o < octaves; o++) {
    sum += simplex3(x * frequency, y * frequency, z * frequency) * amplitude
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }

  return norm > 0 ? sum / norm : 0
}
