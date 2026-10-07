/**
 * Form builders: instance descriptors from scatter.js in, merged geometry out.
 *
 * One mesh per layer per material, so the whole colony is a handful of draw
 * calls whatever the counts. Every vertex carries, besides position and
 * normal:
 *
 *   uv       surface coordinates in world units — apertures and pores are
 *            patterned in these, so they are the same size on every form
 *   aAnchor  the point this part grows from
 *   aBirth   (start, duration) on the shared growth clock, 0..1
 *   aLook    (tone, glow, alpha, openness) — the per-site variation
 *   aEdge    0 at a free edge, 1 inside — membranes brighten toward edges
 *   aSway    how much this vertex moves in the slow drift
 *
 * Growth is done in the vertex shader: a part scales about its anchor as the
 * clock passes its birth window, so the colony can be grown and scrubbed
 * without rebuilding anything. Bridge rings are anchored on their own centre
 * line and born in sequence from each foot, which is what makes a span read
 * as two traces reaching toward each other rather than as a bridge inflating.
 */

import * as THREE from 'three'
import { mulberry32 } from './noise'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/* --- small vector helpers ------------------------------------------------ */

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const UP = [0, 1, 0]

/* --- writer -------------------------------------------------------------- */

/**
 * Accumulates one merged geometry. Vertex attributes that belong to a whole
 * part (anchor, birth, look, sway) are held as state and stamped onto every
 * vertex written until they change.
 */
class FormWriter {
  constructor() {
    this.position = []
    this.normal = []
    this.uv = []
    this.anchor = []
    this.birth = []
    this.look = []
    this.edge = []
    this.sway = []
    this.index = []
    this.count = 0
    this.state = {
      anchor: [0, 0, 0],
      birth: 0,
      span: 0.1,
      tone: 0.5,
      glow: 0,
      alpha: 1,
      open: 0,
      sway: 0,
    }
  }

  set(changes) {
    Object.assign(this.state, changes)
    return this
  }

  vertex(p, n, u = 0, v = 0, edge = 1, sway = this.state.sway) {
    const s = this.state
    this.position.push(p[0], p[1], p[2])
    this.normal.push(n[0], n[1], n[2])
    this.uv.push(u, v)
    this.anchor.push(s.anchor[0], s.anchor[1], s.anchor[2])
    this.birth.push(s.birth, s.span)
    this.look.push(s.tone, s.glow, s.alpha, s.open)
    this.edge.push(edge)
    this.sway.push(sway)
    return this.count++
  }

  tri(a, b, c) {
    this.index.push(a, b, c)
  }

  toGeometry() {
    if (!this.count) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    geo.setAttribute('aAnchor', new THREE.Float32BufferAttribute(this.anchor, 3))
    geo.setAttribute('aBirth', new THREE.Float32BufferAttribute(this.birth, 2))
    geo.setAttribute('aLook', new THREE.Float32BufferAttribute(this.look, 4))
    geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(this.edge, 1))
    geo.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1))
    geo.setIndex(this.index)
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
    return geo
  }
}

/* --- primitives ---------------------------------------------------------- */

/**
 * A tube along curve(t), t in 0..1.
 *
 * `side` fixes the frame: the section's width axis stays as close to it as
 * the tangent allows. For a span that is the horizontal perpendicular to it,
 * so the section never twists along the strand.
 *
 * `ring(t)` may return state changes per ring — that is how a span gets a
 * birth time per ring, anchored on its own centre line.
 */
