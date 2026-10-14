/**
 * The branching network: residual matter gradually becoming tissue around a
 * colony — something between mycelium, fine roots, veins and
 * crystallisation, never a tree, grass or decorative branches.
 *
 * Grown by a parametric, stochastic L-system and drawn by a turtle that
 * reads the world as it goes:
 *
 *     colony + sediment data (scatter.js)
 *       -> an accumulation field: where matter has settled around the colony
 *          (the membranes' bases, residue, the trail, the sediment record)
 *       -> axioms: where growth starts and why
 *            base     a few subdued structural roots from the membranes' feet
 *            trace    one along the residue trail
 *            micro    many small seeds scattered by the accumulation field,
 *                     and along the structural roots where matter settled
 *            climb    a few veins up into the larger membranes
 *       -> derivation: a few generations of rewriting (below)
 *       -> interpretation: a turtle on the ground (or on a membrane) that
 *          bends toward its tropism and stops at water, at the edge of its
 *          reach, where the accumulation thins out, or where it meets
 *          another branch
 *       -> translation into material: the ground network is not drawn as
 *          lines over the terrain but painted into a fine tissue map, draped
 *          on the ground and shaded as part of it (translucent, raised a
 *          little, partly beneath the surface); the membrane veins are faint
 *          translucent ribbons in the sheet
 *
 * The grammar. Modules are { s, ... } with parameters:
 *
 *     A(l, w, g, a)   an apex: segment length, width, order (generation of
 *                     branching), age along its own axis
 *     F(l, w, g)      grow one segment
 *     R(d)            turn by d radians (in the surface)
 *     [ ]             push / pop: a lateral branch
 *     T               a tip
 *
 *     A(l,w,g,a) : g ≥ G or a ≥ age(g)      -> F(l,w,g) T
 *                : p_lateral(g)             -> F(l,w,g) [ R(±θ) A(l·ks, w·qs, g+1, 0) ] R(∓δ) A(l·km, w·qm, g, a+1)
 *                : p_fork(g)                -> F(l,w,g) [ R(+θ1) A(…, g+1, 0) ] [ R(−θ2) A(…, g+1, 0) ] T
 *                : p_stop(g)                -> F(l,w,g) T
 *                : otherwise                -> F(l,w,g) R(±small) A(l·0.95, w·0.96, g, a+1)
 *
 * Laterals are monopodial and asymmetric (a continuing axis, a side branch
 * of a higher order, angles and length ratios drawn per branch), with an
 * occasional dichotomous fork, as in fungal and root growth. Every
 * probability, angle and ratio is drawn from a range, so no two branches
 * repeat.
 *
 * Study scope: one representative colony (the strongest site). The same
 * code grows every colony once `BRANCHING.colonies` is raised.
 */

import * as THREE from 'three'
import { mulberry32 } from './noise'
import { FormWriter, bloomSurfaces } from './traceForms'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

export const BRANCHING = {
  /** Colonies that grow a network, strongest site first (study: one). */
  colonies: 1,
  /** Highest order of branching, young colony to old (History matures them). */
  orders: [3, 5],
  /** Rewriting steps of the L-system. */
  steps: 26,
  /** How far the structural roots may reach from the colony, in colony radii. */
  reach: [0.75, 1.05],
  /** Transitions: strands that leave a membrane, cross a little air, and
   *  root into the ground network (a few per colony, not a design density). */
  transitions: 3,
  /** Micro growth: seeds per colony at Amount 1, and how far one may spread. */
  micro: { seeds: 420, reach: [0.45, 1.0] },
  /** The tissue map: texels per side, and the most ground it may cover (units). */
  map: { size: 2048, span: 8 },
  /** Distances at which the detail drops (camera to colony centre). */
  lod: [0, 8, 16],
  /** Most segments one colony may hold: a guard, not a design value. */
  budget: 40000,
}

/* --- the grammar --------------------------------------------------------- */

/**
 * Growth parameters of each kind of axiom (lengths and widths in world
 * units). Structural roots are few and short; micro growth is short-
 * stepped, irregular and branches densely; climbing veins rise and branch
 * little.
 */
const KINDS = {
  base: { segment: [0.1, 0.14], width: [0.012, 0.018], lateral: [0.22, 0.3], fork: 0.03, stop: [0.02, 0.12], age: [14, 3.0], angle: [0.45, 1.05], sideLen: [0.55, 0.75], sideWidth: [0.5, 0.66], wander: 0.2, tropism: [0.2] },
  trace: { segment: [0.1, 0.14], width: [0.011, 0.016], lateral: [0.2, 0.28], fork: 0.03, stop: [0.02, 0.1], age: [16, 3.4], angle: [0.35, 0.85], sideLen: [0.55, 0.72], sideWidth: [0.5, 0.62], wander: 0.14, tropism: [0.26] },
  micro: { segment: [0.022, 0.04], width: [0.0045, 0.008], lateral: [0.42, 0.55], fork: 0.08, stop: [0.03, 0.12], age: [12, 2.4], angle: [0.5, 1.1], sideLen: [0.6, 0.85], sideWidth: [0.62, 0.8], wander: 0.3, tropism: [0.05] },
  climb: { segment: [0.08, 0.11], width: [0.006, 0.009], lateral: [0.3, 0.2], fork: 0.0, stop: [0.04, 0.14], age: [9, 2.4], angle: [0.4, 0.8], sideLen: [0.55, 0.75], sideWidth: [0.5, 0.62], wander: 0.1, tropism: [0.2] },
}

/** One rewriting step of the whole string. */
function rewrite(modules, G, random) {
  const out = []
  const range = ([a, b]) => lerp(a, b, random())
  const side = () => (random() < 0.5 ? -1 : 1)
  for (const m of modules) {
    if (m.s !== 'A') {
      out.push(m)
      continue
    }
    const k = KINDS[m.kind]
    const { l, w, g, a } = m
    const F = { s: 'F', l, w, g }
    const maxAge = Math.max(2, Math.round(k.age[0] - k.age[1] * g))
    if (g >= G || a >= maxAge) {
      out.push(F, { s: 'T', g })
      continue
    }
    const pLateral = k.lateral[0] - (k.lateral[0] - k.lateral[1]) * (g / G)
    const pStop = k.stop[0] + (k.stop[1] - k.stop[0]) * (g / G)
    const r = random()
    const apex = (l2, w2, g2, a2) => ({ s: 'A', kind: m.kind, l: l2, w: w2, g: g2, a: a2 })
    if (r < pLateral && a > 0) {
      const s = side()
      out.push(
        F,
        { s: '[' },
        { s: 'R', d: s * range(k.angle) },
        apex(l * range(k.sideLen), w * range(k.sideWidth), g + 1, 0),
        { s: ']' },
        { s: 'R', d: -s * range([0.05, 0.2]) },
        apex(l * 0.96, w * 0.93, g, a + 1),
      )
    } else if (r < pLateral + k.fork && a > (g === 0 ? 6 : 1)) {
      out.push(
        F,
        { s: '[' },
        { s: 'R', d: range(k.angle) * 0.8 },
        apex(l * range(k.sideLen), w * 0.7, g + 1, 0),
        { s: ']' },
        { s: '[' },
        { s: 'R', d: -range(k.angle) * 0.8 },
        apex(l * range(k.sideLen), w * 0.7, g + 1, 0),
        { s: ']' },
      )
    } else if (r < pLateral + k.fork + pStop && a > 1) {
      out.push(F, { s: 'T', g })
    } else {
      out.push(F, { s: 'R', d: (random() - 0.5) * k.wander }, apex(l * 0.95, w * 0.96, g, a + 1))
    }
  }
  return out
}

