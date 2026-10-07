/**
 * The scatter system: where the colony forms, and how it organises itself.
 *
 * The first passes scattered each language on its own over all suitable
 * ground. Every rule held, and the result still read as props: many forms of
 * similar size, evenly spread, each standing alone. This version forms
 * *colonies* instead:
 *
 *     world data (worldData.js)
 *       -> site potential: dry ground near water, gentle, with a record, in
 *          the colony field
 *       -> a few colony sites: its strongest peaks, kept far apart
 *       -> per colony, in order:
 *            one anchor membrane at the site
 *            smaller veils on suitable ground nearby, smaller further out
 *            structure: ribs in the anchor, strands toward the others, and
 *              one crossing where a hollow or water lies within reach
 *            residue around every base, along the trace running downhill,
 *              and one heap where the record is thickest
 *       -> instance descriptors -> form builders (traceForms.js)
 *
 * Nothing grows outside a colony. Each language's per-point rules are
 * unchanged: they now decide where *inside* a colony a member may stand.
 *
 * Placement is deterministic: each colony draws from its own seeded stream.
 */

import { mulberry32 } from './noise'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}
const lerp = (a, b, t) => a + (b - a) * t

/* --- rule vocabulary ----------------------------------------------------- */

/**
 * A rule reads one channel and returns 0..1. `edge` may be a number or a
 * function of the layer's params, so a slider can move a threshold without
 * the rule itself changing. `soft` is the half-width of the blend either side
 * of the edge: rules are gradients, not cliffs.
 */
const above = (channel, edge, soft, why) => ({ kind: 'above', channel, edge, soft, why })
const below = (channel, edge, soft, why) => ({ kind: 'below', channel, edge, soft, why })
const band = (channel, lo, hi, soft, why) => ({ kind: 'band', channel, lo, hi, soft, why })

const resolve = (value, params) => (typeof value === 'function' ? value(params) : value)

function evaluate(rule, d, params) {
  const v = d[rule.channel]
  if (rule.kind === 'above') {
    const e = resolve(rule.edge, params)
    return smoothstep(e - rule.soft, e + rule.soft, v)
  }
  if (rule.kind === 'below') {
    const e = resolve(rule.edge, params)
    return 1 - smoothstep(e - rule.soft, e + rule.soft, v)
  }
  const lo = resolve(rule.lo, params)
  const hi = resolve(rule.hi, params)
  return smoothstep(lo - rule.soft, lo + rule.soft, v) * (1 - smoothstep(hi - rule.soft, hi + rule.soft, v))
}

const UNITS = { slope: '°', shore: 'u', depth: 'u' }
const fmt = (channel, v) => {
  const unit = UNITS[channel] ?? ''
  const digits = unit === '°' ? 0 : Math.abs(v) < 1 ? 2 : 1
  return `${Number(v).toFixed(digits)}${unit}`
}

/** One readable line per rule, with the current slider values filled in. */
export function describeRule(rule, params) {
  if (rule.kind === 'above') return `${rule.channel} > ${fmt(rule.channel, resolve(rule.edge, params))}`
  if (rule.kind === 'below') return `${rule.channel} < ${fmt(rule.channel, resolve(rule.edge, params))}`
  return `${rule.channel} ${fmt(rule.channel, resolve(rule.lo, params))} … ${fmt(rule.channel, resolve(rule.hi, params))}`
}

/* --- internal protocol ---------------------------------------------------- */

/**
 * Tuned once, not exposed: the panel prints every rule and leaves only design
 * controls adjustable.
 */
const PROTOCOL = {
  /** Share of the world the colony field leaves empty (it is ranked). */
  quiet: 0.35,
  /** How far inland of the waterline the wet margin extends, world units. */
  bloomReach: 2.2,
  /** Trace Beads are an accent: a fixed flow threshold. */
  beadThreshold: 0.3,
}

/**
 * Design params with the internal protocol filled in. Accumulation is one
 * control standing for things that only make sense together: residue settles
 * on thinner record, heaps grow taller, trails run further.
 */
export function withProtocol(params) {
  const accumulation = params.shardAccumulation ?? 0.5
  return {
    ...PROTOCOL,
    ...params,
    shardAccumulation: accumulation,
    shardThreshold: 0.7 - 0.45 * accumulation,
  }
}

/* --- protocols ----------------------------------------------------------- */

/**
 * The layers. Three are the scatter languages; Trace Beads is a small accent
 * shown only with the whole colony. `rules` are per point: inside a colony
 * they decide where a member may stand, and over the whole world they draw
 * the suitability map.
 */
