import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildBlooms, FormWriter } from '../lib/traceForms'
import { createFormMaterial, setAccumulation } from '../lib/formMaterial'
import { LIFECYCLE, RECENT, recentAt } from '../lib/lifecycle'
import { createFilmMesh } from './AirFragments'
import ConduitLayer from './ConduitLayer'
import ConduitFold from './ConduitFold'
import ConduitGreybox from './ConduitGreybox'

/**
 * Study 10, behind `?lifecycle=1`: the lifecycle's patch, drawn with what the
 * colony already uses (lib/lifecycle.js holds the simulation):
 *
 *   - each resident is one membrane, built by the bloom layer's own builder
 *     in the bloom layer's own materials (`meshes`, from ScatterLayers). It
 *     unfolds as far as its matter allows; lying down, it folds over toward
 *     its lean (the form vertex shader's `uRecline`); ended, it stays as a
 *     low contour on the ground, fainter as its matter is taken up, never
 *     gone (`uFade`)
 *   - the residue is a thin skin lying on the ground, in the colony's own
 *     ground-skin material, as thick as the residual is, granular where it
 *     is thickest, with a faint fold where the deposit thins out: the edge a
 *     new resident rises from
 *   - the films in the air are the air's fragments (AirFragments' mesh and
 *     material), placed where the simulation carries them, fading into the
 *     ground where they settle
 *
 * The simulation steps here, once per frame, on its fixed step.
 *
 * A warm accent can be tried on top (`&warm=1|2|3`, or the inspector; off by
 * default, and then not compiled at all): see WARM.
 */

/** Films shown at once: in flight, or fading where they settled. */
const FILMS = 16

/** Seconds a settled film lies on the ground before it has merged into the residue. */
const FADE_OUT = 10

/** The residue's film: vertices per side, and its lift off the ground (units). */
const DEPOSIT_GRID = 128
const DEPOSIT_LIFT = 0.02

/**
 * How the residue is drawn: in the colony's ground-skin material (tissue),
 * paler and warmer than the colony's own skin; a little softer than the
 * grid holds it (a display blur, radius in cells); granular where it lies
 * thickest (the material's crust); a faint brighter fold where it thins out
 * (its vein light). `full` is the residual that reads as fully present.
 */
const DEPOSIT_LOOK = { blur: 2, tint: '#EEE6F6', full: 0.008 }

/**
 * The warm accent, a development A/B. Only where matter is crossing from one
 * state to another, for as long as the simulation records it doing so, the
 * surface shifts toward a pale champagne at its own brightness, then returns:
 *
 *   - release   the spot on a lying resident a film has just left, and the
 *               film itself for its first seconds in the air
 *   - deposit   a film just settled (only when the record keeps it), and
 *               the fresh deposit: its thin edge, or (variant 3) all of it
 *   - uptake    the residue being taken up (cells the simulation is drawing
 *               from), the new resident's foot while it takes matter in,
 *               and an old contour while it gives
 *
 * Nothing is drawn along the films' paths: the matter travels as the films,
 * through open air, not along any channel. `fade` is how long (simulation
 * seconds) each cue takes to return after its transition.
 *
 * Variants 4 and 5 are a study of the uptake alone, one approach each, and
 * follow how much is being taken up, not only when (the simulation's
 * recent-uptake records, which forget over RECENT seconds):
 *
 *   - A absorb  the deposit skin, cell by cell, as much as is being drawn out
 *               of it, in the skin's own grain; it recedes with the matter
 *   - B growth  the new resident, from its foot a short way up its own
 *               columns, as far as its recent intake reaches
 */