function tube(w, curve, radius, { segments, radial = 10, side, ring, sway }) {
  const e = 0.5 / segments
  let arc = 0
  let prev = curve(0)
  const rows = []

  for (let k = 0; k <= segments; k++) {
    const t = k / segments
    const c = curve(t)
    arc += Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2])
    prev = c
    const T = norm(sub(curve(Math.min(1, t + e)), curve(Math.max(0, t - e))))
    let N = cross(side, T)
    if (Math.hypot(...N) < 1e-4) N = cross([0, 0, 1], T)
    N = norm(N)
    const S = norm(cross(T, N))
    const r = Math.max(0, radius(t))

    if (ring) w.set({ anchor: c, ...ring(t) })
    const circumference = Math.PI * 2 * r
    const row = []
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const n = add(scale(S, Math.cos(a)), scale(N, Math.sin(a)))
      const p = add(c, scale(n, r))
      row.push(w.vertex(p, n, arc, (j / radial) * circumference, 1, sway ? sway(t) : undefined))
    }
    rows.push(row)
  }

  for (let k = 0; k < segments; k++) {
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
 * A surface over an (I+1) × (J+1) grid of points. Normals come from central
 * differences on the grid itself, so any parametric sheet gets smooth normals
 * without deriving them by hand. `wrap` joins the i direction into a ring;
 * `state(i, j)` may change the writer state per vertex, e.g. its anchor.
 */
function surfaceGrid(w, I, J, point, { wrap = false, uv, edge, sway, state, flip = false }) {
  const P = []
  for (let j = 0; j <= J; j++) {
    const row = []
    for (let i = 0; i <= I; i++) row.push(point(wrap && i === I ? 0 : i, j))
    P.push(row)
  }
  const at = (i, j) => {
    if (wrap) i = ((i % I) + I) % I
    else i = Math.max(0, Math.min(I, i))
    return P[Math.max(0, Math.min(J, j))][i]
  }

  const ids = []
  for (let j = 0; j <= J; j++) {
    const row = []
    for (let i = 0; i <= I; i++) {
      const di = sub(at(i + 1, j), at(i - 1, j))
      const dj = sub(at(i, j + 1), at(i, j - 1))
      let n = norm(cross(di, dj))
      if (flip) n = scale(n, -1)
      const [u, v] = uv ? uv(i, j) : [i / I, j / J]
      if (state) w.set(state(i, j))
      row.push(w.vertex(P[j][i], n, u, v, edge ? edge(i, j) : 1, sway ? sway(i, j) : undefined))
    }
    ids.push(row)
  }
  for (let j = 0; j < J; j++) {
    for (let i = 0; i < I; i++) {
      const a = ids[j][i]
      const b = ids[j][i + 1]
      const c = ids[j + 1][i]
      const d = ids[j + 1][i + 1]
      if (flip) {
        w.tri(a, c, b)
        w.tri(b, c, d)
      } else {
        w.tri(a, b, c)
        w.tri(b, d, c)
      }
    }
  }
}

const UNIT_SPHERE = (() => {
  const g = new THREE.SphereGeometry(1, 10, 7)
  return {
    position: Array.from(g.attributes.position.array),
    normal: Array.from(g.attributes.normal.array),
    index: Array.from(g.index.array),
  }
})()

function sphere(w, c, r) {
  const { position, normal, index } = UNIT_SPHERE
  const base = w.count
  for (let k = 0; k < position.length; k += 3) {
    const n = [normal[k], normal[k + 1], normal[k + 2]]
    w.vertex(
      [c[0] + position[k] * r, c[1] + position[k + 1] * r, c[2] + position[k + 2] * r],
      n,
      position[k] * r * 3,
      position[k + 2] * r * 3,
    )
  }
  for (let k = 0; k < index.length; k += 3) w.tri(base + index[k], base + index[k + 1], base + index[k + 2])
}

const groundAt = (world, x, z) => world.groundY(...world.toUV(x, z))

/* --- Bridgework ---------------------------------------------------------- */

/**
 * Bridgework as a form logic, not a bridge. Strands leave a footing with
 * their own height, their own lean to the side and their own high point —
 * never the middle — so they read as grown tension, not as arches. Inside a
 * colony there are three kinds:
 *
 *   rib    a strand along the anchor membrane (built with the bloom)
 *   reach  from the anchor toward a smaller veil; some land, some stop in
 *          the air and let a bead hang
 *   span   the colony's one crossing: two or three strands over a hollow or
 *          water, a film sagging between two of them
 *
 * The first version was a thick deck with a second tier joined by struts: a
 * footbridge that dominated every frame.
 */
function buildBridgework(instances, world, { solid, film }) {
  for (const inst of instances) {
    const random = mulberry32(inst.seed)
    const A = inst.a
    const B = inst.b
    const m = inst.maturity
    const birth = inst.birth
    const horizontal = norm([B[0] - A[0], 0, B[2] - A[2]])
    const side = [-horizontal[2], 0, horizontal[0]]
    const span = inst.type === 'span'
    // Thin and taut: tension, not tubing.
    const rMid = span ? 0.016 + 0.014 * m : 0.012 + 0.01 * m
    const tone = 0.4 + 0.35 * random()
    const end = inst.end ?? 1
    const lands = span || inst.grounded

    // Footings belong to the colony tissue: strands root into it, no pads.
    solid.set({ tone, glow: 0, alpha: 1, open: 0, sway: 0 })

    const count = span ? 2 + (m > 0.85 ? 1 : 0) : 1 + (m > 0.7 ? 1 : 0)
    const strands = []
    for (let k = 0; k < count; k++) {
      // Where the high point falls: t^skew peaks off-centre either way.
      const skew = lerp(0.65, 1.5, random())
      const shape = (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, skew)), 0.85)
      const bow = k === 0
        ? (random() - 0.5) * 0.06 * inst.len
        : (k % 2 ? 1 : -1) * (0.06 + 0.08 * random()) * inst.len
      const wave = random() * 6
      const base = (t) => add(add(A, scale(sub(B, A), t)), scale(side, bow * Math.sin(Math.PI * t) + 0.03 * Math.sin(3 * Math.PI * t + wave)))

      // Height: a share of the span, raised until the strand clears the
      // ground beneath its own (bowed, skewed) path.
      let h = inst.arch * (k === 0 ? 1 : 0.72 + 0.4 * random())
      for (let t = 0.12; t <= Math.min(0.88, end); t += 0.04) {
        const p = base(t)
        h = Math.max(h, (groundAt(world, p[0], p[2]) + 0.12 - p[1]) / Math.max(0.15, shape(t)))
      }
      h = Math.min(h, inst.len * 0.5)

      const at = (t) => add(base(t), [0, h * shape(t) - 0.04 * (1 - Math.sin(Math.PI * t)), 0])
      // A strand that does not land is drawn only up to `end`, thinning to a tip.
      const curve = (u) => at(u * end)
      const r = k === 0 ? rMid : rMid * (0.5 + 0.2 * random())
      const radius = (u) => {
        const t = u * end
        const swell = 1 + 0.14 * Math.sin(t * 9 + wave)
        return lands
          ? r * (1 + 1.9 * Math.pow(1 - t, 5) + 0.9 * Math.pow(t, 5)) * swell
          : r * (1 + 1.9 * Math.pow(1 - t, 5)) * (1 - 0.85 * Math.pow(u, 3)) * swell
      }
      strands.push({ curve, radius })

      // The lead strand grows from the anchor's side; on a crossing the
      // others answer from the far footing, so it closes from both ends.
      tube(solid, curve, radius, {
        segments: Math.max(24, Math.round(inst.len * end * 9)),
        radial: 8,
        side,
        ring: (u) => ({ birth: k === 0 || !span ? birth + 0.02 + u * 0.22 + k * 0.03 : birth + 0.08 + (1 - u) * 0.2, span: 0.06 }),
      })
    }

    // A film between two strands where the colony is established.
    if (strands.length > 1 && lands && m > 0.3) {
      const t0 = 0.06 + random() * 0.18
      const t1 = 0.94 - random() * 0.18
      // A closed skin with light pores: lace between strands let the dark
      // ground through as spots.
      stretchFilm(film, strands[0].curve, strands[1].curve, t0, t1, inst.len, {
        birth: birth + 0.26,
        tone,
        open: 0.2 + 0.1 * random(),
      })
    }

    if (!lands) {
      // A strand that stops short lets a bead hang from its tip.
      drip(solid, strands[0].curve(1), 0.12 + 0.18 * random(), birth + 0.26, random)
    } else if (span) {
      const drips = Math.round(m * 1.5 + random() * 0.8)
      for (let k = 0; k < drips; k++) {
        const t = lerp(0.3, 0.7, random())
        const top = add(strands[0].curve(t), scale(UP, -strands[0].radius(t) * 0.6))
        const ground = Math.max(groundAt(world, top[0], top[2]), world.waterY)
        if (top[1] - ground < 0.4) continue
        drip(solid, top, (top[1] - ground) * (0.2 + 0.25 * random()), birth + 0.28, random)
      }
    }
  }
}

