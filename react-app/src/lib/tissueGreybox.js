import { CONDUIT } from './conduit'
import { mulberry32 } from './noise'

/**
 * Study 10's tissue greybox (`?lifecycle=1&conduit=1&greybox=1`): geometry
 * only, for judging form before material. One stretch of the shared tissue
 * (the one the simulation chooses for the fold study, `chooseFold`) unfolds
 * out of the ground where its paths meet.
 *
 * At each knot (a group of junctions, and one near the hub where most has
 * passed), every path that runs into it peels up out of the ground as a
 * membrane leaf: its root lies in the terrain out along its path, it rises
 * toward the knot, cupped across with open space under it, and its tip
 * droops back toward the ground; its rim is ruffled. The leaves of one knot
 * cross over it in layers, the most used highest; where much has passed, a
 * second, smaller leaf lies under the first.
 *
 * Each quantity is read from the simulation:
 *
 *   - what has passed through the knot's nodes (slow memory): how large its
 *     leaves are, and whether a second layer has formed
 *   - each path's thickness now (use): how far its leaf has peeled up; near
 *     the dormant floor it lies back down on the ground as a trace
 *   - what flows now: a little more lift, so the space under it opens
 *
 * Nothing here moves or implies a flow: no direction is drawn.
 *
 * Unfinished and paused (24 October 2026): a study of form, not a final one.
 */

export const GREYBOX = {
  /** Matter passed per node at which the tissue there is well remembered (1 − 1/e). */
  remembered: 0.2,
  /** Flow (per edge, per second) at which a knot counts as fully flowing. */
  flowing: 5e-4,
  /** Length of a leaf (units), before memory and seed; its steepest rise (radians). */
  size: 1.45,
  steepest: 1.2,
  /** Memory from which a second, smaller leaf forms under the first. */
  layered: 0.55,
  /** How far a leaf's root lies along the terrain before it rises (share of its length). */
  root: 0.14,
  /** Knots: junctions closer than this along the stretch are one knot; and the first knot's distance from the hub. */
  knot: 0.35,
  first: 0.62,
  /** Mesh resolution of a leaf: along, across. */
  segments: [36, 15],
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * The knots of a stretch, fixed once it is chosen: where its paths meet (its
 * junctions, grouped), and one near the hub where most has passed. Each knot
 * keeps its nodes (to read the simulation at) and its arms: the stretch on
 * either side and the branches leaving it, each with the edge it reads and
 * its own seeded proportions.
 */
export function greyboxSites(fold, C) {
  const N = fold.nodes.length
  // The stretch, smoothed (as the fold study draws it).
  let px = Float64Array.from(fold.nodes, (n) => C.x[n])
  let pz = Float64Array.from(fold.nodes, (n) => C.z[n])
  for (let it = 0; it < 8; it++) {
    const qx = px.slice()
    const qz = pz.slice()
    for (let i = 1; i < N - 1; i++) {
      qx[i] = 0.5 * px[i] + 0.25 * (px[i - 1] + px[i + 1])
      qz[i] = 0.5 * pz[i] + 0.25 * (pz[i - 1] + pz[i + 1])
    }
    px = qx
    pz = qz
  }
  const arc = new Float64Array(N)
  for (let i = 1; i < N; i++) arc[i] = arc[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1])
  const onPath = new Set(fold.nodes)
  const toward = (k, step) => {
    const b = Math.min(N - 1, Math.max(0, k + step))
    const dx = px[b] - px[k]
    const dz = pz[b] - pz[k]
    const l = Math.hypot(dx, dz) || 1
    return [dx / l, dz / l]
  }
  // A branch's direction: a few nodes out along it.
  const branch = (n, e) => {
    let prev = n
    let cur = C.a[e] === n ? C.b[e] : C.a[e]
    for (let k = 0; k < 3; k++) {
      const next = C.at[cur].map((f) => (C.a[f] === cur ? C.b[f] : C.a[f])).find((o) => o !== prev && !onPath.has(o))
      if (next === undefined) break
      prev = cur
      cur = next
    }
    const dx = C.x[cur] - C.x[n]
    const dz = C.z[cur] - C.z[n]
    const l = Math.hypot(dx, dz) || 1
    return [dx / l, dz / l]
  }

  // Junctions, grouped into knots.
  const groups = []
  fold.nodes.forEach((n, k) => {
    if (C.at[n].length < 3 || arc[k] < GREYBOX.first * 0.6) return
    const last = groups[groups.length - 1]
    if (last && arc[k] - last.s1 < GREYBOX.knot) {
      last.ks.push(k)
      last.s1 = arc[k]
    } else groups.push({ ks: [k], s1: arc[k] })
  })
  // And one near the hub, where most has passed.
  const hubK = fold.nodes.findIndex((_, k) => arc[k] >= GREYBOX.first)
  const knots = [{ ks: [hubK], hub: true }, ...groups]

  return knots.map((g, i) => {
    const ks = g.ks
    const k0 = ks[0]
    const k1 = ks[ks.length - 1]
    const random = mulberry32(fold.nodes[ks[Math.floor(ks.length / 2)]] * 7919 + 101 + i)
    const arms = []
    const arm = (dir, edge) => {
      if (edge === undefined) return
      if (arms.some((o) => o.dx * dir[0] + o.dz * dir[1] > 0.8)) return
      arms.push({
        dx: dir[0],
        dz: dir[1],
        edge,
        // Its own proportions, fixed.
        size: 0.85 + 0.35 * random(),
        wide: 0.36 + 0.14 * random(),
        cup: 0.2 + 0.2 * random(),
        droop: 0.7 + 0.6 * random(),
        steep: 0.75 + 0.35 * random(),
        yaw: (random() - 0.5) * 0.45,
        side: (random() - 0.5) * 0.18,
        twist: (random() - 0.5) * 0.6,
        ruffle: { n: 3 + Math.floor(random() * 4), amp: 0.06 + 0.06 * random(), ph: random() * 6.28 },
        under: { side: random() < 0.5 ? -1 : 1, ph: random() * 6.28 },
      })
    }
    // The stretch on either side, then the branches leaving it.
    arm(toward(k0, -3), fold.edges[k0 - 1])
    arm(toward(k1, 3), fold.edges[k1])
    for (const kk of ks) {
      const n = fold.nodes[kk]
      for (const e of C.at[n]) {
        const o = C.a[e] === n ? C.b[e] : C.a[e]
        if (!onPath.has(o) && arms.length < 4) arm(branch(n, e), e)
      }
    }
    return {
      s: arc[ks[Math.floor(ks.length / 2)]],
      x: ks.reduce((s, kk) => s + px[kk], 0) / ks.length,
      z: ks.reduce((s, kk) => s + pz[kk], 0) / ks.length,
      junction: !g.hub,
      nodes: ks.map((kk) => fold.nodes[kk]),
      arms,
    }
  })
}

