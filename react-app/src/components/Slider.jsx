/**
 * One labelled range control. Shared by every panel.
 *
 * `onCommit`, when given, is called when the hand lets go — pointer up, key
 * up, or leaving the control — so a panel can apply an expensive change once,
 * on release, rather than on every step of a drag (Explore does this for the
 * controls that regenerate the world). Without it the slider behaves as it
 * always has.
 */
export default function Slider({ definition, value, onChange, onCommit }) {
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
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </label>
  )
}
