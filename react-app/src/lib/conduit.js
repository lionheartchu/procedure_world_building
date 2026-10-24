/**
 * The shared tissue — study 10, toward stage 3 (docs/03-DEMO-EXECUTION-PLAN.md),
 * behind `?lifecycle=1&conduit=1`. After the Shared Conduit Study
 * (docs/references/conduit-01.png), grown by a logic borrowed from mycelium
 * (not drawn as one):
 *
 *   - it begins where matter enters the ground: where a resident releases
 *     part of itself into the ground at its base, or its old contour sinks
 *     in, a little tissue forms
 *   - its tips explore, fed by matter in the tissue: a growing tip draws
 *     matter toward itself along the path behind it, advances only as fast
 *     as the matter it holds allows, carries part of it forward, and spends
 *     some on growing (that matter becomes the tissue itself)
 *   - tips steer by what the ground offers: the record (where History left
 *     matter), a signal from the colonies on the same land that have room
 *     to grow (which travels through the ground: its distance is measured
 *     over land, around water), a little persistence and chance; water
 *     stops them
 *   - they branch now and then, and where a tip meets other tissue it fuses
 *     with it, so separate growths join into one network
 *   - a tip without matter rests, and after long enough without it, stops:
 *     its path stays, dormant
 *
 * What moves through the tissue, how use thickens a path and disuse lets it
 * thin to a dormant trace, and the colonies' pockets, are the lifecycle's
 * (lifecycle.js, `circulate`). This file keeps the network: its nodes,
 * edges, tips, and a spatial index; deterministic for a given seed.
 *
 * Status, 24 October 2026: unfinished and paused. Kept as it stands for
 * later work, and reached only through `&conduit=1`; neither Explore nor the
 * stages 0–2 demo (`?lifecycle=1` alone) builds it.
 */

export const CONDUIT = {
  /** Spacing of the tissue's nodes as it grows (units). */
  spacing: 0.1,
  /** Most nodes and edges the network may hold: a guard, not a design value. */
  capacity: 3000,
  /** How far (units) from the lifecycle's colony another colony may lie to take part. */
  reach: 9,
  /** Radius of a colony's hub: its uptake zone, under its middle. */
  hub: 0.7,
  /** Diffusion of matter along a path of ordinary thickness (units² / s); a path `g` times as thick carries `g` times faster. */
  diffusion: 0.08,
  /** Share of each release that goes down into the ground at the resident's base (the rest is a film). */
  down: 0.35,
  /** Seconds over which an old contour gives the spare part of itself to the ground below. */
  seepContour: 40,
  /** Share per second of residue lying on the tissue that sinks into it. */
  seepResidue: 0.015,
  /** How close to the tissue matter must lie to sink into it (units). */
  intake: 0.35,
  /** Share per second a hub draws from the tissue into its pocket while it has room. */
  absorb: 0.6,
  /** A colony's pocket holds up to this much per unit of its demand (1 − maturity): its room to grow. */
  room: 0.45,
  /** Growth. */
  grow: {
    /** Fastest a tip advances (units/s), when it holds `fuel` or more. */
    speed: 0.08,
    fuel: 0.002,
    /** Share per second of the matter in the few nodes behind a growing tip that it draws toward itself. */
    pull: 0.1,
    /** Matter spent per unit of new tissue: it becomes the tissue. */
    cost: 0.004,
    /** Share of a tip's matter it carries forward as it advances. */
    carry: 0.5,
    /** Chance per new node of a branch (times how well fed the tip is). */
    branch: 0.08,
    /** Most tips growing at once. */
    tips: 18,
    /** Tips a new growth starts with. */
    seedTips: 2,
    /** Seconds a tip may rest without matter before it stops for good. */
    rest: 120,
    /** A tip fuses with other tissue this close (units). */
    fuse: 0.14,
    /** It has reached a colony this close to its middle. */
    arrive: 0.35,
  },
  /** How a tip chooses its way among a few headings. */
  steer: { turn: 0.5, record: 1.0, toward: 1.6, keep: 0.8, noise: 0.4, avoid: 0.6 },
  /** Use: a path thickens with what passes along it and thins back toward a dormant floor. */
  use: { gain: 120, decay: 1 / 150, floor: 0.12, start: 1, cap: 6 },
  /**
   * The fold study (`&fold=1`, display only): one stretch into another
   * colony, chosen once it has lasted. Up to `length` units from the hub,
   * at least `least`, and at least `thick` thick on average.
   */
  fold: { length: 3, least: 1.8, thick: 2.5 },
}

