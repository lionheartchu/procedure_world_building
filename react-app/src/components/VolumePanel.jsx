import Slider from './Slider'

const VOLUME_SLIDERS = [
  {
    key: 'resolution',
    label: 'Lattice',
    min: 24,
    max: 80,
    step: 8,
    integer: true,
    hint: 'Cells per axis. Cost grows with the cube of this number',
  },
  {
    key: 'iso',
    label: 'Compaction',
    min: -0.45,
    max: 0.45,
    step: 0.01,
    hint: 'Isolevel — where the surface is taken, so the mass swells or shrinks',
  },
]

const STRUCTURE_SLIDERS = [
  {
    key: 'consolidation',
    label: 'Consolidation',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Softens the field before meshing — removes pinholes and slivers, leaves structure',
  },
  {
    key: 'cohesion',
    label: 'Cohesion',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Protects the core from porosity, so voids act on the rind first',
  },
  {
    key: 'layers',
    label: 'Strata count',
    min: 2,
    max: 18,
    step: 1,
    integer: true,
    hint: 'How many deposition layers cross the volume',
  },
  {
    key: 'strata',
    label: 'Strata depth',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How strongly the layers push the surface in and out',
  },
  {
    key: 'porosity',
    label: 'Porosity',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Subtracts 3D noise from the mass, opening voids through it',
  },
  {
    key: 'channelRadius',
    label: 'Channel',
    min: 0,
    max: 1.2,
    step: 0.01,
    hint: 'Radius of the meandering tunnel carved through the volume',
  },
  {
    key: 'cavity',
    label: 'Cavity',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Hollows a basin out of the interior',
  },
  {
    key: 'scaffold',
    label: 'Scaffold',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Strut thickness of the residual network. 0 is off',
  },
  {
    key: 'scaffoldNodes',
    label: 'Scaffold nodes',
    min: 2,
    max: 7,
    step: 1,
    integer: true,
    hint: 'How many points the network is grown between — fewer means longer spans',
  },
  {
    key: 'scaffoldLoops',
    label: 'Scaffold loops',
    min: 0,
    max: 1,
    step: 0.01,
    hint: '0 is a pure branching tree; higher closes loops that bound openings',
  },
  {
    key: 'scaffoldClearance',
    label: 'Clearance',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Hollows the sediment back from the network so struts stand clear and span the gap',
  },
  {
    key: 'scaffoldCurve',
    label: 'Scaffold bow',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How far each span bows away from a straight line',
  },
  {
    key: 'cut',
    label: 'Section',
    min: 0,
    max: 0.9,
    step: 0.005,
    hint: 'Slices the mass away so the inside can be looked at',
  },
  {
    key: 'debris',
    label: 'Debris',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'Drops loose fragments and fills trapped bubbles below this size',
  },
  {
    key: 'seed',
    label: 'Seed',
    min: 1,
    max: 999,
    step: 1,
    integer: true,
    hint: 'A different mass, same rules',
  },
]

const METHODS = [
  { id: 'tetrahedra', label: 'Tetrahedra' },
  { id: 'surfaceNets', label: 'Surface nets' },
]

const METHOD_NOTE = {
  tetrahedra:
    'Vertices on the lattice edges, triangles inside each cell. Follows every crossing exactly; many small triangles.',
  surfaceNets:
    'One vertex per cell, a quad across every edge that changes sign. Shared vertices, larger patches, a softer shrink-wrapped surface.',
}

const int = (n) => n.toLocaleString('en-US')

export default function VolumePanel({ params, onChange, stats, wireframe }) {
  return (
    <aside
      className="side-panel"
      aria-label="Volume controls"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <section className="panel-section">
        <h2 className="section-title">Volume</h2>
        <p className="panel-note">
          The bed given thickness: one density value per point in a box.
        </p>
        <div className="slider-list">
          {VOLUME_SLIDERS.map((definition) => (
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
        <h2 className="section-title">Meshing</h2>
        <div className="button-row">
          {METHODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`control-button${params.method === id ? ' is-current' : ''}`}
              aria-pressed={params.method === id}
              onClick={() => onChange('method', id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="panel-note">{METHOD_NOTE[params.method]}</p>
      </section>

      <section className="panel-section">
        <h2 className="section-title">Structure</h2>
        <div className="slider-list">
          {STRUCTURE_SLIDERS.map((definition) => (
            <Slider
              key={definition.key}
              definition={definition}
              value={params[definition.key]}
              onChange={onChange}
            />
          ))}
        </div>
      </section>

      {stats && (
        <section className="panel-section">
          <h2 className="section-title">Cost</h2>
          <dl className="stat-list">
            <div className="stat-row">
              <dt>lattice</dt>
              <dd>
                {stats.resolution}³ · {int(stats.samples)} samples
              </dd>
            </div>
            <div className="stat-row">
              <dt>vertices</dt>
              <dd>{int(stats.vertices)}</dd>
            </div>
            <div className="stat-row">
              <dt>triangles</dt>
              <dd>{int(stats.triangles)}</dd>
            </div>
            <div className="stat-row">
              <dt>pieces</dt>
              <dd>
                {int(stats.pieces)}
                {stats.dropped > 0 ? ` · ${int(stats.dropped)} dropped` : ''}
              </dd>
            </div>
            <div className="stat-row">
              <dt>pockets filled</dt>
              <dd>{int(stats.filled ?? 0)}</dd>
            </div>
            <div className="stat-row">
              <dt>scaffold</dt>
              <dd>{int(stats.segments ?? 0)} segments</dd>
            </div>
            <div className="stat-row">
              <dt>sample · mesh</dt>
              <dd>
                {stats.sampleMs.toFixed(0)} · {stats.meshMs.toFixed(0)} ms
              </dd>
            </div>
            <div className="stat-row">
              <dt>buffers</dt>
              <dd>{stats.megabytes.toFixed(1)} MB</dd>
            </div>
          </dl>
        </section>
      )}

      <p className="panel-hint">
        Drag to orbit · scroll to zoom · W wireframe{wireframe ? ' (on)' : ''}
      </p>
    </aside>
  )
}
