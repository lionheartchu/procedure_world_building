/**
 * Water veins: the spline layer (assignment 2), as part of the one world.
 *
 * A few narrow streams that rise on high, thick ground and run down into the
 * basins. Each is one spline — the stream's centreline — and the stream is
 * built from it in both directions:
 *
 *   terrain → spline   the course is found by walking downhill over the
 *                      ground: drawn into hollows, kept off ridges, carrying
 *                      a little momentum, wandering more where the ground is
 *                      gentle. The walk is smoothed into a Catmull-Rom curve.
 *   spline → terrain   the curve is projected onto the ground and carves a
 *                      shallow channel into the world field itself — so the
 *                      mesh, the sediment simulation and the colonies all
 *                      stand on ground the stream has cut — and leaves damp
 *                      banks and a little settled material beside it.
 *   water              a thin water surface lies in the channel, from a
 *                      trickle at the source to where it joins the basin.
 *
 * Streams read the field, not the sediment history, so they belong to the
 * shared world: every tab shows the same streams in the same channels.
 */

import { mulberry32 } from './noise'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}
const lerp = (a, b, t) => a + (b - a) * t

/** Walk step and spline spacing, world units. */
const WALK = 0.1
const STEP = 0.06
const MAX_LENGTH = 16

/** Resolution of the routing grid, the carve grid and the material grid. */
const ROUTE_RES = 128
const CARVE_RES = 384
export const STREAM_RES = 256

/* --- the ground a stream reads ------------------------------------------- */

/**
 * Everything a stream needs to know about the ground, from the field alone:
 * a smoothed height to route over (so it follows the land's form, not every
 * pit), broad curvature (hollow vs ridge), and distance to the water.
 */
function groundGrid(field, { size, elevation, waterLevel }) {
  const n = ROUTE_RES
  const cell = size / n
  const raw = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) raw[j * n + i] = (field.sample((i + 0.5) / n, (j + 0.5) / n) - 0.5) * elevation
  }
  // Routing ground: broad (about a unit and a half of smoothing), so a stream
  // follows the large-scale form of the land and not every small bump; it
  // is carved into the real ground afterwards.
  const smooth = blur(blur(raw, n, 5), n, 5)
  const broad = blur(blur(raw, n, 6), n, 6)
  const waterY = (waterLevel - 0.5) * elevation

  // Curvature of the broad ground, ranked against its own spread.
  const lap = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const at = (a, b) => broad[Math.max(0, Math.min(n - 1, b)) * n + Math.max(0, Math.min(n - 1, a))]
      lap[j * n + i] = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1) - 4 * at(i, j)
    }
  }
  const sorted = Float32Array.from(lap, Math.abs).sort()
  const ls = Math.max(1e-6, sorted[Math.floor(sorted.length * 0.9)])
  const hollow = lap.map((v) => clamp01(0.5 + 0.5 * (v / ls)))

  // Distance to the water, in cells (two-pass chamfer).
  const dist = new Float32Array(n * n)
  for (let k = 0; k < n * n; k++) dist[k] = raw[k] < waterY ? 0 : 1e9
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0
    for (let jj = 0; jj < n; jj++) {
      const j = fwd ? jj : n - 1 - jj
      for (let ii = 0; ii < n; ii++) {
        const i = fwd ? ii : n - 1 - ii
        const c = j * n + i
        let v = dist[c]
        const s = fwd ? -1 : 1
        if (i + s >= 0 && i + s < n) v = Math.min(v, dist[c + s] + 1)
        if (j + s >= 0 && j + s < n) {
          v = Math.min(v, dist[c + s * n] + 1)
          if (i - 1 >= 0) v = Math.min(v, dist[c + s * n - 1] + Math.SQRT2)
          if (i + 1 < n) v = Math.min(v, dist[c + s * n + 1] + Math.SQRT2)
        }
        dist[c] = v
      }
    }
  }

  const sampler = (grid) => (x, z) => {
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
  const ground = (x, z) => (field.sample(clamp01(x / size + 0.5), clamp01(z / size + 0.5)) - 0.5) * elevation
  return {
    n,
    cell,
    size,
    waterY,
    raw,
    dist,
    H: sampler(smooth),
    hollow: sampler(hollow),
    ground,
    inside: (x, z, margin) => Math.abs(x) < size / 2 - margin && Math.abs(z) < size / 2 - margin,
  }
}

