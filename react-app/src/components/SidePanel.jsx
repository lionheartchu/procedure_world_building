import FieldMap from './FieldMap'
import Slider from './Slider'
import SimulationMap from './SimulationMap'
import { SHAPING_KEYS, SHAPING_OPS } from '../lib/field'

const FIELD_SLIDERS = [
  {
    key: 'landformScale',
    label: 'Landform scale',
    min: 0.5,
    max: 8,
    step: 0.05,
    hint: 'Layer A frequency — how many broad forms cross the field',
  },
  {
    key: 'detailScale',
    label: 'Detail scale',
    min: 2,
    max: 26,
    step: 0.1,
    hint: 'Layer B frequency — grain of the sediment',
  },
  {
    key: 'detailAmount',
    label: 'Detail amount',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How much of layer B is blended into layer A',
  },
  {
    key: 'seed',
    label: 'Seed',
    min: 1,
    max: 999,
    step: 1,
    integer: true,
    hint: 'A different field, same rules',
  },
]

const TERRAIN_SLIDERS = [
  {
    key: 'elevation',
    label: 'Elevation',
    min: 0.4,
    max: 9,
    step: 0.05,
    hint: 'Vertical amplitude of the displacement',
  },
  {
    key: 'waterLevel',
    label: 'Water level',
    min: 0,
    max: 1,
    step: 0.005,
    hint: 'Where the tidal plane cuts the field',
  },
  {
    key: 'resolution',
    label: 'Grid resolution',
    min: 16,
    max: 256,
    step: 8,
    integer: true,
    hint: 'Subdivisions of the plane and samples in the base map',
  },
]

const SIM_SLIDERS = [
  {
    key: 'flow',
    label: 'Flow speed',
    min: 0,
    max: 3,
    step: 0.01,
    hint: 'How fast mobile sediment runs downhill',
  },
  {
    key: 'deposition',
    label: 'Deposition',
    min: 0,
    max: 0.9,
    step: 0.01,
    hint: 'Fraction of sediment that stops moving and settles',
  },
  {
    key: 'supply',
    label: 'Sediment supply',
    min: 0,
    max: 0.05,
    step: 0.001,
    hint: 'How much material exposed ground sheds per second',
  },
]

export default function SidePanel({
  field,
  params,
  onChange,
  sim,
  simParams,
  onSimChange,
  running,
  onToggleRunning,
  onReset,
  wireframe,
}) {
  const op = SHAPING_OPS[params.shaping]
  const shapingSlider = op.slider

  return (
    <aside
      className="side-panel"
      aria-label="Field controls"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="map-stack">
        <FieldMap
          field={field}
          resolution={params.resolution}
          waterLevel={params.waterLevel}
        />
        <SimulationMap sim={sim} />
      </div>

      <section className="panel-section">
        <h2 className="section-title">Field</h2>
        <div className="slider-list">
          {FIELD_SLIDERS.map((definition) => (
            <Slider
              key={definition.key}
              definition={definition}
              value={params[definition.key]}
              onChange={onChange}
            />
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2 className="section-title">Shaping</h2>

        <label className="select-slot">
          <span className="slider-label">Operation</span>
          <select
            className="select"
            value={params.shaping}
            onChange={(e) => {
              const next = e.target.value
              onChange('shaping', next)
              // The adaptive slider means something different per mode, so it
              // resets to that mode's own default.
              onChange('shapingAmount', SHAPING_OPS[next].slider.default)
            }}
          >
            {SHAPING_KEYS.map((key) => (
              <option key={key} value={key}>
                {SHAPING_OPS[key].label}
              </option>
            ))}
          </select>
        </label>

        <p className="panel-note">{op.note}</p>

        <div className="slider-list">
          <Slider
            definition={{
              key: 'shapingAmount',
              label: shapingSlider.label,
              min: shapingSlider.min,
              max: shapingSlider.max,
              step: shapingSlider.step,
              integer: shapingSlider.step >= 1,
              hint: 'Meaning follows the selected shaping operation',
            }}
            value={params.shapingAmount}
            onChange={onChange}
          />
        </div>
      </section>

      <section className="panel-section">
        <h2 className="section-title">Terrain</h2>
        <div className="slider-list">
          {TERRAIN_SLIDERS.map((definition) => (
            <Slider
              key={definition.key}
              definition={definition}
              value={params[definition.key]}
              onChange={onChange}
            />
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2 className="section-title">Simulation</h2>

        <div className="button-row">
          <button
            type="button"
            className={`control-button${running ? ' is-active' : ''}`}
            onClick={onToggleRunning}
          >
            {running ? 'Pause' : 'Run'}
          </button>
          <button type="button" className="control-button" onClick={onReset}>
            Reset
          </button>
        </div>

        <p className="panel-note">
          {running
            ? 'Sediment is moving toward lower ground.'
            : 'Frozen. Reset clears everything that settled.'}
        </p>

        <div className="slider-list">
          {SIM_SLIDERS.map((definition) => (
            <Slider
              key={definition.key}
              definition={definition}
              value={simParams[definition.key]}
              onChange={onSimChange}
            />
          ))}
        </div>
      </section>

      <p className="panel-hint">
        Drag to orbit · scroll to zoom · W wireframe{wireframe ? ' (on)' : ''}
      </p>
    </aside>
  )
}
