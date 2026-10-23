import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Scene from './components/Scene'
import SidePanel from './components/SidePanel'
import VolumeScene from './components/VolumeScene'
import VolumePanel from './components/VolumePanel'
import ViewTabs from './components/ViewTabs'
import ShaderPanel, { MODES } from './components/ShaderPanel'
import ScatterPanel from './components/ScatterPanel'
import ExplorePanel from './components/ExplorePanel'
import ScatterLayers from './components/ScatterLayers'
import BaseEdge from './components/BaseEdge'
import LibraryPanel from './components/LibraryPanel'
import { FIELD_SIZE } from './components/Terrain'
import { buildCellGrid, createField, SHAPING_OPS, withRelief } from './lib/field'
import { SedimentSim } from './lib/sediment'
import { buildWorldData, runHistory } from './lib/worldData'
import { placeScatter } from './lib/scatter'
import { buildAccumulation } from './lib/accumulation'
import { createAccumulationTexture } from './lib/formMaterial'
import { captureState, restoreState } from './lib/savedState'
import { navigate } from './lib/route'
import QuietNav from './components/QuietNav'
import { buildStreamWater, carveStreams, streamLines, streamMaterial, traceStreams } from './lib/streams'
import './App.css'

/**
 * Default state is tuned for the sediment-field character: one broad
 * low-frequency landform with a little grain on top, pushed down into basins
 * by the power op, with the tidal plane sitting at the field's midline so
 * roughly half of it floods.
 */
const DEFAULT_PARAMS = {
  landformScale: 1.5,
  detailScale: 6.4,
  detailAmount: 0.18,
  seed: 42,
  shaping: 'power',
  shapingAmount: SHAPING_OPS.power.slider.default,
  elevation: 2.7,
  waterLevel: 0.5,
  // Fine enough that a stream's channel spans a few vertices.
  resolution: 224,
}

const DEFAULT_SIM = {
  flow: 1.8,
  deposition: 0.25,
  supply: 0.022,
}

/**
 * The volume study opens already sectioned: the question it is asking is about
 * interior structure, so the interior should be the first thing visible.
 * Tuned toward a continuous, grown substrate — cohesion holds a parent mass,
 * consolidation and the debris threshold clear away anything too small to read,
 * and surface nets gives the softer surface that suits it.
 */
const DEFAULT_VOLUME = {
  resolution: 48,
  iso: 0,
  seed: 42,
  layers: 7,
  strata: 0.5,
  porosity: 0.5,
  channelRadius: 0.62,
  cavity: 0.7,
  cut: 0.26,
  cohesion: 0.72,
  consolidation: 0.4,
  debris: 0.5,
  method: 'surfaceNets',
  scaffold: 0.75,
  scaffoldNodes: 5,
  scaffoldLoops: 0.6,
  scaffoldClearance: 0.4,
  scaffoldCurve: 0.5,
}

/**
 * The shader study reads the same terrain as the Field view; only the material
 * mode and a couple of its inputs change.
 */
const DEFAULT_SHADER = {
  mode: 'geological',
  heightInfluence: 1,
  strata: 0.45,
  activity: 0.7,
  pulse: 0.5,
  fresnel: 0.7,
  membrane: 0.5,
  water: 0.6,
  caustics: 0.5,
}

/**
 * The scatter study populates the same world with trace-grown forms. Only
 * design controls live here; slope limits, shore bands, thresholds and the
 * colony's quiet share are protocol, fixed in lib/scatter.js.
 *
 * `view` is the one selector: the whole colony, or one language solo — in
 * the scene, in the plan map and in the panel at once.
 */
