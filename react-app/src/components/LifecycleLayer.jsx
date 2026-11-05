import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildBlooms, FormWriter } from '../lib/traceForms'
import { createFormMaterial, setAccumulation } from '../lib/formMaterial'
import { LIFECYCLE, RECENT, recentAt } from '../lib/lifecycle'
import { airWaves } from '../lib/air'
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

/** A film's matter that shows as a full load (`carriers`): about what one film of a 0.7 resident carries. */
const FULL_LOAD = 0.07

/**
 * A carrier's wake (`carriers`): a few motes of its matter left along its
 * path as it flies, sinking and fading. Display only: the simulation's
 * matter stays in the film until it settles. It marks where matter is going
 * where the film itself, thin and screened, is lost against pale ground.
 */
const WAKE = { per: 22, every: 0.3, life: 6, sink: 0.025, size: 0.028, color: '#EEE6F6' }

/** Where carriers fade near the camera (units): the overview's distances, or (first person) close. */
const NEAR = { overview: [1.2, 2.4], carriers: [0.35, 0.9] }

function createWake() {
  const n = FILMS * WAKE.per
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(n).fill(1e3), 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aLoad', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage))
  const material = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uColor: { value: new THREE.Color(WAKE.color) }, uSize: { value: WAKE.size }, uLife: { value: WAKE.life }, uScale: { value: 400 } },
    ]),
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute float aLoad;
      uniform float uSize;
      uniform float uLife;
      uniform float uScale;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float k = clamp(aAge / uLife, 0.0, 1.0);
        vAlpha = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.4, aAge) * (0.35 + 0.65 * aLoad) * smoothstep(0.3, 0.8, -mvPosition.z);
        gl_PointSize = uSize * (0.7 + 0.5 * aLoad) * uScale / max(-mvPosition.z, 0.1);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a * 0.8);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.name = 'lifecycle-wake'
  return points
}

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
 * D1 (`legible`): the residue drawn to be seen from eye height. One
 * resident's films leave a few thousandths in a cell, which at `full` 0.008
 * and a blur of two cells read as a faint haze on the skin around it; here a
 * lighter blur keeps its shape and it shows fully at half as much. The
 * residual itself is the same.
 */
const DEPOSIT_LEGIBLE = { blur: 1, full: 0.004 }

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
    // The Habitat's D1: the whole passage at once, each cue only where and
    // while the simulation records matter crossing — a film coming away
    // (and in its first seconds in the air), a fresh deposit's edge, the
    // skin as it is drawn out (A), the new resident as it takes it in (B),
    // and an old contour giving part of itself.
    6: { ...NONE, name: 'D1 passage', tint: '#EBDBB6', film: 0.5, left: 0.55, edge: 0.6, give: 0.35, glow: 0.03, absorb: [1.1, 0.2, 0.1, 1.0], grow: { strength: 0.75, reach: [0.08, 0.32], glow: 0.18, density: 0.05 } },
  },
}

/**
 * The Habitat's D1 (`legible`): a resident bent by the air its films ride.
 * The air's horizontal velocity at its crest, on the simulation's clock, as
 * a displacement there (units per unit of air speed), eased over `ease` s
 * (a sheet has some weight). How far it gives is its state: fuller and
 * standing, it holds; half-formed, or lying down, it gives more; ended, it
 * lies on the ground and does not move.
 */
const WIND = { gain: 1.0, ease: 1.5, give: { forming: 1.25, holding: 1, receding: 0.8, releasing: 0.55 } }

/** D1: a film's mark on the resident it left, as wide as this share of its height, and how long it takes to come away (s). */
const MARK = { radius: 0.24, away: 2.5 }

/**
 * M1 (a lifecycle with a commons, lib/morph.js): the cue a resident has
 * gathered, as a cool stain in its film (`full` gathered shows at `most`),
 * the air study's ice-lilac. A signal, drawn apart from matter's champagne.
 */
const STAIN = { full: 0.012, most: 0.5, color: [0.74, 0.8, 1.0] }

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

/**
 * As `blur`, inside a window of the grid only ([i0, i1, j0, j1], inclusive),
 * reading the cells around it; the rest of `out` is left as it was. `tmp` is
 * the caller's (as long as the grid).
 */