/** Derive the string from an axiom: `steps` rewritings. */
function derive(axiom, G, steps, random) {
  let modules = [axiom]
  for (let n = 0; n < steps; n++) {
    if (!modules.some((m) => m.s === 'A')) break
    modules = rewrite(modules, G, random)
  }
  // Apices still growing when the derivation stops become tips.
  return modules.map((m) => (m.s === 'A' ? { s: 'T', g: m.g } : m))
}

/* --- the turtle ---------------------------------------------------------- */

/**
 * A space the turtle can walk: the ground around a colony, or one
 * membrane's surface. Each provides
 *   place(state)            -> { p, n } world position and surface normal
 *   step(state, l)          -> the state one segment on, or null where it may
 *                              not go (water, the edge of its reach, a rim)
 *   steer(state, kind)      -> heading it bends toward (tropism)
 */
function groundSpace(world, colony, reach, accumulation, field) {
  const d = {}
  const sample = (x, z) => world.sample(...world.toUV(x, z), d)
  return {
    place(s) {
      const [u, v] = world.toUV(s.x, s.z)
      const q = world.surface(u, v)
      return { p: [q.x, q.y, q.z], n: [q.nx, q.ny, q.nz] }
    },
    step(s, l) {
      const x = s.x + Math.cos(s.h) * l
      const z = s.z + Math.sin(s.h) * l
      const half = world.size / 2 - 0.3
      if (Math.abs(x) > half || Math.abs(z) > half) return 'edge'
      sample(x, z)
      if (d.depth < -0.04) return 'water'
      if (s.micro) {
        // Micro growth stays where matter has settled, close to its seed.
        if (field.at(x, z) < 0.12) return 'sparse'
        if (Math.hypot(x - s.sx, z - s.sz) > s.reach) return 'reach'
        return { ...s, x, z }
      }
      const dist = Math.hypot(x - colony.x, z - colony.z)
      // The reach is uneven: longer down the record, and with accumulation.
      if (dist > reach * (0.8 + 0.35 * d.trace + 0.25 * accumulation)) return 'reach'
      return { ...s, x, z }
    },
    steer(s, kind) {
      // A blend of the branch's own course (the heading it set out on: an
      // axis holds its direction, as a root does), outward from the colony,
      // downhill, and toward thicker record — each as a unit vector, so no
      // one of them can take over and wind a branch into a spiral.
      // Outward from where its root began, set back a little along its
      // first heading: a root leaving the anchor's foot spreads away from
      // it, rather than along the base line it started on.
      const ox = s.x - s.ox
      const oz = s.z - s.oz
      const ol = Math.hypot(ox, oz) || 1
      const e = 0.3
      const tx = sample(s.x + e, s.z).trace - sample(s.x - e, s.z).trace
      const tz = sample(s.x, s.z + e).trace - sample(s.x, s.z - e).trace
      const tl = Math.hypot(tx, tz)
      sample(s.x, s.z)
      const w = kind === 'trace' ? [0.45, 0.15, 0.55, 0.25] : kind === 'micro' ? [0.6, 0.3, 0.05, 0.2] : [0.5, 0.45, 0.12, 0.12]
      const vx = Math.cos(s.h0) * w[0] + (ox / ol) * w[1] + d.downX * w[2] + (tl > 0.02 ? (tx / tl) * w[3] : 0)
      const vz = Math.sin(s.h0) * w[0] + (oz / ol) * w[1] + d.downZ * w[2] + (tl > 0.02 ? (tz / tl) * w[3] : 0)
      return Math.atan2(vz, vx)
    },
  }
}

/**
 * A membrane's surface, from the columns its builder kept (traceForms.js):
 * the turtle walks in column/row coordinates and is placed just off the
 * sheet, so the veins lie in the translucent membrane.
 */
function membraneSpace(surface, top) {
  const { columns } = surface
  const I = columns.length - 1
  const J = columns[0].column.length - 1
  const at = (i, j) => {
    const i0 = Math.max(0, Math.min(I - 1, Math.floor(i)))
    const j0 = Math.max(0, Math.min(J - 1, Math.floor(j)))
    const fi = clamp01(i - i0)
    const fj = clamp01(j - j0)
    const a = columns[i0].column[j0]
    const b = columns[i0 + 1].column[j0]
    const c = columns[i0].column[j0 + 1]
    const e = columns[i0 + 1].column[j0 + 1]
    return [0, 1, 2].map((k) => (a[k] * (1 - fi) + b[k] * fi) * (1 - fj) + (c[k] * (1 - fi) + e[k] * fi) * fj)
  }
  const width = Math.hypot(...[0, 1, 2].map((k) => columns[I].column[0][k] - columns[0].column[0][k])) || 1
  return {
    place(s) {
      const p = at(s.i, s.j)
      const di = at(s.i + 0.5, s.j).map((v, k) => v - at(s.i - 0.5, s.j)[k])
      const dj = at(s.i, s.j + 0.5).map((v, k) => v - at(s.i, s.j - 0.5)[k])
      let n = [di[1] * dj[2] - di[2] * dj[1], di[2] * dj[0] - di[0] * dj[2], di[0] * dj[1] - di[1] * dj[0]]
      const len = Math.hypot(...n) || 1
      n = n.map((v) => v / len)
      // Just off the sheet, on the side facing up the slope of the lean.
      return { p: p.map((v, k) => v + n[k] * 0.006), n }
    },
    step(s, l) {
      const col = columns[Math.round(Math.max(0, Math.min(I, s.i)))]
      const rows = (l / Math.max(col.L, 0.05)) * J
      const cols = (l / width) * I
      const i = s.i + Math.sin(s.h) * cols
      const j = s.j + Math.cos(s.h) * rows
      if (i < 0.5 || i > I - 0.5 || j < 0 || j > top * J) return 'rim'
      return { ...s, i, j }
    },
    steer() {
      return 0 // straight up the sheet
    },
  }
}

/**
 * Interpret a derived string. Writes chains of points: a chain is one
 * branch from where it leaves its parent to its tip. A shared occupancy
 * grid lets a branch stop where it would run into another, which spaces the
 * network the way growing tissue spaces itself.
 */