/** Connected land masses on the routing grid: a label per cell and areas. */
function landBodies(G) {
  const { n } = G
  const label = new Int32Array(n * n).fill(-1)
  const areas = []
  for (let start = 0; start < n * n; start++) {
    if (label[start] >= 0 || G.raw[start] < G.waterY) continue
    const id = areas.length
    let area = 0
    const stack = [start]
    label[start] = id
    while (stack.length) {
      const c = stack.pop()
      area++
      const i = c % n
      const j = (c - i) / n
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di
        const b = j + dj
        if (a < 0 || b < 0 || a >= n || b >= n) continue
        const k = b * n + a
        if (label[k] >= 0 || G.raw[k] < G.waterY) continue
        label[k] = id
        stack.push(k)
      }
    }
    areas.push(area)
  }
  return { label, areas }
}

function blur(src, n, radius) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const span = radius * 2 + 1
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let k = -radius; k <= radius; k++) s += src[j * n + Math.max(0, Math.min(n - 1, i + k))]
      tmp[j * n + i] = s / span
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let k = -radius; k <= radius; k++) s += tmp[Math.max(0, Math.min(n - 1, j + k)) * n + i]
      out[j * n + i] = s / span
    }
  }
  return out
}

/* --- the walk ------------------------------------------------------------ */

/**
 * Terrain → spline. Downhill on the smoothed ground, pulled into hollows,
 * with momentum, and a meander that grows on gentle ground. It succeeds when
 * it reaches the water or another stream; it fails if it is trapped in a pit
 * above the water or leaves the field.
 */
function walk(G, source, others, meander, random) {
  const e = 0.18
  const grad = (x, z) => [(G.H(x + e, z) - G.H(x - e, z)) / (2 * e), (G.H(x, z + e) - G.H(x, z - e)) / (2 * e)]
  const hollowGrad = (x, z) => [(G.hollow(x + 0.4, z) - G.hollow(x - 0.4, z)) / 0.8, (G.hollow(x, z + 0.4) - G.hollow(x, z - 0.4)) / 0.8]

  const phase = random() * 6
  const phase2 = random() * 6
  let [gx, gz] = grad(source.x, source.z)
  let len = Math.hypot(gx, gz) || 1
  let dir = [-gx / len, -gz / len]
  const pts = [{ x: source.x, z: source.z }]
  let x = source.x
  let z = source.z
  let s = 0
  let lowest = G.H(x, z)
  let climbing = 0

  while (s < MAX_LENGTH) {
    ;[gx, gz] = grad(x, z)
    const slope = Math.hypot(gx, gz)
    const down = slope > 1e-5 ? [-gx / slope, -gz / slope] : dir
    const [hx, hz] = hollowGrad(x, z)
    const gentle = 1 - smoothstep(0.08, 0.45, slope)
    const wander = meander * (0.2 + 0.8 * gentle) * (Math.sin(s * 1.05 + phase) * 0.7 + Math.sin(s * 0.41 + phase2) * 0.5)
    const across = [-dir[1], dir[0]]
    const pull = 0.9 + 3 * Math.min(slope, 0.5)
    let nx = down[0] * pull + dir[0] * 2.4 + hx * 0.35 + across[0] * wander
    let nz = down[1] * pull + dir[1] * 2.4 + hz * 0.35 + across[1] * wander
    len = Math.hypot(nx, nz) || 1
    nx /= len
    nz /= len
    dir = [nx, nz]
    x += nx * WALK
    z += nz * WALK
    s += WALK
    if (!G.inside(x, z, 0.5)) return null
    pts.push({ x, z })

    // The water: a few steps on, then it has joined the basin.
    if (G.ground(x, z) < G.waterY) {
      for (let k = 0; k < 4; k++) {
        x += nx * WALK
        z += nz * WALK
        if (G.inside(x, z, 0.3)) pts.push({ x, z })
      }
      return { points: pts, end: 'water', mouth: pts.length - 5 }
    }

    // Another stream: join it.
    for (const o of others) {
      for (let k = 0; k < o.points.length; k += 2) {
        const p = o.points[k]
        if (Math.hypot(p.x - x, p.z - z) < 0.3) {
          pts.push({ ...p })
          return { points: pts, end: 'join', host: o.index, hostIndex: k }
        }
      }
    }

    // A pit above the water: once it has climbed a while it is trapped.
    const h = G.H(x, z)
    if (h < lowest - 0.002) {
      lowest = h
      climbing = 0
    } else if (++climbing > 10) {
      return null
    }
  }
  return null
}

