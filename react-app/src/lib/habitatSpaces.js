import { chooseResidents, LIFECYCLE } from './lifecycle'
import { FormWriter } from './traceForms'
import { mulberry32 } from './noise'
import { PRESENCE, supportAt } from './presence'

/**
 * Spatial studies for the Habitat (docs/13-habitat-spaces.md): two ways of
 * making the world a place to move through, each by rule, so neither depends
 * on one seed or one colony's index.
 *
 *   A  terrain-led: the landform folds into banks and shallow pockets; where
 *      land narrows between water on both sides (a neck), a pair of veils
 *      takes root at its banks, a threshold to pass between
 *   B  tissue-led: a few large vessels, translucent half-pipe chambers lying
 *      across a shore from land into the shallows, open at both ends, with
 *      apertures in their sides and a slit along their top
 *
 * Both choose their lifecycle patches, encounter and arrival from the world
 * they are given.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
const groundAt = (world, x, z) => world.groundY(...world.toUV(x, z))
const wet = (world, x, z) => groundAt(world, x, z) <= world.waterY + 0.02
const inside = (world, x, z, margin) => Math.abs(x) < world.size / 2 - margin && Math.abs(z) < world.size / 2 - margin

/** How far from (x, z) along (dx, dz) the water begins (up to `most`); Infinity if it does not. */
function toWater(world, x, z, dx, dz, most) {
  for (let s = 0.15; s <= most; s += 0.15) {
    const px = x + dx * s
    const pz = z + dz * s
    if (!inside(world, px, pz, 0.2)) return Infinity
    if (wet(world, px, pz)) return s
  }
  return Infinity
}

/** Every membrane and strand's footing, so nothing new stands on what is placed. */
function footings(scatter) {
  const out = []
  for (const b of scatter.layers.bloom.instances) out.push([b.p[0], b.p[2], 0.35 + 0.5 * (b.width ?? b.height)])
  for (const r of scatter.layers.bridgework.instances) {
    if (r.a) out.push([r.a[0], r.a[2], 0.5])
    if (r.b) out.push([r.b[0], r.b[2], 0.5])
  }
  return out
}
const clearOf = (places, x, z, r) => places.every(([px, pz, pr]) => Math.hypot(px - x, pz - z) > pr + r)

/* --- A: folded ground ----------------------------------------------------- */

/**
 * Fold: the ridge shaping (field.js) with its crest rounded. Ridge folds the
 * field at its midline with a hard cusp, which the terrain's grid draws as a
 * saw-tooth along every crest; here the fold's absolute value is a smooth
 * one, so a crest is a rounded bank. Peak height stays 1.
 */
export const FOLD = {
  label: 'Fold',
  note: 'Ridge with rounded crests (Habitat study A).',
  apply: (n, sharpness) => {
    const k = 0.012
    const m = 1 - Math.sqrt((n * 2 - 1) ** 2 + k)
    return clamp(Math.pow(Math.max(0, m) / (1 - Math.sqrt(k)), sharpness), 0, 1)
  },
}

/* --- A: thresholds -------------------------------------------------------- */

export const THRESHOLD = {
  /** A neck: land at most this wide between water on both sides (units)... */
  narrow: 3.4,
  /** ...that goes on as land at least this far along it, both ways. */
  through: 2.2,
  /** At most this many, this far apart. */
  most: 5,
  apart: 4,
  /** Veil height, by how narrow the neck is. */
  height: [0.85, 1.25],
}

/**
 * Necks: land between two waters, open along the land. Where one is, two
 * veils root at its banks, leaning in over the passage between them, so the
 * passage stays at least a body's width (≥ 1.2) clear.
 */