function interpret(modules, start, space, kind, occupancy, tips, chains, random, budget, stops) {
  const k = KINDS[kind]
  const stack = []
  let s = { ...start }
  // A chain knows its ancestors, so a branch may run over its own parent's
  // ground (it leaves from it) but not over anyone else's.
  let chain = { points: [], g: 0, kind, lineage: new Set() }
  chain.lineage.add(chain)
  const push = (state, g, w) => {
    const { p, n } = space.place(state)
    chain.points.push({ p, n, w, arc: state.arc, g })
  }
  push(s, 0, modules.find((m) => m.s === 'F')?.w ?? 0.01)
  let dead = 0 // depth of a branch that has stopped: skip its modules
  for (const m of modules) {
    if (budget.left <= 0) break
    if (m.s === '[') {
      stack.push({ s, chain, dead })
      if (!dead) {
        const parent = chain
        chain = { points: [], g: parent.g + 1, kind, lineage: new Set(parent.lineage) }
        chain.lineage.add(chain)
        const last = parent.points.at(-1)
        if (last) chain.points.push({ ...last })
      } else dead++
      continue
    }
    if (m.s === ']') {
      const top = stack.pop()
      if (!dead && chain.points.length > 1) chains.push(chain)
      ;({ s, chain, dead } = top)
      continue
    }
    if (dead) continue
    if (m.s === 'R') {
      s = { ...s, h: s.h + m.d }
      // The first turn of a new branch sets its course, and its meander
      // starts afresh.
      if (chain.points.length <= 1) s = { ...s, h0: s.h, curv: 0 }
    } else if (m.s === 'F') {
      // Bend toward the tropism, a little more on the finer orders.
      const want = space.steer(s, kind)
      let dh = want - s.h
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      const pull = k.tropism[0] / (1 + 1.5 * m.g)
      // A meander: the turning rate itself drifts slowly, so a branch curves
      // one way and then the other instead of jittering. Micro growth is
      // more irregular: it wanders further and turns more sharply.
      const bound = kind === 'micro' ? 0.2 : 0.12
      const curv = Math.max(-bound, Math.min(bound, (s.curv ?? 0) * 0.8 + (random() - 0.5) * k.wander))
      s = { ...s, curv, h: s.h + dh * pull + curv }
      const next = space.step(s, m.l)
      if (typeof next === 'string') {
        stops[next] = (stops[next] ?? 0) + 1
        dead = 1
        continue
      }
      const key = occupancy ? occupancy.key(next) : null
      // Main axes pass over each other (and fuse where they cross, as
      // mycelium does); finer branches stop where they meet another's
      // ground, which spaces the network. A root's first steps leave its
      // membrane's foot, where the others start too: no meeting there.
      if (key && (m.g > 0 || kind === 'micro') && s.arc > (kind === 'micro' ? 0.05 : 0.25) && occupancy.blocked(key, chain)) {
        stops.meet = (stops.meet ?? 0) + 1
        dead = 1
        continue
      }
      s = { ...next, arc: s.arc + m.l }
      chain.g = m.g
      push(s, m.g, m.w)
      if (key) occupancy.add(key, chain)
      budget.left--
    } else if (m.s === 'T') {
      const last = chain.points.at(-1)
      if (last) tips.push({ ...last, g: m.g })
    }
  }
  if (chain.points.length > 1) chains.push(chain)
}

/**
 * Smooth a chain: three points per segment along a Catmull-Rom spline
 * through its points, each put back on the surface it grew on (the ground
 * is re-sampled; on a membrane the spline is close enough). The turtle's
 * straight steps become a continuous curve.
 */
function smoothChain(chain, ground) {
  const P = chain.points
  if (P.length < 3) return chain
  const out = []
  const cr = (a, b, c, d, t) => {
    const t2 = t * t
    const t3 = t2 * t
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  }
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[Math.max(0, k - 1)]
    const b = P[k]
    const c = P[k + 1]
    const d = P[Math.min(P.length - 1, k + 2)]
    for (let q = 0; q < 3; q++) {
      const t = q / 3
      const x = cr(a.p[0], b.p[0], c.p[0], d.p[0], t)
      const z = cr(a.p[2], b.p[2], c.p[2], d.p[2], t)
      const lerpN = (key) => b[key] + (c[key] - b[key]) * t
      if (ground) {
        const { p, n } = ground.place({ x, z })
        out.push({ p, n, w: lerpN('w'), arc: lerpN('arc'), g: b.g })
      } else {
        const y = cr(a.p[1], b.p[1], c.p[1], d.p[1], t)
        out.push({ p: [x, y, z], n: b.n, w: lerpN('w'), arc: lerpN('arc'), g: b.g })
      }
    }
  }
  out.push(P[P.length - 1])
  return { ...chain, points: out }
}

/** Occupancy on the ground, in cells of `size` world units. */
function makeOccupancy(size) {
  const cells = new Map()
  return {
    key: (s) => `${Math.floor(s.x / size)},${Math.floor(s.z / size)}`,
    blocked(key, chain) {
      const owner = cells.get(key)
      return owner !== undefined && !chain.lineage.has(owner)
    },
    add(key, chain) {
      if (!cells.has(key)) cells.set(key, chain)
    },
  }
}

/* --- where matter has settled ------------------------------------------ */

/**
 * The colony's accumulation field, 0..1 on a grid over its ground: high at
 * the membranes' bases (their whole base line), where residue lies, along
 * the trail, and where the sediment record is thick; nothing far from the
 * colony. Micro growth is seeded by it and stops where it thins.
 */
function accumulationField(scatter, world, colony) {
  const { layers } = scatter
  const blooms = layers.bloom.instances.filter((b) => b.colony === colony.index)
  const deps = layers.shard.instances.filter((s) => s.colony === colony.index)
  const capsules = blooms.map((b) => {
    const half = (b.width ?? b.height) * 0.5
    const lx = -Math.sin(b.lean) * half
    const lz = Math.cos(b.lean) * half
    return { ax: b.p[0] - lx, az: b.p[2] - lz, bx: b.p[0] + lx, bz: b.p[2] + lz, r: 0.3 + 0.22 * b.height, w: b.role === 'anchor' ? 1 : 0.8 }
  })
  const spots = []
  for (const dep of deps) {
    for (const pl of dep.plates) spots.push({ x: pl.x, z: pl.z, r: 0.22 + pl.len, w: 0.75 })
    for (const g of dep.beads) spots.push({ x: g.x, z: g.z, r: 0.14, w: 0.45 })
    if (dep.kind === 'trail' && dep.path) for (const [x, z, fade] of dep.path) spots.push({ x, z, r: 0.18 + 0.1 * fade, w: 0.6 * fade + 0.2 })
    if (dep.kind === 'heap') spots.push({ x: dep.center[0], z: dep.center[2], r: dep.radius + 0.2, w: 0.9 })
  }
  // Bounds: everything above, with room to fade out; square, capped.
  let minX = colony.x - 1
  let maxX = colony.x + 1
  let minZ = colony.z - 1
  let maxZ = colony.z + 1
  for (const c of capsules) {
    minX = Math.min(minX, c.ax - c.r, c.bx - c.r)
    maxX = Math.max(maxX, c.ax + c.r, c.bx + c.r)
    minZ = Math.min(minZ, c.az - c.r, c.bz - c.r)
    maxZ = Math.max(maxZ, c.az + c.r, c.bz + c.r)
  }
  for (const sp of spots) {
    minX = Math.min(minX, sp.x - sp.r)
    maxX = Math.max(maxX, sp.x + sp.r)
    minZ = Math.min(minZ, sp.z - sp.r)
    maxZ = Math.max(maxZ, sp.z + sp.r)
  }
  const margin = 0.9
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const span = Math.min(BRANCHING.map.span, Math.max(maxX - minX, maxZ - minZ) + 2 * margin)
  const bounds = { minX: cx - span / 2, minZ: cz - span / 2, span }

  const N = 128
  const grid = new Float32Array(N * N)
  const d = {}
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = bounds.minX + ((i + 0.5) / N) * span
      const z = bounds.minZ + ((j + 0.5) / N) * span
      let a = 0
      for (const c of capsules) {
        const vx = c.bx - c.ax
        const vz = c.bz - c.az
        const t = clamp01(((x - c.ax) * vx + (z - c.az) * vz) / (vx * vx + vz * vz || 1))
        const dd = Math.hypot(x - c.ax - vx * t, z - c.az - vz * t) / c.r
        a = Math.max(a, c.w * Math.exp(-dd * dd))
      }
      for (const sp of spots) {
        const dd = Math.hypot(x - sp.x, z - sp.z) / sp.r
        if (dd < 3) a = Math.max(a, sp.w * Math.exp(-dd * dd))
      }
      world.sample(...world.toUV(x, z), d)
      // The record thickens it; water and distance from the colony end it.
      const far = Math.hypot(x - colony.x, z - colony.z) / (colony.radius * 1.3)
      a = clamp01(a * (0.55 + 0.6 * d.trace) * (1 - smoothstep(0.75, 1.1, far))) * (d.depth < -0.02 ? 0 : 1)
      grid[j * N + i] = a
    }
  }
  const at = (x, z) => {
    const fx = ((x - bounds.minX) / span) * N - 0.5
    const fz = ((z - bounds.minZ) / span) * N - 0.5
    const i0 = Math.max(0, Math.min(N - 2, Math.floor(fx)))
    const j0 = Math.max(0, Math.min(N - 2, Math.floor(fz)))
    if (fx < -0.5 || fz < -0.5 || fx > N - 0.5 || fz > N - 0.5) return 0
    const tx = clamp01(fx - i0)
    const tz = clamp01(fz - j0)
    const g = (i, j) => grid[j * N + i]
    return (g(i0, j0) * (1 - tx) + g(i0 + 1, j0) * tx) * (1 - tz) + (g(i0, j0 + 1) * (1 - tx) + g(i0 + 1, j0 + 1) * tx) * tz
  }
  return { at, bounds, capsules, blooms }
}

