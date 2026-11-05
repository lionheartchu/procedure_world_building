import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './components/Scene'
import ScatterLayers, { RESIDENT_MESHES } from './components/ScatterLayers'
import PresenceCamera from './components/PresenceCamera'
import EncounterVeil from './components/EncounterVeil'
import FarField from './components/FarField'
import { FIELD_SIZE } from './components/Terrain'
import { deriveWorld } from './lib/deriveWorld'
import { buildAccumulation } from './lib/accumulation'
import { createAccumulationTexture, createFormMaterial, setAccumulation } from './lib/formMaterial'
import { Lifecycle, LIFECYCLE } from './lib/lifecycle'
import { strayResidue } from './lib/scatter'
import { buildBlooms, FormWriter } from './lib/traceForms'
import { buildFarField } from './lib/farField'
import { Membrane } from './lib/encounter'
import { LOOKS, SPACES, withLook } from './lib/habitat'
import { composeSpace } from './lib/habitatCompose'
import { prerun } from './lib/habitatWorld'
import { Commons, prerunTogether } from './lib/morph'
import MorphAir from './components/MorphAir'
import { usePath } from './lib/route'
import './App.css'
import './Habitat.css'

/**
 * The Habitat, v0 (`/habitat`; docs/12-habitat-v0.md): Explore's world as a
 * place to be in. The same generation and the same ecological code, with
 * its own state: its world is derived once from a pinned configuration
 * (lib/habitat.js), and its lifecycles, encounter and presence are its own
 * objects, so nothing here touches Explore or is touched by it.
 *
 *   - autonomous: two lifecycle patches (colonies 0 and 3), each its own
 *     simulation, on their own clocks; the air
 *   - reactive: one membrane on the northern colony yields to the visitor
 *   - static: the landform, History's record, the colonies, the residue
 *     between them, and the far field
 */

/** Nothing to do with a thumbnail here. */
const noop = () => {}

/** For measurement only: `?dpr=2` renders at Explore's pixel ratio, to compare like with like. */
const DPR = typeof window !== 'undefined' ? Number(new URLSearchParams(window.location.search).get('dpr')) || null : null

/** Development diagnostics, like the lifecycle's own (`window.__habitat`). */
function Diagnostics({ lifecycles, membrane, composed, ground, commons }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const clock = useThree((s) => s.clock)
  useEffect(() => {
    window.__habitat = { gl, scene, camera, clock, lifecycles, membrane, composed, ground, commons }
    return () => {
      delete window.__habitat
    }
  }, [gl, scene, camera, clock, lifecycles, membrane, composed, ground, commons])
  return null
}

/**
 * A spatial study's formation (B's vessels, C's canopy): one sheet in the
 * bloom layer's film, drawn as its membranes are; `look` overrides the
 * film's own (C's canopy is quieter: less gain and rim, so its large
 * overlapping folds do not flare).
 */
function Formation({ geometry, formOptions, accumulation, openness, world, look = null }) {
  const material = useMemo(
    () => createFormMaterial({ ...RESIDENT_MESHES.find((m) => m.part === 'film'), ...look, ...formOptions }),
    [formOptions, look],
  )
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame((state) => {
    const u = material.uniforms
    const t = state.clock.elapsedTime
    u.uGrowth.value = 1
    u.uTime.value = t
    u.uWaterY.value = world.waterY + Math.sin(t * 0.125) * world.elevation * 0.012
    u.uGlow.value = 0.6
    u.uOpenness.value = openness * 1.6
    setAccumulation(u, accumulation)
  })
  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}

/** The visitor's place on the water, for the water's cue (Terrain `cue`): set each frame from the camera. */
function WaterCue({ cue, world }) {
  const camera = useThree((s) => s.camera)
  useFrame((_, delta) => {
    const { x, y, z } = camera.position
    const over = world.groundY(...world.toUV(x, z)) < world.waterY - 0.01 && Math.abs(x) < world.size / 2 && Math.abs(z) < world.size / 2
    const v = cue.value
    v.x = x
    v.y = z
    v.z = y - world.waterY
    v.w += ((over ? 1 : 0) - v.w) * Math.min(1, delta / 0.4)
  })
  return null
}

/** Which space the path asks for: `/habitat` (v0), `/habitat/a`, `/habitat/b`, `/habitat/c`, `/habitat/c1`, `/habitat/d`, `/habitat/d1`. */
const spaceOf = (path) => SPACES[path.split('/')[2]] ?? SPACES.v0

/**
 * How the visitor moves: the space's own (smooth in C; as before elsewhere),
 * or, to compare, `?motion=smooth` or `?motion=classic` on any of them.
 */
const QUERY = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
const MOTION = QUERY.get('motion')

