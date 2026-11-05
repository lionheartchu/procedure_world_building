import './PresenceControl.css'

/**
 * Study 11's one control (`?presence=1`, Explore only): enter the world, or
 * return to the overview. Inside, a single line of keys beside it. A
 * development control, like the lifecycle's inspector; not part of Explore.
 */
export default function PresenceControl({ inside, onToggle }) {
  return (
    <div className={`presence-control${inside ? ' is-inside' : ''}`}>
      <button
        type="button"
        className="presence-toggle"
        onClick={(event) => {
          // Not left focused: Space and Enter belong to the world inside.
          event.currentTarget.blur()
          onToggle()
        }}
      >
        {inside ? 'Return to overview' : 'Enter the world'}
      </button>
      {inside && <p className="presence-keys">Drag to look · W A S D to drift · Q E lower, rise · Shift faster · Esc returns</p>}
    </div>
  )
}