export const LAYERS = [
  {
    id: 'bridgework',
    label: 'Bridgework',
    role: 'Structural support',
    summary: 'Structure inside each colony: ribs in its anchor membrane, strands reaching toward its other forms, and a crossing where the world offers one.',
    protocol: 'Structure first stiffens the anchor membrane with ribs, then reaches toward the colony’s other forms — not always arriving — and, where a hollow or water lies within reach, crosses it once. Every footing must be dry and stable.',
    varies: 'Ribs, strands and the crossing from Amount and the colony’s maturity · strands peak off-centre and may end in the air · a crossing carries a film, and a small membrane at its far footing',
    rules: [
      above('depth', 0.06, 0.05, 'footing stands clear of the water'),
      below('slope', 16, 5, 'no footing on a cliff'),
    ],
    colony: 1,
  },
  {
    id: 'bloom',
    label: 'Membrane Bloom',
    role: 'Soft surface / growth',
    summary: 'One large anchor membrane per colony, with smaller veils gathered around it.',
    protocol: 'Each colony grows from one anchor membrane at its strongest point. Smaller veils follow on suitable ground nearby — the wet margin, gentle slopes, gathered trace — smaller the further out they stand.',
    varies: 'Anchor size from the colony’s maturity · veils shrink with distance from it and lean with the colony toward the water · openness from distance to the water: wet skins at the waterline, lace further up',
    rules: [
      band('shore', -0.3, (p) => p.bloomReach, 0.3, 'the wet margin'),
      below('slope', 20, 6, 'sheets cannot stand on steep ground'),
      above('trace', 0.2, 0.12, 'something has gathered here'),
    ],
    colony: 1,
    prefer: (d) => 0.55 + 0.45 * d.hollow,
  },
  {
    id: 'shard',
    label: 'Shard / Residue',
    role: 'Sediment / fragment',
    summary: 'Material caught around bases, laid along the trace downhill, and one heap where the record is thickest.',
    protocol: 'Residue gathers where forms stand and where material moved: banked around every base, laid along the trace running downhill from the anchor, and in one heap at the colony’s thickest record.',
    varies: 'How much from trace and Amount · trails, heaps and fine grains from Accumulation · plates lie along the flow, partly buried',
    rules: [
      above('trace', (p) => p.shardThreshold, 0.1, 'enough sediment settled'),
      below('slope', 24, 6, 'fragments slide off steep faces'),
      above('depth', -0.45, 0.15, 'dry or shallow enough to be seen'),
    ],
    colony: 0.6,
  },
  {
    id: 'bead',
    label: 'Trace Beads',
    role: 'Active trace',
    accent: true,
    summary: 'A small accent: bead trails on live channels near the colonies.',
    protocol: 'Where traces are still being made: short bead trails running downhill along the live flow channels.',
    varies: 'Trail length and bead size from flow · the only mint in the scene',
    rules: [
      above('flow', (p) => p.beadThreshold, 0.08, 'material is moving here'),
      above('depth', -0.12, 0.08, 'at the surface'),
    ],
    colony: 0.35,
  },
]

const LAYER_BY_ID = Object.fromEntries(LAYERS.map((layer) => [layer.id, layer]))

/** The colony field as a gate, for the suitability map. */
function colonyGate(d, params, weight) {
  if (weight <= 0 || params.quiet <= 0) return 1
  return Math.pow(smoothstep(params.quiet - 0.06, params.quiet + 0.06, d.colony), weight)
}

/** A layer's own rules at one point, 0..1 — where a member may stand. */
function fits(layer, d, params) {
  let s = 1
  for (const rule of layer.rules) {
    s *= evaluate(rule, d, params)
    if (s <= 0) return 0
  }
  return layer.prefer ? s * layer.prefer(d, params) : s
}

/** A layer's rules times the colony field: what the suitability map shows. */
export function suitability(layer, d, params) {
  return colonyGate(d, params, layer.colony) * fits(layer, d, params)
}

/** Suitability of one layer over the whole field, for the map. */
export function suitabilityGrid(world, layerId, design, res = world.res) {
  const params = withProtocol(design)
  const layer = LAYER_BY_ID[layerId]
  const grid = new Float32Array(res * res)
  const d = {}
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      world.sample((i + 0.5) / res, (j + 0.5) / res, d)
      grid[j * res + i] = suitability(layer, d, params)
    }
  }
  return grid
}

/* --- helpers ------------------------------------------------------------- */

function sampleAt(world, x, z, out = {}) {
  const [u, v] = world.toUV(x, z)
  return world.sample(u, v, out)
}

function surfaceAt(world, x, z) {
  const [u, v] = world.toUV(x, z)
  return world.surface(u, v)
}

const groundAt = (world, x, z) => world.groundY(...world.toUV(x, z))

const inBounds = (world, x, z, margin) => {
  const h = world.size / 2 - margin
  return x > -h && x < h && z > -h && z < h
}

/** A point in a disc, area-uniform. */
function inDisc(random, x, z, rMin, rMax) {
  const angle = random() * Math.PI * 2
  const r = Math.sqrt(lerp((rMin / rMax) ** 2, 1, random())) * rMax
  return [x + Math.cos(angle) * r, z + Math.sin(angle) * r, r]
}

/**
 * Footprints claimed by placed forms, so members of a colony never stand on
 * top of each other.
 */
class Claims {
  constructor() {
    this.items = []
  }

