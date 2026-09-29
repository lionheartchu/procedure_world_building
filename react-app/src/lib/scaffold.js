/**
 * The residual scaffold: an explicit network grown through the volume.
 *
 * Everything else in the density field is statistical — noise thresholded,
 * noise subtracted. Noise cannot express *connection*, which is why a sponge is
 * the only thing that came out of it. This module builds a structure that knows
 * where it is going:
 *
 *   1. scatter nodes on a jittered lattice inside the mass
 *   2. join them with a minimum spanning tree, so the network is connected by
 *      construction rather than by luck
 *   3. add the shortest leftover edges back, which is what closes loops and
 *      gives openings something to be bounded by
 *   4. bow each edge along a noise offset and subdivide it into segments
 *   5. taper the radius — thick at the nodes, thin mid-span
 *
 * The result is queried as a distance field, so it composes with the rest of
 * the pipeline like any other operation and is meshed by the same two meshers.
 * Segments are binned into a uniform grid; without that, a voxel would have to
 * test every segment and the build would take seconds rather than milliseconds.
 */

import { makeSimplex3, mulberry32 } from './noise'

/** Floats per segment: x0 y0 z0 x1 y1 z1 r0 r1. */
const STRIDE = 8

/** Curve subdivision. Four is enough to read as an arc, cheap to test against. */
const SUBDIVISIONS = 4

/** Roughly how wide a bin should be, in world units. */
const BIN_SIZE = 1.15

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * @param seed       reproducible structure
 * @param size       world size of the volume, [x, y, z]
 * @param divisions  lattice divisions along x/z — sets how many nodes there are
 * @param loops      0 = a pure tree, 1 = every short leftover edge added back
 * @param radius     strut radius at a node, in world units
 * @param curve      how far an edge bows away from a straight line
 */
export function createScaffold({ seed, size, divisions, loops, radius, curve }) {
  const random = mulberry32(seed + 5501)
  const bend = makeSimplex3(seed + 7717)

  const nodes = placeNodes(random, size, divisions)
  if (nodes.length < 2) return emptyScaffold()

  const edges = connect(nodes, loops)
  const segments = buildSegments(nodes, edges, bend, radius, curve)
  return index(segments, size, radius)
}

/**
 * Jittered lattice, trimmed to an ellipsoid so the network stays inside the
 * mass rather than reaching into empty space around it.
 */
function placeNodes(random, size, divisions) {
  const nx = Math.max(2, Math.round(divisions))
  const ny = Math.max(2, Math.round(divisions * 0.55))
  const nz = nx
  const nodes = []

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const u = (ix + 0.5) / nx - 0.5
        const v = (iy + 0.5) / ny - 0.5
        const w = (iz + 0.5) / nz - 0.5

        // Jitter by up to half a cell, so the lattice never reads as a lattice.
        const ju = u + (random() - 0.5) / nx * 0.9
        const jv = v + (random() - 0.5) / ny * 0.9
        const jw = w + (random() - 0.5) / nz * 0.9

        // Trim to an ellipsoid a little inside the box.
        const r = Math.hypot(ju / 0.46, jv / 0.4, jw / 0.46)
        if (r > 1) continue

        nodes.push([ju * size[0], jv * size[1], jw * size[2]])
      }
    }
  }
  return nodes
}

const distanceSquared = (a, b) => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

/**
 * A minimum spanning tree, plus the shortest leftover edges put back.
 *
 * The tree is what guarantees one connected structure — no isolated pieces to
 * clean up afterwards. The leftover edges are what turn a tree into a network
 * with cycles, which is the difference between a branching root and the loops
 * in the reference.
 */
function connect(nodes, loops) {
  const n = nodes.length
  const inTree = new Uint8Array(n)
  const best = new Float64Array(n).fill(Infinity)
  const parent = new Int32Array(n).fill(-1)
  const edges = []
  const used = new Set()

  best[0] = 0
  for (let step = 0; step < n; step++) {
    let u = -1
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (u === -1 || best[i] < best[u])) u = i
    }
    inTree[u] = 1
    if (parent[u] >= 0) {
      edges.push([parent[u], u])
      used.add(key(parent[u], u))
    }
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue
      const d = distanceSquared(nodes[u], nodes[v])
      if (d < best[v]) {
        best[v] = d
        parent[v] = u
      }
    }
  }

  if (loops > 0) {
    const spare = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (used.has(key(i, j))) continue
        spare.push([distanceSquared(nodes[i], nodes[j]), i, j])
      }
    }
    spare.sort((a, b) => a[0] - b[0])
    const extra = Math.round(loops * n * 0.6)
    for (let k = 0; k < extra && k < spare.length; k++) {
      edges.push([spare[k][1], spare[k][2]])
    }
  }

  return edges
}