/** Dense Catmull-Rom resample at STEP spacing: the stream's centreline. */
function spline(pts) {
  const ctrl = pts.filter((_, k) => k % 6 === 0 || k === pts.length - 1)
  const at = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))]
  const cr = (p0, p1, p2, p3, t) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  const fine = []
  for (let i = 0; i < ctrl.length - 1; i++) {
    for (let k = 0; k < 10; k++) {
      const t = k / 10
      fine.push({
        x: cr(at(i - 1).x, at(i).x, at(i + 1).x, at(i + 2).x, t),
        z: cr(at(i - 1).z, at(i).z, at(i + 1).z, at(i + 2).z, t),
      })
    }
  }
  fine.push(ctrl[ctrl.length - 1])
  const out = [fine[0]]
  let carry = 0
  for (let i = 1; i < fine.length; i++) {
    const p = fine[i - 1]
    const q = fine[i]
    const seg = Math.hypot(q.x - p.x, q.z - p.z)
    let s = STEP - carry
    while (s <= seg) {
      const t = s / seg
      out.push({ x: lerp(p.x, q.x, t), z: lerp(p.z, q.z, t) })
      s += STEP
    }
    carry = seg - (s - STEP)
  }
  return out
}

/* --- entry point --------------------------------------------------------- */

/**
 * @param field     the world field before the streams (base + relief)
 * @param params.count   how many streams, 0–3
 * @param params.flow    0 a thread of water … 1 a small brook: width, depth
 */