function blurWindow(src, out, res, radius, [i0, i1, j0, j1], tmp) {
  const ja = Math.max(0, j0 - radius)
  const jb = Math.min(res - 1, j1 + radius)
  for (let j = ja; j <= jb; j++) {
    for (let i = i0; i <= i1; i++) {
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
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
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
function Resident({ resident: r, lifecycle, world, meshes, growth, waterLine, openness, accumulation, visible, legible = false }) {
  const shared = !!lifecycle.commons
  const materials = useMemo(
    () => meshes.map((m) => warmUniforms(createFormMaterial({ ...m, ...(legible ? { wind: true, release: true } : null), ...(shared ? { stain: true } : null) }))),
    [meshes, legible, shared],
  )
  // D1: where its films came away (as it stood), and the air bending it now.
  const marks = useRef({ list: [] })
  const bend = useRef(new THREE.Vector3())
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

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const ended = r.stage === 'ended'
    if (legible) {
      const d = r.desc
      // Where its films came away (the simulation's record of each release):
      // its place across the sheet, and its height on the resident as it
      // stood, from how far it lay then.
      const m = marks.current
      const left = r.left ?? []
      while (m.list.length < Math.min(4, left.length)) {
        const e = left[m.list.length]
        const k = Math.min(1, Math.max(0, (e.height - 0.1) / Math.max(d.height * (1 - e.recline), 1e-3)))
        m.list.push([e.along, d.height * k, MARK.radius * d.height, e.t])
      }
      // The air at its crest, on the simulation's own clock.
      const target = tmp.x.set(0, 0, 0)
      const give = WIND.give[r.stage] ?? 0
      if (give > 0) {
        const air = typeof lifecycle.air === 'function' ? lifecycle.air() : lifecycle.air.current
        const w = airWaves(d.p[0], d.p[1] + d.height * 0.8, d.p[2], lifecycle.t, air)
        const full = r.need > 0 ? Math.min(1, r.taken / r.need) : 1
        const k = WIND.gain * give * (1.4 - 0.4 * full) * (1 - r.recline) * r.unfold
        target.set(w.vx * k, 0, w.vz * k)
      }
      // M1: turned toward a neighbour's release (the simulation's `reach`), as far as it stands.
      if (r.reach && r.stage !== 'ended') {
        const turn = d.height * (1 - r.recline) * r.unfold
        target.x += r.reach[0] * turn
        target.z += r.reach[1] * turn
      }
      bend.current.lerp(target, Math.min(1, Math.min(delta, 0.1) / WIND.ease))
    }
    // Releasing, it thins as its films leave; ended, its contour is as
    // present as the matter it still holds, and never less than a trace.
    // D1 (`legible`): as present as the matter its body holds now, against
    // a full body for its height — faint as it begins to form, filling as it
    // takes matter up, a little denser than the colony's placed veils when
    // full, thinner as its films leave, and as an old contour, as much as
    // it still holds.
    const full = LIFECYCLE.bodyPerHeight * r.desc.height
    const presence = legible
      ? ended
        ? 0.2 + 0.75 * (r.contour / full)
        : 0.3 + 0.85 * Math.min(1.1, r.body / full)
      : ended
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
      if (u.uWind) u.uWind.value.set(bend.current.x, 0, bend.current.z, r.desc.height)
      if (u.uStain) u.uStain.value.set(...STAIN.color, ended ? 0 : STAIN.most * Math.min(1, Math.sqrt((r.dose ?? 0) / STAIN.full)))
      if (u.uLeft) {
        const list = marks.current.list
        for (let k = 0; k < 4; k++) {
          const e = list[k]
          if (e) u.uLeft.value[k].set(e[0], e[1], e[2], smoothstep(0, MARK.away, lifecycle.t - e[3]))
          else u.uLeft.value[k].set(0, 0, 1, 0)
        }
        u.uAcross.value.set(-Math.sin(r.desc.lean), Math.cos(r.desc.lean))
      }
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
function Deposit({ lifecycle, world, waterLine, accumulation, visible, cull = false, light = null, legible = false }) {
  const LOOK = legible ? { ...DEPOSIT_LOOK, ...DEPOSIT_LEGIBLE } : DEPOSIT_LOOK
  // D1 (`light`): the residue lit as the ground it lies on is (its own entry, else the colony skin's).
  const material = useMemo(() => warmUniforms(createFormMaterial({ kind: 'tissue', tint: DEPOSIT_LOOK.tint, light: light && { tissue: light.deposit ?? light.tissue } })), [light])
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
  // Culled (the Habitat's D, where each grid spans the whole wider world):
  // the display's work only over the cells this deposit reads, with room
  // for its blurs, so its result there is the same. `scratch` for blurWindow.
  const win = useMemo(() => {
    if (!cull) return null
    const res = lifecycle.res
    let u0 = 1
    let u1 = 0
    let v0 = 1
    let v1 = 0
    for (const [u, v] of uvs) {
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const M = 8
    const at = (t, edge) => Math.max(0, Math.min(res - 1, Math.floor(t * res) + edge))
    return [at(u0, -M), at(u1, M), at(v0, -M), at(v1, M)]
  }, [cull, uvs, lifecycle])
  const scratch = useMemo(() => (cull ? new Float32Array(lifecycle.residual.length) : null), [cull, lifecycle])
  const blurShown = (src, out, radius) => (win ? blurWindow(src, out, lifecycle.res, radius, win, scratch) : blur(src, out, lifecycle.res, radius))
  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )
  const seen = useRef(-1)
  // Culled only: whether anything has settled here yet.
  const [empty, setEmpty] = useState(true)

  useFrame((state) => {
    if (lifecycle.version !== seen.current) {
      seen.current = lifecycle.version
      blurShown(lifecycle.residual, shown, LOOK.blur)
      const look = geometry.attributes.aLook
      const F = LOOK.full
      for (let k = 0; k < uvs.length; k++) {
        const r = sample(shown, lifecycle.res, uvs[k][0], uvs[k][1])
        // The tissue material reads (thickness, vein light, presence, crust).
        const fold = smoothstep(F * 0.04, F * 0.15, r) * (1 - smoothstep(F * 0.15, F * 0.45, r))
        look.setXYZW(k, smoothstep(0, F, r), 0.35 * fold, smoothstep(F * 0.04, F * 0.5, r), 0.9 * smoothstep(F * 0.3, F * 1.5, r))
      }
      look.needsUpdate = true
      // Culled (a world of many lifecycles: the Habitat's D): nothing is drawn
      // until something has settled here.
      if (cull) {
        let any = false
        for (let k = 0; k < uvs.length && !any; k++) any = look.getX(k) > 0.002
        if (any === empty) setEmpty(!any)
      }
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
      const res = lifecycle.res
      const [i0, i1, j0, j1] = win ?? [0, res - 1, 0, res - 1]
      for (let c0 = j0 * res + i0, j = j0; j <= j1; j++, c0 += res) for (let c = c0; c <= c0 + i1 - i0; c++) {
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
        blurShown(warmth.arrived, warmth.arrivedShown, LOOK.blur)
        // A keeps close to the cells it is drawn from: two light passes, so
        // the cells' grid does not show.
        if (W.absorb) {
          blurShown(warmth.drawn, warmth.soft, 1)
          blurShown(warmth.soft, warmth.drawnShown, 1)
        } else blurShown(warmth.drawn, warmth.drawnShown, LOOK.blur)
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

  // Culled (a world of many lifecycles: the Habitat's D): off screen, or
  // before anything has settled, it is not drawn.
  if (cull) return <mesh geometry={geometry} material={material} visible={visible && !empty} />
  return <mesh geometry={geometry} material={material} visible={visible} frustumCulled={false} />
}

/**
 * `carriers` (the Habitat): the films show the matter they carry as grains
 * (AirFragments' CARRIER), so they read apart from the air's own particles.
 */
export default function LifecycleLayer({ lifecycle, world, meshes, growth, waterLine, openness, accumulation, visible, frame = true, carriers = false, cull = false, legible = false, light = null }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const wake = useMemo(() => (carriers ? { points: createWake(), next: new Map(), slot: new Map(), cursor: 0 } : null), [carriers])
  useEffect(
    () => () => {
      wake?.points.geometry.dispose()
      wake?.points.material.dispose()
    },
    [wake],
  )
  const size = useThree((s) => s.size)
  const films = useMemo(() => {
    const mesh = createFilmMesh(FILMS, { carrier: carriers, over: legible })
    mesh.name = 'lifecycle-films'
    warmUniforms(mesh.material)
    const warm = new THREE.InstancedBufferAttribute(new Float32Array(FILMS), 1)
    warm.setUsage(THREE.DynamicDrawUsage)
    mesh.geometry.setAttribute('aWarm', warm)
    return mesh
  }, [carriers, legible])
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
    const loads = films.geometry.attributes.aLoad
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
        loads?.setX(i, 0)
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
      const [near0, near1] = carriers ? NEAR.carriers : NEAR.overview
      const fade = smoothstep(0, 1, f.age) * settling * smoothstep(near0, near1, dist) * (1 - smoothstep(18, 30, dist))
      seeds.setX(i, f.seed)
      fades.setX(i, fade)
      softs.setX(i, smoothstep(0.05, 0.12, length / Math.max(dist, 1e-3)))
      ages.setX(i, Math.min(1, f.age / 20))
      // Warm just after it leaves its resident, and just after it settles
      // where the record keeps it (with feedback off, nothing is kept).
      const released = f.state === 'flight' ? recency(f.age, WARM.fade.release) : 0
      const landed = f.state === 'settled' && lifecycle.feedback ? recency(f.age - f.settledAt, WARM.fade.land) : 0
      warms.setX(i, W ? W.film * Math.max(released, landed) : 0)
      loads?.setX(i, Math.min(1, f.matter / FULL_LOAD))
      films.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(length)))
    }
    films.instanceMatrix.needsUpdate = true
    seeds.needsUpdate = true
    fades.needsUpdate = true
    softs.needsUpdate = true
    ages.needsUpdate = true
    warms.needsUpdate = true
    if (loads) loads.needsUpdate = true

    // The carriers' wakes: a mote of each one's matter left where it is, now
    // and then, while it flies (on the simulation's clock, so a paused or
    // faster lifecycle leaves them as it moves).
    if (wake) {
      const pos = wake.points.geometry.attributes.position
      const age = wake.points.geometry.attributes.aAge
      const load = wake.points.geometry.attributes.aLoad
      const dt = Math.min(delta, 0.1) * (lifecycle.paused ? 0 : lifecycle.speed)
      const n = age.count
      for (let k = 0; k < n; k++) {
        const a = age.getX(k) + dt
        age.setX(k, a)
        if (a < WAKE.life) pos.setY(k, pos.getY(k) - WAKE.sink * dt)
      }
      for (const f of lifecycle.films) {
        if (f.state !== 'flight') continue
        const due = wake.next.get(f.id) ?? f.age
        if (f.age < due) continue
        wake.next.set(f.id, f.age + WAKE.every)
        const k = wake.cursor
        wake.cursor = (wake.cursor + 1) % n
        pos.setXYZ(k, f.p[0] + (Math.sin(f.seed + f.age * 7.1) * 0.03), f.p[1] - 0.02, f.p[2] + (Math.cos(f.seed * 1.3 + f.age * 5.3) * 0.03))
        age.setX(k, 0)
        load.setX(k, Math.min(1, f.matter / FULL_LOAD))
      }
      pos.needsUpdate = true
      age.needsUpdate = true
      load.needsUpdate = true
      // Pixels per unit at unit distance, so a mote is its size in the world.
      wake.points.material.uniforms.uScale.value = (size.height * 0.5 * state.viewport.dpr) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    }
  })

  const residents = lifecycle.residents.slice(0, count)
  return (
    <group>
      <Deposit lifecycle={lifecycle} world={world} waterLine={waterLine} accumulation={accumulation} visible={visible} cull={cull} light={light} legible={legible} />
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
          legible={legible}
        />
      ))}
      <primitive object={films} renderOrder={6} />
      {wake && <primitive object={wake.points} renderOrder={6} />}
    </group>
  )
}
