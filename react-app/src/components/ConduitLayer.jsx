import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CONDUIT } from '../lib/conduit'

/**
 * The shared tissue (lib/conduit.js, lifecycle.js `circulate`), drawn:
 * study 10, behind `?lifecycle=1&conduit=1`. Every quality on screen is a
 * quantity in the simulation:
 *
 *   - where it is: soft translucent bands just over the ground along each
 *     stretch of the network, pearl-lavender, a little deeper in tone at
 *     their edges (tissue seen through the ground, not laid on it)
 *   - how much it has been used: its width and density, and fine fibres
 *     along it; a dormant path narrows to a faint trace and stays
 *   - what it holds: a pale champagne in it, as much as matter is there; a
 *     colony's pocket shows the same way, at its hub
 *   - what moves in it: soft pulses inside the band, travelling along each
 *     stretch at the velocity the matter there has (its net flow over the
 *     matter present), so they stand still where nothing flows
 *   - where it grows: a slight brightening at a tip while it advances
 *
 * No particles, tubes, arrows or lines over the ground.
 *
 * Unfinished and paused (24 October 2026), like the tissue it draws.
 */

/** Colours: the tissue (pearl, and its deeper edge), a faint iridescence, and matter in it. */
const LOOK = { pearl: '#DCD5F0', deep: '#7E77B4', iris: '#CFC6EC', warm: '#E6D6B4' }

/** Matter per node that reads as fully present (a dense stretch; a thin spread stays pearl). */
const CONTENT_FULL = 0.008

/** Half-width of a band (units): dormant to fully used. */
const WIDTH = [0.022, 0.1]

/** Fastest the pulses are drawn moving (units/s), and how fast reads as flowing at all. */
const FASTEST = 0.3
const FLOWING = [0.004, 0.03]

/** The band's lift off the ground (units). */
const LIFT = 0.012