const NONE = { film: 0, left: 0, edge: 0, fresh: 0, drawn: 0, take: 0, give: 0, glow: 0, absorb: null, grow: null }
const WARM = {
  tint: '#EFDCC0',
  fade: { release: 8, land: 4, arrive: 18, drawn: 3, take: 2.5, give: 2.5, left: 3 },
  variants: {
    1: { ...NONE, name: 'edge', film: 0.55, left: 0.5, edge: 0.7, drawn: 0.4, take: 0.4, give: 0.25, glow: 0.03 },
    2: { ...NONE, name: 'uptake', film: 0.75, left: 0.8, edge: 0.7, drawn: 0.8, take: 0.75, give: 0.5, glow: 0.06 },
    3: { ...NONE, name: 'deposit', film: 0.75, left: 0.8, edge: 0.7, fresh: 0.6, drawn: 0.4, take: 0.4, give: 0.25, glow: 0.1 },
    // strength, light, density, grain
    4: { ...NONE, name: 'A absorb', tint: '#EBDBB6', absorb: [1.2, 0.26, 0.12, 1.0] },
    5: { ...NONE, name: 'B growth', tint: '#EBDBB6', grow: { strength: 0.85, reach: [0.08, 0.32], glow: 0.26, density: 0.06 } },
  },
}

/** Matter taken lately from one cell that shows fully (approach A); about the most a cell gives. */
const UPTAKE_FULL = 0.005

/** 1 when a transition happened `since` seconds ago, 0 once `fade` has passed. */
const recency = (since, fade) => 1 - smoothstep(0, fade, since)

/** Compile the accent into a material, or take it out again (exactly as before). */
function setWarm(material, on) {
  const has = material.defines?.WARM !== undefined
  if (has === on) return
  material.defines = { ...material.defines }
  if (on) material.defines.WARM = ''
  else delete material.defines.WARM
  material.needsUpdate = true
}

/** The accent's uniforms, on one of the lifecycle's own materials. */
function warmUniforms(material) {
  const u = material.uniforms
  u.uWarmTint = { value: new THREE.Color(WARM.tint) }
  u.uWarmGlow = { value: 0 }
  u.uWarmIn = { value: 0 }
  u.uWarmAt = { value: new THREE.Vector4(0, 0, 0, 1) }
  u.uWarm = { value: new THREE.Vector4() }
  u.uAbsorb = { value: new THREE.Vector4() }
  u.uGrow = { value: new THREE.Vector4() }
  return material
}

/** The patch's default view, relative to the colony: inside the orbit's own limits. */
const VIEW = { target: [1.0, 0, -0.33], from: [6.2, 5.0, 0.6] }

/**
 * With the shared tissue: every colony it joins and the ground between, from
 * the south, well above; `from` is per unit of how far the colonies spread.
 */
const VIEW_CONDUIT = { from: [0.03, 1.15, 0.8], least: 7 }

/** A separable box blur of a res × res grid, for display. */
function blur(src, out, res, radius) {
  const tmp = new Float32Array(src.length)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let s = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const ii = i + k
        if (ii < 0 || ii >= res) continue
        s += src[j * res + ii]
        n++
      }
      tmp[j * res + i] = s / n
    }
  }
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let s = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const jj = j + k
        if (jj < 0 || jj >= res) continue
        s += tmp[jj * res + i]
        n++
      }
      out[j * res + i] = s / n
    }
  }
}

