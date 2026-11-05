import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CONDUIT } from '../lib/conduit'
import { createFormMaterial, setAccumulation } from '../lib/formMaterial'
import { mulberry32 } from '../lib/noise'

/**
 * Study 10's fold, behind `?lifecycle=1&conduit=1&fold=1`, display only: one
 * stretch of the shared tissue (the simulation chooses it, lifecycle.js
 * `chooseFold`) drawn as the ground itself folding up into living tissue, in
 * the colonies' own membrane (the bloom layer's film), lofted along the
 * stretch:
 *
 *   - its section is asymmetric: a long low trailing edge rising to a hump,
 *     a dip, then a crest that curls over and comes down to flare back into
 *     the ground. Under it an inner skin, so there is space within it as well
 *     as under its curl
 *   - along it, it lifts away in some places and stays in the ground in
 *     others; it sinks back into the flat tissue at its far end and widens
 *     into the colony's ground at the other
 *   - slow memory (the matter that has passed through it): how wide it is,
 *     how far it can rise, and the low scar it keeps when dormant
 *   - its use now (conductance): how far it stands up
 *   - what it holds and carries: a little fullness, and champagne specks in
 *     its inner skin, as many as there is matter, moving at the matter's
 *     speed
 *
 * Reads the simulation, changes nothing in it. Only this one stretch.
 *
 * Unfinished and paused (24 October 2026): set aside in review for the
 * greybox (ConduitGreybox), and kept for reference.
 */

const FOLD = {
  /** Highest it stands (units): fully used, well remembered, at a lobe. */
  lift: 0.2,
  /** Of that, what a dormant fold keeps (its use at the floor). */
  scar: 0.22,
  /** Half-width (units): little has passed, to much. */
  width: [0.1, 0.25],
  /** Matter passed per node at which it is well remembered (1 − 1/e of the way). */
  remembered: 0.06,
  /** Spacing of its sections along it (units). */
  step: 0.05,
  /** Length over which it widens into the colony's ground, and over which it sinks back into the flat tissue. */
  merge: 0.7,
  sink: 0.6,
  /** Its lift between lobes, as a share of a lobe's: there it stays in the ground. */
  embedded: 0.12,
  /** Density of its outer skin and its inner one. */
  presence: [0.3, 0.22],
  /**
   * The membrane's film, adapted: a little toward the colony's ground skin
   * in colour, and holding less light of its own, since it is ground rising
   * rather than a membrane standing.
   */
  tint: '#C8C2EA',
  gain: 0.95,
  /** How far its edges go into the ground, and how far its skin stays above it. */
  buried: 0.02,
  floor: 0.014,
  /** Smoothing of what it reads along it (units), and of its path. */
  sigma: 0.15,
}

/** Matter in it, and its colour (as the flat tissue's). */
const CONTENT_FULL = 0.008
const WARM = '#E6D6B4'
const FASTEST = 0.3

/** Sub-samples per span of a section's control points, and the sample at the front of the roll. */
const K = 4
const LIP = 8 * K

/**
 * The section, across (u, in half-widths, + toward its curl) and up (y, in
 * lifts). The first and last points are where it enters the ground.
 *   hump  height of the hump on its trailing side
 *   crest where its crest stands across it
 *   curl  how far the crest rolls over (0 a steep face, 1 an overhang)
 *   full  how full it is of matter
 */
function outerSection({ hump, crest: c, curl, full }) {
  const h = hump + 0.08 * full
  return [
    [-1, 0],
    [-0.78, 0.07],
    [-0.52, 0.62 * h],
    [-0.3, h],
    [-0.06, 0.75 * h],
    [c - 0.2, 0.5 * (0.75 * h + 1) + 0.1],
    [c, 1],
    // The roll: over, out to its front, back under itself.
    [c + 0.22 + 0.06 * curl, 0.95],
    [c + 0.32 + 0.08 * curl, 0.8],
    [c + 0.3, 0.64 + 0.02 * curl],
    [c + 0.28 - 0.1 * curl, 0.52],
    // The face below it, flaring out into the ground.
    [c + 0.3 - 0.05 * curl, 0.3],
    [0.5 * (c + 1.3 - 0.05 * curl), 0.07],
    [1, 0],
  ]
}

/** The inner skin: from the ground on the trailing side up into the space under the crest. */
function innerSection({ crest: c, full }) {
  return [
    [-0.62, 0],
    [-0.42, 0.08],
    [-0.12, 0.2 + 0.06 * full],
    [Math.min(0.14, c - 0.3), 0.34 + 0.06 * full],
    [c - 0.16, 0.48],
    [c - 0.02, 0.58],
  ]
}

