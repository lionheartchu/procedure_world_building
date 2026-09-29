import Slider from './Slider'

/**
 * Material modes. Each is one reading of the same terrain: a short list of
 * inputs, a short list of things it changes, and two controls. The point of
 * keeping them this narrow is that any difference you see has an obvious cause.
 */
export const MODES = [
  {
    id: 'geological',
    value: 1,
    label: 'Geological',
    note: 'Height, normal and world position. Static. About twelve warped beds across the relief, each its own value with a thin parting between, strongest on steep faces where bedding is exposed.',
    sliders: [
      {
        key: 'heightInfluence',
        label: 'Height influence',
        min: 0.4,
        max: 2.2,
        step: 0.01,
        hint: 'How much of the colour ramp elevation spans',
      },
      {
        key: 'strata',
        label: 'Strata strength',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'Bed contrast and partings. Scaled to the relief, so it reads on any landform',
      },
    ],
  },
  {
    id: 'dormant',
    value: 2,
    label: 'Dormant / Residual',
    note: 'Sediment, activity and time. Untouched ground stays dark whatever the sliders say — residue and pulse both sit behind a threshold, so only real accumulation lights up.',
    sliders: [
      {
        key: 'activity',
        label: 'Activity influence',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'How strongly accumulated sediment lightens the ground',
      },
      {
        key: 'pulse',
        label: 'Glow / pulse',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'Emissive response and the slow breath through it. 0 is completely still',
      },
    ],
    needsSimulation: true,
  },
  {
    id: 'membrane',
    value: 3,
    label: 'Living Membrane',
    note: 'Smooth normal, view angle and time. No facets: a slow field pushes the normal around, so sheen pools and slides; looking toward the light, thin grazing parts let a little through.',
    sliders: [
      {
        key: 'fresnel',
        label: 'Sheen strength',
        min: 0,
        max: 1.5,
        step: 0.01,
        hint: 'Breadth of the sheen and the wet highlight riding on it',
      },
      {
        key: 'membrane',
        label: 'Surface movement',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'Slow drift across the surface, and a very small displacement with it',
      },
    ],
  },
]

const WATER_SLIDERS = [
  {
    key: 'water',
    label: 'Water surface',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Surface presence, from none to a full veil: sky reflection, slow tilt, glint',
  },
  {
    key: 'caustics',
    label: 'Water light',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Reflected light drifting across the basins and their banks; fades with depth',
  },
]

export default function ShaderPanel({
  params,
  onChange,
  running,
  onToggleRunning,
  onReset,
}) {
  const mode = MODES.find((m) => m.id === params.mode) ?? MODES[0]

  return (
    <aside
      className="side-panel"
      aria-label="Shader controls"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <section className="panel-section">
        <h2 className="section-title">Material mode</h2>
        <p className="panel-note">
          The same terrain, the same camera. Only the material changes.
        </p>
        <div className="mode-list">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`control-button${params.mode === id ? ' is-current' : ''}`}
              aria-pressed={params.mode === id}
              onClick={() => onChange('mode', id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="panel-note">{mode.note}</p>
      </section>

      <section className="panel-section">
        <h2 className="section-title">{mode.label}</h2>
        <div className="slider-list">
          {mode.sliders.map((definition) => (
            <Slider
              key={definition.key}
              definition={definition}
              value={params[definition.key]}
              onChange={onChange}
            />
          ))}
        </div>
      </section>

      {mode.needsSimulation && (
        <section className="panel-section">
          <h2 className="section-title">Simulation</h2>
          <p className="panel-note">
            This mode reads the sediment field, so it has nothing to show until
            the simulation has run.
          </p>
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
        </section>
      )}

      <section className="panel-section">
        <h2 className="section-title">Water</h2>
        <p className="panel-note">
          Shared by every mode — the water belongs to the world, not to one
          reading of it. The surface is a veil pooled in the basins; the light
          is one slow drifting field, on the ground below it, a short way up
          its banks, and faintly on the surface itself.
        </p>
        <div className="slider-list">
          {WATER_SLIDERS.map((definition) => (
            <Slider
              key={definition.key}
              definition={definition}
              value={params[definition.key]}
              onChange={onChange}
            />
          ))}
        </div>
      </section>

      <p className="panel-hint">Drag to orbit · scroll to zoom · W wireframe</p>
    </aside>
  )
}