/* --- transitions: membrane -> strand -> ground network ------------------- */

/**
 * The few places where the network visibly belongs to a membrane. On the
 * larger membranes, where the sheet has begun to rise (0.15–0.45 above the
 * ground), a strand leaves the sheet's surface on the side facing settled
 * matter, crosses a little air under tension, and touches down 0.5–1 units
 * away, where it roots into the ground network. Each carries:
 *   adhered   points along the sheet above the leaving point: the strand
 *             running in the membrane before it detaches
 *   P         where it leaves the sheet (just off it), and the sheet's normal
 *   T         where it touches down, and the heading it continues on
 */
function transitionSites(world, colony, field, random) {
  const ground = (x, z) => world.groundY(...world.toUV(x, z))
  const d = {}
  const land = (x, z) => world.sample(...world.toUV(x, z), d).depth > 0.03
  const candidates = field.blooms
    .filter((b) => bloomSurfaces.get(b) && (b.role === 'anchor' || b.height > 0.6))
    .sort((a, b) => b.height - a.height)
  const out = []
  for (const b of candidates) {
    const columns = bloomSurfaces.get(b).columns
    const I = columns.length - 1
    // The anchor gets two, set apart along its base line; others one.
    const picks = b.role === 'anchor' ? [lerp(0.2, 0.38, random()), lerp(0.62, 0.8, random())] : [lerp(0.3, 0.7, random())]
    for (const f of picks) {
      if (out.length >= BRANCHING.transitions) break
      const i = Math.round(f * I)
      const col = columns[i].column
      const foot = col[0]
      const g0 = ground(foot[0], foot[2])
      const want = lerp(0.25, 0.55, random()) * Math.min(1, b.height / 1.2)
      let j = col.findIndex((p) => p[1] - ground(p[0], p[2]) >= want)
      if (j < 2) continue
      const P = col[j]
      // The sheet's normal at P, from its neighbours.
      const di = columns[Math.min(I, i + 1)].column[j].map((v, k) => v - columns[Math.max(0, i - 1)].column[j][k])
      const dj = col[Math.min(col.length - 1, j + 1)].map((v, k) => v - col[j - 1][k])
      let n = [di[1] * dj[2] - di[2] * dj[1], di[2] * dj[0] - di[0] * dj[2], di[0] * dj[1] - di[1] * dj[0]]
      const nl = Math.hypot(...n) || 1
      n = n.map((v) => v / nl)
      // Leave on the side with more settled matter beyond it.
      let hx = n[0]
      let hz = n[2]
      const hl = Math.hypot(hx, hz)
      if (hl < 0.2) continue
      hx /= hl
      hz /= hl
      const side = field.at(P[0] + hx * 0.8, P[2] + hz * 0.8) >= field.at(P[0] - hx * 0.8, P[2] - hz * 0.8) ? 1 : -1
      hx *= side
      hz *= side
      // Turned a little, so it does not leave square to the sheet.
      const turn = (random() - 0.5) * 0.7
      const dx = hx * Math.cos(turn) - hz * Math.sin(turn)
      const dz = hx * Math.sin(turn) + hz * Math.cos(turn)
      const heading0 = Math.atan2(dz, dx)
      let reach = lerp(0.55, 1.0, random()) * (0.6 + 0.4 * Math.min(1, b.height / 1.5))
      let T = null
      for (let k = 0; k < 4 && !T; k++, reach *= 0.75) {
        const tx = foot[0] + dx * reach
        const tz = foot[2] + dz * reach
        if (land(tx, tz)) T = [tx, ground(tx, tz), tz]
      }
      if (!T) continue
      // The strand in the sheet above P: a short run gathered diagonally
      // across it, from a little higher and to one side, the way a fold
      // runs. Read off the sheet's grid between its points.
      const sheetAt = (fi, fj) => {
        fi = Math.max(0, Math.min(I, fi))
        const i0 = Math.min(I - 1, Math.floor(fi))
        const at = (ii, fj2) => {
          const c = columns[ii].column
          const f = Math.max(0, Math.min(c.length - 1, fj2))
          const j0 = Math.min(c.length - 2, Math.floor(f))
          return c[j0].map((v, k) => lerp(v, c[j0 + 1][k], f - j0))
        }
        const a = at(i0, fj)
        const c = at(i0 + 1, fj)
        return a.map((v, k) => lerp(v, c[k], fi - i0))
      }
      // Rows and columns are not evenly spaced, so walk the sheet to the
      // lengths: up the column, then across.
      const dist = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2])
      const runLength = lerp(0.18, 0.3, random())
      let rise = 0
      while (rise < col.length - 1 - j && dist(sheetAt(i, j + rise), P) < runLength) rise += 0.25
      // Coming from the side away from where it will lean, so the run in
      // the sheet and the free span are one sweep, not a kink.
      const lean = di[0] * Math.cos(heading0) + di[2] * Math.sin(heading0)
      const sideways = Math.abs(lean) > 1e-4 ? -Math.sign(lean) : random() < 0.5 ? -1 : 1
      const sideLength = lerp(0.08, 0.16, random())
      const top = sheetAt(i, j + rise)
      let aside = 0
      while (i + aside > 0 && i + aside < I && dist(sheetAt(i + aside, j + rise), top) < sideLength) aside += sideways * 0.25
      const adhered = []
      for (let k = 12; k >= 0; k--) {
        const t = k / 12
        adhered.push(sheetAt(i + aside * Math.pow(t, 0.7), j + rise * t))
      }
      out.push({ bloom: b, P, n: n.map((v) => v * side), adhered, T, heading: heading0, g0, seed: random() })
    }
  }
  return out
}

/* --- seeding from the colony --------------------------------------------- */