const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`)

/** Bow each edge and cut it into straight segments with tapering radii. */
function buildSegments(nodes, edges, bend, radius, curve) {
  const segments = new Float32Array(edges.length * SUBDIVISIONS * STRIDE)
  let at = 0

  for (const [ai, bi] of edges) {
    const a = nodes[ai]
    const b = nodes[bi]
    const length = Math.sqrt(distanceSquared(a, b))

    // Control point for a quadratic arc: the midpoint, pushed sideways by a
    // noise vector so no two spans bow the same way.
    const mx = (a[0] + b[0]) * 0.5
    const my = (a[1] + b[1]) * 0.5
    const mz = (a[2] + b[2]) * 0.5
    const push = length * curve * 0.42
    const cx = mx + bend(mx * 0.4, my * 0.4, mz * 0.4) * push
    const cy = my + bend(mx * 0.4 + 17.1, my * 0.4 - 5.3, mz * 0.4 + 9.7) * push * 0.7
    const cz = mz + bend(mx * 0.4 - 8.9, my * 0.4 + 11.4, mz * 0.4 - 3.2) * push

    let px = a[0]
    let py = a[1]
    let pz = a[2]

    for (let s = 1; s <= SUBDIVISIONS; s++) {
      const t = s / SUBDIVISIONS
      const it = 1 - t
      const qx = it * it * a[0] + 2 * it * t * cx + t * t * b[0]
      const qy = it * it * a[1] + 2 * it * t * cy + t * t * b[1]
      const qz = it * it * a[2] + 2 * it * t * cz + t * t * b[2]

      segments[at] = px
      segments[at + 1] = py
      segments[at + 2] = pz
      segments[at + 3] = qx
      segments[at + 4] = qy
      segments[at + 5] = qz
      segments[at + 6] = taper(radius, (s - 1) / SUBDIVISIONS)
      segments[at + 7] = taper(radius, t)
      at += STRIDE

      px = qx
      py = qy
      pz = qz
    }
  }

  return segments
}

/** Thick where spans meet, thin in the middle of a span. */
const taper = (radius, t) => radius * (1 - 0.42 * Math.sin(Math.PI * t))

/** Bin the segments so a voxel only tests what is near it. */
function index(segments, size, radius) {
  const count = segments.length / STRIDE
  const nx = Math.max(1, Math.ceil(size[0] / BIN_SIZE))
  const ny = Math.max(1, Math.ceil(size[1] / BIN_SIZE))
  const nz = Math.max(1, Math.ceil(size[2] / BIN_SIZE))
  const bins = new Array(nx * ny * nz)

  const cell = [size[0] / nx, size[1] / ny, size[2] / nz]
  const half = [size[0] / 2, size[1] / 2, size[2] / 2]
  const reach = radius * 1.6

  const binOf = (x, y, z) => {
    const ix = Math.floor((x + half[0]) / cell[0])
    const iy = Math.floor((y + half[1]) / cell[1])
    const iz = Math.floor((z + half[2]) / cell[2])
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return -1
    return (iz * ny + iy) * nx + ix
  }

  for (let s = 0; s < count; s++) {
    const o = s * STRIDE
    const lo = [
      Math.min(segments[o], segments[o + 3]) - reach,
      Math.min(segments[o + 1], segments[o + 4]) - reach,
      Math.min(segments[o + 2], segments[o + 5]) - reach,
    ]
    const hi = [
      Math.max(segments[o], segments[o + 3]) + reach,
      Math.max(segments[o + 1], segments[o + 4]) + reach,
      Math.max(segments[o + 2], segments[o + 5]) + reach,
    ]

    const ix0 = Math.max(0, Math.floor((lo[0] + half[0]) / cell[0]))
    const iy0 = Math.max(0, Math.floor((lo[1] + half[1]) / cell[1]))
    const iz0 = Math.max(0, Math.floor((lo[2] + half[2]) / cell[2]))
    const ix1 = Math.min(nx - 1, Math.floor((hi[0] + half[0]) / cell[0]))
    const iy1 = Math.min(ny - 1, Math.floor((hi[1] + half[1]) / cell[1]))
    const iz1 = Math.min(nz - 1, Math.floor((hi[2] + half[2]) / cell[2]))

    for (let iz = iz0; iz <= iz1; iz++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const b = (iz * ny + iy) * nx + ix
          if (!bins[b]) bins[b] = []
          bins[b].push(o)
        }
      }
    }
  }

  let occupied = 0
  let total = 0
  for (const b of bins) if (b) { occupied++; total += b.length }

  return {
    segmentCount: count,
    /** Mean segments a voxel has to test — the number that makes this viable. */
    binLoad: occupied ? total / occupied : 0,

    /**
     * Signed distance to the surface of the network: negative inside a strut,
     * positive outside, Infinity where nothing is near.
     */
    distanceAt(x, y, z) {
      const b = binOf(x, y, z)
      if (b < 0) return Infinity
      const list = bins[b]
      if (!list) return Infinity

      let best = Infinity
      for (let i = 0; i < list.length; i++) {
        const o = list[i]
        const ax = segments[o]
        const ay = segments[o + 1]
        const az = segments[o + 2]
        const ex = segments[o + 3] - ax
        const ey = segments[o + 4] - ay
        const ez = segments[o + 5] - az

        const px = x - ax
        const py = y - ay
        const pz = z - az
        const ee = ex * ex + ey * ey + ez * ez
        let t = ee > 0 ? (px * ex + py * ey + pz * ez) / ee : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t

        const dx = px - ex * t
        const dy = py - ey * t
        const dz = pz - ez * t
        const r = segments[o + 6] + (segments[o + 7] - segments[o + 6]) * t
        const sd = Math.sqrt(dx * dx + dy * dy + dz * dz) - r
        if (sd < best) best = sd
      }
      return best
    },

    /** 0..1 across a strut and a little way off it, for the material read. */
    proximityAt(x, y, z, band) {
      const sd = this.distanceAt(x, y, z)
      if (sd === Infinity) return 0
      return clamp01(1 - sd / band)
    },
  }
}

function emptyScaffold() {
  return {
    segmentCount: 0,
    binLoad: 0,
    distanceAt: () => Infinity,
    proximityAt: () => 0,
  }
}
