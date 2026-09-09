import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Scene from './components/Scene'
import SidePanel from './components/SidePanel'
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

function App() {
  const appRef = useRef(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [simParams, setSimParams] = useState(DEFAULT_SIM)
  const [running, setRunning] = useState(false)
  const [wireframe, setWireframe] = useState(false)

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
      <Scene
        field={field}
        params={params}
        sim={sim}
        simParams={simParams}
        running={running}
        wireframe={wireframe}
        eventSource={appRef}
      />

      <header className="app-header">
        <h1 className="brand">Sediment Field</h1>
      </header>

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
    </div>
  )
}

export default App