  add(x, z, r) {
    this.items.push(x, z, r)
  }

  clear(x, z, r) {
    const a = this.items
    for (let k = 0; k < a.length; k += 3) {
      const dx = a[k] - x
      const dz = a[k + 1] - z
      const rr = a[k + 2] + r
      if (dx * dx + dz * dz < rr * rr) return false
    }
    return true
  }
}

/* --- colony sites -------------------------------------------------------- */

const COLONY = {
  /** At most this many colonies; fewer if the world offers fewer sites. */
  max: 5,
  /** Distance between colony centres, world units: the empty space. */
  separation: 6.5,
  /** A site must reach this share of the best site's potential. */
  floor: 0.3,
  /** Grid the potential is evaluated on. */
  grid: 64,
}

/**
 * Where a colony would begin: dry ground near the water (the wet margin, a
 * little wider), gentle, holding some record, inside the colony field, and
 * sheltered rather than exposed.
 */
function sitePotential(d, params) {
  const margin = smoothstep(-0.2, 0.4, d.shore) * (1 - smoothstep(3, 5, d.shore))
  const gentle = 1 - smoothstep(12, 22, d.slope)
  const record = 0.3 + 0.7 * smoothstep(0.1, 0.7, d.trace)
  const field = smoothstep(params.quiet - 0.1, params.quiet + 0.3, d.colony)
  const shelter = 0.75 + 0.25 * d.hollow
  return margin * gentle * record * field * shelter
}

/**
 * The few strongest peaks of the site potential, kept far apart. Blurred
 * first, so a colony starts at a broad strong place rather than a spike.
 */
export function findColonies(world, params) {
  const n = COLONY.grid
  const raw = new Float32Array(n * n)
  const d = {}
  // A colony does not take root in a stream: its site keeps clear of the
  // water veins (they are part of the world it grows in).
  const lines = params.streams ?? []
  const clearOfStreams = (x, z) => {
    let near = Infinity
    for (const sl of lines) for (let k = 0; k < sl.points.length; k += 3) near = Math.min(near, Math.hypot(sl.points[k].x - x, sl.points[k].z - z))
    return smoothstep(1.2, 2.6, near)
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      world.sample((i + 0.5) / n, (j + 0.5) / n, d)
      const x = ((i + 0.5) / n - 0.5) * world.size
      const z = ((j + 0.5) / n - 0.5) * world.size
      raw[j * n + i] = sitePotential(d, params) * clearOfStreams(x, z)
    }
  }
  const potential = blur(raw, n, 2)
  const order = Array.from(potential.keys()).sort((a, b) => potential[b] - potential[a])
  const best = potential[order[0]]
  if (!(best > 0.01)) return []

  const cell = world.size / n
  const sites = []
  for (const k of order) {
    if (sites.length >= COLONY.max || potential[k] < best * COLONY.floor) break
    const x = ((k % n) + 0.5) * cell - world.size / 2
    const z = (Math.floor(k / n) + 0.5) * cell - world.size / 2
    if (!inBounds(world, x, z, 2)) continue
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < COLONY.separation)) continue
    sites.push({ x, z, strength: potential[k] / best })
  }
  return sites.map((site, index) => describeColony(world, site, index))
}

/**
 * A colony's centre, direction and maturity. Maturity comes mostly from the
 * record around the site, so a longer History makes colonies *older* — larger
 * anchors, more members, more residue — rather than just more numerous.
 */
function describeColony(world, site, index) {
  const d = {}
  const e = 0.8
  // Toward the water: down the shore-distance gradient.
  let dx = sampleAt(world, site.x - e, site.z, d).shore - sampleAt(world, site.x + e, site.z, d).shore
  let dz = sampleAt(world, site.x, site.z - e, d).shore - sampleAt(world, site.x, site.z + e, d).shore
  let len = Math.hypot(dx, dz)
  if (len < 1e-4) {
    sampleAt(world, site.x, site.z, d)
    dx = d.downX
    dz = d.downZ
    len = Math.hypot(dx, dz) || 1
  }
  dx /= len
  dz /= len

  // Settle the anchor on dry ground, stepping inland if needed.
  let x = site.x
  let z = site.z
  for (let k = 0; k < 10 && sampleAt(world, x, z, d).depth < 0.1; k++) {
    x -= dx * 0.3
    z -= dz * 0.3
  }

  let trace = 0
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    trace += sampleAt(world, x + Math.cos(a) * 1.4, z + Math.sin(a) * 1.4, d).trace
  }
  const record = smoothstep(0.1, 0.7, trace / 12)
  const maturity = clamp01((0.3 + 0.7 * record) * (0.55 + 0.45 * Math.sqrt(site.strength)))

  return {
    index,
    x,
    z,
    y: groundAt(world, x, z),
    dir: [dx, dz],
    maturity,
    radius: lerp(1.7, 3, maturity),
    // The most established colonies begin first.
    birth: (1 - maturity) * 0.12,
  }
}

/* --- placement ----------------------------------------------------------- */