/** Bilinear read of a res × res grid at (u, v). */
function sample(grid, res, u, v) {
  const x = Math.min(1, Math.max(0, u)) * res - 0.5
  const y = Math.min(1, Math.max(0, v)) * res - 0.5
  const i0 = Math.max(0, Math.min(res - 1, Math.floor(x)))
  const j0 = Math.max(0, Math.min(res - 1, Math.floor(y)))
  const i1 = Math.min(res - 1, i0 + 1)
  const j1 = Math.min(res - 1, j0 + 1)
  const fx = Math.min(1, Math.max(0, x - i0))
  const fy = Math.min(1, Math.max(0, y - j0))
  return (
    grid[j0 * res + i0] * (1 - fx) * (1 - fy) +
    grid[j0 * res + i1] * fx * (1 - fy) +
    grid[j1 * res + i0] * (1 - fx) * fy +
    grid[j1 * res + i1] * fx * fy
  )
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const tmp = {
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
  x: new THREE.Vector3(),
  y: new THREE.Vector3(),
  z: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
}

/** One resident: its membrane, its own two materials, its own stage. */
function Resident({ resident: r, lifecycle, world, meshes, growth, waterLine, openness, accumulation, visible }) {
  const materials = useMemo(() => meshes.map((m) => warmUniforms(createFormMaterial(m))), [meshes])
  const edgeGlows = useMemo(() => materials.map((m) => m.uniforms.uEdgeGlow?.value ?? 0), [materials])
  const geo = useMemo(() => buildBlooms([r.desc], world, new FormWriter()), [r, world])
  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose())
      geo.solid?.dispose()
      geo.film?.dispose()
    },
    [materials, geo],
  )
  const solid = useRef(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const ended = r.stage === 'ended'
    // Releasing, it thins as its films leave; ended, its contour is as
    // present as the matter it still holds, and never less than a trace.
    const presence = ended
      ? 0.22 + 0.4 * (r.contour0 > 0 ? r.contour / r.contour0 : 0)
      : r.stage === 'releasing'
        ? 1 - 0.3 * smoothstep(0, LIFECYCLE.release, r.stageTime)
        : 1
    materials.forEach((material) => {
      const u = material.uniforms
      u.uGrowth.value = r.unfold * growth.current
      u.uTime.value = t
      u.uWaterY.value = waterLine.current
      u.uGlow.value = 0.6
      u.uOpenness.value = openness * 1.6
      u.uRecline.value = r.recline
      u.uBase.value.set(r.desc.p[0], r.desc.p[1], r.desc.p[2])
      u.uLean.value.set(Math.cos(r.desc.lean), Math.sin(r.desc.lean))
      u.uFade.value = presence
      // A contour's rim is quiet: it lies on the ground, it is not an object.
      if (u.uEdgeGlow) u.uEdgeGlow.value = ended ? 0.06 : edgeGlows[materials.indexOf(material)]
      setAccumulation(u, accumulation)
    })
    // The warm accent (only the membrane carries it): where matter crosses
    // this body now, and how recently.
    const W = WARM.variants[lifecycle.warm]
    const film = materials[1]
    if (film) {
      setWarm(film, !!W && !!(W.left || W.take || W.give || W.grow))
      if (W) {
        const u = film.uniforms
        const now = lifecycle.t
        u.uWarmTint.value.set(W.tint ?? WARM.tint)
        // B: the matter it has taken in over the last few seconds, as a share
        // of what full-rate uptake brings in that time.
        const g = W.grow
        const taking = g && (r.stage === 'forming' || r.stage === 'holding')
        const n = taking ? Math.min(1, recentAt(r.inflow, r.inflowAt, now) / (LIFECYCLE.uptake * RECENT)) : 0
        if (g) u.uGrow.value.set(g.strength * n, g.reach[0] + g.reach[1] * n, g.glow, g.density)
        else u.uGrow.value.set(0, 1, 0, 0)
        const [x, y, z] = r.desc.p
        let strength = 0
        if (r.stage === 'ended') {
          // An old contour giving part of itself to a resident forming on it.
          strength = W.give * recency(now - (r.gaveAt ?? -1e9), WARM.fade.give)
          u.uWarmAt.value.set(x, y, z, 0.3 + 0.6 * r.desc.height)
        } else if (r.stage === 'releasing' && r.lastRelease) {
          // Where its last film came away.
          strength = W.left * recency(now - r.lastRelease.t, WARM.fade.left)
          u.uWarmAt.value.set(...r.lastRelease.at, 0.35)
        } else {
          // Its foot, while it takes matter in from the ground.
          strength = W.take * recency(now - (r.tookAt ?? -1e9), WARM.fade.take)
          u.uWarmAt.value.set(x, y, z, 0.45)
        }
        u.uWarmIn.value = strength
        u.uWarmGlow.value = W.glow
      }
    }
    if (solid.current) solid.current.visible = visible && !ended
  })

  return (
    <group>
      {geo.solid && <mesh ref={solid} geometry={geo.solid} material={materials[0]} frustumCulled={false} />}
      {geo.film && <mesh geometry={geo.film} material={materials[1]} visible={visible} frustumCulled={false} />}
    </group>
  )
}

/**
 * The residue: a film lying on the ground over the patch, reading the live
 * residual. Rebuilt only when the residual changes.
 */