export function traceStreams(field, { size, elevation, waterLevel, count, flow, seed }) {
  const empty = { streams: [], flow, size, elevation, waterLevel, stats: { streams: 0, length: 0, joins: 0 } }
  if (!field || count < 1) return empty
  const G = groundGrid(field, { size, elevation, waterLevel })
  const random = mulberry32((seed | 0) * 53 + 11)

  // Sources: high above the water and far from it — the thick of the land.
  // Ranked, then each tried in turn; only courses that reach the water (or
  // another stream) are kept, so every stream has somewhere to go.
  const { n } = G
  const cells = []
  let topH = 0
  let topD = 0
  for (let j = 2; j < n - 2; j += 2) {
    for (let i = 2; i < n - 2; i += 2) {
      const k = j * n + i
      const above = G.raw[k] - G.waterY
      if (above < 0.2) continue
      topH = Math.max(topH, above)
      topD = Math.max(topD, G.dist[k])
      cells.push({ x: ((i + 0.5) / n - 0.5) * size, z: ((j + 0.5) / n - 0.5) * size, above, dist: G.dist[k] })
    }
  }
  for (const c of cells) c.score = Math.pow(c.above / (topH || 1), 0.8) * Math.pow(c.dist / (topD || 1), 0.6) * (0.85 + 0.3 * random())
  cells.sort((a, b) => b.score - a.score)

  // Land masses, largest first: each gets a stream before any gets a
  // second, so streams are spread through the world rather than all rising
  // on its single highest island.
  const body = landBodies(G)
  for (const c of cells) {
    const i = Math.max(0, Math.min(n - 1, Math.floor((c.x / size + 0.5) * n)))
    const j = Math.max(0, Math.min(n - 1, Math.floor((c.z / size + 0.5) * n)))
    c.body = body.label[j * n + i]
  }
  const order = [...body.areas.keys()].filter((b) => body.areas[b] > 120).sort((a, b) => body.areas[b] - body.areas[a])

  // Fewer, better streams: on each land mass, largest first, several of the
  // best sources are walked and the longest course that reaches the water
  // is kept — a long stream reads, a short one is a mark.
  const meander = 0.35
  const streams = []
  const target = Math.round(count)
  const tryFrom = (pool) => {
    let best = null
    let tried = 0
    for (const c of pool) {
      if (tried >= 10) break
      if (streams.some((s) => Math.hypot(s.source.x - c.x, s.source.z - c.z) < 7)) continue
      if (best && Math.hypot(best.source.x - c.x, best.source.z - c.z) < 1.2) continue
      tried++
      const w = walk(G, c, streams, meander, random)
      if (!w || w.points.length < 18) continue
      const length = w.points.length * WALK
      if (!best || length > best.length) best = { source: { x: c.x, z: c.z }, w, length }
    }
    if (!best) return false
    streams.push({ index: streams.length, source: best.source, points: spline(best.w.points), end: best.w.end, host: best.w.host })
    return true
  }
  for (const b of order) {
    if (streams.length >= target) break
    tryFrom(cells.filter((c) => c.body === b))
  }

  // What each point carries (grows downstream; a confluence adds below it),
  // the slope under it, and where it is still on land.
  for (const s of streams) {
    s.carried = s.points.map((_, k) => k * STEP)
    s.length = (s.points.length - 1) * STEP
  }
  for (const s of streams) {
    if (s.end !== 'join') continue
    const host = streams[s.host]
    const p = s.points[s.points.length - 1]
    let best = 0
    let bestD = Infinity
    host.points.forEach((q, k) => {
      const d = Math.hypot(q.x - p.x, q.z - p.z)
      if (d < bestD) {
        bestD = d
        best = k
      }
    })
    for (let k = best; k < host.points.length; k++) host.carried[k] += s.length * 0.7
  }
  // Along each stream: how wide (half-width of the water), how deep, and
  // the level of the bed and the water. Width grows downstream and pools at
  // the mouth; the channel is broad and shallow — about 25 times wider than
  // deep — so it reads as water lying in the land, not a cut in it.
  const scale = 0.6 + 0.8 * flow
  const ground = G.ground
  for (const s of streams) {
    const n = s.points.length
    const e = 0.3
    s.slope = s.points.map((p) => Math.hypot(G.H(p.x + e, p.z) - G.H(p.x - e, p.z), G.H(p.x, p.z + e) - G.H(p.x, p.z - e)) / (2 * e))
    s.dry = s.points.map((p) => smoothstep(0, 0.08, ground(p.x, p.z) - G.waterY))
    // Where it reaches the basin: the first point under water.
    let mouth = n - 1
    if (s.end === 'water') for (let k = 0; k < n; k++) if (ground(s.points[k].x, s.points[k].z) < G.waterY) { mouth = k; break }
    s.mouth = mouth
    const fadeIn = (k) => smoothstep(0, 1.4, k * STEP)
    const pool = (k) => (s.end === 'water' ? smoothstep(mouth - 1.6 / STEP, mouth, k) : 0)
    s.width = s.points.map((_, k) => {
      const steep = smoothstep(0.08, 0.45, s.slope[k])
      return (0.24 + 0.13 * Math.sqrt(s.carried[k])) * scale * (1.15 - 0.3 * steep) * (0.4 + 0.6 * fadeIn(k)) * (1 + 0.85 * pool(k))
    })
    s.depth = s.points.map((_, k) => {
      const steep = smoothstep(0.08, 0.45, s.slope[k])
      return (0.024 + 0.01 * Math.sqrt(s.carried[k])) * scale * (0.85 + 0.3 * steep) * (0.3 + 0.7 * fadeIn(k)) * (1 - 0.3 * pool(k))
    })
    // The bed follows the broad ground along the stream: the real ground,
    // smoothed over about a unit, and never rising downstream.
    const g = s.points.map((p) => ground(p.x, p.z))
    const level = g.map((_, k) => {
      let sum = 0
      let c = 0
      for (let m = -9; m <= 9; m++) {
        sum += g[Math.max(0, Math.min(n - 1, k + m))]
        c++
      }
      return sum / c
    })
    for (let k = 1; k < n; k++) level[k] = Math.min(level[k], level[k - 1])
    s.bed = level.map((v, k) => v - s.depth[k])
    // The water lies a little below the banks, level across its width, and
    // settles onto the basin's own level at the mouth.
    s.surface = s.bed.map((b, k) => Math.max(b + 0.8 * s.depth[k], G.waterY + 0.003))
  }

  return {
    streams,
    flow,
    size,
    elevation,
    waterLevel,
    stats: {
      streams: streams.length,
      length: streams.reduce((a, s) => a + s.length, 0),
      joins: streams.filter((s) => s.end === 'join').length,
    },
  }
}

/* --- spline → terrain ---------------------------------------------------- */