/**
 * Find the colonies, then grow each one.
 *
 * @returns {{ colonies: object[], layers: Record<string, { instances: object[], stats: object }> }}
 */
export function placeScatter(world, design) {
  const params = withProtocol(design)
  const colonies = findColonies(world, params)
  const claims = new Claims()
  // Each stream claims its course, so no membrane or residue stands in the
  // water. Structure may still cross it — a strand over a stream is a span.
  for (const sl of params.streams ?? []) {
    for (let k = 0; k < sl.points.length; k += 3) claims.add(sl.points[k].x, sl.points[k].z, sl.width[k] * 1.5)
  }
  const out = { bridgework: [], bloom: [], shard: [], bead: [] }
  for (const colony of colonies) {
    growColony(world, params, colony, claims, out, mulberry32((params.seed | 0) * 7919 + colony.index * 104729 + 1))
  }

  const by = (list, key) => list.filter((i) => i.type === key || i.role === key).length
  return {
    colonies,
    layers: {
      bridgework: {
        instances: out.bridgework,
        stats: {
          count: out.bridgework.length + out.bloom.reduce((s, b) => s + (b.ribs ?? 0), 0),
          ribs: out.bloom.reduce((s, b) => s + (b.ribs ?? 0), 0),
          reaches: by(out.bridgework, 'reach'),
          spans: by(out.bridgework, 'span'),
        },
      },
      bloom: {
        instances: out.bloom,
        stats: { count: out.bloom.length, anchors: by(out.bloom, 'anchor'), secondaries: out.bloom.length - by(out.bloom, 'anchor') },
      },
      shard: {
        instances: out.shard,
        stats: {
          count: out.shard.length,
          plates: out.shard.reduce((s, i) => s + i.plates.length, 0),
          grains: out.shard.reduce((s, i) => s + i.beads.length, 0),
        },
      },
      bead: {
        instances: out.bead,
        stats: { count: out.bead.length, beads: out.bead.reduce((s, i) => s + i.beads.length, 0) },
      },
    },
  }
}

/**
 * One colony, in order: anchor, smaller veils, structure, residue, beads.
 * Hierarchy is built in, not tuned: the anchor's size comes from the
 * colony's maturity, every other member is a fraction of the anchor, and
 * that fraction falls with distance from it.
 */