/**
 * A perforated film between two curves over t0..t1, sagging a little
 * between them like a membrane under tension, anchored along the first so it
 * spreads out from it as it grows.
 */
function stretchFilm(w, from, to, t0, t1, length, { birth, tone, open }) {
  const I = 6
  const J = Math.max(16, Math.round(length * 5))
  const tAt = (j) => lerp(t0, t1, j / J)
  w.set({ birth, span: 0.08, tone, glow: 0, alpha: 0.24, open, sway: 0 })
  surfaceGrid(
    w,
    I,
    J,
    (i, j) => {
      const t = tAt(j)
      const s = i / I
      const p = add(scale(from(t), 1 - s), scale(to(t), s))
      const gap = Math.hypot(...sub(to(t), from(t)))
      return add(p, scale(UP, -0.25 * gap * Math.sin(Math.PI * s)))
    },
    {
      uv: (i, j) => {
        const t = tAt(j)
        return [(i / I) * Math.hypot(...sub(to(t), from(t))), (j / J) * length * (t1 - t0)]
      },
      edge: (i, j) => Math.min(1, Math.min(i, I - i) / 1.5, Math.min(j, J - j) / 2),
      state: (_, j) => ({ anchor: from(tAt(j)) }),
    },
  )
}

/** A thin hanging thread ending in a bead. */
function drip(w, top, length, birth, random) {
  const drift = [(random() - 0.5) * 0.08, 0, (random() - 0.5) * 0.08]
  const thread = (s) => add(add(top, scale(UP, -length * s)), scale(drift, Math.sin(Math.PI * s * 0.5)))
  w.set({ anchor: top, birth, span: 0.06 })
  tube(w, thread, (s) => lerp(0.016, 0.009, s), {
    segments: 6,
    radial: 6,
    side: [1, 0, 0],
    sway: (s) => s * s * 0.6,
  })
  const r = 0.028 + 0.012 * random()
  w.set({ sway: 0.6 })
  sphere(w, add(thread(1), scale(UP, -r * 0.7)), r)
  w.set({ sway: 0 })
}

/* --- Membrane Bloom ------------------------------------------------------ */

/**
 * Crest shape. Ranges are [min, max], picked per bloom or per crest; heights
 * are multiples of the bloom's height from placement, angles are degrees.
 */
const BLOOM_SHAPE = {
  height: [1.3, 1.5],
  /** Height of the frill between and beyond its crests, as a share of the
   *  tallest. Kept low: a far edge standing taller than about a third of the
   *  crest turned a single veil into a box. */
  low: 0.1,
  /** Where a single crest sits along the base line (either side of centre). */
  crest: [0.4, 0.7],
  /** Reach of a crest's profile on its slow and its steep side. The steep
   *  side must stay short, or both ends stand at the same height and the
   *  veil is an arch, symmetric front-on. */
  rise: 1.6,
  fall: 0.38,
  /** Angle once the sheet has risen off the ground, from horizontal. */
  lean: [74, 82],
  /** Curl at a crest, from a young bloom to an established one. */
  curl: [55, 95],
  /** How much of the curl is concentrated at the crests rather than spread. */
  curlFocus: 0.9,
  cup: 0.4,
  flare: 0.35,
  scroll: [0.2, 0.45],
  /** Share of the sheet that runs along the ground before it rises. */
  peel: 0.14,
}

/** The anchor peels further from the ground and holds its crests off-centre. */
const ANCHOR_SHAPE = { ...BLOOM_SHAPE, crest: [0.5, 0.75], lean: [72, 80], peel: 0.2 }

/**
 * A bloom is one continuous membrane — a frill — rising from a meandering
 * base line and differentiating into one or more crests. Each crest climbs
 * slowly on one side to an off-centre high point, falls away steeply on the
 * other, and hooks toward the water like the lip of a wave. Between crests
 * the sheet stays low and pleats, so the lobes are parts of one skin rather
 * than sails standing next to each other. The anchor carries two to four
 * crests of different heights, smaller blooms one or two.
 *
 * It emerges from the colony's tissue rather than standing on the ground:
 * the base line follows the terrain, the first stretch runs along the
 * surface before it rises, and the sheet is more opaque low down, where it
 * fuses with the tissue, thinning toward its rim. Each column grows from its
 * own foot, the tallest crest first, so in growth the frill unfurls
 * sideways out of one point rather than inflating.
 *
 * Readings rejected on the way, each a pass: tulip (petals radiating from a
 * point), hood (wide, curled evenly), blade (narrow, pointed, pleated),
 * tombstone (upright, round-topped), bag (wide, low, curled back), sleeve
 * (narrow, upright, cupped), box (a tall far edge), and — in the colony
 * version before this one — a row of separate sails, which read as related
 * pieces rather than one body.
 */