/** Splat every stream point into a grid, keeping the strongest value. */
function rasterise(result, res, reachOf, value) {
  const grid = new Float32Array(res * res)
  const { size } = result
  const cell = size / res
  for (const s of result.streams) {
    for (let k = 0; k < s.points.length; k++) {
      const p = s.points[k]
      const reach = reachOf(s, k)
      const gx = (p.x / size + 0.5) * res - 0.5
      const gz = (p.z / size + 0.5) * res - 0.5
      const r = Math.ceil(reach / cell)
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const i = Math.round(gx) + dx
          const j = Math.round(gz) + dz
          if (i < 0 || j < 0 || i >= res || j >= res) continue
          const dist = Math.hypot(i - gx, j - gz) * cell
          if (dist > reach) continue
          const v = value(s, k, dist)
          const c = j * res + i
          if (v > grid[c]) grid[c] = v
        }
      }
    }
  }
  return grid
}

function bilinear(grid, res) {
  return (u, v) => {
    const gx = clamp01(u) * res - 0.5
    const gz = clamp01(v) * res - 0.5
    const i0 = Math.max(0, Math.min(res - 2, Math.floor(gx)))
    const j0 = Math.max(0, Math.min(res - 2, Math.floor(gz)))
    const fx = clamp01(gx - i0)
    const fz = clamp01(gz - j0)
    return (
      grid[j0 * res + i0] * (1 - fx) * (1 - fz) +
      grid[j0 * res + i0 + 1] * fx * (1 - fz) +
      grid[(j0 + 1) * res + i0] * (1 - fx) * fz +
      grid[(j0 + 1) * res + i0 + 1] * fx * fz
    )
  }
}

/**
 * The carved field: around each centreline the ground is drawn toward a soft
 * valley section — the bed at the centre, rising as the square of the
 * distance, so the water's edge falls exactly at the water's half-width —
 * and blended back into the real ground over about two and a half widths.
 * Where the ground is higher than the section it is cut; where a little
 * lower, on dry land, it is raised into a faint levee, so the water never
 * spills out the low side. Under the basin's water it only ever cuts.
 */
export function carveStreams(field, result) {
  if (!result || !result.streams.length) return field
  const { elevation, waterLevel, size } = result
  const E = Math.max(1e-3, elevation)
  const waterY = (waterLevel - 0.5) * elevation
  const res = CARVE_RES
  const cell = size / res
  const near = new Float32Array(res * res).fill(Infinity)
  const which = new Int32Array(res * res).fill(-1)
  const at = new Int32Array(res * res)
  for (const s of result.streams) {
    for (let k = 0; k < s.points.length; k++) {
      const p = s.points[k]
      const reach = s.width[k] * 2.6
      const gx = (p.x / size + 0.5) * res - 0.5
      const gz = (p.z / size + 0.5) * res - 0.5
      const r = Math.ceil(reach / cell)
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const i = Math.round(gx) + dx
          const j = Math.round(gz) + dz
          if (i < 0 || j < 0 || i >= res || j >= res) continue
          const d = Math.hypot(i - gx, j - gz) * cell
          if (d > reach) continue
          // The truly nearest point, then distance in its own widths. (By
          // widths directly, the wide mouth claimed cells beside the upper
          // channel and cut its banks away to the mouth's lower bed.)
          const c = j * res + i
          if (d < near[c]) {
            near[c] = d
            which[c] = s.index
            at[c] = k
          }
        }
      }
    }
  }
  const delta = new Float32Array(res * res)
  for (let c = 0; c < res * res; c++) {
    if (which[c] < 0) continue
    const s = result.streams[which[c]]
    const k = at[c]
    const r = near[c] / s.width[k]
    const u = ((c % res) + 0.5) / res
    const v = (Math.floor(c / res) + 0.5) / res
    const h = (field.sample(u, v) - 0.5) * elevation
    const target = s.bed[k] + 0.8 * s.depth[k] * r * r
    const weight = 1 - smoothstep(1.3, 2.6, r)
    let d = (target - h) * weight
    if (d > 0 && h < waterY) d = 0
    delta[c] = d / E
  }
  const lookup = bilinear(delta, res)
  return { ...field, sample: (u, v) => field.sample(u, v) + lookup(u, v) }
}

/**
 * What a stream leaves on the ground, for the terrain shader, as RGBA bytes:
 * R damp banks (wider than the water), G settled material in patches along
 * the banks and on the inside of bends, B how much is moving.
 */