const DEFAULT_SCATTER = {
  view: 'all',
  history: 40,
  seed: 7,
  growth: 1,
  bridgeAmount: 0.6,
  bridgeReach: 5.5,
  bloomAmount: 0.5,
  bloomOpenness: 0.5,
  shardAmount: 0.5,
  shardAccumulation: 0.5,
  // Water veins (assignment 2): part of the shared world, set from here.
  streams: 2,
  streamFlow: 0.5,
  // The air (assignment 3): the scene's ambient particles. Rework phases
  // 1–4: the base atmosphere (dust), residue in moving air (wisps), the
  // colonies' local air, and the basin haze.
  airDensity: 0.6,
  airDrift: 0.5,
  airCurl: 0.5,
  airWisps: 0.5,
  airWispStrength: 0.5,
  airColony: 0.6,
  airHaze: 0.5,
  // Explore's Water appearance: how clearly the submerged ground reads.
  // Presentation only, and only in Explore; 0 is the water as it was.
  underwater: 0,
}

/** Scatter settings that trigger a recompute rather than a uniform change. */
const RECOMPUTE_KEYS = [
  'history',
  'seed',
  'bridgeAmount',
  'bridgeReach',
  'bloomAmount',
  'shardAmount',
  'shardAccumulation',
  'streams',
  'streamFlow',
]

/**
 * The colony stands on the shader study's Dormant reading, so the ground
 * shows the same record the rules read — held down so the forms carry the
 * light. At the shader study's own settings, forty seconds of history lit
 * the whole island.
 */
const SCATTER_GROUND = {
  ...DEFAULT_SHADER,
  mode: MODES.find((m) => m.id === 'dormant').value,
  // The base revision's shading: plateaus, shoulders and feet (Terrain.jsx).
  relief: 1,
  activity: 0.35,
  pulse: 0.12,
  // The basins hold water here as in every tab. At 0.5 (and with Dormant's
  // clearer veil) the water changed 15% of pixels against Field's 70%, and
  // the basins read as empty pits.
  water: 0.85,
  caustics: 0.35,
  // The cleaned palette (Terrain.jsx): deep cool shadows, a finer record,
  // water reflecting the scene's own sky.
  grade: 1,
}

/** Explore's staged changes, per state group (see handleExploreChange). */
const NO_DRAFT = { params: {}, simParams: {}, scatterParams: {} }
const hasDraft = (draft) => Object.values(draft).some((group) => Object.keys(group).length > 0)

