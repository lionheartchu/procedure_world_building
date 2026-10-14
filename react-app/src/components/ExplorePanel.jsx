import Slider from './Slider'
import ScatterMap from './ScatterMap'
import { FIELD_SLIDERS, ShapingControl, SIM_SLIDERS, TERRAIN_SLIDERS } from './SidePanel'
import { AIR_CONTROLS, GROWTH, HISTORY, LAYER_CONTROLS, SEED, STREAM_CONTROLS } from './ScatterPanel'

/**
 * Explore: the whole world as one place, in the order it is made — World,
 * Record, Life — then Emergence and Atmosphere, which change how it is seen
 * but never what it is. Nothing here is new: every control is one the
 * studies already have, writing the same state (App.jsx); only the
 * arrangement and, for a few, the label differ. A few controls show at once;
 * the rest wait in collapsed sections. The most technical ones (detail
 * scale and amount, structure reach, air curl, wisp strength) are left to
 * their studies, on the same state.
 *
 * Controls that regenerate the world (App's RECOMPUTE_KEYS and everything
 * in params and simParams) apply when the hand lets go, all at once
 * (`onCommit`), so the scene never shows a world half rebuilt; the rest act
 * live. One word beside each section says which kind it holds — regenerates,
 * rewrites the record, or view only — and the rest (what follows from what)
 * is in tooltips, so the panel stays a list of controls.
 *
 * One control is Explore's own: Underwater visibility, under World's Water
 * appearance. Presentation only (App passes it to the ground and water
 * shaders in Explore and nowhere else); at 0 the water is as it was.
 */

const pick = (list, key, extra = {}) => ({ ...list.find((d) => d.key === key), ...extra })

const WORLD_SEED = pick(FIELD_SLIDERS, 'seed', {
  label: 'World seed',
  hint: 'A different landform, same rules. Its streams, record and colonies follow',
})
const LANDFORM = [
  pick(TERRAIN_SLIDERS, 'elevation'),
  pick(TERRAIN_SLIDERS, 'waterLevel'),
  pick(FIELD_SLIDERS, 'landformScale'),
]
const VEINS = [pick(STREAM_CONTROLS, 'streams'), pick(STREAM_CONTROLS, 'streamFlow', { label: 'Stream flow' })]
const UNDERWATER = {
  key: 'underwater',
  label: 'Underwater visibility',
  min: 0,
  max: 1,
  step: 0.01,
  hint: 'How clearly the ground under the water reads: lighter below, a thinner veil above. Acts at once; the world is unchanged',
}
const RECORD = {
  ...HISTORY,
  hint: 'Seconds of sediment laid down before anything grows. The colonies are placed again on the new record',
}
const COLONY_SEED = { ...SEED, label: 'Colony seed', hint: 'A different gathering of colonies on the same world, same rules' }
const LANGUAGES = [
  pick(LAYER_CONTROLS.bridgework, 'bridgeAmount', { label: 'Structure amount' }),
  pick(LAYER_CONTROLS.bloom, 'bloomAmount', { label: 'Membrane amount' }),
  pick(LAYER_CONTROLS.bloom, 'bloomOpenness', {
    label: 'Membrane openness',
    hint: 'From porous skin to lace; more open further from the water. Acts at once',
  }),
  pick(LAYER_CONTROLS.shard, 'shardAmount', { label: 'Residue amount' }),
  pick(LAYER_CONTROLS.shard, 'shardAccumulation', { label: 'Residue accumulation' }),
]
const AIR_MAIN = [pick(AIR_CONTROLS, 'airDensity', { label: 'Air density' }), pick(AIR_CONTROLS, 'airHaze')]
const AIR_MORE = ['airDrift', 'airWisps', 'airColony'].map((key) => pick(AIR_CONTROLS, key))

/** What a section's controls do to the world, as one word and a tooltip. */
const KINDS = {
  regenerates: 'Applies on release and builds the world again from it',
  record: 'Applies on release: the record is laid down again and the colonies placed on it. The ground stays',
  view: 'Acts at once. Changes how the world is seen, never what it is',
}
const TAGS = { regenerates: 'regenerates', record: 'rewrites record', view: 'view only' }

function Tag({ kind }) {
  return <span className="explore-tag">{TAGS[kind]}</span>
}