/**
 * The structural axioms and the climbing veins: few, short, from the
 * membranes' feet, the anchor toward its larger satellites, and the trail.
 */
function structuralAxioms(scatter, world, colony, random, amount, blooms) {
  const out = []
  const d = {}
  const sample = (x, z) => world.sample(...world.toUV(x, z), d)
  const roots = (n) => Math.max(1, Math.round(n * (0.4 + 0.9 * amount)))

  // At the foot of every membrane, along its base line. The anchor's roots
  // spread all round (spaced by the golden angle, never evenly), leaning
  // downhill toward the water; a satellite's lead outward.
  sample(colony.x, colony.z)
  const downhill = Math.atan2(d.downZ, d.downX)
  let turn = random() * Math.PI * 2
  for (const b of blooms) {
    const half = (b.width ?? b.height) * 0.5
    const anchor = b.role === 'anchor'
    const n = roots(anchor ? 4 : b.role === 'footing' ? 0.6 : 1)
    for (let k = 0; k < n; k++) {
      const f = (random() - 0.5) * 1.6
      const x = b.p[0] - Math.sin(b.lean) * half * f
      const z = b.p[2] + Math.cos(b.lean) * half * f
      let h
      if (anchor) {
        turn += 2.39996 + (random() - 0.5) * 0.5
        const a = Math.atan2(Math.sin(turn), Math.cos(turn))
        h = downhill + a * (0.8 + 0.2 * Math.abs(a) / Math.PI)
      } else {
        h = Math.atan2(z - colony.z, x - colony.x) + (random() - 0.5) * 1.1
      }
      out.push({ kind: 'base', x, z, h, scale: anchor ? 1 : 0.75 })
    }
    // From the anchor's foot toward its larger satellites: the connections
    // the colony made, which the network follows.
    if (!anchor && b.role === 'secondary' && b.height > 0.7) {
      const a0 = blooms.find((m) => m.role === 'anchor')
      if (a0) out.push({ kind: 'base', x: a0.p[0], z: a0.p[2], h: Math.atan2(b.p[2] - a0.p[2], b.p[0] - a0.p[0]) + (random() - 0.5) * 0.3, scale: 0.85 })
    }
    // A few veins climb into the larger membranes.
    const surface = bloomSurfaces.get(b)
    if (surface && (anchor || b.height > 0.9)) {
      const climbs = anchor ? roots(2) : 1
      const I = surface.columns.length - 1
      for (let k = 0; k < climbs; k++) {
        out.push({ kind: 'climb', surface, i: lerp(0.15, 0.85, random()) * I, j: 0, h: (random() - 0.5) * 0.5, top: lerp(0.4, 0.7, random()), scale: 1 })
      }
    }
  }

  // Along the residue trail.
  for (const dep of scatter.layers.shard.instances) {
    if (dep.colony !== colony.index || dep.kind !== 'trail' || !(dep.path?.length > 2)) continue
    const [x, z] = dep.path[Math.min(2, dep.path.length - 1)]
    sample(x, z)
    out.push({ kind: 'trace', x, z, h: Math.atan2(d.downZ, d.downX), scale: 1 })
  }
  return out
}

/**
 * Micro seeds: scattered over the colony's ground in proportion to the
 * accumulation (squared, so they gather where matter has settled most),
 * and along the structural roots wherever they pass through it.
 */
function microAxioms(field, random, amount, structural) {
  const out = []
  const { bounds } = field
  const want = Math.round(0.6 * BRANCHING.micro.seeds * (0.25 + 0.75 * amount))
  for (let k = 0; k < want * 30 && out.length < want; k++) {
    const x = bounds.minX + random() * bounds.span
    const z = bounds.minZ + random() * bounds.span
    const a = field.at(x, z)
    if (random() > a * a) continue
    out.push({ kind: 'micro', x, z, h: random() * Math.PI * 2, a })
  }
  for (const chain of structural) {
    if (chain.kind === 'climb') continue
    // Fine growth off the roots wherever they pass through settled matter,
    // so the micro growth is continuous with them.
    for (let k = 2; k < chain.points.length; k += 2) {
      const p = chain.points[k]
      const a = field.at(p.p[0], p.p[2])
      if (random() > 0.85 * a) continue
      out.push({ kind: 'micro', x: p.p[0], z: p.p[2], h: random() * Math.PI * 2, a })
    }
  }
  return out
}

/* --- growth -------------------------------------------------------------- */

/**
 * Grow the network of the strongest colonies: the structural roots first,
 * then the micro growth around them, as chains of points with their order,
 * arc length and kind.
 */
export function growBranching(scatter, world, { seed = 1, amount = 0.6, accumulation = 0.5 } = {}) {
  if (!scatter || amount <= 0) return []
  // Colonies are numbered by the strength of their site (scatter.js): the
  // strongest first.
  const colonies = [...scatter.colonies].sort((a, b) => a.index - b.index).slice(0, BRANCHING.colonies)
  return colonies.map((colony) => {
    const random = mulberry32((seed | 0) * 2654435 + colony.index * 97 + 13)
    const range = ([a, b]) => lerp(a, b, random())
    const M = colony.maturity
    const G = Math.round(lerp(BRANCHING.orders[0], BRANCHING.orders[1], M))
    const reach = colony.radius * lerp(BRANCHING.reach[0], BRANCHING.reach[1], M)
    const field = accumulationField(scatter, world, colony)
    const ground = groundSpace(world, colony, reach, accumulation, field)
    const chains = []
    const tips = []
    const budget = { left: BRANCHING.budget }
    const stops = {}

    // Structure first.
    const occupancy = makeOccupancy(0.05)
    const seeds = structuralAxioms(scatter, world, colony, random, amount, field.blooms)
    for (const ax of seeds) {
      const k = KINDS[ax.kind]
      const modules = derive({ s: 'A', kind: ax.kind, l: range(k.segment) * ax.scale, w: range(k.width) * ax.scale, g: 0, a: 0 }, Math.min(G, 3), BRANCHING.steps, random)
      if (ax.kind === 'climb') {
        interpret(modules, { i: ax.i, j: ax.j, h: ax.h, h0: ax.h, arc: 0 }, membraneSpace(ax.surface, ax.top), 'climb', null, tips, chains, random, budget, stops)
      } else {
        const start = { x: ax.x, z: ax.z, h: ax.h, h0: ax.h, arc: 0, ox: ax.x - Math.cos(ax.h) * 0.8, oz: ax.z - Math.sin(ax.h) * 0.8 }
        interpret(modules, start, ground, ax.kind, occupancy, tips, chains, random, budget, stops)
      }
    }
    // The transitions: where each strand touches down, a root continues the
    // strand into the ground (on its own heading), and a little micro growth
    // gathers around it.
    const transitions = transitionSites(world, colony, field, random)
    for (const tr of transitions) {
      const k = KINDS.base
      const modules = derive({ s: 'A', kind: 'base', l: range(k.segment), w: range(k.width) * 0.9, g: 0, a: 0 }, Math.min(G, 3), BRANCHING.steps, random)
      const before = chains.length
      const start = { x: tr.T[0], z: tr.T[2], h: tr.heading, h0: tr.heading, arc: 0, ox: tr.T[0] - Math.cos(tr.heading) * 0.8, oz: tr.T[2] - Math.sin(tr.heading) * 0.8 }
      interpret(modules, start, ground, 'base', occupancy, tips, chains, random, budget, stops)
      for (let c = before; c < chains.length; c++) chains[c].transition = true
    }
    const structural = chains.slice()

    // Then the micro growth, on a finer spacing of its own.
    const fine = makeOccupancy(0.012)
    const micro = microAxioms(field, random, amount, structural)
    for (const tr of transitions) {
      for (let k = 0; k < 7; k++) {
        const a = random() * Math.PI * 2
        const r = 0.05 + 0.25 * random()
        micro.push({ kind: 'micro', x: tr.T[0] + Math.cos(a) * r, z: tr.T[2] + Math.sin(a) * r, h: tr.heading + (random() - 0.5) * 2.4, a: 1 })
      }
    }
    for (const ax of micro) {
      const k = KINDS.micro
      const modules = derive({ s: 'A', kind: 'micro', l: range(k.segment), w: range(k.width) * (0.7 + 0.5 * ax.a), g: 0, a: 0 }, G, BRANCHING.steps, random)
      const start = { x: ax.x, z: ax.z, h: ax.h, h0: ax.h, arc: 0, ox: ax.x - Math.cos(ax.h) * 0.2, oz: ax.z - Math.sin(ax.h) * 0.2, micro: true, sx: ax.x, sz: ax.z, reach: range(BRANCHING.micro.reach) * (0.6 + 0.6 * ax.a) }
      interpret(modules, start, ground, 'micro', fine, tips, chains, random, budget, stops)
    }

    // Smooth every chain onto its surface.
    for (let c = 0; c < chains.length; c++) chains[c] = smoothChain(chains[c], chains[c].kind === 'climb' ? null : ground)
    const stats = {
      axioms: seeds.length + micro.length,
      kinds: [...seeds, ...micro].reduce((n, a) => ({ ...n, [a.kind]: (n[a.kind] ?? 0) + 1 }), {}),
      chains: chains.length,
      segments: BRANCHING.budget - budget.left,
      tips: tips.length,
      stops,
    }
    stats.transitions = transitions.length
    return { colony, chains, tips, orders: G, reach, field, transitions, stats }
  })
}