const TAU = Math.PI * 2

/** Which dry cells of the world's grid are joined over land (a label per cell; -1 under water). */
function landmasses(world) {
  const res = world.res
  const label = new Int32Array(res * res).fill(-1)
  const isDry = new Uint8Array(res * res)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * world.size
      const z = ((j + 0.5) / res - 0.5) * world.size
      isDry[j * res + i] = world.groundY(...world.toUV(x, z)) >= world.waterY + 0.02 ? 1 : 0
    }
  }
  let next = 0
  const stack = []
  for (let k = 0; k < res * res; k++) {
    if (!isDry[k] || label[k] >= 0) continue
    label[k] = next
    stack.push(k)
    while (stack.length) {
      const c = stack.pop()
      const i = c % res
      const j = (c / res) | 0
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= res || nj >= res) continue
        const n = nj * res + ni
        if (isDry[n] && label[n] < 0) {
          label[n] = next
          stack.push(n)
        }
      }
    }
    next++
  }
  return label
}

/** Distance over dry land from (x, z) to every cell of the world's grid (Dijkstra, 8 neighbours). */
function landDistance(world, x, z) {
  const res = world.res
  const cell = world.size / res
  const dist = new Float64Array(res * res).fill(Infinity)
  const dry = new Uint8Array(res * res)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const cx = ((i + 0.5) / res - 0.5) * world.size
      const cz = ((j + 0.5) / res - 0.5) * world.size
      dry[j * res + i] = world.groundY(...world.toUV(cx, cz)) >= world.waterY + 0.02 ? 1 : 0
    }
  }
  const i0 = Math.max(0, Math.min(res - 1, Math.floor((x / world.size + 0.5) * res)))
  const j0 = Math.max(0, Math.min(res - 1, Math.floor((z / world.size + 0.5) * res)))
  const start = j0 * res + i0
  dist[start] = 0
  // A simple binary heap of [distance, cell].
  const heap = [[0, start]]
  const push = (d, k) => {
    heap.push([d, k])
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heap[p][0] <= heap[c][0]) break
      ;[heap[p], heap[c]] = [heap[c], heap[p]]
      c = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let c = 0
      for (;;) {
        const l = 2 * c + 1
        const r = l + 1
        let m = c
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === c) break
        ;[heap[m], heap[c]] = [heap[c], heap[m]]
        c = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, k] = pop()
    if (d > dist[k]) continue
    const i = k % res
    const j = (k / res) | 0
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= res || nj >= res) continue
        const n = nj * res + ni
        if (!dry[n]) continue
        const nd = d + cell * (di && dj ? Math.SQRT2 : 1)
        if (nd < dist[n]) {
          dist[n] = nd
          push(nd, n)
        }
      }
    }
  }
  return dist
}

/**
 * The colonies the tissue can join: the lifecycle's own, and every other
 * colony within reach on the same land. Null if there is none.
 */
export function tissueColonies(world, scatter, colony) {
  const label = landmasses(world)
  const cellOf = (x, z) => {
    const i = Math.max(0, Math.min(world.res - 1, Math.floor((x / world.size + 0.5) * world.res)))
    const j = Math.max(0, Math.min(world.res - 1, Math.floor((z / world.size + 0.5) * world.res)))
    return j * world.res + i
  }
  const home = label[cellOf(colony.x, colony.z)]
  const others = scatter.colonies.filter(
    (c) => c.index !== colony.index && Math.hypot(c.x - colony.x, c.z - colony.z) <= CONDUIT.reach && home >= 0 && label[cellOf(c.x, c.z)] === home,
  )
  if (!others.length) return null
  const d = (c) => Math.hypot(c.x - colony.x, c.z - colony.z)
  return [colony, ...others.sort((p, q) => d(p) - d(q))]
}

