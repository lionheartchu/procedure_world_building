/**
 * The accumulation light: where the colonies have gathered matter, and how
 * the light held in that matter seeps out into the ground around it.
 *
 * Light here is not a lamp placed at a colony. It is a property of what the
 * colonies laid down: the bases of their membranes, the residue they caught,
 * the heap, the trail running downhill. That matter is splatted into a
 * grid aligned with the world data, then carried outward by a diffusion that
 * reads the ground:
 *
 *   - it travels through the sediment record (deposits conduct, bare ground
 *     much less), so light follows where matter has already settled
 *   - it is held back by steep faces, so a ridge keeps its shade
 *   - it leans downhill, the way the residue itself moves
 *   - it is dimmed under water
 *
 * So its outline is the outline of the deposits and the landform, never a
 * disc. Where several colonies sit close, their light meets across the record
 * between them; where nothing has gathered, the ground stays dark.
 *
 *   R  light: the diffused, terrain-shaped glow, 0..1 (soft-saturated)
 *   G  density: the matter itself, barely spread — the cores
 *   B  tone: 0 pearl (dense cores) … 0.5 icy lavender … 1 silver-blue (wet
 *      ground and the far edge of the light)
 *   A  unused (255)
 *
 * Pure data: the texture is made by the renderer (formMaterial.js).
 */

import { makeSimplex2 } from './noise'

