import Slider from './Slider'
import ScatterMap from './ScatterMap'
import { describeRule, LAYERS, withProtocol } from '../lib/scatter'

/** The three scatter languages. Trace Beads is an accent, never soloed. */
const LANGUAGES = LAYERS.filter((layer) => !layer.accent)
const BEADS = LAYERS.find((layer) => layer.accent)

/** At most two design controls per language; the rest is protocol. */
const LAYER_CONTROLS = {
  bridgework: [
    { key: 'bridgeAmount', label: 'Amount', min: 0, max: 1, step: 0.01, hint: 'How much structure each colony grows: ribs in its anchor, then strands toward its other forms, then one crossing' },
    { key: 'bridgeReach', label: 'Reach', min: 3, max: 9, step: 0.1, hint: 'Longest crossing tried, in world units' },
  ],
  bloom: [
    { key: 'bloomAmount', label: 'Amount', min: 0, max: 1, step: 0.01, hint: 'How many smaller veils gather around each colony’s anchor' },
    { key: 'bloomOpenness', label: 'Openness', min: 0, max: 1, step: 0.01, hint: 'From porous skin to lace. Each bloom is still more open the further it is from the water' },
  ],
  shard: [
    { key: 'shardAmount', label: 'Amount', min: 0, max: 1, step: 0.01, hint: 'How much residue each colony collects: around its bases, along its trace, in one heap' },
    { key: 'shardAccumulation', label: 'Accumulation', min: 0, max: 1, step: 0.01, hint: 'How far it gathers: settles on thinner record, trails run further, the heap grows taller' },
  ],
}

const HISTORY = {
  key: 'history',
  label: 'History',
  min: 0,
  max: 120,
  step: 5,
  integer: true,
  hint: 'Seconds of sediment record laid down before anything is placed',
}

const SEED = {
  key: 'seed',
  label: 'Scatter seed',
  min: 1,
  max: 999,
  step: 1,
  integer: true,
  hint: 'A different colony on the same world, same rules',
}

const GROWTH = {
  key: 'growth',
  label: 'Growth',
  min: 0,
  max: 1,
  step: 0.01,
  hint: 'Plays the placed colony emerging: trace → gather → accrete → reach → wrap',
}

/**
 * Water veins belong to the world, not to the colony: their two controls sit
 * with the world record. They shape the ground every tab shows.
 */
const STREAM_CONTROLS = [
  { key: 'streams', label: 'Streams', min: 0, max: 3, step: 1, integer: true, hint: 'How many streams rise on the high, thick ground and run down to the basins' },
  { key: 'streamFlow', label: 'Flow', min: 0, max: 1, step: 0.01, hint: 'From a thread of water to a small brook: the channel’s width and depth' },
]

/** The air: four controls, all uniforms — nothing is recomputed. */
const AIR_CONTROLS = [
  { key: 'airDensity', label: 'Density', min: 0, max: 1, step: 0.01, hint: 'How many residents the air holds' },
  { key: 'airDrift', label: 'Drift', min: 0, max: 1, step: 0.01, hint: 'The slow current across the scene, and the air sliding downhill' },
  { key: 'airCurl', label: 'Curl', min: 0, max: 1, step: 0.01, hint: 'How much the air turns and folds as it drifts' },
  { key: 'airColony', label: 'Colony hold', min: 0, max: 1, step: 0.01, hint: 'How strongly colonies slow the air, draw it in and circulate it' },
]

function placed(id, stats) {
  if (!stats) return ''
  if (id === 'bridgework') return `${stats.ribs} ribs · ${stats.reaches} strands · ${stats.spans} crossings`
  if (id === 'bloom') return `${stats.anchors} anchors · ${stats.secondaries} smaller veils`
  if (id === 'shard') return `${stats.plates} plates · ${stats.grains} grains`
  if (id === 'streams') {
    return stats.streams ? `${stats.streams} streams · ${stats.length.toFixed(0)} units of water` : 'no streams'
  }
  return `${stats.count} trails`
}