function Deposit({ lifecycle, world, waterLine, accumulation, visible }) {
  const material = useMemo(() => warmUniforms(createFormMaterial({ kind: 'tissue', tint: DEPOSIT_LOOK.tint })), [])
  const shown = useMemo(() => new Float32Array(lifecycle.residual.length), [lifecycle])
  // The warm accent's grids: how recently matter arrived in each cell, and
  // was taken up from it (1 now, 0 faded), as drawn (blurred like the residue).
  const warmth = useMemo(() => {
    const n = lifecycle.residual.length
    return { arrived: new Float32Array(n), drawn: new Float32Array(n), arrivedShown: new Float32Array(n), drawnShown: new Float32Array(n), soft: new Float32Array(n), t: -1, variant: 0, any: false }
  }, [lifecycle])
  const { geometry, uvs } = useMemo(() => {
    const c = lifecycle.colony
    const half = c.radius + LIFECYCLE.margin + 0.6
    const n = DEPOSIT_GRID
    const position = []
    const uvs = []
    const index = []
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = c.x + (i / (n - 1) - 0.5) * 2 * half
        const z = c.z + (j / (n - 1) - 0.5) * 2 * half
        const [u, v] = world.toUV(x, z)
        position.push(x, Math.max(world.groundY(u, v), world.waterY - 0.6) + DEPOSIT_LIFT, z)
        uvs.push([u, v])
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i
        index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
      }
    }
    const count = n * n
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(count).fill([0, 1, 0]).flat(), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(position.filter((_, k) => k % 3 !== 1), 2))
    geometry.setAttribute('aAnchor', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('aBirth', new THREE.Float32BufferAttribute(new Array(count).fill([0, 0.001]).flat(), 2))
    const look = new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4)
    const edge = new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1)
    look.setUsage(THREE.DynamicDrawUsage)
    edge.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aLook', look)
    geometry.setAttribute('aEdge', edge)
    geometry.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(count), 1))
    // Read only when the warm accent is compiled in.
    const warm = new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2)
    warm.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aWarm', warm)
    geometry.setIndex(index)
    geometry.computeBoundingSphere()
    return { geometry, uvs }
  }, [lifecycle, world])
  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )
  const seen = useRef(-1)

  useFrame((state) => {
    if (lifecycle.version !== seen.current) {
      seen.current = lifecycle.version
      blur(lifecycle.residual, shown, lifecycle.res, DEPOSIT_LOOK.blur)
      const look = geometry.attributes.aLook
      const F = DEPOSIT_LOOK.full
      for (let k = 0; k < uvs.length; k++) {
        const r = sample(shown, lifecycle.res, uvs[k][0], uvs[k][1])
        // The tissue material reads (thickness, vein light, presence, crust).
        const fold = smoothstep(F * 0.04, F * 0.15, r) * (1 - smoothstep(F * 0.15, F * 0.45, r))
        look.setXYZW(k, smoothstep(0, F, r), 0.35 * fold, smoothstep(F * 0.04, F * 0.5, r), 0.9 * smoothstep(F * 0.3, F * 1.5, r))
      }
      look.needsUpdate = true
    }
    const u = material.uniforms
    u.uGrowth.value = 1
    u.uTime.value = state.clock.elapsedTime
    u.uWaterY.value = waterLine.current
    setAccumulation(u, accumulation)

    const W = WARM.variants[lifecycle.warm]
    const on = !!W && !!(W.edge || W.fresh || W.drawn || W.absorb)
    setWarm(material, on)
    if (on && (warmth.t !== lifecycle.t || warmth.variant !== lifecycle.warm)) {
      warmth.t = lifecycle.t
      warmth.variant = lifecycle.warm
      const now = lifecycle.t
      let any = false
      for (let c = 0; c < warmth.arrived.length; c++) {
        const a = recency(now - lifecycle.arrived[c], WARM.fade.arrive)
        // A: how much was drawn from here lately; otherwise how recently.
        const d = W.absorb
          ? Math.min(1, recentAt(lifecycle.uptake[c], lifecycle.uptakeAt[c], now) / UPTAKE_FULL)
          : recency(now - lifecycle.drawn[c], WARM.fade.drawn)
        warmth.arrived[c] = a
        warmth.drawn[c] = d > 0.002 ? d : 0
        if (a > 0 || warmth.drawn[c] > 0) any = true
      }
      // Nothing recent, now or last time: the attribute already reads 0.
      if (any || warmth.any) {
        blur(warmth.arrived, warmth.arrivedShown, lifecycle.res, DEPOSIT_LOOK.blur)
        // A keeps close to the cells it is drawn from: two light passes, so
        // the cells' grid does not show.
        if (W.absorb) {
          blur(warmth.drawn, warmth.soft, lifecycle.res, 1)
          blur(warmth.soft, warmth.drawnShown, lifecycle.res, 1)
        } else blur(warmth.drawn, warmth.drawnShown, lifecycle.res, DEPOSIT_LOOK.blur)
        const attr = geometry.attributes.aWarm
        for (let k = 0; k < uvs.length; k++) {
          attr.setXY(k, sample(warmth.arrivedShown, lifecycle.res, uvs[k][0], uvs[k][1]), sample(warmth.drawnShown, lifecycle.res, uvs[k][0], uvs[k][1]))
        }
        attr.needsUpdate = true
      }
      warmth.any = any
    }
    if (on) {
      u.uWarm.value.set(W.edge, W.fresh, W.drawn, W.glow)
      u.uAbsorb.value.set(...(W.absorb ?? [0, 0, 0, 0]))
      u.uWarmTint.value.set(W.tint ?? WARM.tint)
    }
  })

  return <mesh geometry={geometry} material={material} visible={visible} frustumCulled={false} />
}

