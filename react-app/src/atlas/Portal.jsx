import { useEffect, useRef } from 'react'
import { PORTAL } from './assets'
import { CHAPTERS } from './content'
import { reducedMotion } from './navigation'
import { AtlasHeader, Link } from './parts'

/**
 * The chapters as five specimens suspended in an open field: one conceptual
 * illustration each (PORTAL in assets.js), shown as supplied, with its
 * number, title and one line. Three above, two below, on a loose grid so
 * nothing overlaps at any width; each floats very slowly and drifts with
 * the pointer at its own depth. The whole of each item opens its chapter.
 */

/**
 * Where each sits in the field's 12 columns, how far it is lowered (rem),
 * how wide its image is within its columns, its depth for the drift,
 * whether its label sits beside it, and whether it sits centred in its
 * columns (so the gaps either side of it match).
 */
const PLACE = {
  world: { col: '1 / span 4', row: 1, drop: 2.6, width: 0.94, depth: 1 },
  'life-cycles': { col: '5 / span 4', row: 1, drop: 0, width: 0.62, depth: 0.6, centred: true },
  'matter-exchange': { col: '9 / span 4', row: 1, drop: 3.4, width: 0.94, depth: 1.3 },
  'field-notes': { col: '2 / span 5', row: 2, drop: 0.4, width: 0.5, depth: 0.8, side: true },
  fragments: { col: '8 / span 5', row: 2, drop: 1.6, width: 0.52, depth: 1.1, side: true },
}

export default function Portal() {
  const field = useRef(null)

  // Drift: the pointer's place in the field, from −1 to 1, as two CSS variables.
  useEffect(() => {
    const el = field.current
    if (!el || reducedMotion()) return undefined
    let frame = 0
    const onMove = (event) => {
      const r = el.getBoundingClientRect()
      const mx = ((event.clientX - r.left) / r.width) * 2 - 1
      const my = ((event.clientY - r.top) / r.height) * 2 - 1
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--mx', mx.toFixed(3))
        el.style.setProperty('--my', my.toFixed(3))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <main className="atlas-page atlas-portal">
      <AtlasHeader
        right={
          <Link to="/atlas" className="atlas-quiet">
            ← Atlas
          </Link>
        }
      />
      <header className="portal-intro">
        <h1 className="portal-heading">Five chapters</h1>
        <p className="portal-lede">The ground, what lives on it, what passes between, how it was studied, and what it was imagined through.</p>
        <p className="portal-provenance">Conceptual illustrations for the chapters: not screenshots of the app, and not evidence from its simulation.</p>
      </header>

      <nav className="portal-field" ref={field} aria-label="Chapters">
        {CHAPTERS.map((c, k) => {
          const p = PLACE[c.id]
          const art = PORTAL[c.id]
          return (
            <Link
              key={c.id}
              to={`/atlas/${c.id}`}
              className={`portal-specimen specimen-for-${c.id}${p.side ? ' is-side' : ''}${p.centred ? ' is-centred' : ''}`}
              style={{ gridColumn: p.col, gridRow: p.row, '--drop': `${p.drop}rem`, '--w': p.width, '--depth': p.depth, '--phase': `${-k * 2.3}s` }}
            >
              <span className="specimen-body" style={{ viewTransitionName: `atlas-hero-${c.id}` }}>
                <img
                  className="specimen-art"
                  src={art.src}
                  alt={art.alt}
                  width={art.size[0]}
                  height={art.size[1]}
                  decoding="async"
                  draggable="false"
                />
              </span>
              <span className="portal-label">
                <span className="portal-number">{c.number}</span>
                <span className="portal-title">
                  {c.title}
                  <span className="portal-cue" aria-hidden="true">
                    →
                  </span>
                </span>
                <span className="portal-text">{c.teaser}</span>
              </span>
            </Link>
          )
        })}
      </nav>

    </main>
  )
}
