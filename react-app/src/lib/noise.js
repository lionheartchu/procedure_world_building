/**
 * Seeded 2D simplex noise + fBm.
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