/* --- translation into material ------------------------------------------- */

const hash = (v) => {
  const s = Math.sin(v * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

/** Smooth 1D value noise, for how far a stretch of branch has surfaced. */
const noise1 = (x) => {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return lerp(hash(i * 1.37 + 0.11), hash((i + 1) * 1.37 + 0.11), u)
}

/**
 * Paint the ground network into a tissue map over the colony's ground:
 *   R  coverage: how much tissue is here (anti-aliased, with sub-texel
 *      branches given a share of a texel rather than a whole one)
 *   G  core: the thinner, denser middle of each branch
 *   B  fineness: 0 on the structural roots, 1 on the finest growth
 *   A  surfaced: 0 where the branch runs beneath the surface, 1 where it
 *      has come through it
 * Overlaps take the maximum, never the sum, so crossings do not brighten.
 * Every branch fades where the accumulation thins, so nothing runs out
 * bright over empty ground; the structural roots are drawn subdued.
 */
function growthBounds(net) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const c of net.chains) {
    if (c.kind === 'climb') continue
    for (const p of c.points) {
      minX = Math.min(minX, p.p[0])
      maxX = Math.max(maxX, p.p[0])
      minZ = Math.min(minZ, p.p[2])
      maxZ = Math.max(maxZ, p.p[2])
    }
  }
  if (!Number.isFinite(minX)) return net.field.bounds
  const span = Math.min(BRANCHING.map.span, Math.max(maxX - minX, maxZ - minZ) + 0.6)
  return { minX: (minX + maxX) / 2 - span / 2, minZ: (minZ + maxZ) / 2 - span / 2, span }
}

function paintTissue(net, bounds) {
  const size = BRANCHING.map.size
  const texel = bounds.span / size
  const data = new Uint8Array(size * size * 4)
  const toT = (x, z) => [((x - bounds.minX) / bounds.span) * size, ((z - bounds.minZ) / bounds.span) * size]

  for (const chain of net.chains) {
    if (chain.kind === 'climb') continue
    const structural = chain.kind !== 'micro'
    const seedHash = hash(chain.points[0].p[0] * 7.1 + chain.points[0].p[2] * 3.3 + chain.g * 1.7)
    const P = chain.points
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k]
      const b = P[k + 1]
      const [ax, az] = toT(a.p[0], a.p[2])
      const [bx, bz] = toT(b.p[0], b.p[2])
      const tone = (p) => {
        const acc = net.field.at(p.p[0], p.p[2])
        const fade = Math.max(chain.transition ? 0.5 * (1 - smoothstep(0.1, 0.35, p.arc)) : 0, smoothstep(0.06, 0.4, acc))
        // Structural roots are subdued; finer orders a little lighter. A
        // transition root carries its strand on into the ground, a little
        // stronger at first, fading into the network within 0.35 units.
        let base = structural ? 0.32 + 0.1 * (1 - p.g / 3) : 0.55 + 0.35 * Math.min(1, p.g / 3)
        if (chain.transition && p.g === 0) base += 0.12 * (1 - smoothstep(0, 0.3, p.arc))
        return base * fade
      }
      const ia = tone(a)
      const ib = tone(b)
      if (ia < 0.01 && ib < 0.01) continue
      // Structural roots are broader and softer: a raised vein in the
      // surface rather than a line.
      const wa = (a.w * (structural ? 1.4 : 1)) / texel
      const wb = (b.w * (structural ? 1.4 : 1)) / texel
      const ea = noise1(a.arc * (structural ? 2.2 : 3.5) + seedHash * 40)
      const eb = noise1(b.arc * (structural ? 2.2 : 3.5) + seedHash * 40)
      const fineness = structural ? 0 : Math.min(1, 0.35 + 0.22 * a.g)
      const pad = Math.max(wa, wb) + 2
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad))
      const i1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + pad))
      const j0 = Math.max(0, Math.floor(Math.min(az, bz) - pad))
      const j1 = Math.min(size - 1, Math.ceil(Math.max(az, bz) + pad))
      const vx = bx - ax
      const vz = bz - az
      const vv = vx * vx + vz * vz || 1
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const px = i + 0.5
          const pz = j + 0.5
          const t = clamp01(((px - ax) * vx + (pz - az) * vz) / vv)
          const dist = Math.hypot(px - ax - vx * t, pz - az - vz * t)
          let hw = lerp(wa, wb, t)
          let I = lerp(ia, ib, t)
          // Thinner than a texel: a share of one.
          if (hw < 0.6) {
            I *= hw / 0.6
            hw = 0.6
          }
          const cov = clamp01((hw + 0.7 - dist) / 1.4)
          if (cov <= 0) continue
          const core = clamp01((hw * 0.4 + 0.6 - dist) / 1.2)
          const e = lerp(ea, eb, t)
          const o = (j * size + i) * 4
          const c = Math.round(cov * I * 255)
          if (c > data[o]) {
            data[o] = c
            data[o + 2] = Math.round(fineness * 255)
            data[o + 3] = Math.round(e * 255)
          }
          const g = Math.round(core * I * 255)
          if (g > data[o + 1]) data[o + 1] = g
        }
      }
    }
  }
  // A few soft nodes where growth gathered (some micro tips): thickenings in
  // the tissue, not lights.
  for (const t of net.tips) {
    if (t.g < 2 || hash(t.p[0] * 13.1 + t.p[2] * 7.7) > 0.12) continue
    const acc = net.field.at(t.p[0], t.p[2])
    if (acc < 0.2) continue
    const [cx, cz] = toT(t.p[0], t.p[2])
    const r = (0.006 + 0.008 * hash(t.p[0] * 3.7)) / texel
    for (let j = Math.max(0, Math.floor(cz - r - 2)); j <= Math.min(size - 1, Math.ceil(cz + r + 2)); j++) {
      for (let i = Math.max(0, Math.floor(cx - r - 2)); i <= Math.min(size - 1, Math.ceil(cx + r + 2)); i++) {
        const dist = Math.hypot(i + 0.5 - cx, j + 0.5 - cz)
        const cov = clamp01((r + 0.7 - dist) / 1.4) * 0.6 * acc
        const o = (j * size + i) * 4
        const c = Math.round(cov * 255)
        if (c > data[o]) {
          data[o] = c
          data[o + 2] = 255
          data[o + 3] = 200
        }
      }
    }
  }
  return data
}

