/** The original studies, as they were: one view each, unchanged. */
const STUDIES = [
  { id: 'field', label: 'Field' },
  { id: 'volume', label: 'Volume' },
  { id: 'shaders', label: 'Shaders' },
  { id: 'scatter', label: 'Scatter' },
]

/**
 * Quiet text tabs under the title. Explore is the world as one place; the
 * Habitat is a world to be in, in first person (the featured one; the
 * others keep routes of their own); the Atlas is its archive, on pages of
 * its own; the studies it grew from sit behind a secondary Studies menu,
 * each still its own view with its own panel.
 */
export default function ViewTabs({ value, onChange, studiesOpen, onToggleStudies, onAtlas, onHabitat, habitatHref }) {
  const inStudy = value !== 'explore'
  return (
    <nav className="view-tabs" aria-label="View">
      <button
        type="button"
        className={`view-tab${value === 'explore' ? ' is-current' : ''}`}
        aria-current={value === 'explore' ? 'page' : undefined}
        onClick={() => onChange('explore')}
      >
        Explore
      </button>
      {habitatHref && (
        <a className="view-tab" href={habitatHref} onClick={onHabitat}>
          Habitat
        </a>
      )}
      <a className="view-tab" href="/atlas" onClick={onAtlas}>
        Atlas
      </a>
      <button
        type="button"
        className={`view-tab view-tab-menu${inStudy ? ' is-current' : ''}${studiesOpen ? ' is-open' : ''}`}
        aria-expanded={studiesOpen}
        onClick={onToggleStudies}
      >
        Studies
      </button>
      {studiesOpen && (
        <span className="study-tabs" role="group" aria-label="Studies">
          {STUDIES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`view-tab study-tab${value === id ? ' is-current' : ''}`}
              aria-current={value === id ? 'page' : undefined}
              onClick={() => onChange(id)}
            >
              {label}
            </button>
          ))}
        </span>
      )}
    </nav>
  )
}
