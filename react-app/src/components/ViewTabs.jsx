const VIEWS = [
  { id: 'field', label: 'Field' },
  { id: 'volume', label: 'Volume' },
  { id: 'shaders', label: 'Shaders' },
]

/** Quiet text tabs under the title. The studies coexist; none is modal. */
export default function ViewTabs({ value, onChange }) {
  return (
    <nav className="view-tabs" aria-label="Study">
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`view-tab${value === id ? ' is-current' : ''}`}
          aria-current={value === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