/** The growing network. */
export class TissueNet {
  constructor(world, colonies, random) {
    this.world = world
    this.colonies = colonies
    this.random = random
    const N = CONDUIT.capacity
    this.count = 0
    this.x = new Float32Array(N)
    this.z = new Float32Array(N)
    this.y = new Float32Array(N)
    /** The colony whose hub a node lies in (-1: none). */
    this.hubOf = new Int16Array(N).fill(-1)
    /** Edges: their two nodes, length, and thickness (conductance). */
    this.edgeCount = 0
    this.a = new Int32Array(N)
    this.b = new Int32Array(N)
    this.len = new Float32Array(N)
    this.g = new Float32Array(N)
    /** The edges at each node. */
    this.at = Array.from({ length: N }, () => [])
    this.tips = []
    /** Changes whenever a node or edge is added (for the display). */
    this.version = 0
    this.cells = new Map()
    this.cellSize = 0.2
    // Each colony's signal through the ground: the distance to it over dry land.
    this.landDistance = new Map(colonies.map((c) => [c.index, landDistance(world, c.x, c.z)]))
  }

  /** The distance over land from (x, z) to colony `index` (Infinity across water). */
  overLand(index, x, z) {
    const W = this.world
    const i = Math.max(0, Math.min(W.res - 1, Math.floor((x / W.size + 0.5) * W.res)))
    const j = Math.max(0, Math.min(W.res - 1, Math.floor((z / W.size + 0.5) * W.res)))
    return this.landDistance.get(index)[j * W.res + i]
  }

  addNode(x, z) {
    if (this.count >= CONDUIT.capacity) return -1
    const n = this.count++
    this.x[n] = x
    this.z[n] = z
    this.y[n] = this.world.groundY(...this.world.toUV(x, z))
    for (const c of this.colonies) if (Math.hypot(x - c.x, z - c.z) < CONDUIT.hub) this.hubOf[n] = c.index
    const k = Math.floor(x / this.cellSize) * 100003 + Math.floor(z / this.cellSize)
    if (!this.cells.has(k)) this.cells.set(k, [])
    this.cells.get(k).push(n)
    this.version++
    return n
  }

  addEdge(p, q) {
    if (this.edgeCount >= CONDUIT.capacity) return -1
    const e = this.edgeCount++
    this.a[e] = p
    this.b[e] = q
    this.len[e] = Math.hypot(this.x[q] - this.x[p], this.z[q] - this.z[p])
    this.g[e] = CONDUIT.use.start
    this.at[p].push(e)
    this.at[q].push(e)
    this.version++
    return e
  }