/**
 * What the simulation says at each knot now: memory (what has passed through
 * its nodes), each arm's use (its path's thickness, normalised to the
 * dormant floor and the cap), and flow (the most moving along any path there).
 */
export function greyboxState(sites, life) {
  const C = life.conduit
  const U = CONDUIT.use
  const use = (e) => Math.min(1, Math.max(0, (C.g[e] - U.floor) / (U.cap - U.floor)))
  return sites.map((site) => {
    let passed = 0
    let f = 0
    for (const n of site.nodes) {
      passed += life.passed[n]
      for (const e of C.at[n]) f = Math.max(f, Math.abs(life.flow[e]))
    }
    passed /= site.nodes.length
    return {
      memory: 1 - Math.exp(-passed / GREYBOX.remembered),
      open: smoothstep(0.02, 0.6, f / GREYBOX.flowing),
      // How far each arm has peeled up: from its own path's thickness.
      arms: site.arms.map((a) => smoothstep(0.04, 0.55, use(a.edge))),
    }
  })
}

/** The leaves of every knot, for the state now. */
function leavesFor(sites, states) {
  const leaves = []
  sites.forEach((site, i) => {
    const st = states[i]
    const grow = (0.55 + 0.45 * st.memory) * (site.junction ? 1 : 0.75)
    const layers = st.memory > GREYBOX.layered ? 2 : 1
    // The most used arms highest: stacked in order of use.
    const order = site.arms.map((_, j) => j).sort((p, q) => st.arms[p] - st.arms[q])
    order.forEach((j, rank) => {
      const arm = site.arms[j]
      const rise = st.arms[j]
      for (let layer = 0; layer < layers; layer++) {
        const L = GREYBOX.size * arm.size * grow * (layer ? 0.62 : 1)
        // Its root out along its path (the lower layer further out and to one side), pointing back over the knot.
        const out = L * (layer ? 0.95 : 0.78)
        const side = arm.side + (layer ? arm.under.side * L * 0.35 : 0)
        leaves.push({
          x: site.x + arm.dx * out - arm.dz * side,
          z: site.z + arm.dz * out + arm.dx * side,
          heading: Math.atan2(-arm.dz, -arm.dx) + arm.yaw * (layer ? -1 : 1),
          L,
          W: L * arm.wide * (layer ? 1.15 : 1),
          rise,
          angle: GREYBOX.steepest * arm.steep * (layer ? 0.7 : 1) * (1 + 0.15 * st.open * rise) * (1 + 0.1 * rank),
          cup: arm.cup,
          droop: arm.droop,
          twist: arm.twist,
          ruffle: layer ? { ...arm.ruffle, ph: arm.under.ph } : arm.ruffle,
        })
      }
    })
  })
  return leaves
}