/** A section title with its kind beside it; the tooltip says what follows. */
function Title({ children, kind, hint }) {
  return (
    <h2 className="section-title explore-title" title={hint ?? KINDS[kind]}>
      {children}
      <Tag kind={kind} />
    </h2>
  )
}

/** A quiet collapsible group, closed by default. */
function More({ title, hint, kind, children }) {
  return (
    <details className="explore-more">
      <summary title={hint}>
        {title}
        {kind && <Tag kind={kind} />}
      </summary>
      {children}
    </details>
  )
}

export default function ExplorePanel({
  params,
  simParams,
  scatterParams,
  onChange,
  onCommit,
  regenerating,
  world,
  scatter,
  streams,
  growing,
  onGrow,
}) {
  const on = (group) => (key, value) => onChange(group, key, value)
  const sliders = (group, values, list) =>
    list.map((definition) => (
      <Slider
        key={definition.key}
        definition={definition}
        value={values[definition.key]}
        onChange={on(group)}
        onCommit={onCommit}
      />
    ))

  return (
    <aside
      className="side-panel explore-panel"
      aria-label="Explore"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <section className="panel-section">
        <Title
          kind="regenerates"
          hint="The ground every system reads. Applies on release: its streams, record and colonies are built again, and colonies may settle elsewhere"
        >
          World
        </Title>
        <div className="slider-list">{sliders('params', params, [WORLD_SEED])}</div>
        <More title="Landform" hint="The shape of the ground: height, water line, scale and one shaping operation">
          <div className="slider-list">{sliders('params', params, LANDFORM)}</div>
          <ShapingControl params={params} onChange={on('params')} onCommit={onCommit} compact />
        </More>
        <More title="Water veins" hint="Streams carved into the ground, from its high ground to the basins. They shape the record laid along them">
          <div className="slider-list">{sliders('scatterParams', scatterParams, VEINS)}</div>
        </More>
        <More title="Water appearance" kind="view" hint={KINDS.view}>
          <div className="slider-list">{sliders('scatterParams', scatterParams, [UNDERWATER])}</div>
        </More>
      </section>

      <section className="panel-section">
        <Title kind="record">Record</Title>
        <div className="slider-list">{sliders('scatterParams', scatterParams, [RECORD])}</div>
        <More
          title="Record process"
          hint="The rules that lay the record down. The Field study runs the same rules live, separately; that never changes this world"
        >
          <div className="slider-list">{sliders('simParams', simParams, SIM_SLIDERS)}</div>
        </More>
      </section>

      <section className="panel-section">
        <Title
          kind="regenerates"
          hint="Where colonies gather comes from the record and the colony seed; the languages shape what each grows. Applies on release"
        >
          Life
        </Title>
        <div className="slider-list">{sliders('scatterParams', scatterParams, [COLONY_SEED])}</div>
        <More title="Languages" hint="What each colony grows. Amounts apply on release; openness acts at once">
          <div className="slider-list">{sliders('scatterParams', scatterParams, LANGUAGES)}</div>
        </More>
      </section>

      <section className="panel-section">
        <Title kind="view" hint="Replays the colonies emerging: when forms appear, never where. Nothing is built again">
          Emergence
        </Title>
        <div className="growth-row">
          <Slider definition={GROWTH} value={scatterParams.growth} onChange={on('scatterParams')} />
          <button type="button" className={`control-button${growing ? ' is-active' : ''}`} onClick={onGrow}>
            {growing ? 'Growing' : 'Grow'}
          </button>
        </div>
      </section>

      <section className="panel-section">
        <Title kind="view" hint="The air over the world. Acts at once; nothing in the world is built again">
          Atmosphere
        </Title>
        <div className="slider-list">{sliders('scatterParams', scatterParams, AIR_MAIN)}</div>
        <More title="Air detail">
          <div className="slider-list">{sliders('scatterParams', scatterParams, AIR_MORE)}</div>
        </More>
      </section>

      <section className="panel-section">
        <More title="Plan" hint="The world from above: ground, water, streams and colonies">
          <div className="map-stack explore-map">
            <ScatterMap world={world} scatter={scatter} streams={streams} view="all" />
          </div>
        </More>
      </section>

      <p className="panel-hint">
        {regenerating ? 'Regenerating the world…' : 'Drag to orbit · scroll to zoom'}
      </p>
    </aside>
  )
}