export function findThresholds(world, scatter, { seed = 1 } = {}) {
  const T = THRESHOLD
  const random = mulberry32(seed * 977 + 13)
  const places = footings(scatter)
  const found = []
  const dirs = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI
    return [Math.cos(a), Math.sin(a)]
  })
  for (let z = -world.size / 2 + 1.5; z < world.size / 2 - 1.5; z += 0.4) {
    for (let x = -world.size / 2 + 1.5; x < world.size / 2 - 1.5; x += 0.4) {
      if (wet(world, x, z)) continue
      let best = null
      for (const [dx, dz] of dirs) {
        const a = toWater(world, x, z, dx, dz, T.narrow)
        const b = toWater(world, x, z, -dx, -dz, T.narrow)
        const w = a + b
        if (w <= T.narrow && (!best || w < best.w)) best = { w, a, b, dx, dz }
      }
      if (!best || best.w < 1.6) continue
      // Along the neck (across the narrowest direction) the land must go on.
      const along = [-best.dz, best.dx]
      const f = toWater(world, x, z, along[0], along[1], T.through)
      const g = toWater(world, x, z, -along[0], -along[1], T.through)
      if (f < T.through || g < T.through) continue
      const centred = Math.min(best.a, best.b) / Math.max(best.a, best.b)
      found.push({ x, z, ...best, along, score: (1 - best.w / T.narrow) * 0.6 + centred * 0.4 })
    }
  }
  found.sort((p, q) => q.score - p.score)
  const picked = []
  for (const f of found) {
    if (picked.length >= T.most) break
    if (picked.some((p) => Math.hypot(p.x - f.x, p.z - f.z) < T.apart)) continue
    if (!clearOf(places, f.x, f.z, 1.2)) continue
    picked.push(f)
  }
  // Two veils per neck, at its banks, leaning along the passage (one each
  // way) and a little in over it: a gate to pass between, never crossed.
  const veils = []
  picked.forEach((f, k) => {
    const height = T.height[0] + (T.height[1] - T.height[0]) * smoothstep(3.4, 1.6, f.w) + 0.1 * random()
    for (const side of [-1, 1]) {
      const reach = side < 0 ? f.a : f.b
      const off = Math.max(0.6, reach - 0.35)
      const x = f.x + side * f.dx * off
      const z = f.z + side * f.dz * off
      if (wet(world, x, z) || !clearOf(places, x, z, 0.4)) continue
      const inward = [-side * f.dx, -side * f.dz]
      const way = [side * f.along[0], side * f.along[1]]
      const lean = Math.atan2(way[1] + 0.45 * inward[1], way[0] + 0.45 * inward[0]) + (random() - 0.5) * 0.3
      veils.push({
        role: 'secondary',
        colony: -1,
        threshold: k,
        p: [x, groundAt(world, x, z), z],
        lean,
        height: height * (0.9 + 0.2 * random()),
        crests: 1,
        width: height * 0.85,
        // Closed (pores, not lace): a few isolated holes in a pale sheet read as a face,
        // and a threshold is met as solid.
        openness: 0.12 + 0.1 * random(),
        glow: 0.2,
        maturity: 0.6,
        ribs: 0,
        birth: 0,
        seed: Math.floor(random() * 1e6),
      })
    }
  })
  return { necks: picked, veils }
}

/* --- B: vessels ----------------------------------------------------------- */

export const VESSEL = {
  /** At most this many, centres this far apart. */
  most: 3,
  apart: 6,
  /** Length along its axis, and the radius of its section (units). */
  length: [5.5, 7.5],
  radius: [1.45, 1.8],
  /** How far round its section reaches from the top (radians): past the side, into the ground. */
  sweep: 2.0,
  /** Grid spacing of its sheet (units): finer than the presence's body, so it cannot slip through. */
  spacing: 0.14,
  /** Its feet stand clear of colonies' reach and footings by this much (units). */
  clear: 0.6,
  /** The water it reaches into stays shallow. */
  depth: 0.5,
  /** Land again within this far beyond its water end: it bridges to somewhere. */
  across: 7,
}

/**
 * Where vessels lie: across a shore, half on land, half in the shallows,
 * near a colony but outside the reach of its lifecycle, clear of every
 * footing, and facing land again across the water (so a vessel leads from
 * one place toward another, not out to the edge). Each runs down the
 * shore's gradient (from land into water), bent a little along it.
 */
