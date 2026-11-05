/**
 * The far field — the Habitat's inexpensive continuation beyond the slab
 * (docs/12-habitat-v0.md). Not more world: nothing lives, settles or is met
 * there, and the visitor cannot reach it. It is the same landform carried on
 * past the edge so the slab stops reading as a display surface:
 *
 *   - the base landform (field.js's createField) is plain noise, defined
 *     everywhere, so it continues past the slab with the same seed. What is
 *     only defined on the slab (relief, streams, History's sediment) is not
 *     continued: across a band beyond the edge the ground eases from the
 *     slab's own rim to the base landform, so they meet without a step
 *   - further out the land sinks and flattens toward the water, so the
 *     landform gathers at the slab and the distance becomes shallows and
 *     haze rather than a second horizon of hills
 *
 * One coarse grid around the slab: its lines inside the slab's extent are
 * every other line of the terrain's own grid (so its edge meets the
 * terrain's), widening geometrically outward.
 */

export const FAR = {
  /** How far the field reaches from the centre (units). */
  reach: 85,
  /** The band beyond the edge over which the slab's rim gives way to the base landform. */
  blend: 4,
  /** Where the land begins to sink, and where it has sunk (radius, units), and how far. */
  sinkFrom: 16,
  sinkTo: 52,
  sink: 1.1,
  /** How much of the relief is left at the far reach. */
  flatten: 0.65,
  /** Growth of the grid's spacing outward, per line. */
  growth: 1.13,
  /** Where it thins into the sky's horizon (radius, units; Terrain's far water uses the same). */
  dissolve: [45, 80],
}

import { fbm, makeSimplex2 } from './noise'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/**
 * The grid's lines along one axis: the terrain's every other line inside
 * (or every line, with `fine`), widening outside — after `fine` units at the
 * terrain's own spacing, so the ground just past the edge keeps the same
 * grain as the ground just inside it.
 */
function lines(half, inner, fine = 0, reach = FAR.reach, widest = Infinity) {
  const step = (2 * half) / inner
  const inside = Array.from({ length: inner + 1 }, (_, i) => -half + i * step)
  const outside = []
  let x = half
  let d = step
  while (x < reach) {
    if (x - half >= fine) d = Math.min(widest, d * FAR.growth)
    x += d
    outside.push(x)
  }
  return [...outside.map((v) => -v).reverse(), ...inside, ...outside]
}

/**
 * The far ground and the far water.
 *
 * @param baseField  the base landform (createField), sampled past 0..1
 * @param world      world data (the slab's displayed ground at its rim)
 * @param elevation  the vertical scale
 * @param resolution the terrain's grid resolution
 * @param sink, flatten  how far the land sinks and flattens far out (FAR's by default)
 * @param fine       units past the edge kept at the terrain's own grid (0: none)
 * @returns {{ ground: { position, index }, water: { position, depth, index } }}
 */