function growColony(world, params, colony, claims, out, random) {
  const d = {}
  const seed = () => Math.floor(random() * 1e6)
  const { x: cx, z: cz, maturity: M, radius: R, birth: cb } = colony
  // The colony leans toward the water, turned 20–40° along the shore: square
  // on to the water, every anchor faced anyone looking from the water head-on
  // and read as a rounded bell; turned, its asymmetry and curl show.
  const twist = (random() < 0.5 ? -1 : 1) * (0.35 + 0.35 * random())
  const Dx = colony.dir[0] * Math.cos(twist) - colony.dir[1] * Math.sin(twist)
  const Dz = colony.dir[0] * Math.sin(twist) + colony.dir[1] * Math.cos(twist)
  const bases = []

  // 1. The anchor membrane, at the site: one continuous frill whose crests
  // multiply as the colony matures, its base line running across the lean.
  sampleAt(world, cx, cz, d)
  const p = surfaceAt(world, cx, cz)
  const H = lerp(1.4, 2.5, M) * (0.9 + 0.2 * random())
  const crests = 2 + (M > 0.6 ? 1 : 0)
  const width = H * (0.55 + 0.4 * crests)
  const anchor = {
    role: 'anchor',
    colony: colony.index,
    p: [p.x, p.y, p.z],
    lean: Math.atan2(Dz, Dx),
    height: H,
    crests,
    width,
    // The anchor is a fuller skin than its satellites: lace across a sheet
    // this large read as dense spotting, not as openness.
    openness: 0.15 + 0.4 * smoothstep(-0.1, params.bloomReach, d.shore),
    glow: Math.pow(d.flow, 1.5) * 0.7,
    maturity: M,
    // Bridgework merging into the membrane: ribs along it.
    ribs: params.bridgeAmount > 0.12 ? (params.bridgeAmount > 0.75 && M > 0.7 ? 2 : 1) : 0,
    birth: cb + 0.22,
    seed: seed(),
  }
  out.bloom.push(anchor)
  // The frill claims its whole base line, not just its centre.
  for (const f of [-0.4, 0, 0.4]) claims.add(cx - Dz * width * f, cz + Dx * width * f, 0.35 * H)
  bases.push({ x: cx, z: cz, r: 0.2 + 0.12 * H, weight: 1 })

  // 2. Smaller veils on suitable ground nearby.
  const bloomLayer = LAYER_BY_ID.bloom
  const want = Math.round(lerp(0.5, 5, params.bloomAmount) * (0.35 + 0.65 * M))
  const candidates = []
  for (let k = 0; k < 80; k++) {
    const [x, z, r] = inDisc(random, cx, cz, 0.35 * H + 0.5, R)
    if (!inBounds(world, x, z, 0.6)) continue
    const s = fits(bloomLayer, sampleAt(world, x, z, d), params)
    if (s > 0.2) candidates.push({ x, z, r, score: s * (1 - 0.45 * (r / R)) * (0.8 + 0.4 * random()) })
  }
  candidates.sort((a, b) => b.score - a.score)
  const secondaries = []
  for (const c of candidates) {
    if (secondaries.length >= want) break
    const h = H * lerp(0.48, 0.2, c.r / R) * (0.85 + 0.3 * random())
    if (!claims.clear(c.x, c.z, 0.25 + 0.25 * h)) continue
    const s = surfaceAt(world, c.x, c.z)
    sampleAt(world, c.x, c.z, d)
    // Lean with the colony toward the water, fanning slightly outward.
    const ox = (c.x - cx) / c.r
    const oz = (c.z - cz) / c.r
    const lx = Dx * 0.65 + ox * 0.35 + d.downX * 0.15
    const lz = Dz * 0.65 + oz * 0.35 + d.downZ * 0.15
    const veil = {
      role: 'secondary',
      colony: colony.index,
      p: [s.x, s.y, s.z],
      lean: Math.atan2(lz, lx),
      height: h,
      // Two crests only for the largest, most established satellites: small
      // two-crested frills came out squat, like boxes.
      crests: h > 0.42 * H && M > 0.75 ? 2 : 1,
      width: h * (h > 0.42 * H && M > 0.75 ? 1.4 : 0.85),
      openness: 0.25 + 0.75 * smoothstep(-0.1, params.bloomReach, d.shore),
      glow: Math.pow(d.flow, 1.5) * 0.7,
      maturity: M * (1 - 0.4 * (c.r / R)),
      ribs: 0,
      // The colony grows outward from its anchor.
      birth: cb + 0.32 + 0.14 * (c.r / R),
      seed: seed(),
      distance: c.r,
    }
    secondaries.push(veil)
    out.bloom.push(veil)
    claims.add(c.x, c.z, 0.2 + 0.25 * h)
    bases.push({ x: c.x, z: c.z, r: 0.12 + 0.1 * h, weight: 0.45 })
  }

  // 3. Structure.
  if (params.bridgeAmount > 0) {
    // Strands from the anchor toward its largest neighbours. Not all arrive.
    const reaches = Math.min(secondaries.length, Math.round(params.bridgeAmount * 2.4 * (0.4 + 0.6 * M)))
    const targets = [...secondaries].sort((a, b) => b.height - a.height).slice(0, reaches)
    targets.forEach((t, k) => {
      const ux = t.p[0] - cx
      const uz = t.p[2] - cz
      const len = Math.hypot(ux, uz)
      const start = 0.12 + 0.08 * H
      const ax = cx + (ux / len) * start
      const az = cz + (uz / len) * start
      const bx = t.p[0] - (ux / len) * 0.1
      const bz = t.p[2] - (uz / len) * 0.1
      const grounded = random() < 0.6
      out.bridgework.push({
        type: 'reach',
        colony: colony.index,
        a: [ax, groundAt(world, ax, az), az],
        b: [bx, groundAt(world, bx, bz), bz],
        len: Math.hypot(bx - ax, bz - az),
        arch: Math.hypot(bx - ax, bz - az) * (0.28 + 0.14 * random()),
        grounded,
        end: grounded ? 1 : 0.5 + 0.25 * random(),
        maturity: M,
        birth: cb + 0.48 + 0.05 * k,
        seed: seed(),
      })
    })

    // One crossing, where the world offers it.
    if (params.bridgeAmount > 0.45) {
      // The anchor frill's base line, which a crossing may not pass through.
      const frill = [cx + Dz * width * 0.5, cz - Dx * width * 0.5, cx - Dz * width * 0.5, cz + Dx * width * 0.5]
      const span = findCrossing(world, params, colony, claims, random, frill)
      if (span) {
        out.bridgework.push({ ...span, colony: colony.index, maturity: M, birth: cb + 0.55, seed: seed() })
        claims.add(span.a[0], span.a[2], 0.5)
        claims.add(span.b[0], span.b[2], 0.5)
        bases.push({ x: span.a[0], z: span.a[2], r: 0.18, weight: 0.4 })
        bases.push({ x: span.b[0], z: span.b[2], r: 0.18, weight: 0.4 })
        // A small membrane at the far footing: the crossing lands in growth.
        const fb = sampleAt(world, span.b[0], span.b[2], d)
        if (fits(bloomLayer, fb, params) > 0.1) {
          out.bloom.push({
            role: 'footing',
            colony: colony.index,
            p: span.b,
            lean: Math.atan2(span.b[2] - span.a[2], span.b[0] - span.a[0]),
            height: H * 0.28,
            crests: 1,
            width: H * 0.24,
            openness: 0.6,
            glow: 0,
            maturity: M * 0.6,
            ribs: 0,
            birth: cb + 0.72,
            seed: seed(),
          })
        }
      }
    }
  }

  // 4. Residue.
  gatherResidue(world, params, colony, bases, claims, out, random)

  // 5. A trace bead trail or two on the live channels nearby.
  traceBeads(world, params, colony, out, random)
}