export function placeVessels(world, scatter, { seed = 1 } = {}) {
  const V = VESSEL
  const random = mulberry32(seed * 3301 + 7)
  const places = footings(scatter)
  const reachOf = (c) => c.radius + LIFECYCLE.margin + 0.5
  const d = {}
  const found = []
  for (let z = -world.size / 2 + 3; z < world.size / 2 - 3; z += 0.5) {
    for (let x = -world.size / 2 + 3; x < world.size / 2 - 3; x += 0.5) {
      world.sample(...world.toUV(x, z), d)
      if (Math.abs(d.shore) > 0.25) continue
      // Down the shore: toward the water.
      let gx = d.downX
      let gz = d.downZ
      const gl = Math.hypot(gx, gz)
      if (gl < 1e-3) continue
      gx /= gl
      gz /= gl
      const L = V.length[0]
      const land = [x - gx * L * 0.5, z - gz * L * 0.5]
      const sea = [x + gx * L * 0.5, z + gz * L * 0.5]
      if (!inside(world, land[0], land[1], 1.2) || !inside(world, sea[0], sea[1], 1.2)) continue
      if (wet(world, ...land)) continue
      const deep = world.waterY - groundAt(world, ...sea)
      if (deep > V.depth) continue
      // Near a colony, outside every colony's lifecycle reach.
      let near = Infinity
      let blocked = false
      for (const c of scatter.colonies) {
        const dc = Math.hypot(c.x - x, c.z - z)
        near = Math.min(near, dc - c.radius)
        for (const s of [0, 0.5, 1]) {
          const px = land[0] + (sea[0] - land[0]) * s
          const pz = land[1] + (sea[1] - land[1]) * s
          if (Math.hypot(c.x - px, c.z - pz) < reachOf(c) + V.radius[1]) blocked = true
        }
      }
      if (blocked || near > 7) continue
      let clear = true
      for (let s = 0; s <= 1 && clear; s += 0.1) {
        const px = land[0] + (sea[0] - land[0]) * s
        const pz = land[1] + (sea[1] - land[1]) * s
        if (!clearOf(places, px, pz, V.radius[1] + V.clear)) clear = false
      }
      if (!clear) continue
      // It should lead somewhere: land again across the water ahead of it
      // (a strait it bridges), not out toward the open water and the edge.
      let ahead = Infinity
      for (let t = 0.5; t <= V.across; t += 0.25) {
        const px = sea[0] + gx * t
        const pz = sea[1] + gz * t
        if (!inside(world, px, pz, 1)) break
        if (!wet(world, px, pz)) {
          ahead = t
          break
        }
      }
      if (ahead === Infinity) continue
      const edge = Math.max(Math.abs(x), Math.abs(z)) / (world.size / 2)
      found.push({ x, z, gx, gz, score: 1 / (1 + Math.abs(near - 3)) + 0.3 * smoothstep(0, V.depth, deep) + (1 - ahead / V.across) - 0.8 * smoothstep(0.6, 0.9, edge) })
    }
  }
  found.sort((p, q) => q.score - p.score)
  const picked = []
  for (const f of found) {
    if (picked.length >= V.most) break
    if (picked.some((p) => Math.hypot(p.x - f.x, p.z - f.z) < V.apart)) continue
    picked.push(f)
  }
  return picked.map((f) => ({
    centre: [f.x, f.z],
    axis: [f.gx, f.gz],
    length: V.length[0] + (V.length[1] - V.length[0]) * random(),
    radius: V.radius[0] + (V.radius[1] - V.radius[0]) * random(),
    bend: (random() - 0.5) * 1.2,
    lean: (random() - 0.5) * 0.5,
    seed: Math.floor(random() * 1e6),
  }))
}

/**
 * One vessel's sheet: a half-pipe along its axis, standing in the ground at
 * both sides, its section a little lopsided (it leans), swelling in the
 * middle and narrowing to its two open ends. Apertures (holes through the
 * sheet, larger than a body) open in its sides and a slit along its top, so
 * it is never sealed.
 *
 * Written into `film` (the bloom layer's film material); returns the points
 * the presence meets (none inside an aperture).
 */