/**
 * The drape the tissue map is shown on: a grid over the colony's ground,
 * following the terrain just above it, with the cells the map leaves empty
 * dropped. Levels of detail are coarser grids (the map itself is mipmapped,
 * so its detail falls away with distance on its own).
 */
function drapeGeometry(world, bounds, data, cells, birthOf) {
  const size = BRANCHING.map.size
  // Which cells hold any tissue: the map's maximum over each cell, dilated.
  const occ = new Uint8Array(cells * cells)
  const per = size / cells
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      let m = 0
      for (let j = Math.floor(cj * per); j < Math.floor((cj + 1) * per) && !m; j += 2) {
        for (let i = Math.floor(ci * per); i < Math.floor((ci + 1) * per); i += 2) {
          if (data[(j * size + i) * 4] > 3) {
            m = 1
            break
          }
        }
      }
      occ[cj * cells + ci] = m
    }
  }
  const keep = (ci, cj) => {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di
      const j = cj + dj
      if (i >= 0 && j >= 0 && i < cells && j < cells && occ[j * cells + i]) return true
    }
    return false
  }
  const w = new FormWriter()
  const index = new Map()
  const vertex = (i, j) => {
    const key = j * (cells + 1) + i
    if (index.has(key)) return index.get(key)
    const x = bounds.minX + (i / cells) * bounds.span
    const z = bounds.minZ + (j / cells) * bounds.span
    const q = world.surface(...world.toUV(x, z))
    const p = [q.x + q.nx * 0.014, q.y + q.ny * 0.014, q.z + q.nz * 0.014]
    w.set({ anchor: p, birth: birthOf(x, z), span: 0.18, tone: 1, glow: 0, alpha: 1, open: 0, sway: 0 })
    const v = w.vertex(p, [q.nx, q.ny, q.nz], i / cells, j / cells)
    index.set(key, v)
    return v
  }
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      if (!keep(ci, cj)) continue
      const a = vertex(ci, cj)
      const b = vertex(ci + 1, cj)
      const c = vertex(ci, cj + 1)
      const d = vertex(ci + 1, cj + 1)
      w.tri(a, c, b)
      w.tri(b, c, d)
    }
  }
  return w.toGeometry()
}

/**
 * The veins in the membranes: faint translucent ribbons just off the sheet,
 * tapering, their across coordinate in uv.x (−1..1) and arc length in uv.y.
 */
function veinGeometry(chains, birthOf) {
  const w = new FormWriter()
  for (const chain of chains) {
    if (chain.kind !== 'climb') continue
    const pts = chain.points
    const n = pts.length
    if (n < 2) continue
    const rows = []
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)].p
      const b = pts[Math.min(n - 1, k + 1)].p
      const T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const nrm = pts[k].n
      let S = [nrm[1] * T[2] - nrm[2] * T[1], nrm[2] * T[0] - nrm[0] * T[2], nrm[0] * T[1] - nrm[1] * T[0]]
      const sl = Math.hypot(...S) || 1
      S = S.map((v) => v / sl)
      const t = k / (n - 1)
      const width = pts[k].w * (1 - 0.7 * t) * (k === n - 1 ? 0.2 : 1)
      const c = pts[k].p
      w.set({ anchor: c, birth: birthOf(c[0], c[2]), span: 0.12, tone: (0.5 - 0.1 * chain.g) * (1 - 0.6 * t), glow: hash(c[0] * 3.1 + chain.g), alpha: 1, open: width, sway: 0 })
      rows.push([
        w.vertex([c[0] - S[0] * width, c[1] - S[1] * width, c[2] - S[2] * width], nrm, -1, pts[k].arc),
        w.vertex([c[0] + S[0] * width, c[1] + S[1] * width, c[2] + S[2] * width], nrm, 1, pts[k].arc),
      ])
    }
    for (let k = 0; k < n - 1; k++) {
      const [a, b] = rows[k]
      const [c, d] = rows[k + 1]
      w.tri(a, c, b)
      w.tri(b, c, d)
    }
  }
  return w.toGeometry()
}

/**
 * The transition strands: each a small bundle of fibres (one main, two
 * finer) that runs in the membrane, leaves it at a slight thickening, crosses
 * a little air under tension, touches down at a shallow angle and sinks into
 * the ground, splaying, where the painted network carries it on. Fibres share
 * the leaving point and drift apart toward the ground. Per vertex, aLook is
 * (tone, fibre, alpha, 0); alpha rises out of the sheet and falls to nothing
 * as the fibre sinks.
 */