/** A centripetal Catmull–Rom point between p1 and p2 (no loops or cusps at the curl). */
function catmull(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
  const t1 = d(p0, p1)
  const t2 = t1 + d(p1, p2)
  const t3 = t2 + d(p2, p3)
  const tt = t1 + (t2 - t1) * t
  const mix = (a, b, ta, tb) => {
    const f = (tt - ta) / (tb - ta)
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  }
  const a1 = mix(p0, p1, 0, t1)
  const a2 = mix(p1, p2, t1, t2)
  const a3 = mix(p2, p3, t2, t3)
  return mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2)
}

/**
 * A section sampled: K points per span, and how buried each is (1 at an end
 * that enters the ground, 0 one span in). The inner skin's top end is free.
 */
function sampleSection(points, out, buried, freeEnd = false) {
  const n = points.length
  const at = (i) => {
    if (i < 0) return [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]]
    if (i >= n) return [2 * points[n - 1][0] - points[n - 2][0], 2 * points[n - 1][1] - points[n - 2][1]]
    return points[i]
  }
  let k = 0
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < K; j++) {
      const t = j / K
      const p = catmull(at(i - 1), at(i), at(i + 1), at(i + 2), t)
      out[k * 2] = p[0]
      out[k * 2 + 1] = p[1]
      buried[k] = i === 0 ? (1 - t) ** 2 : i === n - 2 && !freeEnd ? t * t : 0
      k++
    }
  }
  out[k * 2] = points[n - 1][0]
  out[k * 2 + 1] = points[n - 1][1]
  buried[k] = freeEnd ? 0 : 1
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** A Gaussian smoothing along a row of samples (sigma in samples). */
function smooth(values, sigma) {
  const r = Math.ceil(sigma * 2.5)
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    let s = 0
    let w = 0
    for (let k = -r; k <= r; k++) {
      const j = Math.min(values.length - 1, Math.max(0, i + k))
      const f = Math.exp(-(k * k) / (2 * sigma * sigma))
      s += values[j] * f
      w += f
    }
    out[i] = s / w
  }
  return out
}

/**
 * The fold's fixed parts, once it is chosen: its path (the chosen nodes,
 * smoothed, resampled), which side it curls to (downhill), where along it
 * it lifts, and the two skins' grids.
 */