/* --- Bridgework: one crossing ------------------------------------------- */

const SPAN_MIN = 2.4
const SPAN_SAMPLES = 20

/**
 * The ground between two footings: how far it dips below the lower foot
 * (the hollow being crossed), how much of it is water, and how far it rises
 * above the straight line (a hill in the way).
 */
function profile(world, ax, az, bx, bz) {
  const ya = groundAt(world, ax, az)
  const yb = groundAt(world, bx, bz)
  const d = {}
  let lowest = Infinity
  let rise = 0
  let wet = 0
  for (let k = 1; k < SPAN_SAMPLES; k++) {
    const t = k / SPAN_SAMPLES
    const x = lerp(ax, bx, t)
    const z = lerp(az, bz, t)
    const y = groundAt(world, x, z)
    if (t > 0.15 && t < 0.85) lowest = Math.min(lowest, y)
    rise = Math.max(rise, y - lerp(ya, yb, t))
    if (sampleAt(world, x, z, d).depth < 0) wet++
  }
  return { ya, yb, gap: Math.min(ya, yb) - lowest, rise, wet: wet / (SPAN_SAMPLES - 1) }
}

/**
 * The colony's one crossing: a footing inside the colony, the other across a
 * real dip or water within reach. A crossing over nothing is not a bridge;
 * the dip is measured against the relief so the rule holds on any landform.
 */
function findCrossing(world, params, colony, claims, random, frill) {
  const layer = LAYER_BY_ID.bridgework
  const reach = Math.max(SPAN_MIN + 0.4, params.bridgeReach)
  const relief = Math.max(0.2, world.elevation)
  const d = {}
  let best = null
  for (let k = 0; k < 48; k++) {
    const [ax, az] = inDisc(random, colony.x, colony.z, 0.6, colony.radius)
    // Footings may sit close to other members: their tissue merges anyway.
    if (!inBounds(world, ax, az, 0.8) || !claims.clear(ax, az, 0.2)) continue
    const sa = fits(layer, sampleAt(world, ax, az, d), params)
    if (sa < 0.3) continue
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = random() * Math.PI * 2
      const len = lerp(SPAN_MIN, reach, Math.pow(random(), 0.8))
      const bx = ax + Math.cos(angle) * len
      const bz = az + Math.sin(angle) * len
      if (!inBounds(world, bx, bz, 0.8) || !claims.clear(bx, bz, 0.2)) continue
      const sb = fits(layer, sampleAt(world, bx, bz, d), params)
      if (sb < 0.3) continue
      // Never through the anchor's frill.
      if (segmentGap(ax, az, bx, bz, ...frill) < 0.6) continue
      const g = profile(world, ax, az, bx, bz)
      if (g.rise > 0.3 * len) continue
      const crossing = Math.max(smoothstep(0.03 * relief, 0.2 * relief, g.gap), g.wet > 0.1 ? 0.75 + 0.25 * g.wet : 0)
      const score = sa * sb * crossing * (0.75 + 0.25 * random())
      if (score > 0.05 && (!best || score > best.score)) best = { ax, az, bx, bz, len, g, score }
    }
  }
  if (!best) return null

  const { ax, az, bx, bz, len, g } = best
  // Arch: a share of the span, raised to clear the ground across its middle.
  let arch = len * 0.18
  for (let k = 1; k < SPAN_SAMPLES; k++) {
    const t = k / SPAN_SAMPLES
    if (t < 0.2 || t > 0.8) continue
    const y = groundAt(world, lerp(ax, bx, t), lerp(az, bz, t))
    arch = Math.max(arch, (y - lerp(g.ya, g.yb, t) + 0.3) / Math.pow(Math.sin(Math.PI * t), 0.8))
  }
  return {
    type: 'span',
    a: [ax, g.ya, az],
    b: [bx, g.yb, bz],
    len,
    arch: Math.min(arch, len * 0.32),
    gap: g.gap,
  }
}

/** Shortest distance between two segments, 0 if they cross. */
function segmentGap(ax, az, bx, bz, cx, cz, dx, dz) {
  const side = (ox, oz, px, pz, qx, qz) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox)
  const d1 = side(cx, cz, dx, dz, ax, az)
  const d2 = side(cx, cz, dx, dz, bx, bz)
  const d3 = side(ax, az, bx, bz, cx, cz)
  const d4 = side(ax, az, bx, bz, dx, dz)
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0
  return Math.min(
    pointSegment(ax, az, cx, cz, dx, dz),
    pointSegment(bx, bz, cx, cz, dx, dz),
    pointSegment(cx, cz, ax, az, bx, bz),
    pointSegment(dx, dz, ax, az, bx, bz),
  )
}

function pointSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax
  const vz = bz - az
  const t = clamp01(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1))
  return Math.hypot(px - ax - vx * t, pz - az - vz * t)
}

/* --- Shard / Residue: accumulation -------------------------------------- */

/**
 * Residue is accumulation, not a population of objects:
 *
 *   around bases  plates banked against each base on its upstream side,
 *                 raised end resting on it, with fine grains between —
 *                 the most at the anchor
 *   along trace   a trail laid down the gradient from the anchor, thinning
 *                 as it goes, until the water or a steep face stops it
 *   one heap      at the thickest record in or near the colony
 *
 * Plates on a trail or in the heap must pass every residue rule where they
 * land. Material *caught by a form* need not: it only needs ground it can
 * lie on (not steep, not deep under water), and the record there decides
 * how much of it there is rather than whether there is any.
 */
function gatherResidue(world, params, colony, bases, claims, out, random) {
  const layer = LAYER_BY_ID.shard
  const amount = params.shardAmount
  const acc = params.shardAccumulation
  if (amount <= 0) return
  const d = {}
  const at = {}
  const cb = colony.birth

  const [, slopeRule, depthRule] = layer.rules
  const ground = (q) => evaluate(slopeRule, q, params) * evaluate(depthRule, q, params)
  const plate = (x, z, dirX, dirZ, len, dip, lift, order, caught = false) => {
    const [u, v] = world.toUV(x, z)
    world.sample(u, v, at)
    if ((caught ? ground(at) : fits(layer, at, params)) < 0.15) return null
    return {
      x,
      y: world.groundY(u, v),
      z,
      dirX,
      dirZ,
      len,
      width: len * (0.3 + 0.2 * random()),
      dip,
      roll: (random() - 0.5) * 0.35,
      lift,
      submerged: clamp01(-at.depth / 0.45),
      order,
      seed: Math.floor(random() * 1e6),
    }
  }
  const grain = (x, z, order, size = 1) => {
    const r = (0.012 + 0.02 * random() * random()) * size
    return { x, y: groundAt(world, x, z) + r * 0.4, z, r, order }
  }

  // Around every base.
  for (const base of bases) {
    sampleAt(world, base.x, base.z, d)
    if (ground(d) < 0.1) continue
    const upstream = Math.atan2(-d.downZ, -d.downX)
    const plates = []
    const beads = []
    // Fewer plates than grains: most of what a base catches is fine material,
    // which the colony's tissue shows as crust; plates are the coarse part.
    const n = Math.round(amount * 14 * base.weight * (0.45 + 0.55 * d.trace) * (0.6 + 0.8 * acc))
    for (let k = 0; k < n; k++) {
      const phi = upstream + (random() - 0.5) * 2.6
      const dist = base.r + 0.04 + random() * 0.22 * (1 + acc)
      const p = plate(
        base.x + Math.cos(phi) * dist,
        base.z + Math.sin(phi) * dist,
        -Math.cos(phi),
        -Math.sin(phi),
        (0.12 + 0.18 * d.trace) * (0.7 + 0.6 * random()),
        0.3 + 0.3 * random(),
        0,
        k / Math.max(1, n),
        true,
      )
      if (p) plates.push(p)
    }
    const m = Math.round(amount * 50 * base.weight * (0.3 + 0.7 * d.trace) * (0.5 + acc))
    for (let k = 0; k < m; k++) {
      const [x, z] = inDisc(random, base.x, base.z, base.r, base.r + 0.5)
      beads.push(grain(x, z, random()))
    }
    if (plates.length || beads.length) {
      out.shard.push({ kind: 'base', colony: colony.index, center: [base.x, groundAt(world, base.x, base.z), base.z], radius: base.r + 0.45, plates, beads, birth: cb + 0.16 + 0.06 * random() })
    }
  }

  // Along the trace, downhill from the anchor.
  {
    sampleAt(world, colony.x, colony.z, d)
    let x = colony.x + d.downX * (0.3 + bases[0].r)
    let z = colony.z + d.downZ * (0.3 + bases[0].r)
    const length = (1.2 + 2.6 * acc) * (0.5 + 0.5 * colony.maturity)
    const plates = []
    const beads = []
    const path = []
    for (let s = 0; s < length; s += 0.22) {
      if (!inBounds(world, x, z, 0.4)) break
      sampleAt(world, x, z, d)
      if (d.depth < -0.4) break
      path.push([x, z, 1 - s / length])
      const fade = 1 - s / length
      if (random() < amount * 0.9 && d.trace > params.shardThreshold * 0.7) {
        const turn = (random() - 0.5) * 0.8
        const p = plate(
          x + (random() - 0.5) * 0.12,
          z + (random() - 0.5) * 0.12,
          d.downX * Math.cos(turn) - d.downZ * Math.sin(turn),
          d.downX * Math.sin(turn) + d.downZ * Math.cos(turn),
          0.08 + 0.2 * fade * (0.7 + 0.6 * random()),
          0.15 + 0.2 * random(),
          0,
          s / length,
        )
        if (p) plates.push(p)
      }
      const g = Math.round((1 + 2 * acc) * fade * amount * 2 * random())
      for (let k = 0; k < g; k++) beads.push(grain(x + (random() - 0.5) * 0.25, z + (random() - 0.5) * 0.25, s / length, 0.5 + 0.5 * fade))
      const wobble = (random() - 0.5) * 0.5
      x += (d.downX * Math.cos(wobble) - d.downZ * Math.sin(wobble)) * 0.22
      z += (d.downX * Math.sin(wobble) + d.downZ * Math.cos(wobble)) * 0.22
    }
    if (plates.length || beads.length) {
      out.shard.push({ kind: 'trail', colony: colony.index, center: [colony.x, colony.y, colony.z], path, plates, beads, birth: cb + 0.04 })
    }
  }

  // One heap at the thickest record in or near the colony.
  if (amount > 0.2) {
    let best = null
    for (let k = 0; k < 40; k++) {
      // Inside the colony, so the heap lies in its tissue rather than apart.
      const [x, z] = inDisc(random, colony.x, colony.z, 0.9, colony.radius + 0.3)
      if (!inBounds(world, x, z, 0.6) || !claims.clear(x, z, 0.3)) continue
      sampleAt(world, x, z, d)
      if (fits(layer, d, params) < 0.3) continue
      if (!best || d.trace > best.trace) best = { x, z, trace: d.trace, downX: d.downX, downZ: d.downZ }
    }
    if (best && best.trace > params.shardThreshold + 0.05) {
      const { x, z, trace } = best
      const radius = 0.25 + 0.25 * acc
      const dirX = best.downX || 1
      const dirZ = best.downZ || 0
      const plates = []
      const n = Math.round((8 + 18 * acc) * amount * (0.5 + 0.5 * trace))
      for (let k = 0; k < n; k++) {
        const [px, pz, r] = inDisc(random, x, z, 0, radius)
        const turn = (random() - 0.5) * 0.9
        const p = plate(
          px,
          pz,
          dirX * Math.cos(turn) - dirZ * Math.sin(turn),
          dirX * Math.sin(turn) + dirZ * Math.cos(turn),
          (0.16 + 0.26 * trace) * (0.7 + 0.6 * random()),
          random() < 0.12 ? 0.45 + 0.25 * random() : 0.15 + 0.3 * random(),
          // A heap, not a scatter: plates nearer the middle sit higher.
          (1 - r / radius) * (0.04 + 0.08 * acc),
          k / n,
        )
        if (p) plates.push(p)
      }
      const beads = []
      for (let k = 0; k < Math.round(amount * 24 * acc); k++) {
        const [bx, bz] = inDisc(random, x, z, 0, radius + 0.3)
        beads.push(grain(bx, bz, random()))
      }
      if (plates.length) {
        out.shard.push({ kind: 'heap', colony: colony.index, center: [x, groundAt(world, x, z), z], radius: radius + 0.3, plates, beads, birth: cb + 0.2 })
        claims.add(x, z, radius)
      }
    }
  }
}