function buildBlooms(instances, world, ribs) {
  const solid = new FormWriter()
  const film = new FormWriter()
  const deg = (v) => (v * Math.PI) / 180

  for (const inst of instances) {
    const random = mulberry32(inst.seed)
    const pick = ([a, b]) => lerp(a, b, random())
    const anchorRole = inst.role === 'anchor'
    const shape = anchorRole ? ANCHOR_SHAPE : BLOOM_SHAPE
    const P = inst.p
    const m = inst.maturity
    const birth = inst.birth
    const H = inst.height
    const tone = 0.4 + 0.45 * random()
    const d = [Math.cos(inst.lean), 0, Math.sin(inst.lean)]
    const across = [-d[2], 0, d[0]]
    const n = inst.crests ?? 1
    const W = inst.width ?? H * 0.9
    const Hk = H * pick(shape.height)

    // Crests along the base line: spread with a little jitter, the tallest
    // not necessarily in the middle, the others clearly lower.
    const tallest = Math.floor(random() * n)
    const crests = Array.from({ length: n }, (_, k) => {
      const single = n === 1
      const hand = single ? 0 : random() < 0.5 ? -1 : 1
      const at = single ? (random() < 0.5 ? -1 : 1) * pick(shape.crest) : lerp(-0.68, 0.68, k / (n - 1)) + (random() - 0.5) * 0.16
      return {
        at,
        // A single crest falls steeply toward the near end, as the lab chose.
        hand: single ? Math.sign(at) : hand,
        height: k === tallest ? 1 : 0.42 + 0.3 * random(),
        curl: deg(lerp(shape.curl[0], shape.curl[1], m)) * (0.85 + 0.3 * random()),
        scroll: (random() < 0.5 ? -1 : 1) * pick(shape.scroll),
      }
    })
    // Between crests the frill neither stays high (a flat-topped curtain)
    // nor drops to the ground (separate fins standing side by side): it
    // falls to a web about a third of the crest's height, so the lobes are
    // parts of one sheet. Crests are peaked and lean one way, as single
    // ones do. Toward both ends the frill tapers into the ground instead of
    // stopping at a vertical edge.
    const spacing = n === 1 ? 1 : 1.36 / (n - 1)
    const single = n === 1
    const bump = (c, w) => {
      const reach = (w - c.at) * c.hand > 0
        ? (single ? shape.fall : 0.3 * spacing)
        : (single ? shape.rise : 0.62 * spacing)
      return c.height * Math.pow(Math.max(0, 1 - Math.pow((w - c.at) / reach, 2)), single ? 0.6 : 0.75)
    }
    const web = single ? 0 : 0.32
    const taper = (w) => 1 - smoothstep(0.62, 1, Math.abs(w))

    const I = Math.max(16, 15 * n)
    const J = anchorRole ? 24 : 18
    const fold = 0.1 * H * (n > 1 ? 1 : 0.4)
    const phase = random() * 6
    const thetaGround = deg(8 + 8 * random())
    const theta0 = deg(pick(shape.lean))
    const columns = []
    for (let i = 0; i <= I; i++) {
      const w = (i / I) * 2 - 1
      // A soft maximum over the crests, so neighbouring lobes merge into one
      // skin instead of meeting at a seam.
      let sum = 0
      let lead = crests[0]
      let leadValue = -1
      for (const c of crests) {
        const v = bump(c, w)
        sum += v ** 4
        if (v > leadValue) {
          leadValue = v
          lead = c
        }
      }
      const b = Math.min(1.05, Math.pow(sum, 0.25))
      const rise = Math.max(shape.low + (1 - shape.low) * b, web * taper(w))
      const ends = single ? 1 : 0.25 + 0.75 * taper(w)
      const L = Hk * rise * ends * (1 + 0.03 * Math.sin(w * 4 + phase))
      const dir = rotateAbout(d, UP, shape.flare * w * (n > 1 ? 0.45 : 1))
      // The base line meanders, so the frill is pleated between its crests.
      const bow = shape.cup * (w * w - 0.35) * W * 0.25 + fold * Math.sin(w * Math.PI * n * 0.9 + phase)
      const flat = add(add(P, scale(across, (w * W) / 2)), scale(d, bow))
      const base = [flat[0], groundAt(world, flat[0], flat[2]) - 0.03, flat[2]]
      const near = lead.height > 0 ? leadValue / lead.height : 0
      const bend = lead.curl * (1 - shape.curlFocus + shape.curlFocus * near)
      const column = [base]
      let p = base
      for (let j = 0; j < J; j++) {
        const sj = j / J
        // Low along the surface first, then rising, then turning at a crest.
        const theta = lerp(thetaGround, theta0, smoothstep(0, shape.peel * 1.6, sj)) - bend * Math.pow(sj, 2)
        const heading = rotateAbout(dir, UP, lead.scroll * near * sj * sj)
        p = add(p, scale(add(scale(heading, Math.cos(theta)), scale(UP, Math.sin(theta))), L / J))
        if (sj < shape.peel * 2) {
          // While it runs along the surface it may not cut into it.
          const g = groundAt(world, p[0], p[2]) + 0.02
          if (p[1] < g) p = [p[0], g, p[2]]
        }
        column.push(p)
      }
      columns.push({ column, L, w })
    }

    const alpha = 0.26 + 0.28 * (1 - inst.openness)
    const tall = crests[tallest]
    film.set({ tone, glow: inst.glow, open: inst.openness, span: anchorRole ? 0.2 : 0.16 })
    surfaceGrid(film, I, J, (i, j) => columns[i].column[j], {
      uv: (i, j) => [columns[i].w * W * 0.5, (j / J) * columns[i].L],
      // Free edges are the two ends and the rim. The foot is attached, and
      // gets a low value too, so no aperture opens right at the ground.
      edge: (i, j) => Math.min(1, (1 - Math.abs(columns[i].w)) * 3 * n, (1 - j / J) * 4, 0.25 + (j / J) * 2.2),
      sway: (_, j) => Math.pow(j / J, 2),
      state: (i, j) => ({
        // Each column grows from its own foot, the tallest crest first —
        // and every column is whole by the end of the clock.
        anchor: columns[i].column[0],
        birth: Math.min(birth + 0.03 + 0.08 * Math.abs(columns[i].w - tall.at), 0.98 - (anchorRole ? 0.2 : 0.16)),
        // Denser low down, where it fuses with the tissue.
        alpha: alpha + 0.32 * Math.pow(1 - j / J, 3),
      }),
    })

    // Crest columns, tallest first.
    const order = crests
      .map((c) => ({ c, i: Math.max(1, Math.min(I - 1, Math.round(((c.at + 1) / 2) * I))) }))
      .sort((a, b) => b.c.height - a.c.height)
    if (anchorRole && inst.ribs > 0) {
      // Structure merges in: ribs run up the tallest crests and on past
      // their lips.
      order.slice(0, inst.ribs).forEach(({ i }, k) => {
        rib(ribs, columns, i, { H: H * (k ? 0.75 : 1), side: across, birth: birth + 0.16 + k * 0.05, random })
      })
    } else if (random() < m * 0.7) {
      // A bead gathers on the curled lip of the tallest crest.
      const tip = columns[order[0].i].column[J]
      const r = 0.02 + 0.016 * random()
      solid.set({ anchor: tip, birth: birth + 0.18, span: 0.05, sway: 1, tone: 0.8, glow: 0, alpha: 1, open: 0 })
      sphere(solid, add(tip, scale(UP, -r * 1.2)), r)
      solid.set({ sway: 0, tone })
    }
  }

  return { solid: solid.toGeometry(), film: film.toGeometry() }
}