  /** Nodes within r of (x, z), nearest first, leaving out `skip`. */
  near(x, z, r, skip) {
    const out = []
    const s = this.cellSize
    for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++) {
      for (let j = Math.floor((z - r) / s); j <= Math.floor((z + r) / s); j++) {
        const list = this.cells.get(i * 100003 + j)
        if (!list) continue
        for (const n of list) {
          if (skip && skip.has(n)) continue
          const d = Math.hypot(this.x[n] - x, this.z[n] - z)
          if (d < r) out.push([n, d])
        }
      }
    }
    return out.sort((p, q) => p[1] - q[1])
  }

  dry(x, z) {
    const h = this.world.size / 2 - 0.4
    if (Math.abs(x) > h || Math.abs(z) > h) return false
    return this.world.groundY(...this.world.toUV(x, z)) >= this.world.waterY + 0.02
  }

  /** The colony nearest (x, z): a growth's home. */
  homeOf(x, z) {
    let best = this.colonies[0]
    for (const c of this.colonies) if (Math.hypot(c.x - x, c.z - z) < Math.hypot(best.x - x, best.z - z)) best = c
    return best.index
  }

  /**
   * How far a step from (x0, z0) to (x, z) leads toward the colonies (other
   * than home) with room to grow, by their signal through the ground: the
   * distance over land it saves, per unit of step, weighed by room to grow
   * and fading with distance.
   */
  toward(x0, z0, x, z, home) {
    let s = 0
    const step = Math.hypot(x - x0, z - z0) || 1
    for (const c of this.colonies) {
      if (c.index === home) continue
      const d0 = this.overLand(c.index, x0, z0)
      const d1 = this.overLand(c.index, x, z)
      if (!Number.isFinite(d0) || !Number.isFinite(d1)) continue
      s += ((1 - c.maturity) / (1 + d0 / 4)) * Math.max(-1, Math.min(1, (d0 - d1) / step))
    }
    return s
  }

  /**
   * A new growth where matter enters the ground at (x, z), from a resident
   * of colony `home`: a node and a few tips. Returns the node (-1 if the
   * ground there is under water).
   */
  seed(x, z, home = this.homeOf(x, z)) {
    if (!this.dry(x, z)) return -1
    const n = this.addNode(x, z)
    if (n < 0) return -1
    const k = CONDUIT.grow.seedTips
    const start = this.random() * TAU
    for (let i = 0; i < k; i++) this.tips.push(this.makeTip(n, start + (i / k) * TAU, home))
    return n
  }

  makeTip(node, heading, home) {
    return { node, heading, home, progress: 0, rest: 0, rate: 0, state: 'growing', lineage: [node] }
  }

  /**
   * One step of growth. `held(n)` is the matter at node n; `spend(n, amount)`
   * takes matter from node n into the tissue itself; `carry(from, to, share)`
   * moves a share of a node's matter to another. Returns what happened.
   */
  grow(dt, held, spend, carry) {
    const G = CONDUIT.grow
    const S = CONDUIT.steer
    const W = this.world
    const sample = {}
    const events = []
    const step = CONDUIT.spacing
    const cost = G.cost * step
    const growing = this.tips.filter((t) => t.state === 'growing')
    for (const t of growing) {
      const m = held(t.node)
      const fed = Math.min(1, m / G.fuel)
      t.rate = m >= cost ? G.speed * fed : 0
      if (!t.rate) {
        // Without matter to grow on, it rests; long enough, and it stops.
        t.rest += dt
        if (t.rest > G.rest) t.state = 'dormant'
        continue
      }
      t.rest = 0
      t.progress += t.rate * dt
      if (t.progress < step) continue
      t.progress -= step
      // Choose a way among a few headings.
      const x0 = this.x[t.node]
      const z0 = this.z[t.node]
      const own = new Set(t.lineage)
      // Ahead first; meeting water, wider and wider before it gives up.
      let best = null
      for (const reach of [2, 4, 6]) {
        for (let k = -reach; k <= reach; k++) {
          if (reach > 2 && Math.abs(k) <= reach - 2) continue
          const h = t.heading + (k * S.turn) / 2
          const x = x0 + Math.cos(h) * step
          const z = z0 + Math.sin(h) * step
          if (!this.dry(x, z)) continue
          W.sample(...W.toUV(x, z), sample)
          // It keeps a little away from tissue it would only run alongside.
          const crowd = this.near(x, z, 0.3, own).length ? 1 : 0
          const score = S.record * sample.trace + S.toward * this.toward(x0, z0, x, z, t.home) + S.keep * Math.cos((k * S.turn) / 2) + S.noise * (this.random() - 0.5) - S.avoid * crowd
          if (!best || score > best.score) best = { x, z, h, score }
        }
        if (best) break
      }
      if (!best) {
        t.state = 'blocked'
        continue
      }
      // Meeting other tissue, it fuses with it.
      const met = this.near(best.x, best.z, G.fuse, own)
      if (met.length) {
        spend(t.node, cost)
        this.addEdge(t.node, met[0][0])
        t.state = 'fused'
        events.push({ kind: 'fuse', node: met[0][0], home: t.home })
        continue
      }
      const n = this.addNode(best.x, best.z)
      if (n < 0) {
        t.state = 'blocked'
        continue
      }
      spend(t.node, cost)
      this.addEdge(t.node, n)
      carry(t.node, n, G.carry)
      t.node = n
      t.heading = best.h
      t.lineage.push(n)
      if (t.lineage.length > 10) t.lineage.shift()
      // Reaching another colony's middle, it has arrived.
      for (const c of this.colonies) {
        if (c.index !== t.home && Math.hypot(best.x - c.x, best.z - c.z) < G.arrive) {
          t.state = 'arrived'
          events.push({ kind: 'reach', colony: c.index, home: t.home })
        }
      }
      if (t.state !== 'growing') continue
      // Now and then, a branch.
      if (this.random() < G.branch * fed && this.tips.filter((u) => u.state === 'growing').length < G.tips) {
        const side = this.random() < 0.5 ? -1 : 1
        const b = this.makeTip(n, best.h + side * (0.55 + 0.45 * this.random()), t.home)
        b.lineage = [...t.lineage]
        this.tips.push(b)
      }
    }
    return events
  }
}