export function buildVessel(world, vessel, film) {
  const V = VESSEL
  const random = mulberry32(vessel.seed)
  const [cx, cz] = vessel.centre
  const [ax, az] = vessel.axis
  const side = [-az, ax]
  const L = vessel.length
  const R = vessel.radius
  const I = Math.ceil(L / V.spacing)
  const J = Math.ceil((2 * V.sweep * R) / V.spacing)
  // The axis, bent along the shore, and its floor (ground or water surface).
  const axisAt = (s) => {
    const t = s - 0.5
    const bend = vessel.bend * (1 - 4 * t * t)
    return [cx + ax * t * L + side[0] * bend, cz + az * t * L + side[1] * bend]
  }
  const floorAt = (x, z) => Math.max(groundAt(world, x, z), world.waterY)
  // Apertures in (s, θ): two in the sides at body height, one slit along the top.
  const holes = [
    { s: 0.3 + 0.1 * random(), a: -1.15 - 0.1 * random(), rs: 0.13, ra: 0.5 },
    { s: 0.62 + 0.1 * random(), a: 1.1 + 0.1 * random(), rs: 0.12, ra: 0.5 },
    { s: 0.5, a: 0.05, rs: 0.22, ra: 0.13 },
  ]
  // Where a point of the sheet is relative to the nearest aperture: ρ < 1 inside, 1 on its outline.
  const nearestHole = (s, a) => {
    let best = null
    for (const h of holes) {
      const rho = Math.hypot((s - h.s) / h.rs, (a - h.a) / h.ra)
      if (!best || rho < best.rho) best = { h, rho }
    }
    return best
  }
  const holeDist = (s, a) => nearestHole(s, a).rho - 1
  const pointAt = (s, a) => {
    const [x0, z0] = axisAt(s)
    // Swelling in the middle, narrowing toward its open ends.
    const r = R * (0.72 + 0.28 * Math.sin(Math.PI * s))
    const lopsided = 1 + vessel.lean * Math.sin(a)
    const y0 = floorAt(x0, z0) - 0.2 * r
    return [x0 + side[0] * Math.sin(a) * r, y0 + Math.cos(a) * r * 1.05 * lopsided, z0 + side[1] * Math.sin(a) * r]
  }
  // The lattice's own parameters, except that points just outside an
  // aperture are moved onto its outline, so it opens along a smooth curve
  // rather than along the grid's steps.
  const cellS = 1 / I
  const cellA = (2 * V.sweep) / J
  const param = (i, j) => {
    let s = i / I
    let a = -V.sweep + cellA * j
    const n = nearestHole(s, a)
    const band = 1.3 * Math.max(cellS / n.h.rs, cellA / n.h.ra)
    if (n.rho >= 1 && n.rho < 1 + band) {
      s = n.h.s + (s - n.h.s) / n.rho
      a = n.h.a + (a - n.h.a) / n.rho
    }
    return [s, a]
  }
  const P = []
  for (let j = 0; j <= J; j++) {
    const row = []
    for (let i = 0; i <= I; i++) row.push(pointAt(...param(i, j)))
    P.push(row)
  }
  const at = (i, j) => P[clamp(j, 0, J)][clamp(i, 0, I)]
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
  const norm = (p) => {
    const l = Math.hypot(...p) || 1
    return [p[0] / l, p[1] / l, p[2] / l]
  }
  const ids = []
  const met = []
  const kept = []
  for (let j = 0; j <= J; j++) {
    const row = []
    const keepRow = []
    for (let i = 0; i <= I; i++) {
      const [s, a] = param(i, j)
      const p = P[j][i]
      const n = norm(cross(sub(at(i + 1, j), at(i - 1, j)), sub(at(i, j + 1), at(i, j - 1))))
      const hd = holeDist(s, a)
      // Rims (its ends, its apertures, its feet) hold a little light, as membranes' edges do.
      const edge = Math.min(1, s * L * 1.2, (1 - s) * L * 1.2, Math.max(0, hd) * 2.5, (V.sweep - Math.abs(a)) * 2)
      const foot = [p[0], floorAt(p[0], p[2]), p[2]]
      film.set({ anchor: foot, birth: 0, span: 0.001, tone: 0.45 + 0.3 * random(), glow: 0.15, alpha: 0.42, open: 0.12, sway: 0 })
      row.push(film.vertex(p, n, s * L, a * R, edge, 0))
      const above = p[1] > groundAt(world, p[0], p[2]) - 0.05
      const open = hd < -1e-6
      keepRow.push(!open)
      if (!open && above) met.push(p[0], p[1], p[2])
    }
    ids.push(row)
    kept.push(keepRow)
  }
  for (let j = 0; j < J; j++) {
    for (let i = 0; i < I; i++) {
      // A quad is cut where any corner lies in an aperture.
      if (!(kept[j][i] && kept[j][i + 1] && kept[j + 1][i] && kept[j + 1][i + 1])) continue
      film.tri(ids[j][i], ids[j][i + 1], ids[j + 1][i])
      film.tri(ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i])
    }
  }
  return { met: new Float32Array(met), holes, axisAt }
}