/**
 * A rib: a strand running up one column of a veil, sitting just off the
 * membrane, and carrying on a little past the lip before it droops and lets
 * a bead hang. It grows from the ground up, after the veil has risen.
 */
function rib(w, columns, i, { H, side, birth, random }) {
  const col = columns[i].column
  const normalAt = (j) => {
    const a = columns[Math.min(columns.length - 1, i + 1)].column[j]
    const b = columns[Math.max(0, i - 1)].column[j]
    const c = col[Math.min(col.length - 1, j + 1)]
    const e = col[Math.max(0, j - 1)]
    return norm(cross(sub(a, b), sub(c, e)))
  }
  const r0 = 0.012 + 0.012 * H
  const points = col.map((p, j) => add(p, scale(normalAt(j), r0 * 0.8)))
  const last = points[points.length - 1]
  const dir = norm(sub(last, points[points.length - 3]))
  for (let k = 1; k <= 3; k++) points.push(add(last, add(scale(dir, 0.06 * k * H), [0, -0.025 * k * k * H, 0])))
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])))
  const at = (t) => curve.getPoint(t).toArray()
  w.set({ anchor: points[0], tone: 0.55, glow: 0, alpha: 1, open: 0, sway: 0 })
  tube(w, at, (t) => r0 * (1 + 1.4 * Math.pow(1 - t, 4)) * (1 - 0.75 * t * t), {
    segments: 44,
    radial: 7,
    side,
    ring: (t) => ({ birth: birth + t * 0.16, span: 0.05 }),
  })
  drip(w, at(1), 0.1 + 0.12 * random(), birth + 0.18, random)
}

/** Rotate v about a unit axis by angle (Rodrigues). */
function rotateAbout(v, axis, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)))
}

/* --- Colony ground ------------------------------------------------------- */

/**
 * A faint luminous stain on the ground under each colony, drawn out toward
 * the water and fading at a lobed edge: the ground's own response to what is
 * growing on it. A separate draped mesh, so the terrain itself is untouched.
 * Intensity rides in `look.x` and comes up with the colony as it grows.
 */
function buildHalos(colonies, world) {
  const w = new FormWriter()
  for (const c of colonies) {
    const random = mulberry32(c.index * 7 + 3)
    const seed = random() * 6
    const R = c.radius * 1.45
    const I = 48
    const J = 14
    const point = (i, j) => {
      const phi = (i / I) * Math.PI * 2
      const s = j / J
      const cx = Math.cos(phi)
      const cz = Math.sin(phi)
      const along = cx * c.dir[0] + cz * c.dir[1]
      const r = R * s * (1 + 0.6 * Math.max(0, along)) * (1 + 0.16 * Math.sin(3 * phi + seed))
      const x = c.x + cx * r
      const z = c.z + cz * r
      return [x, groundAt(world, x, z) + 0.05, z]
    }
    w.set({ anchor: [c.x, c.y, c.z], birth: c.birth, span: 0.35, glow: 0, alpha: 1, open: 0, sway: 0 })
    surfaceGrid(w, I, J, point, {
      wrap: true,
      uv: (i, j) => {
        const p = point(i, j)
        return [p[0], p[2]]
      },
      state: (_, j) => ({ tone: (0.35 + 0.65 * c.maturity) * Math.pow(1 - j / J, 1.8) }),
    })
  }
  return w.toGeometry()
}


/* --- Colony tissue ------------------------------------------------------- */

/** Grid spacing of the tissue, world units, and the most cells per side. */
const TISSUE_CELL = 0.11
const TISSUE_MAX = 96