export default function LifecycleLayer({ lifecycle, world, meshes, growth, waterLine, openness, accumulation, visible, frame = true }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const films = useMemo(() => {
    const mesh = createFilmMesh(FILMS)
    mesh.name = 'lifecycle-films'
    warmUniforms(mesh.material)
    const warm = new THREE.InstancedBufferAttribute(new Float32Array(FILMS), 1)
    warm.setUsage(THREE.DynamicDrawUsage)
    mesh.geometry.setAttribute('aWarm', warm)
    return mesh
  }, [])
  useEffect(
    () => () => {
      films.geometry.dispose()
      films.material.dispose()
    },
    [films],
  )
  // New residents are new components: the count is the only thing React sees.
  const [count, setCount] = useState(lifecycle.residents.length)

  // The patch's view, once, when the experiment begins.
  const framed = useRef(false)
  useEffect(() => {
    if (!frame || framed.current || !controls) return
    framed.current = true
    if (lifecycle.conduit) {
      // Every colony the tissue joins, from the south, well above, as far
      // back as they are spread (never nearer than `least`).
      const cs = lifecycle.conduit.colonies
      const xs = cs.map((c) => c.x)
      const zs = cs.map((c) => c.z)
      const tx = (Math.min(...xs) + Math.max(...xs)) / 2
      const tz = (Math.min(...zs) + Math.max(...zs)) / 2
      const spread = Math.max(VIEW_CONDUIT.least, Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * 1.6)
      const y = world.groundY(...world.toUV(tx, tz))
      const [fx, fy, fz] = VIEW_CONDUIT.from
      controls.target.set(tx, y, tz)
      camera.position.set(tx + fx * spread, y + fy * spread, tz + fz * spread)
      controls.update()
      return
    }
    const c = lifecycle.colony
    const y = world.groundY(...world.toUV(c.x, c.z))
    controls.target.set(c.x + VIEW.target[0], y + VIEW.target[1], c.z + VIEW.target[2])
    camera.position.set(c.x + VIEW.target[0] + VIEW.from[0], y + VIEW.from[1], c.z + VIEW.target[2] + VIEW.from[2])
    controls.update()
  }, [frame, controls, camera, lifecycle, world])

  useFrame((state, delta) => {
    lifecycle.advance(Math.min(delta, 0.1))
    if (lifecycle.residents.length !== count) setCount(lifecycle.residents.length)
    const t = state.clock.elapsedTime

    // The films: in flight, then fading where they settled.
    films.material.uniforms.uTime.value = t
    const seeds = films.geometry.attributes.aSeed
    const fades = films.geometry.attributes.aFade
    const softs = films.geometry.attributes.aSoft
    const ages = films.geometry.attributes.aAge
    const warms = films.geometry.attributes.aWarm
    const W = WARM.variants[lifecycle.warm]
    setWarm(films.material, !!W && W.film > 0)
    if (W) films.material.uniforms.uWarmGlow.value = W.glow
    const shown = lifecycle.films.filter((f) => f.state === 'flight' || (f.state === 'settled' && f.age - f.settledAt < FADE_OUT)).slice(-FILMS)
    for (let i = 0; i < FILMS; i++) {
      const f = shown[i]
      if (!f) {
        films.setMatrixAt(i, tmp.m.makeScale(0, 0, 0))
        fades.setX(i, 0)
        warms.setX(i, 0)
        continue
      }
      // Lying along the air that carries it, tilted up from flat.
      tmp.x.set(f.v[0], f.v[1] * 0.5, f.v[2])
      if (tmp.x.lengthSq() < 1e-10) tmp.x.set(1, 0, 0)
      tmp.x.normalize()
      tmp.z.copy(tmp.up).addScaledVector(tmp.x, -tmp.x.dot(tmp.up)).normalize()
      tmp.y.crossVectors(tmp.z, tmp.x)
      const settling = f.state === 'settled' ? Math.max(0, 1 - (f.age - f.settledAt) / FADE_OUT) : 1
      // Coming to rest it lies flat.
      const roll = (0.9 * Math.sin(f.seed) + 0.35 * Math.sin(0.4 * t + f.seed)) * settling
      tmp.z.multiplyScalar(Math.cos(roll)).addScaledVector(tmp.y, Math.sin(roll))
      tmp.y.crossVectors(tmp.z, tmp.x)
      tmp.q.setFromRotationMatrix(tmp.m.makeBasis(tmp.x, tmp.y, tmp.z))
      const length = f.size * (0.6 + 0.4 * smoothstep(0, 3, f.age))
      tmp.p.set(f.p[0], f.p[1] + (f.state === 'settled' ? DEPOSIT_LIFT : 0), f.p[2])
      const dist = tmp.p.distanceTo(camera.position)
      const fade = smoothstep(0, 1, f.age) * settling * smoothstep(1.2, 2.4, dist) * (1 - smoothstep(18, 30, dist))
      seeds.setX(i, f.seed)
      fades.setX(i, fade)
      softs.setX(i, smoothstep(0.05, 0.12, length / Math.max(dist, 1e-3)))
      ages.setX(i, Math.min(1, f.age / 20))
      // Warm just after it leaves its resident, and just after it settles
      // where the record keeps it (with feedback off, nothing is kept).
      const released = f.state === 'flight' ? recency(f.age, WARM.fade.release) : 0
      const landed = f.state === 'settled' && lifecycle.feedback ? recency(f.age - f.settledAt, WARM.fade.land) : 0
      warms.setX(i, W ? W.film * Math.max(released, landed) : 0)
      films.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(length)))
    }
    films.instanceMatrix.needsUpdate = true
    seeds.needsUpdate = true
    fades.needsUpdate = true
    softs.needsUpdate = true
    ages.needsUpdate = true
    warms.needsUpdate = true
  })

  const residents = lifecycle.residents.slice(0, count)
  return (
    <group>
      <Deposit lifecycle={lifecycle} world={world} waterLine={waterLine} accumulation={accumulation} visible={visible} />
      {lifecycle.conduit && <ConduitLayer lifecycle={lifecycle} world={world} visible={visible} />}
      {lifecycle.greybox && <ConduitGreybox lifecycle={lifecycle} world={world} visible={visible} />}
      {lifecycle.foldStudy && !lifecycle.greybox && (
        <ConduitFold
          lifecycle={lifecycle}
          world={world}
          meshes={meshes}
          waterLine={waterLine}
          openness={openness}
          accumulation={accumulation}
          visible={visible}
        />
      )}
      {residents.map((r) => (
        <Resident
          key={r.id}
          resident={r}
          lifecycle={lifecycle}
          world={world}
          meshes={meshes}
          growth={growth}
          waterLine={waterLine}
          openness={openness}
          accumulation={accumulation}
          visible={visible}
        />
      ))}
      <primitive object={films} renderOrder={6} />
    </group>
  )
}