/** All vessels: one film geometry, and the points the presence meets. */
export function buildVessels(world, vessels) {
  const film = new FormWriter()
  const met = []
  const built = vessels.map((v) => {
    const b = buildVessel(world, v, film)
    met.push(b.met)
    return b
  })
  return { film: film.toGeometry(), met, built }
}

/* --- shared rules --------------------------------------------------------- */

/**
 * Lifecycle patches by rule: the most mature colony with a free veil, and
 * the next such colony far enough away that their reaches (radius, margin
 * and a footprint each) cannot meet. Each patch keeps its own matter.
 */
export function choosePatches(scatter, { seed = 1 } = {}) {
  const reach = (c) => c.radius + LIFECYCLE.margin + LIFECYCLE.footprint
  const able = scatter.colonies.filter((c) => chooseResidents(scatter, c.index).length > 0).sort((p, q) => q.maturity - p.maturity)
  if (!able.length) return []
  const first = able[0]
  const second = able.find((c) => c !== first && Math.hypot(c.x - first.x, c.z - first.z) > reach(c) + reach(first) + 0.5)
  return [{ colony: first.index, seed }, ...(second ? [{ colony: second.index, seed: seed + 3, holds: [90] }] : [])]
}

/** The encounter: the tallest veil no patch takes (a threshold's veil, in A). */
export function chooseEncounterBy(scatter, patches) {
  const taken = new Set(patches.flatMap((p) => chooseResidents(scatter, p.colony)))
  return (
    scatter.layers.bloom.instances
      .filter((b) => b.role === 'secondary' && !taken.has(b) && b.height >= 0.5)
      .sort((p, q) => q.height - p.height)[0] ?? null
  )
}

/** A place to arrive at (x, z), at eye height above the floor, inside the drift bound, looking at `look`. */
export function arriveAt(world, x, z, look) {
  const b = PRESENCE.bound - 0.6
  x = clamp(x, -b, b)
  z = clamp(z, -b, b)
  const support = supportAt(world, x, z)
  return { p: [x, support + PRESENCE.eye, z], look }
}

/* --- C: the canopy ---------------------------------------------------------- */

export const CANOPY = {
  /** Half its length (across the slope) and half its depth (up and down it), units. */
  half: [6.2, 4.6],
  /** The roof inside (units over the floor), and how its free edge hangs. */
  roof: [2.3, 3.2],
  edge: [1.35, 2.3],
  /** Grid spacing: finer than the presence's body. */
  spacing: 0.14,
  /** It stands clear of colonies' lifecycle reach and of every footing by this much. */
  clear: 0.6,
  /** How far its footprint's outline wanders (share of its radius). */
  wander: 0.16,
}

/**
 * Where the canopy grows: a bank rising behind, the ground falling away in
 * front toward the shallows, gentle under its middle, clear of every
 * colony's lifecycle reach and footing, away from the slab's edge, with a
 * colony near enough to be seen from it. It roots into the bank and opens
 * downhill, toward the water.
 */