const segmentDistance = (x, z, ax, az, bx, bz) => {
  const vx = bx - ax
  const vz = bz - az
  const t = clamp01(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1))
  return [Math.hypot(x - ax - vx * t, z - az - vz * t), t]
}

/**
 * The colony's tissue: one continuous skin over the ground that every member
 * grows out of. It replaces the per-object pads and skirts of the previous
 * version, which met the ground one by one and left each form an object.
 *
 * It is a field, built from what the colony placed:
 *
 *   nodes   a capsule under every base: a frill's whole base line, each strand
 *           footing, the heap — the tissue mounds up around them
 *   veins   raised lines from the anchor to every other member and down the
 *           residue trail, carrying a slow light — the connections made
 *           visible in the ground
 *   body    a thin shared skin around the anchor, so the gaps between
 *           members are tissue too, fading out toward the colony's edge
 *   crust   where residue lies, the tissue turns granular and pale: the fine
 *           fraction of what was caught, as a surface rather than as objects
 *
 * Sampled on a grid that follows the terrain. Every vertex carries its own
 * birth: the tissue spreads out from the anchor, veins first, during growth.
 * A footing too far from its colony (a crossing's far end) gets its own
 * small patch.
 */
function buildTissue(scatter, world) {
  const w = new FormWriter()
  const { colonies, layers } = scatter

  for (const c of colonies) {
    const members = layers.bloom.instances.filter((b) => b.colony === c.index)
    const anchor = members.find((b) => b.role === 'anchor')
    if (!anchor) continue
    const ax = anchor.p[0]
    const az = anchor.p[2]
    const reach = c.radius + 1.2
    const near = (x, z) => Math.hypot(x - ax, z - az) < reach

    const main = { nodes: [], veins: [], crust: [], body: true, birth: c.birth + 0.1, spread: 0.3 }
    const patches = [main]
    const capsule = (x, z, b) => {
      const half = (b.width ?? b.height) * 0.5
      const lx = -Math.sin(b.lean) * half
      const lz = Math.cos(b.lean) * half
      return { ax: x - lx, az: z - lz, bx: x + lx, bz: z + lz }
    }

    for (const b of members) {
      const node = { ...capsule(b.p[0], b.p[2], b), r: 0.16 + 0.1 * b.height, h: 0.04 + 0.03 * b.height }
      if (near(b.p[0], b.p[2])) main.nodes.push(node)
      else patches.push({ nodes: [node], veins: [], crust: [], birth: b.birth - 0.06, spread: 0.05 })
      if (b !== anchor && near(b.p[0], b.p[2])) {
        main.veins.push({ ax, az, bx: b.p[0], bz: b.p[2], width: 0.08 + 0.04 * b.height, h: 0.03, glow: 1 })
      }
    }

    for (const s of layers.bridgework.instances) {
      if (s.colony !== c.index) continue
      const feet = [s.a]
      if (s.type === 'span' || s.grounded) feet.push(s.b)
      for (const f of feet) {
        const node = { ax: f[0], az: f[2], bx: f[0], bz: f[2], r: 0.2, h: 0.055 }
        if (near(f[0], f[2])) {
          main.nodes.push(node)
          main.veins.push({ ax, az, bx: f[0], bz: f[2], width: 0.05, h: 0.022, glow: 0.7 })
        } else {
          patches.push({ nodes: [node], veins: [], crust: [], birth: s.birth, spread: 0.05 })
        }
      }
    }

    for (const dep of layers.shard.instances) {
      if (dep.colony !== c.index) continue
      for (const p of dep.plates) main.crust.push({ x: p.x, z: p.z, r: 0.12 + p.len * 0.6, amount: 0.55 })
      for (const g of dep.beads) main.crust.push({ x: g.x, z: g.z, r: 0.1, amount: 0.3 })
      if (dep.kind === 'heap') {
        main.nodes.push({ ax: dep.center[0], az: dep.center[2], bx: dep.center[0], bz: dep.center[2], r: dep.radius, h: 0.05 })
      }
      if (dep.kind === 'trail' && dep.path?.length > 1) {
        // The trail is a vein too: a tongue of deposit running downhill.
        let [px, pz] = [ax, az]
        for (const [x, z, fade] of dep.path) {
          main.veins.push({ ax: px, az: pz, bx: x, bz: z, width: 0.04 + 0.07 * fade, h: 0.015, glow: 0.5 * fade })
          px = x
          pz = z
        }
      }
    }

    for (const patch of patches) tissuePatch(w, world, c, anchor, patch)
  }
  return w.toGeometry()
}