export const ACCUMULATION = {
  /** Diffusion per step between neighbours that both conduct fully. */
  spread: 0.2,
  /** Light lost per step: with spread, sets the reach (about 1.8 units on
   *  conducting ground, about 1 on bare). */
  decay: 0.01,
  /** Share handed downhill per step. */
  downhill: 0.06,
  /** Steps: enough to settle. */
  steps: 200,
  /** Mass that reads as a full core: a mature anchor's base. */
  coreMass: 1.6,
  /** Light below this is no light; above, it saturates softly toward
   *  fullLight. Calibrated on the default world (cores reach about 40). */
  floor: 0.6,
  fullLight: 14,
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * @param world    world data (worldData.js): its grid and channels
 * @param scatter  placeScatter() output: colonies and their instances
 * @returns {{ res: number, size: number, data: Uint8Array, stats: object }}
 */
export function buildAccumulation(world, scatter) {
  const n = world.res
  const size = world.size
  const cell = size / n
  const N = n * n
  const { trace, slope, depth, shore, downX, downZ } = world.channels
  const mass = new Float32Array(N)

  // Gaussian splat in world units.
  const splat = (x, z, r, amount) => {
    const ci = (x / size + 0.5) * n - 0.5
    const cj = (z / size + 0.5) * n - 0.5
    const rc = Math.max(0.6, r / cell)
    const reach = Math.ceil(rc * 2.2)
    for (let j = Math.max(0, Math.floor(cj - reach)); j <= Math.min(n - 1, Math.ceil(cj + reach)); j++) {
      for (let i = Math.max(0, Math.floor(ci - reach)); i <= Math.min(n - 1, Math.ceil(ci + reach)); i++) {
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (rc * rc)
        if (d2 < 4.8) mass[j * n + i] += amount * Math.exp(-d2)
      }
    }
  }

  const { layers } = scatter
  // Membranes: their whole base line, in proportion to their size. The
  // anchor is the colony's oldest and densest matter.
  for (const b of layers.bloom.instances) {
    const half = (b.width ?? b.height) * 0.5
    const lx = -Math.sin(b.lean) * half
    const lz = Math.cos(b.lean) * half
    const amount = (b.role === 'anchor' ? 0.55 : 0.32) * b.height * (0.6 + 0.4 * (b.maturity ?? 1))
    for (let k = -2; k <= 2; k++) splat(b.p[0] + (lx * k) / 2, b.p[2] + (lz * k) / 2, 0.22 + 0.12 * b.height, amount / 5)
  }
  // Residue: plates by their size, grains a little each; the trail fades as
  // it runs; a heap is a dense core of its own.
  for (const dep of layers.shard.instances) {
    for (const p of dep.plates) splat(p.x, p.z, 0.16 + p.len * 0.5, 0.06 + 0.3 * p.len)
    for (const g of dep.beads) splat(g.x, g.z, 0.12, 0.012)
    if (dep.kind === 'heap') splat(dep.center[0], dep.center[2], dep.radius, 0.5)
    if (dep.kind === 'trail' && dep.path) for (const [x, z, fade] of dep.path) splat(x, z, 0.2, 0.05 * fade)
  }
  // Structure's footings hold a little.
  for (const s of layers.bridgework.instances) {
    splat(s.a[0], s.a[2], 0.18, 0.08)
    if (s.type === 'span' || s.grounded) splat(s.b[0], s.b[2], 0.18, 0.08)
  }

  // How well each cell carries light: through the record, not up a cliff,
  // less under water.
  const conduct = new Float32Array(N)
  for (let c = 0; c < N; c++) {
    const record = 0.3 + 0.7 * smoothstep(0.05, 0.7, trace[c])
    const steep = Math.exp(-Math.max(0, slope[c] - 6) / 14)
    const wet = depth[c] < 0 ? 0.55 : 1
    conduct[c] = record * steep * wet
  }

  // Carried outward on a half-resolution grid (light is broad; the cores
  // keep full resolution in G): damped diffusion between neighbours, as
  // well as both conduct, plus a little transport downhill. Explicit and
  // stable — each step moves at most about 0.9 of a cell's light.
  const h = n >> 1
  const H = h * h
  const src = new Float32Array(H)
  const cond = new Float32Array(H)
  const dx = new Float32Array(H)
  const dz = new Float32Array(H)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < h; i++) {
      const c = j * h + i
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const o = (2 * j + b) * n + 2 * i + a
        src[c] += mass[o] / 4
        cond[c] += conduct[o] / 4
        dx[c] += downX[o] / 4
        dz[c] += downZ[o] / 4
      }
    }
  }
  const { spread, decay, downhill, steps } = ACCUMULATION
  let L = new Float32Array(H)
  let next = new Float32Array(H)
  const nb = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (let s = 0; s < steps; s++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < h; i++) {
        const c = j * h + i
        let v = L[c] + src[c] - decay * L[c]
        for (const [a, b] of nb) {
          const ii = i + a
          const jj = j + b
          if (ii < 0 || jj < 0 || ii >= h || jj >= h) continue
          const o = jj * h + ii
          v += spread * Math.min(cond[c], cond[o]) * (L[o] - L[c])
          // Downhill: o hands light to c if c lies down its slope, and c to o.
          v += downhill * cond[c] * Math.max(0, -(dx[o] * a + dz[o] * b)) * L[o]
          v -= downhill * cond[o] * Math.max(0, dx[c] * a + dz[c] * b) * L[c]
        }
        next[c] = v
      }
    }
    ;[L, next] = [next, L]
  }
  // Back to full resolution, bilinear.
  const lightAt = (i, j) => {
    const x = Math.max(0, Math.min(h - 1, (i + 0.5) / 2 - 0.5))
    const y = Math.max(0, Math.min(h - 1, (j + 0.5) / 2 - 0.5))
    const i0 = Math.floor(x)
    const j0 = Math.floor(y)
    const i1 = Math.min(h - 1, i0 + 1)
    const j1 = Math.min(h - 1, j0 + 1)
    const fx = x - i0
    const fy = y - j0
    return (L[j0 * h + i0] * (1 - fx) + L[j0 * h + i1] * fx) * (1 - fy) + (L[j1 * h + i0] * (1 - fx) + L[j1 * h + i1] * fx) * fy
  }

  // Tone varies slowly across the ground as well as with density.
  const hue = makeSimplex2(4177)
  const data = new Uint8Array(N * 4)
  let lit = 0
  let peak = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i
      const raw = lightAt(i, j)
      // A faint wash far from anything is not light: it starts above a floor.
      const light = 1 - Math.exp(-Math.max(0, raw - ACCUMULATION.floor) / ACCUMULATION.fullLight)
      const core = 1 - Math.exp(-mass[c] / ACCUMULATION.coreMass)
      const x = ((i + 0.5) / n - 0.5) * size
      const z = ((j + 0.5) / n - 0.5) * size
      const wet = 1 - smoothstep(-0.2, 1.2, shore[c])
      const tone = clamp01(0.5 - 0.55 * core + 0.4 * wet + 0.35 * (1 - light) * light * 2 + 0.25 * hue(x * 0.21, z * 0.21))
      data[c * 4] = Math.round(light * 255)
      data[c * 4 + 1] = Math.round(core * 255)
      data[c * 4 + 2] = Math.round(tone * 255)
      data[c * 4 + 3] = 255
      if (light > 0.08) lit++
      peak = Math.max(peak, raw)
    }
  }
  return { res: n, size, data, stats: { lit: lit / N, peak } }
}