export function buildFarField({ baseField, world, elevation, resolution = 224, sink = FAR.sink, flatten = FAR.flatten, fine = 0, field = null, horizon = null }) {
  const half = world.size / 2
  const Hz = horizon
  const reach = Hz ? Hz.reach : FAR.reach
  const sinkFrom = Hz ? Hz.sinkFrom : FAR.sinkFrom
  const sinkTo = Hz ? Hz.sinkTo : FAR.sinkTo
  const xs = lines(half, fine > 0 ? resolution : Math.round(resolution / 2), fine, reach, Hz ? Hz.widest : Infinity)
  const n = xs.length
  const rise = Hz ? horizonRise(Hz) : null
  const waterY = world.waterY
  const height = new Float32Array(n * n)
  // The height the ground is coloured by (`field` given): as the terrain
  // colours by the carved field, without History's sediment lift, the lift
  // at the rim is taken off again over the blend band.
  const tone = field ? new Float32Array(n * n) : null
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = xs[i]
      const z = xs[j]
      const u = x / world.size + 0.5
      const v = z / world.size + 0.5
      const beyond = Math.max(Math.abs(x), Math.abs(z)) - half
      const rim = world.groundY(clamp01(u), clamp01(v))
      const lift = field ? rim - (field.sample(clamp01(u), clamp01(v)) - 0.5) * elevation : 0
      // Inside the slab: its own displayed ground.
      let h = rim
      if (beyond > 1e-6) {
        const base = (baseField.sample(u, v) - 0.5) * elevation
        h = rim + (base - rim) * smoothstep(0, FAR.blend, beyond)
        const r = Math.hypot(x, z)
        h -= sink * smoothstep(sinkFrom, sinkTo, r)
        h = waterY + (h - waterY) * (1 - flatten * smoothstep(sinkFrom, reach, r))
        if (rise) h += rise(x, z)
      }
      height[j * n + i] = h
      if (tone) tone[j * n + i] = (h - lift * (1 - smoothstep(0, FAR.blend, beyond))) / elevation + 0.5
    }
  }
  // Every cell not wholly inside the slab (the terrain draws those); with a
  // horizon, only those that begin inside its ring (the ring draws the rest).
  const index = []
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const xIn = Math.max(Math.abs(xs[i]), Math.abs(xs[i + 1])) <= half + 1e-6
      const zIn = Math.max(Math.abs(xs[j]), Math.abs(xs[j + 1])) <= half + 1e-6
      if (xIn && zIn) continue
      if (Hz && Math.hypot(Math.min(Math.abs(xs[i]), Math.abs(xs[i + 1])), Math.min(Math.abs(xs[j]), Math.abs(xs[j + 1]))) >= Hz.ring.inner) continue
      const a = j * n + i
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  }
  const ground = new Float32Array(n * n * 3)
  const water = new Float32Array(n * n * 3)
  const depth = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      ground.set([xs[i], height[k], xs[j]], k * 3)
      water.set([xs[i], waterY, xs[j]], k * 3)
      depth[k] = waterY - height[k]
    }
  }
  // The water also covers the slab's last band (where its own water fades),
  // so it takes over there: the band's cells are added to the water only.
  const band = []
  const edge = half * (1 - 2 * 0.06)
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const xIn = Math.max(Math.abs(xs[i]), Math.abs(xs[i + 1])) <= half + 1e-6
      const zIn = Math.max(Math.abs(xs[j]), Math.abs(xs[j + 1])) <= half + 1e-6
      if (!(xIn && zIn)) continue
      const reach = Math.max(Math.abs(xs[i]), Math.abs(xs[i + 1]), Math.abs(xs[j]), Math.abs(xs[j + 1]))
      if (reach < edge) continue
      const a = j * n + i
      band.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  }
  if (!Hz) {
    const groundIndex = new Uint32Array(index)
    const waterIndex = new Uint32Array([...index, ...band])
    return {
      ground: { position: ground, index: groundIndex, tone },
      water: { position: water, depth, index: waterIndex },
      lines: n,
    }
  }

  // The horizon's ring: polar, from inside the grid's last cells out to the
  // horizon, its spacing widening outward, at the same height and tone as
  // the grid would have there (the base landform, sunk and flattened, and
  // the rise).
  const { inner, outer, segments, rings } = Hz.ring
  const radii = []
  for (let k = 0; k <= rings; k++) radii.push(inner + (outer - inner) * Math.pow(k / rings, 1.6))
  const base0 = n * n
  const count = base0 + radii.length * segments
  const gAll = new Float32Array(count * 3)
  const wAll = new Float32Array(count * 3)
  const dAll = new Float32Array(count)
  const tAll = new Float32Array(count)
  gAll.set(ground)
  wAll.set(water)
  dAll.set(depth)
  tAll.set(tone ?? new Float32Array(n * n))
  for (let k = 0; k < radii.length; k++) {
    for (let a = 0; a < segments; a++) {
      const th = (a / segments) * Math.PI * 2
      const x = Math.cos(th) * radii[k]
      const z = Math.sin(th) * radii[k]
      const r = radii[k]
      let h = (baseField.sample(x / world.size + 0.5, z / world.size + 0.5) - 0.5) * elevation
      h -= sink * smoothstep(sinkFrom, sinkTo, r)
      h = waterY + (h - waterY) * (1 - flatten * smoothstep(sinkFrom, reach, r))
      h += rise(x, z)
      const v = base0 + k * segments + a
      gAll.set([x, h, z], v * 3)
      wAll.set([x, waterY, z], v * 3)
      dAll[v] = waterY - h
      tAll[v] = h / elevation + 0.5
    }
  }
  const ringIndex = []
  for (let k = 0; k < radii.length - 1; k++) {
    for (let a = 0; a < segments; a++) {
      const p = base0 + k * segments + a
      const q = base0 + k * segments + ((a + 1) % segments)
      // Wound as the grid's cells are (facing up).
      ringIndex.push(p, q, p + segments, q, q + segments, p + segments)
    }
  }
  return {
    ground: { position: gAll, index: new Uint32Array([...index, ...ringIndex]), tone: tAll },
    water: { position: wAll, depth: dAll, index: new Uint32Array([...index, ...band, ...ringIndex]) },
    lines: n,
  }
}

/**
 * The horizon (the Habitat's D): past the near shallows the land rises,
 * first into low hills, broken by gaps where the shallows run on, then far
 * out into a higher, ridged range whose crest is the skyline, falling away
 * again behind it. Plain noise, on the world's seed; nothing lives there.
 */
function horizonRise({ seed, hills, range }) {
  const a = makeSimplex2(seed * 31 + 7)
  const b = makeSimplex2(seed * 31 + 19)
  const c = makeSimplex2(seed * 31 + 43)
  return (x, z) => {
    const r = Math.hypot(x, z)
    let h = 0
    const toHills = smoothstep(hills.from, hills.to, r)
    if (toHills > 0) {
      const n = clamp01(fbm(a, x * hills.scale, z * hills.scale, 3) * 0.8 + 0.5)
      h += hills.height * toHills * smoothstep(0.3, 1, n) ** 1.2
    }
    const toRange = smoothstep(range.from, range.to, r) * (1 - smoothstep(range.fall[0], range.fall[1], r))
    if (toRange > 0) {
      // Soft crests over broad shoulders, in masses with gaps between.
      const s = range.scale
      const ridge = 1 - Math.abs(fbm(b, x * s, z * s, 3))
      const roll = clamp01(fbm(b, x * s * 0.5 + 7, z * s * 0.5 - 3, 2) * 0.5 + 0.5)
      const mass = smoothstep(0.2, 0.75, clamp01(fbm(c, x * s * 0.3, z * s * 0.3, 2) * 0.8 + 0.5))
      h += range.height * toRange * (0.55 * ridge ** 1.5 + 0.45 * roll) * (0.12 + 0.88 * mass)
    }
    return h
  }
}