function tissuePatch(w, world, colony, anchor, { nodes, veins, crust, body, birth, spread }) {
  // Bounds: everything the patch carries, plus room to fade out.
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  const grow = (x, z, r) => {
    minX = Math.min(minX, x - r)
    minZ = Math.min(minZ, z - r)
    maxX = Math.max(maxX, x + r)
    maxZ = Math.max(maxZ, z + r)
  }
  for (const n of nodes) {
    grow(n.ax, n.az, n.r * 2.6)
    grow(n.bx, n.bz, n.r * 2.6)
  }
  for (const v of veins) {
    grow(v.ax, v.az, v.width * 4)
    grow(v.bx, v.bz, v.width * 4)
  }
  if (body) grow(anchor.p[0], anchor.p[2], colony.radius * 0.9)
  const half = world.size / 2 - 0.05
  minX = Math.max(-half, minX)
  minZ = Math.max(-half, minZ)
  maxX = Math.min(half, maxX)
  maxZ = Math.min(half, maxZ)

  const I = Math.max(4, Math.min(TISSUE_MAX, Math.ceil((maxX - minX) / TISSUE_CELL)))
  const J = Math.max(4, Math.min(TISSUE_MAX, Math.ceil((maxZ - minZ) / TISSUE_CELL)))
  const cx = (i) => lerp(minX, maxX, i / I)
  const cz = (j) => lerp(minZ, maxZ, j / J)

  // Residue splatted into the grid, so hundreds of grains cost little.
  const crustGrid = new Float32Array((I + 1) * (J + 1))
  for (const s of crust) {
    const r3 = s.r * 2.5
    const i0 = Math.max(0, Math.floor(((s.x - r3 - minX) / (maxX - minX)) * I))
    const i1 = Math.min(I, Math.ceil(((s.x + r3 - minX) / (maxX - minX)) * I))
    const j0 = Math.max(0, Math.floor(((s.z - r3 - minZ) / (maxZ - minZ)) * J))
    const j1 = Math.min(J, Math.ceil(((s.z + r3 - minZ) / (maxZ - minZ)) * J))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dd = Math.hypot(cx(i) - s.x, cz(j) - s.z) / s.r
        const f = Math.exp(-dd * dd) * s.amount
        const k = j * (I + 1) + i
        crustGrid[k] = 1 - (1 - crustGrid[k]) * (1 - f)
      }
    }
  }

  const random = mulberry32(colony.index * 131 + 7)
  const lobeSeed = random() * 6
  const points = []
  const looks = []
  for (let j = 0; j <= J; j++) {
    for (let i = 0; i <= I; i++) {
      const x = cx(i)
      const z = cz(j)
      let h = 0
      let presence = 0
      let vein = 0
      for (const n of nodes) {
        const [dd] = segmentDistance(x, z, n.ax, n.az, n.bx, n.bz)
        const f = Math.exp(-((dd / n.r) ** 2))
        h += n.h * f
        presence = Math.max(presence, 1 - smoothstep(n.r * 0.8, n.r * 2.5, dd))
      }
      for (const v of veins) {
        const [dd, t] = segmentDistance(x, z, v.ax, v.az, v.bx, v.bz)
        const taper = 1 - 0.45 * t
        const f = Math.exp(-((dd / v.width) ** 2)) * taper
        h += v.h * f
        vein = Math.max(vein, f * v.glow)
        presence = Math.max(presence, (1 - smoothstep(v.width, v.width * 3.5, dd)) * 0.8 * taper)
      }
      let distance = 0
      if (body) {
        // A thin shared skin around the anchor, with a lobed, uneven edge.
        const dx = x - anchor.p[0]
        const dz = z - anchor.p[2]
        const angle = Math.atan2(dz, dx)
        const lobes = 1 + 0.2 * Math.sin(3 * angle + lobeSeed) + 0.1 * Math.sin(7 * angle + lobeSeed * 2)
        distance = Math.hypot(dx, dz) / (colony.radius * 0.85 * lobes)
        presence = Math.max(presence, (1 - smoothstep(0.25, 1, distance)) * 0.45)
      }
      const crustValue = crustGrid[j * (I + 1) + i]
      h += 0.012 * crustValue
      presence = Math.max(presence, crustValue * 0.8)
      points.push([x, groundAt(world, x, z) + 0.025 + h, z])
      looks.push({
        tone: clamp01(h / 0.08),
        glow: vein,
        alpha: presence,
        open: crustValue,
        // Spreads out from the anchor; veins lead.
        birth: birth + spread * clamp01(distance) - 0.05 * vein,
      })
    }
  }

  surfaceGrid(w, I, J, (i, j) => points[j * (I + 1) + i], {
    uv: (i, j) => [cx(i), cz(j)],
    state: (i, j) => {
      const look = looks[j * (I + 1) + i]
      return { anchor: points[j * (I + 1) + i], span: 0.14, sway: 0, ...look }
    },
  })
}

/* --- Shard / Residue ----------------------------------------------------- */

/**
 * A plate outline, in units of half length / half width: an elongated,
 * softened polygon. The first outline was a six-point sliver with sharp
 * tips, and in numbers it read as broken glass.
 */
const SLIVER = Array.from({ length: 9 }, (_, k) => {
  const a = (k / 9) * Math.PI * 2
  // Slightly egg-shaped: blunter upstream, tapering downstream.
  const taper = Math.cos(a) > 0 ? 0.85 : 1
  return [Math.cos(a), Math.sin(a) * taper]
})

function buildShards(instances) {
  const glass = new FormWriter()
  const solid = new FormWriter()

  for (const inst of instances) {
    for (const plate of inst.plates) {
      const random = mulberry32(plate.seed)
      const X0 = [plate.dirX, 0, plate.dirZ]
      const Z0 = [-plate.dirZ, 0, plate.dirX]
      // Imbrication: the downstream end is lifted, the upstream end buried.
      const X1 = add(scale(X0, Math.cos(plate.dip)), scale(UP, Math.sin(plate.dip)))
      const Y1 = add(scale(X0, -Math.sin(plate.dip)), scale(UP, Math.cos(plate.dip)))
      const X = X1
      const Z = rotateAbout(Z0, X1, plate.roll)
      const Y = rotateAbout(Y1, X1, plate.roll)
      const half = plate.len / 2
      // Sunk well in: the upstream end buried, only the raised edge showing.
      const c = [plate.x, plate.y + plate.lift + Math.sin(plate.dip) * half * 0.3 - 0.01, plate.z]
      const thick = 0.018 + 0.014 * random()

      const outline = SLIVER.map(([a, b]) => {
        const ja = a * (1 + (random() - 0.5) * 0.18)
        const jb = b * (1 + (random() - 0.5) * 0.25)
        return add(c, add(scale(X, ja * half), scale(Z, (jb * plate.width) / 2)))
      })

      glass.set({
        anchor: c,
        birth: inst.birth + plate.order * 0.15,
        span: 0.08,
        tone: 0.35 + 0.5 * random(),
        glow: 0,
        alpha: 0.78 - 0.3 * plate.submerged,
        open: 0,
        sway: 0,
      })
      prism(glass, outline, Y, thick)
    }

    for (const bead of inst.beads) {
      solid.set({
        anchor: [bead.x, bead.y, bead.z],
        birth: inst.birth + 0.08 + bead.order * 0.12,
        span: 0.05,
        tone: 0.8,
        glow: 0,
        alpha: 1,
        open: 0,
        sway: 0,
      })
      sphere(solid, [bead.x, bead.y, bead.z], bead.r)
    }
  }

  return { glass: glass.toGeometry(), solid: solid.toGeometry() }
}