export function placeCanopy(world, scatter) {
  const C = CANOPY
  const places = footings(scatter)
  const reach = (c) => c.radius + LIFECYCLE.margin + LIFECYCLE.footprint
  const R0 = Math.max(...C.half)
  const d = {}
  let best = null
  for (let z = -world.size / 2 + R0 + 1; z < world.size / 2 - R0 - 1; z += 0.5) {
    for (let x = -world.size / 2 + R0 + 1; x < world.size / 2 - R0 - 1; x += 0.5) {
      if (wet(world, x, z)) continue
      world.sample(...world.toUV(x, z), d)
      if (d.slope > 16) continue
      let fx = d.downX
      let fz = d.downZ
      const fl = Math.hypot(fx, fz)
      if (fl < 1e-3) continue
      fx /= fl
      fz /= fl
      const here = groundAt(world, x, z)
      const behind = groundAt(world, x - fx * C.half[1], z - fz * C.half[1])
      const ahead = Math.max(groundAt(world, x + fx * (C.half[1] + 1.5), z + fz * (C.half[1] + 1.5)), world.waterY)
      const bank = behind - here
      if (bank < 0.15) continue
      // Its footprint (an ellipse a little larger than the sheet) is clear.
      const rx = [-fz, fx]
      let ok = true
      for (let k = 0; k < 24 && ok; k++) {
        const a = (k / 24) * Math.PI * 2
        for (const s of [0.35, 0.75, 1.08]) {
          const px = x + rx[0] * Math.cos(a) * C.half[0] * s + fx * Math.sin(a) * C.half[1] * s
          const pz = z + rx[1] * Math.cos(a) * C.half[0] * s + fz * Math.sin(a) * C.half[1] * s
          if (!inside(world, px, pz, 0.5)) ok = false
          else if (!clearOf(places, px, pz, C.clear)) ok = false
          else if (scatter.colonies.some((c) => Math.hypot(c.x - px, c.z - pz) < reach(c) + C.clear)) ok = false
        }
      }
      if (!ok) continue
      let near = Infinity
      for (const c of scatter.colonies) near = Math.min(near, Math.hypot(c.x - x, c.z - z) - c.radius)
      const water = ahead <= world.waterY + 0.02 ? 1 : smoothstep(0.6, 0, ahead - world.waterY)
      const score = smoothstep(0.15, 0.6, bank) + water + 1 / (1 + Math.abs(near - 9) * 0.3) - 0.05 * d.slope / 16
      if (!best || score > best.score) best = { x, z, f: [fx, fz], score }
    }
  }
  return best ? { centre: [best.x, best.z], forward: best.f, seed: Math.round((best.x + 20) * 131 + (best.z + 20) * 17) } : null
}

/**
 * The canopy's sheet. Over its footprint (an outline that wanders), it
 * stands at a height over the floor beneath it: nothing where it roots into
 * the bank behind it and along one flank, its free edge hanging unevenly at
 * the front (lower in lobes), rising inside to a roof whose highest part
 * lies off its middle. Two of its roots come down inside it to the ground,
 * as columns of the same sheet; a few openings break the roof, and its free
 * edge curls a little out and down. No two sides are alike, and from inside
 * its whole shape is not seen at once.
 *
 * Written into `film`; returns the points the presence meets (none in an
 * opening or beyond its outline) and its frame, for placing the arrival.
 */