export default function ScatterPanel({ params, onChange, world, scatter, streams, busy, growing, onGrow }) {
  const { view } = params
  const layer = LANGUAGES.find((l) => l.id === view)
  const rulesParams = withProtocol(params)

  return (
    <aside
      className="side-panel"
      aria-label="Scatter controls"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <section className="panel-section">
        <h2 className="section-title">View</h2>
        <div className="mode-list">
          {[{ id: 'all', label: 'All — the colony' }, ...LANGUAGES].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`control-button${view === id ? ' is-current' : ''}`}
              aria-pressed={view === id}
              onClick={() => onChange('view', id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="map-stack">
        <ScatterMap world={world} scatter={scatter} streams={streams} view={view} accumulation={params.shardAccumulation} />
        <p className="panel-note map-note">
          {layer
              ? 'Brighter ground passes more of this language’s rules. Marks are what was placed: suitability makes a place possible; amount, spacing and the forms already standing decide which places are used.'
              : 'The colonies and every form in them, from above. Choose a language to solo it and see where it may grow.'}
        </p>
      </div>

      {layer ? (
        <section className="panel-section">
          <h2 className="section-title">{layer.label}</h2>
          <p className="panel-note">{layer.protocol}</p>
          <ul className="rule-list">
            {layer.rules.map((rule) => (
              <li key={rule.channel + rule.kind}>
                <span className="rule-why">{rule.why}</span>
                <span className="rule-expr">{describeRule(rule, rulesParams)}</span>
              </li>
            ))}
            <li>
              <span className="rule-why">only inside a colony</span>
              <span className="rule-expr">
                {scatter?.colonies.length ?? 0} colonies, chosen from the world’s strongest sites
              </span>
            </li>
          </ul>
          <div className="slider-list">
            {LAYER_CONTROLS[layer.id].map((definition) => (
              <Slider key={definition.key} definition={definition} value={params[definition.key]} onChange={onChange} />
            ))}
          </div>
          <p className="panel-note layer-varies">{layer.varies}</p>
          <p className="layer-count">{placed(layer.id, scatter?.layers[layer.id]?.stats)}</p>
        </section>
      ) : (
        <section className="panel-section">
          <h2 className="section-title">Three languages</h2>
          <ul className="legend">
            {LANGUAGES.map((l) => (
              <li key={l.id}>
                <button type="button" className="legend-row" onClick={() => onChange('view', l.id)}>
                  <span className="legend-name">{l.label}</span>
                  <span className="legend-summary">{l.summary}</span>
                  <span className="legend-count">{placed(l.id, scatter?.layers[l.id]?.stats)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="panel-note">
            {BEADS.summary} {placed(BEADS.id, scatter?.layers[BEADS.id]?.stats)}.
          </p>
        </section>
      )}

      <section className="panel-section">
        <h2 className="section-title">World record</h2>
        <p className="panel-note">
          History is how much sediment record exists before anything is placed.
          It changes <em>where</em> forms can appear. {busy ? 'Recomputing…' : ''}
        </p>
        <div className="slider-list">
          <Slider definition={HISTORY} value={params.history} onChange={onChange} />
          <Slider definition={SEED} value={params.seed} onChange={onChange} />
        </div>
        <p className="panel-note stream-note">
          Water veins rise on the high, thick ground and run down to the
          basins, cutting a shallow channel as they go. They are part of the
          world every tab shows.
        </p>
        <div className="slider-list">
          {STREAM_CONTROLS.map((definition) => (
            <Slider key={definition.key} definition={definition} value={params[definition.key]} onChange={onChange} />
          ))}
        </div>
        <p className="layer-count">{placed('streams', streams?.stats)}</p>
      </section>

      <section className="panel-section">
        <h2 className="section-title">Air</h2>
        <p className="panel-note">
          Residents of the air: fine dust, wisps where the air runs, motes
          that linger around the colonies, a few turning flakes, and haze
          pooled over the basins. One field moves them all, with quiet
          pockets, downhill streams and a slow circulation at each colony.
        </p>
        <div className="slider-list">
          {AIR_CONTROLS.map((definition) => (
            <Slider key={definition.key} definition={definition} value={params[definition.key]} onChange={onChange} />
          ))}
        </div>
      </section>


      <section className="panel-section">
        <h2 className="section-title">Emergence</h2>
        <p className="panel-note">
          Growth plays the colony that was already placed, from nothing to
          whole. It changes <em>when</em> forms appear, never where.
        </p>
        <div className="growth-row">
          <Slider definition={GROWTH} value={params.growth} onChange={onChange} />
          <button type="button" className={`control-button${growing ? ' is-active' : ''}`} onClick={onGrow}>
            {growing ? 'Growing' : 'Grow'}
          </button>
        </div>
      </section>

      <p className="panel-hint">Drag to orbit · scroll to zoom</p>
    </aside>
  )
}