const VERTEX = /* glsl */ `
  attribute vec4 aState;
  attribute float aPhase;
  attribute float aAcross;
  attribute float aArc;
  attribute float aSeed;
  varying vec4 vState;
  varying float vPhase;
  varying float vAcross;
  varying float vArc;
  varying float vSeed;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vState = aState;
    vPhase = aPhase;
    vAcross = aAcross;
    vArc = aArc;
    vSeed = aSeed;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uPearl;
  uniform vec3 uDeep;
  uniform vec3 uIris;
  uniform vec3 uWarm;
  varying vec4 vState;
  varying float vPhase;
  varying float vAcross;
  varying float vArc;
  varying float vSeed;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float held = clamp(vState.x, 0.0, 1.0);
    float used = clamp(vState.y, 0.0, 1.0);
    float flowing = clamp(vState.z, 0.0, 1.0);
    float growing = clamp(vState.w, 0.0, 1.0);
    float a = abs(vAcross);
    float prof = pow(max(1.0 - a * a, 0.0), 1.7);

    // Pearl in the middle, a little deeper toward its edges: embedded.
    vec3 col = mix(uDeep, uPearl, smoothstep(0.95, 0.15, a));
    // A faint iridescence that shifts with the view, as on the membranes.
    vec3 v = normalize(cameraPosition - vWorld);
    col = mix(col, uIris, 0.18 * (1.0 - abs(v.y)));
    // Fine fibres along it, where it has been used.
    float fibre = 0.5 + 0.5 * sin(vAcross * (10.0 + 8.0 * used) + 1.6 * sin(vArc * 2.7 + vSeed));
    fibre = smoothstep(0.6, 1.0, fibre) * (0.25 + 0.75 * used);
    col += uPearl * fibre * 0.12;

    // What moves in it: soft pulses carried along at the matter's speed.
    float pulse = 0.5 + 0.5 * sin((vArc - vPhase) * 8.0 + 1.5 * sin(vArc * 1.3 + vSeed));
    pulse = pow(pulse, 5.0) * (1.0 - smoothstep(0.25, 0.9, a));
    // What it holds: a little champagne, and more in what is moving.
    float warm = held * (0.3 + 0.7 * pulse * flowing);
    col = mix(col, uWarm, 0.5 * warm);
    // Where it grows: a slight brightening at the tip.
    col += uPearl * growing * 0.2;

    float alpha = prof * (0.07 + 0.16 * used + 0.1 * held + 0.14 * pulse * flowing * held + 0.22 * growing) + fibre * 0.04 * prof;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.55));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * The network's stretches: runs of nodes between junctions and ends, each
 * with the edges along it and which way each runs.
 */
function stretches(C) {
  const out = []
  const seen = new Uint8Array(C.edgeCount)
  const other = (e, n) => (C.a[e] === n ? C.b[e] : C.a[e])
  const isEnd = (n) => C.at[n].length !== 2
  const walk = (start, e0) => {
    const nodes = [start]
    const edges = []
    let n = start
    let e = e0
    for (;;) {
      seen[e] = 1
      edges.push([e, C.a[e] === n ? 1 : -1])
      n = other(e, n)
      nodes.push(n)
      if (isEnd(n)) break
      const next = C.at[n].find((f) => !seen[f])
      if (next === undefined) break
      e = next
    }
    out.push({ nodes, edges })
  }
  for (let n = 0; n < C.count; n++) if (isEnd(n)) for (const e of C.at[n]) if (!seen[e]) walk(n, e)
  // Closed loops with no junction.
  for (let e = 0; e < C.edgeCount; e++) if (!seen[e]) walk(C.a[e], e)
  return out
}

/** A band along each stretch: two vertices per point, points at half the node spacing. */
function buildBands(C, world, chains) {
  const position = []
  const across = []
  const arcs = []
  const seeds = []
  const refs = []
  const index = []
  const ground = (x, z) => world.groundY(...world.toUV(x, z))
  chains.forEach((ch, c) => {
    const N = ch.nodes
    const pts = []
    let arc = 0
    for (let k = 0; k < N.length - 1; k++) {
      const a = N[k]
      const b = N[k + 1]
      const len = Math.hypot(C.x[b] - C.x[a], C.z[b] - C.z[a])
      for (const t of [0, 0.5]) pts.push({ x: C.x[a] + (C.x[b] - C.x[a]) * t, z: C.z[a] + (C.z[b] - C.z[a]) * t, a, b, t, arc: arc + len * t })
      arc += len
    }
    const last = N[N.length - 1]
    pts.push({ x: C.x[last], z: C.z[last], a: last, b: last, t: 0, arc })
    // A free end (a tip, growing or not) tapers to nothing; a junction does not.
    const freeStart = C.at[N[0]].length === 1
    const freeEnd = C.at[last].length === 1
    const taper = (d) => Math.min(1, d / 0.3)
    const base = position.length / 3
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[Math.min(pts.length - 1, i + 1)]
      const tx = p1.x - p0.x
      const tz = p1.z - p0.z
      const tl = Math.hypot(tx, tz) || 1
      const nx = -tz / tl
      const nz = tx / tl
      for (const side of [-1, 1]) {
        // The centre line here; each vertex is moved out to its width each frame.
        position.push(pts[i].x, ground(pts[i].x, pts[i].z) + LIFT, pts[i].z)
        across.push(side)
        arcs.push(pts[i].arc)
        seeds.push(c * 1.37)
        refs.push(pts[i].a, pts[i].b, pts[i].t, c, nx * side, nz * side, (freeStart ? taper(pts[i].arc) : 1) * (freeEnd ? taper(arc - pts[i].arc) : 1))
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + 2 * i
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  })
  const geometry = new THREE.BufferGeometry()
  const pos = new THREE.Float32BufferAttribute(position, 3)
  pos.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', pos)
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1))
  geometry.setAttribute('aArc', new THREE.Float32BufferAttribute(arcs, 1))
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1))
  const count = position.length / 3
  const state = new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4)
  const phase = new THREE.Float32BufferAttribute(new Float32Array(count), 1)
  state.setUsage(THREE.DynamicDrawUsage)
  phase.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('aState', state)
  geometry.setAttribute('aPhase', phase)
  geometry.setIndex(index)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
  return { geometry, refs: Float32Array.from(refs), centre: Float32Array.from(position) }
}

export default function ConduitLayer({ lifecycle, world, visible }) {
  const C = lifecycle.conduit
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        fog: true,
        transparent: true,
        depthWrite: false,
        // Seen from above whichever way its triangles wind.
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uPearl: { value: new THREE.Color(LOOK.pearl) },
            uDeep: { value: new THREE.Color(LOOK.deep) },
            uIris: { value: new THREE.Color(LOOK.iris) },
            uWarm: { value: new THREE.Color(LOOK.warm) },
          },
        ]),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      }),
    [],
  )
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), material)
    m.name = 'conduit-tissue'
    m.frustumCulled = false
    // Before the membranes, so they veil it as they veil the ground.
    m.renderOrder = -1
    return m
  }, [material])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      material.dispose()
    },
    [mesh, material],
  )

  // The bands, rebuilt as the network grows, and each stretch's pulse phase.
  const built = useRef({ version: -1, chains: [], refs: null, centre: null, phases: [], last: 0 })

  useFrame(() => {
    const B = built.current
    if (B.version !== C.version) {
      B.version = C.version
      const chains = stretches(C)
      const bands = buildBands(C, world, chains)
      mesh.geometry.dispose()
      mesh.geometry = bands.geometry
      // Keep the pulses where they were on stretches that already existed (keyed by their first edge).
      const old = new Map(B.chains.map((ch, i) => [ch.edges[0]?.[0], B.phases[i]]))
      B.phases = chains.map((ch) => old.get(ch.edges[0]?.[0]) ?? 0)
      B.chains = chains
      B.refs = bands.refs
      B.centre = bands.centre
    }
    if (!B.chains.length) return

    // Per node: what it holds (with a hub's share of its pocket), how used
    // its paths are, and whether a tip is growing there.
    const n = C.count
    if (!B.held) {
      B.held = new Float32Array(CONDUIT.capacity)
      B.used = new Float32Array(CONDUIT.capacity)
      B.grow = new Float32Array(CONDUIT.capacity)
    }
    const { held, used, grow } = B
    const U = CONDUIT.use
    for (let i = 0; i < n; i++) {
      held[i] = lifecycle.tissue[i]
      let g = 0
      for (const e of C.at[i]) g = Math.max(g, C.g[e])
      used[i] = Math.sqrt(Math.max(0, (g - U.floor) / (U.cap - U.floor)))
      grow[i] = 0
    }
    for (const site of lifecycle.sites) {
      const hub = site.hub ?? []
      for (const h of hub) held[h] += site.pocket.matter / Math.max(1, hub.length)
    }
    for (const t of C.tips) {
      if (t.state !== 'growing' || !t.rate) continue
      const L = t.lineage
      for (let k = 0; k < Math.min(4, L.length); k++) {
        const i = L[L.length - 1 - k]
        grow[i] = Math.max(grow[i], (t.rate / CONDUIT.grow.speed) * (1 - k / 4))
      }
    }

    // Each stretch: the matter's velocity along it, and its pulses moved on by it.
    const dt = Math.min(2, Math.max(0, lifecycle.t - B.last))
    B.last = lifecycle.t
    const flowing = new Float32Array(B.chains.length)
    const dense = CONTENT_FULL / CONDUIT.spacing
    B.chains.forEach((ch, c) => {
      let q = 0
      let length = 0
      for (const [e, dir] of ch.edges) {
        q += lifecycle.flow[e] * dir
        length += C.len[e]
      }
      q /= Math.max(1, ch.edges.length)
      let m = 0
      for (const i of ch.nodes) m += lifecycle.tissue[i]
      const density = m / Math.max(length, 1e-3)
      const v = Math.max(-FASTEST, Math.min(FASTEST, q / Math.max(density, 1e-6)))
      B.phases[c] += v * dt
      const s = Math.min(1, Math.max(0, (Math.abs(v) - FLOWING[0]) / (FLOWING[1] - FLOWING[0])))
      flowing[c] = s * Math.min(1, density / (dense * 0.15))
    })

    // Onto the vertices: width from use, and the rest as state.
    const geo = mesh.geometry
    const pos = geo.attributes.position
    const state = geo.attributes.aState
    const phase = geo.attributes.aPhase
    const R = B.refs
    const P = B.centre
    for (let v = 0; v < state.count; v++) {
      const a = R[v * 7]
      const b = R[v * 7 + 1]
      const t = R[v * 7 + 2]
      const c = R[v * 7 + 3]
      const h = held[a] * (1 - t) + held[b] * t
      const u = used[a] * (1 - t) + used[b] * t
      const w = (WIDTH[0] + (WIDTH[1] - WIDTH[0]) * u) * R[v * 7 + 6]
      pos.setXYZ(v, P[v * 3] + R[v * 7 + 4] * w, P[v * 3 + 1], P[v * 3 + 2] + R[v * 7 + 5] * w)
      state.setXYZW(v, Math.sqrt(h / CONTENT_FULL), u, flowing[c], grow[a] * (1 - t) + grow[b] * t)
      phase.setX(v, B.phases[c])
    }
    pos.needsUpdate = true
    state.needsUpdate = true
    phase.needsUpdate = true
  })

  return <primitive object={mesh} visible={visible} />
}
