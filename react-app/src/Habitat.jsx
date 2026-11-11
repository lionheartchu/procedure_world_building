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
import { Membrane, ResidentEncounter, tensionOf } from './lib/encounter'
import { FEATURED, LOOKS, SPACES, withLook } from './lib/habitat'
import { composeSpace } from './lib/habitatCompose'
import { arriveAt } from './lib/habitatSpaces'
import { prerun } from './lib/habitatWorld'
import { Commons, prerunTogether } from './lib/morph'
import MorphAir from './components/MorphAir'
import PerceptionInspector, { createPerceptionStore, PerceptionProbe } from './components/PerceptionInspector'
import { Noticing } from './lib/notice'
import { softLink, usePath } from './lib/route'
import './App.css'
import './Habitat.css'

/**
 * The Habitat, v0 (`/habitat/v0`; docs/12-habitat-v0.md): Explore's world as a
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
function Diagnostics({ lifecycles, membrane, composed, ground, commons, encounter, notice }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const clock = useThree((s) => s.clock)
  useEffect(() => {
    window.__habitat = { gl, scene, camera, clock, lifecycles, membrane, composed, ground, commons, encounter, notice }
    return () => {
      delete window.__habitat
    }
  }, [gl, scene, camera, clock, lifecycles, membrane, composed, ground, commons, encounter, notice])
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

/**
 * M3E: the resident encounter, once a frame: which resident is met (from
 * where the visitor is), how taut it is now (its matter and stage), and its
 * spring. It reads the lifecycle; nothing here writes to it.
 */
function ResidentEncounterDriver({ encounter, lifecycles }) {
  const camera = useThree((s) => s.camera)
  useFrame((_, delta) => {
    encounter.choose(camera.position.toArray(), lifecycles)
    const r = encounter.resident
    encounter.respond(r ? tensionOf(r, LIFECYCLE.bodyPerHeight, LIFECYCLE.lies) : 0)
    encounter.update(Math.min(delta, 0.1))
  })
  return null
}

/** M3N: the residents noticing the visitor (lib/notice.js), each frame, on the visitor's clock. */
function NoticeDriver({ notice, lifecycles }) {
  const camera = useThree((s) => s.camera)
  useFrame((_, delta) => notice.update(camera.position.toArray(), lifecycles, Math.min(delta, 0.1)))
  return null
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

/**
 * The way back to Explore: a small arrow in the corner, its label shown on
 * hover or focus, so the world stays clear. Under a pale sky (D's look and
 * after) it is drawn in a dark ink, since Explore's pale one would vanish
 * there. A study's title sits beneath it.
 */
function HabitatCorner({ title, pale }) {
  return (
    <div className={`habitat-corner${pale ? ' is-pale' : ''}`}>
      <a className="habitat-back" href="/" onClick={softLink('/')}>
        <span className="habitat-back-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M17.5 12H6.5M11 7.5 6.5 12l4.5 4.5" />
          </svg>
        </span>
        <span className="habitat-back-label">Back to Explore</span>
      </a>
      {title && <p className="habitat-title">{title}</p>}
    </div>
  )
}

/**
 * Which space the path asks for: `/habitat` the featured one (FEATURED),
 * `/habitat/<key>` each space by its key (`v0`, `a` … `m2`).
 */
const spaceKey = (path) => path.split('/')[2] || null
const spaceOf = (path) => SPACES[spaceKey(path)] ?? SPACES[FEATURED]

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
/** Study 23's development inspector (`?perceive=1`): what the resident nearest the visitor could read. */
const PERCEIVE = QUERY.get('perceive') === '1'
/** Study 23's experiment (`?respond=matter`, spaces with a commons only): the cue sets off a resident by its gathered cue weighed by its fullness, not only a full one (Lifecycle `respond`). */
const RESPOND = QUERY.get('respond') === 'matter' ? 'matter' : 'full'
const CANOPY_ASKED = QUERY.get('canopy')

/** C's canopy: the bloom film, quieter (see Formation). */
const CANOPY_LOOK = { tint: '#C9C8EE', gain: 1.0, edgeGlow: 0.16, specular: 0.08 }

export default function Habitat() {
  const root = useRef(null)
  const path = usePath()
  const base = spaceOf(path)
  // The look asked for in the URL, else the space's own (C1's foundation), else none.
  const H = useMemo(() => withLook(base, LOOKS[LOOK_ASKED] ?? LOOKS[base.lookKey] ?? null), [base])
  // The featured Habitat is the site's own, so it carries no study title.
  const title = spaceKey(path) ? H.title : null
  const paleSky = useMemo(() => new THREE.Color(H.render?.sky?.horizon ?? H.render?.background ?? '#000').getHSL({}).l > 0.5, [H])
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
        // M3: the slab's seam with the far ground sealed.
        ...(H.seal ? { seal: H.seal } : {}),
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
          ...(commons ? { commons, worldOffset: Math.round((patch.age ?? 0) / LIFECYCLE.step), respond: RESPOND } : {}),
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
  // M3E: the resident encounter, met as the veil is (a contact that yields).
  const residentEncounter = useMemo(() => (H.encounter ? new ResidentEncounter({ world }) : null), [H, world])
  const contacts = useMemo(() => [membrane, residentEncounter].filter(Boolean), [membrane, residentEncounter])
  const perception = useMemo(() => (PERCEIVE ? createPerceptionStore() : null), [])
  const noticing = useMemo(() => (H.notice ? new Noticing(H.living ? { frost: 0.35, cup: false, curl: false } : undefined) : null), [H])
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
      ...(H.cueAir === 'wisps' && commons ? { cue: commons, wispFollow: true, cueGlobal: !!H.cueGlobal } : {}),
    }),
    [H, scatter, commons],
  )
  const presenceAir = useMemo(() => ({ drift: H.air.drift, curl: H.air.curl, colony: H.air.colony }), [H])
  // M3L: a space may set where the visitor arrives (`arriveAt`: [x, z] and where they look).
  const arrival = useMemo(() => (H.arriveAt ? arriveAt(world, H.arriveAt.at[0], H.arriveAt.at[1], H.arriveAt.look) : composed.arrival), [H, world, composed])
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
          ageLook={!!H.residueAge}
          closeRange={!!H.closeRange}
          encounter={residentEncounter}
          kinFilms={!!H.kinFilms}
          notice={noticing}
          living={H.living ?? false}
          tendrils={H.tendrils ?? false}
          passage={!!H.passage}
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
        {residentEncounter && <ResidentEncounterDriver encounter={residentEncounter} lifecycles={lifecycles} />}
        {noticing && <NoticeDriver notice={noticing} lifecycles={lifecycles} />}
        {perception && <PerceptionProbe store={perception} lifecycles={lifecycles} accumulation={accumulation} encounter={residentEncounter} />}
        <PresenceCamera world={world} scatter={scatter} lifecycle={null} air={presenceAir} inside arrival={arrival} withhold={metApart} contacts={contacts} forms={forms} smooth={(MOTION ?? H.motion) === 'smooth'} bound={H.bound} nearAir={size > FIELD_SIZE} unstick={!!H.unstick} />
        <Diagnostics lifecycles={lifecycles} membrane={membrane} composed={composed} ground={ground} commons={commons} encounter={residentEncounter} notice={noticing} />
      </Scene>

      <HabitatCorner title={title} pale={paleSky} />
      {perception && <PerceptionInspector store={perception} />}
      <p className={`habitat-keys${hint ? '' : ' is-quiet'}`}>Drag to look · W A S D or arrows to drift · Q E lower, rise · Shift faster · scroll to edge closer</p>
    </div>
  )
}
