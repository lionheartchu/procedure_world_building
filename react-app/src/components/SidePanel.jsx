const SLIDERS = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
  { key: 'drift', label: 'Drift', min: 0, max: 2.5, step: 0.01 },
  { key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.01 },
  { key: 'rain', label: 'Rain', min: 0, max: 1, step: 0.01 },
  { key: 'scale', label: 'Scale', min: 0.4, max: 2.2, step: 0.01 },
  { key: 'turbulence', label: 'Turbulence', min: 0, max: 2.5, step: 0.01 },
  { key: 'lightning', label: 'Lightning', min: 0, max: 1, step: 0.01 },
]

export default function SidePanel({ params, onChange }) {
  return (
    <aside
      className="side-panel"
      aria-label="Controls"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <h2 className="panel-title">Controls</h2>
      <p className="panel-hint">Drag to orbit · Scroll to zoom</p>

      <div className="slider-list">
        {SLIDERS.map(({ key, label, min, max, step }) => (
          <label key={key} className="slider-slot">
            <span className="slider-meta">
              <span className="slider-label">{label}</span>
              <span className="slider-value">{params[key].toFixed(2)}</span>
            </span>
            <input
              className="slider"
              type="range"
              min={min}
              max={max}
              step={step}
              value={params[key]}
              onChange={(e) => onChange(key, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
    </aside>
  )
}
