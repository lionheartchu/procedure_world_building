/** One labelled range control. Shared by both study panels. */
export default function Slider({ definition, value, onChange }) {
  const { key, label, min, max, step, integer, hint } = definition
  return (
    <label className="slider-slot" title={hint}>
      <span className="slider-meta">
        <span className="slider-label">{label}</span>
        <span className="slider-value">
          {integer ? value : Number(value).toFixed(step < 0.01 ? 3 : 2)}
        </span>
      </span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(key, Number(e.target.value))}
      />
    </label>
  )
}