/**
 * The greybox's mesh for the state now: positions, normals and triangles,
 * wound so a leaf's upper side faces front (the material darkens its under
 * side).
 */
export function buildGreybox(sites, states, world) {
  const t0 = performance.now()
  const ground = (x, z) => world.groundY(...world.toUV(x, z))
  const leaves = leavesFor(sites, states)
  const [NS, NT] = GREYBOX.segments
  const positions = []
  const index = []
  for (const lf of leaves) {
    const base = positions.length / 3
    const dx = Math.cos(lf.heading)
    const dz = Math.sin(lf.heading)
    // How much of it stands at all: dormant, it lies on the ground.
    const stand = 0.04 + 0.96 * lf.rise
    const peak = lf.angle * stand
    // Its spine: along the terrain at its root, rising, then turning down at its tip.
    let x = lf.x
    let z = lf.z
    let h = 0
    const spine = []
    for (let i = 0; i <= NS; i++) {
      const s = i / NS
      const pitch = peak * smoothstep(GREYBOX.root, 0.36, s) - (peak + lf.droop * stand) * smoothstep(0.66, 1, s)
      spine.push({ x, z, h, pitch, s })
      const ds = lf.L / NS
      x += dx * Math.cos(pitch) * ds
      z += dz * Math.cos(pitch) * ds
      h += Math.sin(pitch) * ds
    }
    for (const p of spine) {
      const s = p.s
      // A lens: narrow at its root, widest past its middle, rounded at its tip.
      const w = lf.W * (0.22 + 0.78 * Math.sin(Math.PI * Math.min(1, s * 0.92 + 0.04)) ** 0.7)
      const ca = Math.cos(p.pitch)
      const sa = Math.sin(p.pitch)
      // Across, turning a little along it (a twist), and its local up.
      const tw = lf.twist * s * stand
      const ax = -dz * Math.cos(tw)
      const ay = Math.sin(tw)
      const az = dx * Math.cos(tw)
      const ux = -dx * sa
      const uy = ca
      const uz = -dz * sa
      for (let j = 0; j <= NT; j++) {
        const t = (j / NT) * 2 - 1
        // Cupped across (open space under it), ruffled toward its rim.
        const R = lf.ruffle
        const v = (-lf.cup * t * t + R.amp * Math.sin(R.n * Math.PI * s + R.ph + 2 * t) * Math.abs(t) ** 3) * w * stand
        const X = p.x + ax * t * w + ux * v
        const Z = p.z + az * t * w + uz * v
        const g = ground(X, Z)
        let Y = g + p.h + ay * t * w + uy * v
        // Its root lies in the terrain, as does all of it when dormant.
        const lie = Math.max(1 - smoothstep(0, GREYBOX.root, s), 1 - stand)
        Y = Y * (1 - lie) + (g + 0.006) * lie
        // Never below the ground.
        positions.push(X, Math.max(Y, g + 0.004), Z)
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NT; j++) {
        const a = base + i * (NT + 1) + j
        const b = a + NT + 1
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }

  // Normals from the triangles; then wind every leaf so its upper side faces front.
  const P = positions
  const normals = new Float32Array(P.length)
  for (let k = 0; k < index.length; k += 3) {
    const [a, b, c] = [index[k] * 3, index[k + 1] * 3, index[k + 2] * 3]
    const ux = P[b] - P[a]
    const uy = P[b + 1] - P[a + 1]
    const uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a]
    const vy = P[c + 1] - P[a + 1]
    const vz = P[c + 2] - P[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const o of [a, b, c]) {
      normals[o] += nx
      normals[o + 1] += ny
      normals[o + 2] += nz
    }
  }
  let up = 0
  for (let o = 1; o < normals.length; o += 3) up += normals[o]
  if (up < 0) {
    for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]]
    for (let o = 0; o < normals.length; o++) normals[o] = -normals[o]
  }
  for (let o = 0; o < normals.length; o += 3) {
    const l = Math.hypot(normals[o], normals[o + 1], normals[o + 2]) || 1
    normals[o] /= l
    normals[o + 1] /= l
    normals[o + 2] /= l
  }
  return {
    positions: Float32Array.from(positions),
    normals,
    inner: new Float32Array(positions.length / 3),
    index,
    ms: performance.now() - t0,
    leaves: leaves.length,
  }
}