function tendrilGeometry(world, transitions, birthOf) {
  const w = new FormWriter()
  const ground = (x, z) => world.groundY(...world.toUV(x, z))
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

  for (const tr of transitions) {
    const random = mulberry32(Math.floor(tr.seed * 1e6) + 17)
    const off = (p, k) => add(p, tr.n, k)
    const P = off(tr.P, 0.012)
    const hx = Math.cos(tr.heading)
    const hz = Math.sin(tr.heading)
    const span = Math.hypot(tr.T[0] - P[0], tr.T[2] - P[2])
    const L = Math.hypot(tr.T[0] - P[0], tr.T[1] - P[1], tr.T[2] - P[2])
    const bow = (random() < 0.5 ? -1 : 1) * lerp(0.1, 0.22, random()) * span
    // It peels off the sheet, continuing the way it ran in it but turned
    // outward, and comes down onto the ground at a shallow angle from a
    // little above: a cubic between the two, pulled, not lying.
    const A = tr.adhered
    const dIn = norm(sub(A[A.length - 1], A[Math.max(0, A.length - 4)]))
    const out = norm(add(add(tr.n.map((v) => v * 0.65), dIn, 0.6), [0, 1, 0], 0.1))
    const lift = lerp(0.04, 0.1, random()) * Math.min(1, span / 0.7)
    const B1 = add(P, out, 0.38 * L)
    const B2 = [tr.T[0] - hx * 0.38 * span, tr.T[1] + 0.02 + lift, tr.T[2] - hz * 0.38 * span]
    const B3 = [tr.T[0], tr.T[1] + 0.01, tr.T[2]]
    const bez = (t, k) => {
      const s = 1 - t
      return s * s * s * P[k] + 3 * s * s * t * B1[k] + 3 * s * t * t * B2[k] + t * t * t * B3[k]
    }
    const sinkLen = lerp(0.22, 0.35, random())

    // The main path, as (point, s, part): part 0 in the sheet, 1 the free
    // span, 2 sinking into the ground.
    const path = []
    // In the sheet it lifts off the surface gradually, so it peels.
    tr.adhered.forEach((q, k) => {
      const u = k / Math.max(1, tr.adhered.length - 1)
      path.push({ p: off(q, 0.006 + 0.006 * u * u), part: 0, u })
    })
    const N = 26
    for (let k = 1; k <= N; k++) {
      const t = k / N
      // The bow is strongest toward the ground end, as if the strand had
      // been drawn sideways by what it rooted into.
      const sway = Math.sin(Math.PI * Math.pow(t, 0.8))
      const x = bez(t, 0) - hz * bow * sway
      const z = bez(t, 2) + hx * bow * sway
      const y = Math.max(ground(x, z) + 0.012, bez(t, 1))
      path.push({ p: [x, y, z], part: 1, u: t })
    }
    const M = 10
    for (let k = 1; k <= M; k++) {
      const u = k / M
      const x = tr.T[0] + hx * sinkLen * u
      const z = tr.T[2] + hz * sinkLen * u
      path.push({ p: [x, ground(x, z) + 0.01 - 0.03 * u, z], part: 2, u })
    }

    // Main fibre and two finer ones.
    const fibres = [
      { r: 1, spread: 0, phase: 0, alpha: 0.75 },
      { r: 0.45, spread: lerp(0.022, 0.04, random()), phase: random() * 6.28, alpha: 0.55 },
      { r: 0.36, spread: lerp(0.03, 0.055, random()), phase: random() * 6.28, alpha: 0.5 },
    ]
    for (const [fi, f] of fibres.entries()) {
      const twist = (random() < 0.5 ? -1 : 1) * lerp(4, 9, random())
      const splay = (random() < 0.5 ? -1 : 1) * lerp(0.08, 0.2, random())
      const grain = random() * 50
      const pts = []
      const radii = []
      const alphas = []
      path.forEach((q, k) => {
        const a = path[Math.max(0, k - 1)].p
        const b = path[Math.min(path.length - 1, k + 1)].p
        const T = norm(sub(b, a))
        let N1 = cross(T, [0, 1, 0])
        if (Math.hypot(...N1) < 1e-3) N1 = [1, 0, 0]
        N1 = norm(N1)
        const N2 = cross(N1, T)
        // Fibres share the leaving point and drift apart toward the ground;
        // in the ground they splay apart.
        let w0 = 0
        if (q.part === 1) w0 = f.spread * Math.pow(q.u, 0.8)
        else if (q.part === 2) w0 = f.spread + Math.abs(splay) * q.u * 0.9
        const ang = f.phase + twist * (q.part === 1 ? q.u : q.part === 2 ? 1 : 0)
        let p = add(add(q.p, N1, Math.cos(ang) * w0), N2, Math.sin(ang) * w0 * (q.part === 2 ? 0.2 : 1))
        if (q.part === 2) p = add(p, N1, splay * q.u * (fi === 0 ? 0 : 1) * 0.6)
        pts.push(p)
        // Radius: fine in the sheet, a slight node where it leaves, thinning
        // under tension mid-span, thickening a little where it roots, then
        // fading to nothing in the ground.
        let r
        if (q.part === 0) r = lerp(0.0045, 0.009, q.u)
        else if (q.part === 1) r = q.u < 0.08 ? lerp(0.012, 0.0085, q.u / 0.08) : lerp(0.0085, 0.006, Math.sin(Math.PI * Math.min(1, (q.u - 0.08) / 0.84)) ) + 0.0025 * smoothstep(0.75, 1, q.u)
        else r = lerp(0.0085, 0.003, q.u)
        // Uneven along its length, slowly, as a drawn fibre is.
        radii.push(r * f.r * (0.75 + 0.5 * noise1(k * 0.35 + grain)))
        let al
        if (q.part === 0) al = lerp(0.15, 1, q.u)
        else if (q.part === 1) al = 1
        else al = 1 - smoothstep(0.1, 1, q.u)
        alphas.push(al * f.alpha)
      })
      tube(w, pts, radii, alphas, birthOf, fi, f.r)
    }
  }
  return w.toGeometry()
}

/** A tube through `pts` with per-point radius and alpha (an open strand). */
function tube(w, pts, radii, alphas, birthOf, fibre, scale) {
  const radial = scale > 0.5 ? 8 : 6
  const n = pts.length
  let prevN = null
  const rows = []
  let arc = 0
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)]
    const b = pts[Math.min(n - 1, k + 1)]
    let T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const tl = Math.hypot(...T) || 1
    T = T.map((v) => v / tl)
    // A frame carried along the strand, so it does not twist.
    let N = prevN ?? (Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])
    const dotNT = N[0] * T[0] + N[1] * T[1] + N[2] * T[2]
    N = [N[0] - T[0] * dotNT, N[1] - T[1] * dotNT, N[2] - T[2] * dotNT]
    const nl = Math.hypot(...N) || 1
    N = N.map((v) => v / nl)
    prevN = N
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]]
    if (k > 0) arc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2])
    const c = pts[k]
    w.set({ anchor: c, birth: birthOf(c[0], c[2]), span: 0.12, tone: 1, glow: fibre / 2, alpha: alphas[k], open: 0, sway: 0 })
    const row = []
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2
      const nn = [N[0] * Math.cos(ang) + B[0] * Math.sin(ang), N[1] * Math.cos(ang) + B[1] * Math.sin(ang), N[2] * Math.cos(ang) + B[2] * Math.sin(ang)]
      row.push(w.vertex([c[0] + nn[0] * radii[k], c[1] + nn[1] * radii[k], c[2] + nn[2] * radii[k]], nn, arc, j / radial))
    }
    rows.push(row)
  }
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a = rows[k][j]
      const b = rows[k][j + 1]
      const c = rows[k + 1][j]
      const d = rows[k + 1][j + 1]
      w.tri(a, c, b)
      w.tri(b, c, d)
    }
  }
}

/**
 * Everything a colony's network needs on screen: its tissue map (as a
 * texture), the drape at three levels of detail, and the membrane veins
 * (near and middle levels only).
 */
export function buildBranchingGeometry(networks, world) {
  return networks.map((net) => {
    const { colony, chains } = net
    // The map covers the growth itself, so its texels are as fine as they
    // can be.
    const bounds = growthBounds(net)
    const data = paintTissue(net, bounds)
    const size = BRANCHING.map.size
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    // It spreads out from the anchor with the growth clock, after the
    // membranes.
    const maxDist = Math.max(1, colony.radius * 1.3)
    const birthOf = (x, z) => Math.min(0.9, colony.birth + 0.3 + 0.5 * clamp01(Math.hypot(x - colony.x, z - colony.z) / maxDist))
    const veins = veinGeometry(chains, birthOf)
    const tendrils = net.transitions?.length ? tendrilGeometry(world, net.transitions, birthOf) : null
    const drapes = [160, 80, 40].map((cells) => drapeGeometry(world, bounds, data, cells, birthOf))
    return {
      center: [colony.x, colony.y, colony.z],
      texture,
      levels: [
        { drape: drapes[0], veins, tendrils },
        { drape: drapes[1], veins, tendrils },
        { drape: drapes[2], veins: null, tendrils: null },
      ],
      distances: BRANCHING.lod,
      stats: net.stats,
    }
  })
}