function layout(fold, C, world) {
  const ground = (x, z) => world.groundY(...world.toUV(x, z))
  const N = fold.nodes.length
  // The nodes' path, smoothed (its ends kept).
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
  const S = arc[N - 1]
  const count = Math.max(2, Math.ceil(S / FOLD.step) + 1)
  const s = new Float32Array(count)
  const cx = new Float32Array(count)
  const cz = new Float32Array(count)
  // Where each sample lies among the nodes (a fractional node index).
  const node = new Float32Array(count)
  let k = 0
  for (let i = 0; i < count; i++) {
    const at = (S * i) / (count - 1)
    while (k < N - 2 && arc[k + 1] < at) k++
    const f = Math.min(1, Math.max(0, (at - arc[k]) / Math.max(1e-9, arc[k + 1] - arc[k])))
    s[i] = at
    cx[i] = px[k] + (px[k + 1] - px[k]) * f
    cz[i] = pz[k] + (pz[k + 1] - pz[k]) * f
    node[i] = k + f
  }
  // Across: perpendicular to the path, horizontal.
  const nx = new Float32Array(count)
  const nz = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 2)
    const b = Math.min(count - 1, i + 2)
    const tx = cx[b] - cx[a]
    const tz = cz[b] - cz[a]
    const l = Math.hypot(tx, tz) || 1
    nx[i] = -tz / l
    nz[i] = tx / l
  }
  // It curls to the lower side.
  let slope = 0
  for (let i = 0; i < count; i++) slope += ground(cx[i] + nx[i] * 0.3, cz[i] + nz[i] * 0.3) - ground(cx[i] - nx[i] * 0.3, cz[i] - nz[i] * 0.3)
  const side = slope < 0 ? 1 : -1

  // Where along it it lifts: lobes, seeded by the stretch, between which it
  // stays in the ground; it widens into the colony's ground at the hub end
  // and sinks into the flat tissue at the other. Each lobe rises slowly on
  // one side and drops on the other (alternating), so seen from the side it
  // is a fold leaning one way, not a dome.
  const random = mulberry32(fold.nodes[0] * 7919 + 13)
  const lobes = []
  for (let at = FOLD.merge + 0.4 + 0.2 * random(); at < S - FOLD.sink * 0.6; at += 0.8 + 0.3 * random()) {
    const r = 0.3 + 0.15 * random()
    const steep = (lobes.length % 2 ? -1 : 1) * (random() < 0.8 ? 1 : -1)
    lobes.push({ at, long: r * 1.5, short: r * 0.55, steep, h: lobes.length ? 0.6 + 0.4 * random() : 1 })
  }
  const wave = () => {
    const l1 = 0.9 + 0.7 * random()
    const l2 = 0.5 + 0.4 * random()
    const p1 = random() * 6.28
    const p2 = random() * 6.28
    return (x) => 0.6 * Math.sin((x * 6.283) / l1 + p1) + 0.4 * Math.sin((x * 6.283) / l2 + p2)
  }
  const [hump, crest, curl, wide, tone, trail, lead] = [wave(), wave(), wave(), wave(), wave(), wave(), wave()]
  // A finer ripple along its top where it is lifted, so its line is folded rather than smooth.
  const rl = 0.3 + 0.12 * random()
  const rp = random() * 6.28
  const ripple = (x) => Math.sin((x * 6.283) / rl + rp + 0.8 * Math.sin((x * 6.283) / (rl * 2.7)))
  const shape = []
  for (let i = 0; i < count; i++) {
    const x = s[i]
    let sum = 0
    for (const l of lobes) {
      const d = (x - l.at) / ((x - l.at) * l.steep > 0 ? l.short : l.long)
      sum += (l.h * Math.max(0, 1 - d * d) ** 2) ** 4
    }
    const lifted = Math.min(1, sum ** 0.25) * (1 + 0.16 * ripple(x))
    const near = smoothstep(0, FOLD.merge, x)
    const far = 1 - smoothstep(S - FOLD.sink, S, x)
    shape.push({
      lift: (FOLD.embedded + (1 - FOLD.embedded) * lifted) * near * near * far,
      // Narrower where it stays in the ground; its two sides spread
      // independently, so its edges are never parallel.
      wide: (1 + 0.15 * wide(x)) * (0.7 + 0.3 * Math.min(1, lifted)) * (1 + 0.8 * (1 - near)) * (0.6 + 0.4 * far),
      trail: 1 + 0.3 * trail(x),
      lead: 0.92 + 0.12 * lead(x),
      fade: smoothstep(0, 1, near) * far,
      hump: 0.54 + 0.16 * hump(x),
      crest: 0.44 + 0.14 * crest(x),
      curl: 0.5 + 0.5 * curl(x),
      tone: 0.6 + 0.12 * tone(x),
    })
  }

  const outerSize = (14 - 1) * K + 1
  const innerSize = (6 - 1) * K + 1
  const grid = (M) => {
    const index = []
    for (let i = 0; i < count - 1; i++) {
      for (let j = 0; j < M - 1; j++) {
        const a = i * M + j
        index.push(a, a + M, a + 1, a + 1, a + M, a + M + 1)
      }
    }
    return index
  }
  return { count, S, s, cx, cz, nx, nz, node, side, lobes, shape, outerSize, innerSize, outerIndex: grid(outerSize), innerIndex: grid(innerSize) }
}

/** An empty skin with every attribute the film material reads. */
function skinGeometry(rows, M, index) {
  const n = rows * M
  const geo = new THREE.BufferGeometry()
  const dyn = (size) => {
    const a = new THREE.Float32BufferAttribute(new Float32Array(n * size), size)
    a.setUsage(THREE.DynamicDrawUsage)
    return a
  }
  geo.setAttribute('position', dyn(3))
  geo.setAttribute('normal', dyn(3))
  geo.setAttribute('uv', dyn(2))
  geo.setAttribute('aAnchor', dyn(3))
  geo.setAttribute('aLook', dyn(4))
  geo.setAttribute('aFold', dyn(4))
  // Whole from the start, not a free edge anywhere, and still.
  const birth = new Float32Array(n * 2)
  for (let v = 0; v < n; v++) birth[v * 2 + 1] = 0.001
  geo.setAttribute('aBirth', new THREE.Float32BufferAttribute(birth, 2))
  geo.setAttribute('aEdge', dyn(1))
  geo.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(n), 1))
  geo.setIndex(index)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
  return geo
}