/**
 * Visual comparisons (docs/15-habitat-c-visual.md), on any Habitat page:
 * `?look=soft` (LOOKS in lib/habitat.js) and `?canopy=0` (C's canopy
 * hidden: neither drawn nor met). Neither changes the world, its ecology or
 * where the visitor arrives.
 */
const LOOK_ASKED = QUERY.get('look')
const CANOPY_ASKED = QUERY.get('canopy')

/** C's canopy: the bloom film, quieter (see Formation). */
const CANOPY_LOOK = { tint: '#C9C8EE', gain: 1.0, edgeGlow: 0.16, specular: 0.08 }

export default function Habitat() {
  const root = useRef(null)
  const base = spaceOf(usePath())
  // The look asked for in the URL, else the space's own (C1's foundation), else none.
  const H = useMemo(() => withLook(base, LOOKS[LOOK_ASKED] ?? LOOKS[base.lookKey] ?? null), [base])
  const showCanopy = CANOPY_ASKED ? CANOPY_ASKED !== '0' : !base.hideCanopy
  // The water reflects the look's horizon (and in D its zenith, in its own water colours), if it has them.
  const ground = useMemo(() => {
    const g = { ...H.ground }
    for (const key of ['skyHorizon', 'skyZenith', 'waterShallow', 'waterDeep']) if (g[key]) g[key] = new THREE.Color(g[key])
    if (g.colours) g.colours = Object.fromEntries(Object.entries(g.colours).map(([k, v]) => [k, new THREE.Color(v)]))
    return g
  }, [H])
  // The slab's side: 26 units, or D's 48.
  const size = H.size ?? FIELD_SIZE

  // The world, once. (About half a second, on the main thread; D's about a second.)
  const derived = useMemo(() => deriveWorld({ params: H.params, simParams: H.simParams, scatter: H.scatter, size }), [H, size])
  const { world, scatter: placedScatter, history, field, streamLook, baseField } = derived
  // What the space places by its rule: thresholds or vessels, patches, encounter, arrival.
  const composed = useMemo(() => composeSpace(H, { world, scatter: placedScatter }), [H, world, placedScatter])
  const { scatter } = composed
  const waterCue = useMemo(() => (H.waterCue ? { value: new THREE.Vector4(0, 0, 9, 0) } : null), [H])
  // The light held in matter: the colonies' own (thresholds hold none).
  const accumulation = useMemo(() => createAccumulationTexture(buildAccumulation(world, placedScatter)), [world, placedScatter])
  useEffect(() => () => accumulation.texture.dispose(), [accumulation])
  const residue = useMemo(() => strayResidue(world, scatter, { ...H.scatter, streams: streamLook.lines }, H.residue ?? undefined), [world, scatter, streamLook, H])
  const far = useMemo(
    () =>
      buildFarField({
        baseField,
        world,
        elevation: H.params.elevation,
        resolution: H.params.resolution,
        ...(H.look?.far?.sink !== undefined ? { sink: H.look.far.sink, flatten: H.look.far.flatten } : {}),
        ...(H.farTerrain ? { fine: 3.5, field } : {}),
        ...(H.horizon ? { horizon: H.horizon, sink: H.horizon.sink, flatten: H.horizon.flatten } : {}),
      }),
    [baseField, world, H, field],
  )

  // The lifecycles: each its own simulation, begun with the page. In D each
  // has already lived its colony's age (composed.ages), run here before the
  // first frame, by its own rules and clock.
  const airNow = useRef({ drift: H.air.drift, curl: H.air.curl, colony: H.air.colony })
  const lifecycles = useMemo(() => {
    // M1: the commons the lifecycles share (lib/morph.js); none elsewhere.
    // Made here, with them, so a second build (React's StrictMode) has its own.
    const commons = H.morph ? new Commons({ world, air: airNow }) : null
    const lives = composed.patches.map((patch, k, all) => {
        const life = new Lifecycle({
          world,
          scatter,
          history,
          field,
          streams: streamLook.lines,
          simParams: H.simParams,
          air: airNow,
          feedback: true,
          seed: patch.seed,
          colony: patch.colony,
          ...(patch.holds ? { holds: patch.holds } : {}),
          airNear: size > FIELD_SIZE,
          ...(commons ? { commons, worldOffset: Math.round((patch.age ?? 0) / LIFECYCLE.step) } : {}),
        })
        life.setWarm(H.warm)
        if (patch.age && !commons) prerun(life, patch.age)
        // Many lifecycles (D): each a little ahead of the next within one
        // step (under 0.1 s), so their steps fall on different frames.
        if (size > FIELD_SIZE) life.acc = (k / all.length) * LIFECYCLE.step
        return life
      })
    // M1: run together before arrival, on one world clock, so one's cue can reach another.
    if (commons) prerunTogether(lives, composed.patches.map((p) => p.age ?? 0))
    return lives
  }, [world, scatter, history, field, streamLook, H, composed, size])
  const commons = lifecycles[0]?.commons ?? null

  // The encounter: its membrane, built as the bloom layer builds it.
  const veil = composed.encounter
  const veilGeometry = useMemo(() => (veil ? buildBlooms([veil], world, new FormWriter()) : null), [veil, world])
  const membrane = useMemo(() => {
    if (!veilGeometry) return null
    const positions = [veilGeometry.film, veilGeometry.solid].filter((g) => g?.attributes?.position).map((g) => g.attributes.position.array)
    return new Membrane({ positions, foot: veil.p[1], height: veil.height })
  }, [veil, veilGeometry])
  const contacts = useMemo(() => (membrane ? [membrane] : []), [membrane])
  const drawnApart = useMemo(() => (veil ? [veil] : []), [veil])
  const metApart = useMemo(() => [...drawnApart, ...lifecycles.flatMap((l) => l.first)], [drawnApart, lifecycles])

  const formOptions = useMemo(() => ({ nearFade: H.nearFade, ...H.look?.form }), [H])
  const layerParams = useMemo(() => ({ ...H.scatter }), [H])
  const air = useMemo(
    () => ({
      ...H.air,
      colonies: scatter.colonies,
      blooms: scatter.layers.bloom.instances,
      // M2: the cue drawn in the wisps, whose colony air follows the visitor.
      ...(H.cueAir === 'wisps' && commons ? { cue: commons, wispFollow: true } : {}),
    }),
    [H, scatter, commons],
  )
  const presenceAir = useMemo(() => ({ drift: H.air.drift, curl: H.air.curl, colony: H.air.colony }), [H])
  const arrival = composed.arrival
  const canopy = showCanopy ? composed.canopy : null
  const forms = useMemo(() => composed.vessels?.met ?? canopy?.met ?? [], [composed, canopy])

  // The keys, for a while after arriving.
  const [hint, setHint] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setHint(false), 16000)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className="app habitat" ref={root}>
      <Scene
        field={field}
        params={H.params}
        streams={streamLook}
        air={air}
        sim={history.sim}
        simParams={H.simParams}
        running={false}
        wireframe={false}
        eventSource={root}
        onCapture={noop}
        shader={ground}
        accumulation={accumulation}
        profile={DPR ? { ...H.render, dpr: DPR } : H.render}
        far={far.water}
        farGround={H.farTerrain ? far.ground : null}
        waterCue={waterCue}
        size={size}
      >
        {!H.farTerrain && <FarField ground={far.ground} waterY={world.waterY} elevation={world.elevation} palette={H.look?.far ?? null} />}
        <ScatterLayers
          world={world}
          scatter={scatter}
          accumulation={accumulation}
          streams={streamLook}
          params={layerParams}
          growing={false}
          onGrowth={noop}
          onGrowthEnd={noop}
          lifecycles={lifecycles}
          withhold={drawnApart}
          residue={residue}
          formOptions={formOptions}
          frame={false}
          carriers
          cullLives={size > FIELD_SIZE}
          legible={!!H.legible}
        />
        {composed.vessels?.film && (
          <Formation geometry={composed.vessels.film} formOptions={formOptions} accumulation={accumulation} openness={H.scatter.bloomOpenness} world={world} />
        )}
        {canopy?.film && (
          <Formation geometry={canopy.film} formOptions={formOptions} accumulation={accumulation} openness={H.scatter.bloomOpenness} world={world} look={CANOPY_LOOK} />
        )}
        {waterCue && <WaterCue cue={waterCue} world={world} />}
        {membrane && (
          <EncounterVeil
            membrane={membrane}
            geometry={veilGeometry}
            meshes={RESIDENT_MESHES}
            formOptions={formOptions}
            accumulation={accumulation}
            openness={H.scatter.bloomOpenness}
            world={world}
          />
        )}
        {commons && H.cueAir !== 'wisps' && <MorphAir commons={commons} />}
        <PresenceCamera world={world} scatter={scatter} lifecycle={null} air={presenceAir} inside arrival={arrival} withhold={metApart} contacts={contacts} forms={forms} smooth={(MOTION ?? H.motion) === 'smooth'} bound={H.bound} nearAir={size > FIELD_SIZE} />
        <Diagnostics lifecycles={lifecycles} membrane={membrane} composed={composed} ground={ground} commons={commons} />
      </Scene>

      {H.title && <p className="habitat-title">{H.title}</p>}
      <p className={`habitat-keys${hint ? '' : ' is-quiet'}`}>Drag to look · W A S D or arrows to drift · Q E lower, rise · Shift faster · scroll to edge closer</p>
    </div>
  )
}