export function buildCanopy(world, canopy, film) {
  const C = CANOPY
  const random = mulberry32(canopy.seed)
  const phases = Array.from({ length: 8 }, () => random() * 6.28)
  // Smooth wandering, periodic in an angle: two sines with the canopy's own phases.
  const noise = (k, s) => Math.sin(s * (1.3 + k * 0.7) + phases[k]) * 0.6 + Math.sin(s * (2.9 + k * 1.1) + phases[k + 3]) * 0.4
  const [cx, cz] = canopy.centre
  const [fx, fz] = canopy.forward
  const rx = [-fz, fx]
  const [A, B] = C.half
  const I = Math.ceil((2 * A) / C.spacing)
  const J = Math.ceil((2 * B) / C.spacing)
  const floor = (x, z) => Math.max(groundAt(world, x, z), world.waterY)
  // Its outline: radius 1 in (u, v), wandering.
  const outline = (th) => 1 + C.wander * noise(0, th)
  // Around its outline (θ: 0 one flank, π/2 the front over the water, π the
  // other flank, -π/2 the back): rooted behind and along one flank; the
  // front free and high, open to the water; the other flank hanging low in
  // a lobe, to be passed under only near its ends.
  const flank = random() < 0.5 ? 1 : -1
  const bump = (th, at, width) => Math.exp(-((Math.atan2(Math.sin(th - at), Math.cos(th - at)) / width) ** 2))
  const rootSide = flank > 0 ? -0.3 : Math.PI + 0.3
  const lobeSide = flank > 0 ? Math.PI + 0.15 : -0.15
  const rooted = (th) => clamp(smoothstep(0.2, -0.5, Math.sin(th)) + 0.9 * bump(th, rootSide, 0.5), 0, 1)
  const edgeHeight = (th) => (C.edge[0] + (C.edge[1] - C.edge[0]) * (0.5 + 0.5 * noise(1, th * 1.7))) * (1 - 0.5 * bump(th, lobeSide, 0.32))
  const peak = [0.28 * flank * -1 + (random() - 0.5) * 0.2, -0.25 + (random() - 0.5) * 0.15]
  const roofAt = (u, v) => {
    const g = Math.exp(-(((u - peak[0]) / 0.75) ** 2 + ((v - peak[1]) / 0.7) ** 2))
    // A slow fold across the roof, so it is not one smooth drape.
    const fold = 0.32 * Math.sin(u * 2.6 * flank + v * 1.4 + phases[7])
    return C.roof[0] + (C.roof[1] - C.roof[0]) * g + fold + 0.15 * noise(2, u * 3.1 + v * 1.7)
  }
  // Roots that come down inside it, and openings in its roof.
  // Roots: the sheet comes down and widens into a foot fused with the
  // ground, not to a point. Different sizes, not in a line with anything.
  const roots = [
    { u: -0.38 * flank, v: 0.05 + 0.1 * random(), r: 0.8 },
    { u: 0.3 * flank, v: 0.45 + 0.08 * random(), r: 0.6 },
  ]
  // Openings: one large and irregular, one long narrow slit, far apart and
  // elongated. (Two round holes side by side in a pale sheet read as eyes.)
  const openings = [
    { u: 0.12 * flank + 0.1 * random(), v: -0.12, ru: 0.21, rv: 0.085, tilt: 0.5 * flank },
    { u: -0.62 * flank, v: 0.5, ru: 0.06, rv: 0.2, tilt: -0.3 * flank },
  ]
  const opening = (u, v) => {
    let best = null
    for (const o of openings) {
      // In the opening's own (tilted) axes, its outline wandering a little.
      const c = Math.cos(o.tilt)
      const sn = Math.sin(o.tilt)
      const a = ((u - o.u) * c + (v - o.v) * sn) / o.ru
      const b = (-(u - o.u) * sn + (v - o.v) * c) / o.rv
      const rho = Math.hypot(a, b) / (1 + 0.18 * noise(3, Math.atan2(b, a) * 2))
      if (!best || rho < best.rho) best = { o, rho, a, b }
    }
    return best
  }
  const radial = (u, v) => {
    const th = Math.atan2(v, u)
    return { th, rho: Math.hypot(u, v) / outline(th) }
  }
  // The lattice's parameters: points just outside the outline or an opening
  // are moved onto it, so both are smooth curves.
  const du = 2 / I
  const dv = 2 / J
  const param = (i, j) => {
    let u = -1 + du * i
    let v = -1 + dv * j
    const r = radial(u, v)
    if (r.rho > 1 && r.rho < 1 + 1.6 * Math.max(du, dv)) {
      u /= r.rho
      v /= r.rho
    }
    const o = opening(u, v)
    const band = 1.3 * Math.max(du, dv) / Math.min(o.o.ru, o.o.rv)
    if (o.rho >= 1 && o.rho < 1 + band) {
      u = o.o.u + (u - o.o.u) / o.rho
      v = o.o.v + (v - o.o.v) / o.rho
    }
    return [u, v]
  }
  const pointAt = (u, v) => {
    const { th, rho } = radial(u, v)
    const root = rooted(th)
    const he = (1 - root) * edgeHeight(th) - root * 0.06
    // From the edge in toward the roof; where it roots, it peels up from the
    // ground slowly, lying low a long way in, as a skin of the ground would.
    const inward = 1 - Math.min(1, rho) ** 2
    let h = he + (roofAt(u, v) - he) * Math.pow(inward, 0.55 + 1.1 * root)
    for (const r of roots) {
      // The roof flows down into it as a funnel (its radius r in units, not
      // in the sheet's stretched parameters), and its tip is sunk well into
      // the ground, so where it meets the floor it opens into a foot rather
      // than ending in a point. (A flat-topped profile stood like a glass.)
      const q = (((u - r.u) * A) ** 2 + ((v - r.v) * B) ** 2) / (r.r * r.r)
      const g = Math.exp(-q)
      h = h * (1 - g) - 0.35 * g
    }
    // The free edge curls a little out and down.
    const lip = (1 - root) * smoothstep(0.78, 1, rho)
    const out = 0.45 * lip
    const lx = u * A + u * out
    const lz = v * B + v * out
    const x = cx + rx[0] * lx + fx * lz
    const z = cz + rx[1] * lx + fz * lz
    return [x, floor(x, z) + h - 0.35 * lip * lip, z, rho, root]
  }
  const P = []
  const keep = []
  for (let j = 0; j <= J; j++) {
    const row = []
    const krow = []
    for (let i = 0; i <= I; i++) {
      const [u, v] = param(i, j)
      const q = pointAt(u, v)
      row.push(q)
      krow.push(radial(u, v).rho <= 1 + 1e-6 && opening(u, v).rho >= 1 - 1e-6)
    }
    P.push(row)
    keep.push(krow)
  }
  const at = (i, j) => P[clamp(j, 0, J)][clamp(i, 0, I)]
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
  const norm = (p) => {
    const l = Math.hypot(...p) || 1
    return [p[0] / l, p[1] / l, p[2] / l]
  }
  const ids = []
  const met = []
  for (let j = 0; j <= J; j++) {
    const row = []
    for (let i = 0; i <= I; i++) {
      const p = P[j][i]
      const [u, v] = param(i, j)
      const n = norm(cross(sub(at(i + 1, j), at(i - 1, j)), sub(at(i, j + 1), at(i, j - 1))))
      const rim = Math.max(0, 1 - radial(u, v).rho) * 6
      const hole = Math.max(0, opening(u, v).rho - 1) * 3
      const edge = Math.min(1, rim, hole, 0.3 + 2 * p[4])
      const foot = [p[0], floor(p[0], p[2]), p[2]]
      film.set({ anchor: foot, birth: 0, span: 0.001, tone: 0.4 + 0.25 * random(), glow: 0.1, alpha: 0.34, open: 0.1, sway: 0 })
      row.push(film.vertex([p[0], p[1], p[2]], n, u * A, v * B, edge, 0))
      if (keep[j][i] && p[1] > groundAt(world, p[0], p[2]) - 0.05) met.push(p[0], p[1], p[2])
    }
    ids.push(row)
  }
  for (let j = 0; j < J; j++) {
    for (let i = 0; i < I; i++) {
      if (!(keep[j][i] && keep[j][i + 1] && keep[j + 1][i] && keep[j + 1][i + 1])) continue
      film.tri(ids[j][i], ids[j][i + 1], ids[j + 1][i])
      film.tri(ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i])
    }
  }
  return { met: new Float32Array(met), frame: { centre: [cx, cz], forward: [fx, fz], right: rx, half: [A, B] }, roots, flank }
}