export function streamMaterial(result) {
  const res = STREAM_RES
  const data = new Uint8Array(res * res * 4)
  if (!result || !result.streams.length) return { res, data }
  // Damp: strongest at the water's edge, fading out over another width.
  const wet = rasterise(
    result,
    res,
    (s, k) => s.width[k] * 2.4,
    (s, k, dist) => s.dry[k] * (1 - smoothstep(0.8, 2.2, dist / s.width[k])) * 0.85,
  )
  // Settled material: faint patches just beyond the damp ground.
  const deposit = rasterise(
    result,
    res,
    (s, k) => s.width[k] * 2.4,
    (s, k, dist) => {
      const t = k * STEP
      const patch = smoothstep(0.2, 0.8, 0.5 + 0.5 * Math.sin(t * 1.7 + s.index * 3.1) * Math.sin(t * 0.7 + s.index))
      return s.dry[k] * patch * Math.exp(-(((dist / s.width[k] - 1.7) / 0.35) ** 2)) * 0.5
    },
  )
  const moving = rasterise(
    result,
    res,
    (s, k) => s.width[k],
    (s, k, dist) => s.dry[k] * clamp01(s.carried[k] / 8) * Math.exp(-((dist / (s.width[k] * 0.6)) ** 2)),
  )
  for (let i = 0; i < res * res; i++) {
    data[i * 4] = Math.min(255, wet[i] * 255)
    data[i * 4 + 1] = Math.min(255, deposit[i] * 255)
    data[i * 4 + 2] = Math.min(255, moving[i] * 255)
    data[i * 4 + 3] = 255
  }
  return { res, data }
}

/* --- the water ----------------------------------------------------------- */

/**
 * The water in the channel: a ribbon level across its width, a little wider
 * than the water itself, so the banks rise through it and the depth buffer
 * draws the shoreline — as the basin water does. Attributes: uv (metres
 * across, metres along), aFlow (alpha, speed, depth below the surface at
 * this vertex, position across −1…1).
 */
export function buildStreamWater(result, field) {
  if (!result || !result.streams.length) return null
  const { size, elevation } = result
  const ground = (x, z) => (field.sample(clamp01(x / size + 0.5), clamp01(z / size + 0.5)) - 0.5) * elevation
  const pos = []
  const uv = []
  const flow = []
  const index = []
  const C = 14
  let base = 0

  for (const s of result.streams) {
    const n = s.points.length
    const side = (k) => {
      const a = s.points[Math.max(0, k - 2)]
      const b = s.points[Math.min(n - 1, k + 2)]
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
      return [-(b.z - a.z) / len, (b.x - a.x) / len]
    }
    for (let k = 0; k < n; k++) {
      const p = s.points[k]
      const [sx, sz] = side(k)
      const half = s.width[k] * 1.15
      // In at the source; out over half a unit past the mouth, where the
      // basin's own water takes over.
      const start = smoothstep(0, 0.5, k * STEP)
      const fadeOut = s.end === 'water' ? 1 - smoothstep(0, 0.5, (k - s.mouth) * STEP) : smoothstep(0, 0.2, (n - 1 - k) * STEP)
      const speed = 0.3 + 1.2 * smoothstep(0.04, 0.4, s.slope[k])
      for (let c = 0; c <= C; c++) {
        const a = (c / C) * 2 - 1
        const x = p.x + sx * a * half
        const z = p.z + sz * a * half
        const y = s.surface[k]
        pos.push(x, y, z)
        uv.push(a * half, k * STEP + s.index * 7.3)
        flow.push(start * fadeOut, speed, y - ground(x, z), a)
      }
      if (k > 0) {
        const r0 = base + (k - 1) * (C + 1)
        const r1 = base + k * (C + 1)
        for (let c = 0; c < C; c++) index.push(r0 + c, r1 + c, r0 + c + 1, r0 + c + 1, r1 + c, r1 + c + 1)
      }
    }
    base += n * (C + 1)
  }
  return { position: new Float32Array(pos), uv: new Float32Array(uv), flow: new Float32Array(flow), index }
}

/** The centrelines and sources, for an internal debug view only. */
export function streamLines(result) {
  if (!result) return []
  return result.streams.map((s) => ({ source: s.source, points: s.points, width: s.width }))
}
