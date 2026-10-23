import { useEffect, useId, useRef, useState } from 'react'
import './QuietNav.css'

/**
 * Navigation that keeps out of the way: the title and its links show when
 * they are wanted and fade when they are not.
 *
 *   - they show on arrival for a moment, then fade
 *   - a mouse near the top left brings them back; leaving lets them fade
 *   - keyboard focus inside them shows them for as long as it is there
 *   - a small mark stays in the corner: a tap or click opens them and keeps
 *     them open (the way in on touch screens); a second tap, a tap
 *     elsewhere or Escape closes them
 *   - `always` keeps them shown (where they are working tools, as in the
 *     studies)
 *
 * The links stay in the page and reachable at all times; only their
 * visibility changes.
 */

/** The corner that brings them back (px), how long they show on arrival, and how long they linger. */
const NEAR = { x: 440, y: 170 }
const ARRIVAL = 2600
const LINGER = 900

export default function QuietNav({ always = false, label = 'Menu', className = '', children }) {
  const [near, setNear] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [arriving, setArriving] = useState(true)
  const root = useRef(null)
  const linger = useRef(0)
  const id = useId()

  useEffect(() => {
    const t = setTimeout(() => setArriving(false), ARRIVAL)
    return () => clearTimeout(t)
  }, [])

  // A mouse near the corner (touch has the mark instead).
  useEffect(() => {
    const onMove = (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') return
      const inside = event.clientX < NEAR.x && event.clientY < NEAR.y
      clearTimeout(linger.current)
      if (inside) setNear(true)
      else linger.current = setTimeout(() => setNear(false), LINGER)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      clearTimeout(linger.current)
    }
  }, [])

  // Opened with the mark: closed by Escape or a tap elsewhere.
  useEffect(() => {
    if (!pinned) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setPinned(false)
    }
    const onDown = (event) => {
      if (root.current && !root.current.contains(event.target)) setPinned(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [pinned])

  const shown = always || near || focused || pinned || arriving
  return (
    <div
      ref={root}
      className={`quiet-nav${shown ? ' is-shown' : ''}${always ? ' is-always' : ''} ${className}`}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      {!always && (
        <button
          type="button"
          className="quiet-mark"
          aria-label={label}
          aria-expanded={shown}
          aria-controls={id}
          onClick={() => setPinned((value) => !value)}
        >
          <span aria-hidden="true" />
        </button>
      )}
      <div className="quiet-content" id={id}>
        {children}
      </div>
    </div>
  )
}