/**
 * A thin flat-shaded prism: the outline, offset ± half the thickness along
 * `up`. Every face gets its own vertices so the facets stay crisp — mineral,
 * not tissue.
 */
function prism(w, outline, up, thickness) {
  const h = scale(up, thickness / 2)
  const top = outline.map((p) => add(p, h))
  const bottom = outline.map((p) => sub(p, h))
  const n = outline.length
  const face = (points, normal, u = 0) => {
    const ids = points.map((p, k) => w.vertex(p, normal, u + k * 0.1, 0))
    for (let k = 1; k < ids.length - 1; k++) w.tri(ids[0], ids[k], ids[k + 1])
  }
  face(top, up)
  face([...bottom].reverse(), scale(up, -1))
  for (let k = 0; k < n; k++) {
    const a = top[k]
    const b = top[(k + 1) % n]
    const c = bottom[(k + 1) % n]
    const d = bottom[k]
    const normal = norm(cross(sub(b, a), sub(d, a)))
    const oriented = dot(normal, sub(a, outline.reduce((s, p) => add(s, scale(p, 1 / n)), [0, 0, 0]))) < 0
      ? scale(normal, -1)
      : normal
    const ids = [a, b, c, d].map((p) => w.vertex(p, oriented, 0, 0, 0.2))
    w.tri(ids[0], ids[1], ids[2])
    w.tri(ids[0], ids[2], ids[3])
  }
}

/* --- Trace Beads --------------------------------------------------------- */

function buildBeads(instances) {
  const solid = new FormWriter()
  for (const inst of instances) {
    for (const bead of inst.beads) {
      solid.set({
        anchor: [bead.x, bead.y, bead.z],
        birth: inst.birth + bead.order * 0.1,
        span: 0.05,
        tone: 0.85,
        glow: clamp01(bead.glow),
        alpha: 1,
        open: 0,
        sway: 0,
      })
      sphere(solid, [bead.x, bead.y, bead.z], bead.r)
    }
  }
  return { solid: solid.toGeometry() }
}

/* --- entry point --------------------------------------------------------- */

/**
 * Geometry for every layer. Everything that varies per form was decided at
 * placement; this only turns descriptors into surfaces. Structure is built
 * first, into writers the blooms also draw into: an anchor's ribs belong to
 * Bridgework, so soloing Membrane Bloom shows the membrane without them.
 */
export function buildScatterGeometry(scatter, world) {
  const { layers, colonies } = scatter
  const structure = { solid: new FormWriter(), film: new FormWriter() }
  buildBridgework(layers.bridgework.instances, world, structure)
  const bloom = buildBlooms(layers.bloom.instances, world, structure.solid)
  return {
    bridgework: { solid: structure.solid.toGeometry(), film: structure.film.toGeometry() },
    bloom,
    shard: buildShards(layers.shard.instances),
    bead: buildBeads(layers.bead.instances),
    halo: { glow: buildHalos(colonies, world) },
    tissue: { skin: buildTissue(scatter, world) },
  }
}

/* --- Stream centrelines (internal debug) -------------------------------- */

/**
 * The water veins' splines drawn just above the ground they were projected
 * onto, with a ring at each source. Not part of the interface: shown only
 * with ?debug=streams in the URL, to check the spline against the mesh.
 */
export function buildStreamDebug(lines, world) {
  const line = new FormWriter()
  if (!lines || !lines.length) return { spline: null }
  const ground = (x, z) => world.groundY(...world.toUV(x, z))
  const always = { birth: -1, span: 0.001, glow: 0, open: 0, sway: 0, alpha: 1 }
  for (const s of lines) {
    const n = s.points.length
    const side = (k) => {
      const a = s.points[Math.max(0, k - 1)]
      const b = s.points[Math.min(n - 1, k + 1)]
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
      return [-(b.z - a.z) / len, (b.x - a.x) / len]
    }
    line.set(always)
    surfaceGrid(
      line,
      2,
      n - 1,
      (i, k) => {
        const [sx, sz] = side(k)
        // Held well above the water so it reads as the line, not the stream.
        const o = ((i - 1) / 2) * 0.07
        const x = s.points[k].x + sx * o
        const z = s.points[k].z + sz * o
        return [x, ground(x, z) + 0.22, z]
      },
      { uv: (_, k) => [s.points[k].x, s.points[k].z], state: (i) => ({ anchor: [0, 0, 0], tone: i === 1 ? 4 : 1 }) },
    )
    const R = 24
    surfaceGrid(
      line,
      R,
      1,
      (i, j) => {
        const a = (i / R) * Math.PI * 2
        const r = 0.16 + j * 0.06
        const x = s.source.x + Math.cos(a) * r
        const z = s.source.z + Math.sin(a) * r
        return [x, ground(x, z) + 0.22, z]
      },
      { wrap: true, uv: (i) => [i, 0], state: () => ({ anchor: [0, 0, 0], tone: 3 }) },
    )
  }
  return { spline: line.toGeometry() }
}
