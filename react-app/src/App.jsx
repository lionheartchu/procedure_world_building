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
import LibraryPanel from './components/LibraryPanel'
import { buildCellGrid, createField, SHAPING_OPS } from './lib/field'
import { SedimentSim } from './lib/sediment'
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
  resolution: 160,
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

function App() {
  const appRef = useRef(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [simParams, setSimParams] = useState(DEFAULT_SIM)
  const [running, setRunning] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [view, setView] = useState('field')
  const [volumeParams, setVolumeParams] = useState(DEFAULT_VOLUME)
  const [volumeStats, setVolumeStats] = useState(null)
  const [shaderParams, setShaderParams] = useState(DEFAULT_SHADER)

  // Rebuilding the lattice is tens of milliseconds, so the slider stays live
  // and the mesh catches up a beat later instead of stuttering under the drag.
  const deferredVolume = useDeferredValue(volumeParams)

  // The height field is built once per parameter set here and handed to every
  // consumer, so terrain, map and simulation can never drift apart.
  const field = useMemo(
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

  /** Everything the Library needs to reproduce this screen. */
  const getState = useCallback(
    () => ({ view, params, simParams, volumeParams }),
    [view, params, simParams, volumeParams],
  )

  /**
   * Restore a saved configuration. Merged over the defaults so a configuration
   * saved by an older build cannot leave a control undefined.
   */
  const applyState = useCallback((config) => {
    if (['field', 'volume', 'shaders'].includes(config.view)) setView(config.view)
    if (config.params) setParams({ ...DEFAULT_PARAMS, ...config.params })
    if (config.simParams) setSimParams({ ...DEFAULT_SIM, ...config.simParams })
    if (config.volumeParams) setVolumeParams({ ...DEFAULT_VOLUME, ...config.volumeParams })
    setRunning(false)
  }, [])

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
        // Field and Shaders share one scene, so the terrain, the camera and
        // the simulation are literally the same object in both.
        <Scene
          field={field}
          params={params}
          sim={sim}
          simParams={simParams}
          running={running}
          wireframe={wireframe}
          eventSource={appRef}
          onCapture={registerCapture}
          shader={view === 'shaders' ? shader : null}
        />
      )}

      <header className="app-header">
        <h1 className="brand">Residual Ecology</h1>
        <ViewTabs value={view} onChange={setView} />
      </header>

      <LibraryPanel
        getState={getState}
        captureThumbnail={captureThumbnail}
        onLoad={applyState}
      />

      {view === 'volume' ? (
        <VolumePanel
          params={volumeParams}
          onChange={handleVolumeChange}
          stats={volumeStats}
          wireframe={wireframe}
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