export default function ConduitFold({ lifecycle, world, meshes, waterLine, openness, accumulation, visible }) {
  const C = lifecycle.conduit
  const material = useMemo(() => {
    const m = createFormMaterial({ ...meshes.find((x) => x.kind === 'film'), tint: FOLD.tint, gain: FOLD.gain })
    m.defines = { ...m.defines, CONDUIT_FOLD: '' }
    m.uniforms.uFoldWarm = { value: new THREE.Color(WARM) }
    m.uniforms.uFoldPhase = { value: 0 }
    return m
  }, [meshes])
  const outer = useMemo(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), material)
    m.name = 'conduit-fold'
    m.frustumCulled = false
    // After the water, before the colonies' membranes, the inner skin first.
    m.renderOrder = 1.5
    m.visible = false
    return m
  }, [material])
  const inner = useMemo(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), material)
    m.name = 'conduit-fold-inner'
    m.frustumCulled = false
    m.renderOrder = 1.4
    m.visible = false
    return m
  }, [material])
  useEffect(
    () => () => {
      outer.geometry.dispose()
      inner.geometry.dispose()
      material.dispose()
    },
    [outer, inner, material],
  )

  const built = useRef({ fold: null, L: null, last: -1, phase: 0, phaseAt: 0 })

  useFrame((state) => {
    const u = material.uniforms
    u.uTime.value = state.clock.elapsedTime
    u.uWaterY.value = waterLine.current
    u.uGlow.value = 0.6
    u.uOpenness.value = openness * 1.6
    setAccumulation(u, accumulation)

    const fold = lifecycle.fold
    const B = built.current
    if (!fold) {
      outer.visible = inner.visible = false
      return
    }
    if (B.fold !== fold) {
      B.fold = fold
      B.L = layout(fold, C, world)
      // For inspection (where its lobes are, which side it curls to).
      outer.userData.layout = B.L
      outer.geometry.dispose()
      inner.geometry.dispose()
      outer.geometry = skinGeometry(B.L.count, B.L.outerSize, B.L.outerIndex)
      inner.geometry = skinGeometry(B.L.count, B.L.innerSize, B.L.innerIndex)
      B.last = -1
      B.phase = 0
      B.phaseAt = lifecycle.t
    }
    outer.visible = inner.visible = visible
    if (B.last === lifecycle.t) return
    B.last = lifecycle.t
    const L = B.L
    const ground = (x, z) => world.groundY(...world.toUV(x, z))
    // Its height can be tried at other values (`&foldlift=`, App).
    const top = lifecycle.foldLift ?? FOLD.lift

    // Per node of the stretch: what has passed (memory), its use now, what it holds.
    const nodes = fold.nodes
    const U = CONDUIT.use
    const hubShare = new Map()
    for (const site of lifecycle.sites) for (const h of site.hub ?? []) hubShare.set(h, site.pocket.matter / Math.max(1, site.hub.length))
    const read = (f) => {
      const out = new Float32Array(L.count)
      const values = nodes.map(f)
      for (let i = 0; i < L.count; i++) {
        const k = Math.min(nodes.length - 2, Math.floor(L.node[i]))
        const t = L.node[i] - k
        out[i] = values[k] * (1 - t) + values[k + 1] * t
      }
      return smooth(out, FOLD.sigma / FOLD.step)
    }
    const memory = read((n) => 1 - Math.exp(-lifecycle.passed[n] / FOLD.remembered))
    const use = read((n, k) => {
      const a = fold.edges[Math.max(0, k - 1)]
      const b = fold.edges[Math.min(fold.edges.length - 1, k)]
      return Math.min(1, Math.max(0, ((C.g[a] + C.g[b]) / 2 - U.floor) / (U.cap - U.floor)))
    })
    const full = read((n) => Math.min(1, Math.sqrt((lifecycle.tissue[n] + (hubShare.get(n) ?? 0)) / CONTENT_FULL)))

    // What moves in it: the matter's velocity along it (outward positive).
    let q = 0
    let m = 0
    fold.edges.forEach((e, k) => {
      q += lifecycle.flow[e] * (C.a[e] === nodes[k] ? 1 : -1)
    })
    q /= fold.edges.length
    for (const n of nodes) m += lifecycle.tissue[n]
    const v = Math.max(-FASTEST, Math.min(FASTEST, q / Math.max(m / fold.length, 1e-6)))
    const dt = Math.min(2, Math.max(0, lifecycle.t - B.phaseAt))
    B.phaseAt = lifecycle.t
    B.phase += v * dt
    u.uFoldPhase.value = B.phase

    const sec = new Float32Array(L.outerSize * 2)
    const buried = new Float32Array(L.outerSize)
    const skins = [
      { geo: outer.geometry, M: L.outerSize, section: outerSection, presence: FOLD.presence[0], inner: 0 },
      { geo: inner.geometry, M: L.innerSize, section: innerSection, presence: FOLD.presence[1], inner: 1 },
    ]
    for (const skin of skins) {
      const { geo, M } = skin
      const pos = geo.attributes.position.array
      const anchor = geo.attributes.aAnchor.array
      const look = geo.attributes.aLook.array
      const uv = geo.attributes.uv.array
      const flow = geo.attributes.aFold.array
      const edge = geo.attributes.aEdge.array
      for (let i = 0; i < L.count; i++) {
        const sh = L.shape[i]
        const lift = top * memory[i] * (FOLD.scar + (1 - FOLD.scar) * use[i]) * sh.lift
        const w = (FOLD.width[0] + (FOLD.width[1] - FOLD.width[0]) * memory[i]) * sh.wide
        const k = { hump: sh.hump, crest: sh.crest, curl: sh.curl * smoothstep(0.03, 0.1, lift), full: full[i] }
        sampleSection(skin.section(k), sec, buried, !!skin.inner)
        // Faint where it lies in the ground, so the flat tissue reads there.
        const standing = 0.3 + 0.7 * smoothstep(0.02, 0.1, lift)
        const innerShown = skin.inner ? smoothstep(0.03, 0.1, lift) : 1
        // The roll's lip catches light as a membrane's free edge does, where it stands.
        const lip = skin.inner ? 0 : 0.75 * smoothstep(0.04, 0.12, lift)
        let across = 0
        for (let j = 0; j < M; j++) {
          const a = sec[j * 2] * L.side * w * (sec[j * 2] < 0 ? sh.trail : sh.lead)
          const x = L.cx[i] + L.nx[i] * a
          const z = L.cz[i] + L.nz[i] * a
          const g = ground(x, z)
          const b = buried[j]
          const y = g + (FOLD.floor + lift * sec[j * 2 + 1]) * (1 - b) - FOLD.buried * b
          const o = (i * M + j) * 3
          pos[o] = x
          pos[o + 1] = y
          pos[o + 2] = z
          anchor[o] = x
          anchor[o + 1] = g
          anchor[o + 2] = z
          if (j > 0) {
            const p = o - 3
            across += Math.hypot(x - pos[p], y - pos[p + 1], z - pos[p + 2])
          }
          // Its edges fade into the ground (the long trailing one over more
          // of its width); the inner skin fades out toward its top.
          const f = j / (M - 1)
          const edges = skin.inner ? smoothstep(0, 0.3, f) * (1 - smoothstep(0.55, 1, f)) : smoothstep(0, 0.25, f) * smoothstep(0, 0.12, 1 - f)
          const l = (i * M + j) * 4
          look[l] = sh.tone + 0.15 * sec[j * 2 + 1] * (1 - skin.inner)
          look[l + 1] = 0
          // And thins where it meets the ground, so it is not drawn as a line there.
          const meets = 0.3 + 0.7 * smoothstep(0, 0.045, y - g)
          look[l + 2] = skin.presence * edges * meets * standing * innerShown * sh.fade
          look[l + 3] = 0
          edge[i * M + j] = 1 - lip * Math.exp(-(((j - LIP) / (1.2 * K)) ** 2))
          uv[(i * M + j) * 2] = across
          uv[(i * M + j) * 2 + 1] = L.s[i]
          flow[l] = L.s[i]
          flow[l + 1] = across
          flow[l + 2] = skin.inner
          flow[l + 3] = Math.min(0.5, full[i])
        }
      }
      // Normals from the grid, wound as its triangles are (the material
      // turns them toward the viewer), so the curl's underside faces down.
      const nrm = geo.attributes.normal.array
      const P = (i, j) => (Math.min(L.count - 1, Math.max(0, i)) * M + Math.min(M - 1, Math.max(0, j))) * 3
      for (let i = 0; i < L.count; i++) {
        for (let j = 0; j < M; j++) {
          const a = P(i + 1, j)
          const b = P(i - 1, j)
          const c = P(i, j + 1)
          const d = P(i, j - 1)
          const ux = pos[a] - pos[b]
          const uy = pos[a + 1] - pos[b + 1]
          const uz = pos[a + 2] - pos[b + 2]
          const vx = pos[c] - pos[d]
          const vy = pos[c + 1] - pos[d + 1]
          const vz = pos[c + 2] - pos[d + 2]
          const x = uy * vz - uz * vy
          const y = uz * vx - ux * vz
          const z = ux * vy - uy * vx
          const l = Math.hypot(x, y, z) || 1
          const o = (i * M + j) * 3
          nrm[o] = x / l
          nrm[o + 1] = y / l
          nrm[o + 2] = z / l
        }
      }
      for (const name of ['position', 'normal', 'uv', 'aAnchor', 'aLook', 'aFold', 'aEdge']) geo.attributes[name].needsUpdate = true
    }
  })

  return (
    <>
      <primitive object={inner} />
      <primitive object={outer} />
    </>
  )
}