/* --- Trace Beads --------------------------------------------------------- */

/**
 * One or two short bead trails on the liveliest channels in or near the
 * colony, walking downhill one bead per step: the trace still being made.
 */
function traceBeads(world, params, colony, out, random) {
  const layer = LAYER_BY_ID.bead
  const d = {}
  const seeds = []
  for (let k = 0; k < 30; k++) {
    const [x, z] = inDisc(random, colony.x, colony.z, 0.5, colony.radius + 1.2)
    if (!inBounds(world, x, z, 0.6)) continue
    sampleAt(world, x, z, d)
    if (fits(layer, d, params) > 0.3) seeds.push({ x, z, flow: d.flow })
  }
  seeds.sort((a, b) => b.flow - a.flow)
  for (const seed of seeds.slice(0, 2)) {
    const beads = []
    let { x, z } = seed
    const steps = 3 + Math.round(seed.flow * 4)
    for (let k = 0; k < steps; k++) {
      const [u, v] = world.toUV(x, z)
      world.sample(u, v, d)
      if (k > 0 && (d.depth < -0.15 || d.flow < params.beadThreshold * 0.4)) break
      const r = lerp(0.045, 0.018, k / steps)
      beads.push({ x, y: world.groundY(u, v) + r * 0.55, z, r, glow: Math.pow(d.flow, 1.2), order: k / steps })
      const step = 0.2 + 0.06 * random()
      x += d.downX * step
      z += d.downZ * step
      if (!inBounds(world, x, z, 0.3)) break
    }
    if (beads.length >= 2) out.bead.push({ colony: colony.index, beads, birth: colony.birth + 0.02 + random() * 0.08 })
  }
}

/* --- grid helpers -------------------------------------------------------- */

/** Separable box blur, clamped at the edges. */
function blur(src, n, radius) {
  const tmp = new Float32Array(src.length)
  const dst = new Float32Array(src.length)
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
      dst[j * n + i] = s / span
    }
  }
  return dst
}