function App() {
  const appRef = useRef(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [simParams, setSimParams] = useState(DEFAULT_SIM)
  const [running, setRunning] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  // Explore is the world as one place, and where the app opens; the studies
  // it grew from are one menu away, each unchanged.
  const [view, setView] = useState('explore')
  const [studiesOpen, setStudiesOpen] = useState(() => window.history.state?.studies === true)
  const [volumeParams, setVolumeParams] = useState(DEFAULT_VOLUME)
  const [volumeStats, setVolumeStats] = useState(null)
  const [shaderParams, setShaderParams] = useState(DEFAULT_SHADER)
  const [scatterParams, setScatterParams] = useState(DEFAULT_SCATTER)
  const [growing, setGrowing] = useState(false)

  // Rebuilding the lattice is tens of milliseconds, so the slider stays live
  // and the mesh catches up a beat later instead of stuttering under the drag.
  const deferredVolume = useDeferredValue(volumeParams)

  const deferredScatter = useDeferredValue(scatterParams)

  // The world. One field, built once and handed to every tab — Field,
  // Shaders and Scatter render the same ground, run the same sediment, and
  // place colonies on it — so they can never drift apart:
  //
  //   base field (noise + shaping)  →  relief  →  water veins carved in
  //
  // The base field alone is what studies 01–04 were made on; their documents
  // keep that history, the live app shows the world as it is now.
  const baseField = useMemo(
    () =>
      createField({
        seed: params.seed,
        landformScale: params.landformScale,
        detailScale: params.detailScale,
        detailAmount: params.detailAmount,
        shaping: params.shaping,
        shapingAmount: params.shapingAmount,
      }),
    [
      params.seed,
      params.landformScale,
      params.detailScale,
      params.detailAmount,
      params.shaping,
      params.shapingAmount,
    ],
  )
  const relieved = useMemo(
    () => withRelief(baseField, { waterLevel: params.waterLevel, seed: params.seed }),
    [baseField, params.waterLevel, params.seed],
  )
  // Water veins (assignment 2): terrain → spline (traced over the relieved
  // ground), then spline → terrain (carved into it). Streams belong to the
  // world, so they take the world's seed, not the colony's.
  const { streams: streamCount, streamFlow } = deferredScatter
  const streams = useMemo(
    () =>
      traceStreams(relieved, {
        size: FIELD_SIZE,
        elevation: params.elevation,
        waterLevel: params.waterLevel,
        count: streamCount,
        flow: streamFlow,
        seed: params.seed,
      }),
    [relieved, params.elevation, params.waterLevel, streamCount, streamFlow, params.seed],
  )
  const field = useMemo(() => carveStreams(relieved, streams), [relieved, streams])
  // What the terrain draws for them: the damp/deposit grid for its shader,
  // and the water lying in each channel.
  const streamLook = useMemo(
    () => ({ material: streamMaterial(streams), water: buildStreamWater(streams, field), lines: streamLines(streams), stats: streams.stats }),
    [streams, field],
  )
  // The ground at the slab's edge, for the misty edge every tab shows.
  const edgeGround = useMemo(
    () => ({
      size: FIELD_SIZE,
      toUV: (x, z) => [x / FIELD_SIZE + 0.5, z / FIELD_SIZE + 0.5],
      groundY: (u, v) => (field.sample(u, v) - 0.5) * params.elevation,
      waterY: (params.waterLevel - 0.5) * params.elevation,
    }),
    [field, params.elevation, params.waterLevel],
  )

  const sim = useMemo(() => new SedimentSim(), [])

  // A new landform is a new world: the simulation restarts on top of it.
  useEffect(() => {
    sim.setHeight(buildCellGrid(field, sim.res))
  }, [sim, field])

  const handleChange = useCallback((key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSimChange = useCallback((key, value) => {
    setSimParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleReset = useCallback(() => {
    sim.reset()
  }, [sim])

  const handleVolumeChange = useCallback((key, value) => {
    setVolumeParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleShaderChange = useCallback((key, value) => {
    setShaderParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleScatterChange = useCallback((key, value) => {
    // Taking hold of the growth slider stops a running Grow.
    if (key === 'growth') setGrowing(false)
    setScatterParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleGrowth = useCallback((value) => {
    setScatterParams((prev) => ({ ...prev, growth: value }))
  }, [])

  const handleGrowthEnd = useCallback(() => setGrowing(false), [])
  const handleGrow = useCallback(() => setGrowing((value) => !value), [])

  // --- Explore: changes that regenerate the world apply on release --------
  //
  // Explore writes the same state the studies do. Controls that only move
  // uniforms (growth, openness, the air) act live. Controls that regenerate
  // the world — anything in params or simParams, and the scatter keys in
  // RECOMPUTE_KEYS — are staged while a hand is on them (the panel shows the
  // staged value, the world keeps the last applied one) and applied together
  // when it lets go, in one update. Every stage of the world is derived from
  // that one applied state in the same render, so the scene can show the old
  // world or the new one, never a mixture. The studies keep their own
  // behaviour: their panels write directly, as before.
  const [draft, setDraft] = useState(NO_DRAFT)
  const draftRef = useRef(NO_DRAFT)
  const [regenerating, setRegenerating] = useState(false)
  const commitTimer = useRef(null)

  const applyDraft = useCallback(() => {
    const staged = draftRef.current
    draftRef.current = NO_DRAFT
    if (Object.keys(staged.params).length) setParams((prev) => ({ ...prev, ...staged.params }))
    if (Object.keys(staged.simParams).length) setSimParams((prev) => ({ ...prev, ...staged.simParams }))
    if (Object.keys(staged.scatterParams).length) setScatterParams((prev) => ({ ...prev, ...staged.scatterParams }))
    setDraft(NO_DRAFT)
    setRegenerating(false)
  }, [])

  const handleExploreChange = useCallback(
    (group, key, value) => {
      if (group === 'scatterParams' && !RECOMPUTE_KEYS.includes(key)) {
        handleScatterChange(key, value)
        return
      }
      draftRef.current = { ...draftRef.current, [group]: { ...draftRef.current[group], [key]: value } }
      setDraft(draftRef.current)
    },
    [handleScatterChange],
  )

  const handleExploreCommit = useCallback(() => {
    if (!hasDraft(draftRef.current) || commitTimer.current) return
    // Show "Regenerating" first: the rebuild itself holds the thread.
    setRegenerating(true)
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null
      applyDraft()
    }, 30)
  }, [applyDraft])

  const handleViewChange = useCallback(
    (next) => {
      // Nothing staged in Explore is left behind when leaving it.
      if (commitTimer.current) {
        clearTimeout(commitTimer.current)
        commitTimer.current = null
      }
      if (hasDraft(draftRef.current)) applyDraft()
      setView(next)
      if (next === 'explore') setStudiesOpen(false)
    },
    [applyDraft],
  )
  useEffect(() => () => clearTimeout(commitTimer.current), [])

  // --- scatter study ------------------------------------------------------
  //
  // Each stage is memoised on exactly what it reads, so a slider only redoes
  // the work downstream of it: the history (~100 ms per 40 s) only when the
  // landform, water or sediment settings change; the world data when the
  // colony seed changes; placement (~15 ms) for a rule change; and growth,
  // glow, openness and visibility never leave the GPU.
  // Explore and the Scatter study show the same complete world, built once.
  const exploring = view === 'explore'
  const scattering = view === 'scatter' || exploring
  const history = useMemo(
    () => (scattering ? runHistory(field, simParams, params.waterLevel, deferredScatter.history) : null),
    [scattering, field, simParams, params.waterLevel, deferredScatter.history],
  )
  const world = useMemo(
    () =>
      history
        ? buildWorldData({
            field,
            size: FIELD_SIZE,
            elevation: params.elevation,
            waterLevel: params.waterLevel,
            history,
            seed: deferredScatter.seed,
          })
        : null,
    [history, field, params.elevation, params.waterLevel, deferredScatter.seed],
  )
  const { seed: scatterSeed, bridgeAmount, bridgeReach, bloomAmount, shardAmount, shardAccumulation } =
    deferredScatter
  const scatter = useMemo(
    () =>
      world
        ? placeScatter(world, {
            seed: scatterSeed,
            bridgeAmount,
            bridgeReach,
            bloomAmount,
            shardAmount,
            shardAccumulation,
            streams: streamLook.lines,
          })
        : null,
    [world, scatterSeed, bridgeAmount, bridgeReach, bloomAmount, shardAmount, shardAccumulation, streamLook],
  )

  // The light held in what the colonies gathered: one grid, read by the
  // ground, the colony tissue and the forms alike (lib/accumulation.js).
  const accumulation = useMemo(
    () => (world && scatter ? createAccumulationTexture(buildAccumulation(world, scatter)) : null),
    [world, scatter],
  )
  useEffect(() => () => accumulation?.texture.dispose(), [accumulation])
  // The air belongs to the whole scene, in every tab; colonies change it
  // locally where they exist (the Scatter view).
  const { airDensity, airDrift, airCurl, airWisps, airWispStrength, airColony, airHaze } = scatterParams
  const colonies = scattering ? scatter?.colonies : null
  const blooms = scattering ? scatter?.layers.bloom.instances : null
  const air = useMemo(
    () => ({
      density: airDensity,
      drift: airDrift,
      curl: airCurl,
      wisps: airWisps,
      wispStrength: airWispStrength,
      colony: airColony,
      colonies,
      blooms,
      haze: airHaze,
    }),
    [airDensity, airDrift, airCurl, airWisps, airWispStrength, airColony, colonies, blooms, airHaze],
  )

  // Explore stands on Scatter's ground, plus its one presentation control
  // for the water. The studies never see it.
  const { underwater } = scatterParams
  const exploreGround = useMemo(() => ({ ...SCATTER_GROUND, underwater }), [underwater])

  // The numeric mode the shader branches on, alongside its inputs.
  const shader = useMemo(
    () => ({
      ...shaderParams,
      mode: (MODES.find((m) => m.id === shaderParams.mode) ?? MODES[0]).value,
    }),
    [shaderParams],
  )

  // The active scene registers a frame-grab here so a saved configuration can
  // carry a thumbnail of what it looked like.
  const capture = useRef(null)
  const registerCapture = useCallback((grab) => {
    capture.current = grab
  }, [])
  const captureThumbnail = useCallback(() => capture.current?.() ?? null, [])

  /** Everything the Library needs to reproduce this screen (lib/savedState.js). */
  const getState = useCallback(
    () => captureState({ view, params, simParams, volumeParams, shaderParams, scatterParams }),
    [view, params, simParams, volumeParams, shaderParams, scatterParams],
  )

  /**
   * Restore a saved configuration. Each part is merged over the defaults so a
   * configuration saved by an older build cannot leave a control undefined;
   * saves from before Explore carry no shader settings and open their study.
   */
  const applyState = useCallback(
    (config) => {
      const restored = restoreState(config, {
        params: DEFAULT_PARAMS,
        simParams: DEFAULT_SIM,
        volumeParams: DEFAULT_VOLUME,
        shaderParams: DEFAULT_SHADER,
        scatterParams: DEFAULT_SCATTER,
      })
      if (restored.view) {
        handleViewChange(restored.view)
        if (restored.view !== 'explore') setStudiesOpen(true)
      }
      if (restored.params) setParams(restored.params)
      if (restored.simParams) setSimParams(restored.simParams)
      if (restored.volumeParams) setVolumeParams(restored.volumeParams)
      if (restored.shaderParams) setShaderParams(restored.shaderParams)
      if (restored.scatterParams) setScatterParams(restored.scatterParams)
      setRunning(false)
      setGrowing(false)
    },
    [handleViewChange],
  )

  // The colony's own structure (branching) grows from the same generation of
  // values the placement used — the deferred ones — never from a newer slider
  // value, so no frame shows one world's branching on another's colonies.
  // Explore always shows the whole colony; the study keeps its solo views.
  const layerParams = useMemo(
    () => ({
      ...scatterParams,
      seed: deferredScatter.seed,
      bridgeAmount: deferredScatter.bridgeAmount,
      shardAccumulation: deferredScatter.shardAccumulation,
      view: exploring ? 'all' : scatterParams.view,
    }),
    [scatterParams, deferredScatter.seed, deferredScatter.bridgeAmount, deferredScatter.shardAccumulation, exploring],
  )

  // Explore draws the terrain at the default grid: the colonies sit on the
  // exact field, and a coarse study grid would leave them floating or sunk.
  const sceneParams = useMemo(
    () => (exploring && params.resolution !== DEFAULT_PARAMS.resolution ? { ...params, resolution: DEFAULT_PARAMS.resolution } : params),
    [exploring, params],
  )

  // What Explore's panel shows: the applied state with anything staged on top.
  const exploreParams = useMemo(() => ({ ...params, ...draft.params }), [params, draft.params])
  const exploreSim = useMemo(() => ({ ...simParams, ...draft.simParams }), [simParams, draft.simParams])
  const exploreScatter = useMemo(() => ({ ...scatterParams, ...draft.scatterParams }), [scatterParams, draft.scatterParams])
  const scatterPending = RECOMPUTE_KEYS.some((key) => deferredScatter[key] !== scatterParams[key])

  // Dormant / Residual has nothing to show until the simulation has run, so
  // entering it starts the sediment. Leaving it — for another mode or for
  // another tab — always pauses, so nothing the Shaders tab started keeps
  // running in Field. Run / Pause still works by hand inside either.
  const dormant = view === 'shaders' && shaderParams.mode === 'dormant'
  const previous = useRef({ view, dormant })
  useEffect(() => {
    const was = previous.current
    previous.current = { view, dormant }
    if (dormant && !was.dormant) setRunning(true)
    else if (!dormant && was.dormant) setRunning(false)
    else if (view !== was.view && was.view === 'shaders') setRunning(false)
  }, [view, dormant])

  const openAtlas = (event) => {
    event.preventDefault()
    navigate('/atlas')
  }

  // W toggles wireframe on the terrain.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'w' && event.key !== 'W') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      setWireframe((value) => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app" ref={appRef}>
      {view === 'volume' ? (
        <VolumeScene
          params={deferredVolume}
          wireframe={wireframe}
          onStats={setVolumeStats}
          eventSource={appRef}
          onCapture={registerCapture}
        />
      ) : (
        // Field, Shaders and Scatter share one scene and one world: the same
        // field, mesh, water, streams and edge in all three. Scatter swaps in
        // the history simulation, so the ground shows the same record the
        // scatter rules read.
        <Scene
          field={field}
          params={sceneParams}
          streams={streamLook}
          air={air}
          sim={scattering && history ? history.sim : sim}
          simParams={simParams}
          running={scattering ? false : running}
          wireframe={wireframe}
          eventSource={appRef}
          onCapture={registerCapture}
          shader={view === 'shaders' ? shader : exploring ? exploreGround : scattering ? SCATTER_GROUND : null}
          accumulation={scattering ? accumulation : null}
        >
          <BaseEdge world={edgeGround} />
          {scattering && world && scatter && (
            <ScatterLayers
              world={world}
              scatter={scatter}
              accumulation={accumulation}
              streams={streamLook}
              params={layerParams}
              growing={growing}
              onGrowth={handleGrowth}
              onGrowthEnd={handleGrowthEnd}
            />
          )}
        </Scene>
      )}

      <header className="app-header">
        {/* Quiet over Explore's world; always shown in the studies, where the tabs are tools. */}
        <QuietNav always={!exploring || studiesOpen} label="Residual Ecology: menu">
          {/* The title, like the Atlas tab, opens the Atlas. */}
          <h1 className="brand">
            <a className="brand-link" href="/atlas" onClick={openAtlas}>
              Residual Ecology
            </a>
          </h1>
          <ViewTabs
            value={view}
            onChange={handleViewChange}
            studiesOpen={studiesOpen}
            onToggleStudies={() => setStudiesOpen((open) => !open)}
            onAtlas={openAtlas}
          />
        </QuietNav>
      </header>

      {/* Secondary: the Library appears with the studies, not in Explore's
          exhibition view. */}
      {(studiesOpen || !exploring) && (
        <LibraryPanel getState={getState} captureThumbnail={captureThumbnail} onLoad={applyState} />
      )}

      {exploring ? (
        <ExplorePanel
          params={exploreParams}
          simParams={exploreSim}
          scatterParams={exploreScatter}
          onChange={handleExploreChange}
          onCommit={handleExploreCommit}
          regenerating={regenerating || scatterPending}
          world={world}
          scatter={scatter}
          streams={streamLook}
          growing={growing}
          onGrow={handleGrow}
        />
      ) : view === 'volume' ? (
        <VolumePanel
          params={volumeParams}
          onChange={handleVolumeChange}
          stats={volumeStats}
          wireframe={wireframe}
        />
      ) : scattering ? (
        <ScatterPanel
          params={scatterParams}
          onChange={handleScatterChange}
          world={world}
          scatter={scatter}
          streams={streamLook}
          busy={scatterPending}
          growing={growing}
          onGrow={handleGrow}
        />
      ) : view === 'shaders' ? (
        <ShaderPanel
          params={shaderParams}
          onChange={handleShaderChange}
          running={running}
          onToggleRunning={() => setRunning((value) => !value)}
          onReset={handleReset}
        />
      ) : (
        <SidePanel
          field={field}
          params={params}
          onChange={handleChange}
          sim={sim}
          simParams={simParams}
          onSimChange={handleSimChange}
          running={running}
          onToggleRunning={() => setRunning((value) => !value)}
          onReset={handleReset}
          wireframe={wireframe}
        />
      )}
    </div>
  )
}

export default App
