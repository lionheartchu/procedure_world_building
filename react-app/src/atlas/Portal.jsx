import { useEffect, useRef } from 'react'
import { PORTAL } from './assets'
import { CHAPTERS } from './content'
import { reducedMotion } from './navigation'
import { AtlasHeader, Link } from './parts'
import PortalAir from './PortalAir'
import './portal.css'

/**
 * The chapters as five specimens in one quiet atmosphere (PORTAL in
 * assets.js: conceptual illustrations, shown as supplied). One composed
 * stage, not a grid: Life Cycles stands at the centre on a pale, barely
 * reflective plane; World and Matter Exchange float on either side, a
 * little further back; Field Notes and Fragments rest lower, nearer, on the
 * plane. Each keeps its own number and name; its one line shows on hover or
 * focus. Residue carried by moving air drifts through the lower space,
 * behind them (PortalAir: the World's wisps, in miniature). The stage keeps
 * its proportions and scales to the window, so the composition holds at
 * every desktop size; on narrow screens it becomes a simple column.
 */

/**
 * Each specimen's place on the stage (percent of the stage's width and
 * height: left, top, width), where its label sits (beside it, or for Life
 * Cycles inside the empty upper left of its own image, against the stem, so
 * it reads as the sail's and not World's), whether it
 * rests on the plane (a soft contact shadow and a faint reflection), and
 * its depth for the pointer drift.
 */
const PLACE = {
  world: { x: 5.5, y: 6, w: 23, label: 'below', depth: 0.7 },
  'life-cycles': { x: 38, y: 9.5, w: 24, label: 'inside', ground: true, depth: 0.45 },
  'matter-exchange': { x: 72, y: 25, w: 21, label: 'above', depth: 0.8 },
  'field-notes': { x: 15, y: 63.5, w: 12.5, label: 'right', ground: true, depth: 1.1 },
  fragments: { x: 63.5, y: 68.5, w: 13, label: 'right', ground: true, depth: 1.2 },
}

export default function Portal() {
  const stage = useRef(null)

  // Drift: the pointer's place over the stage, from −1 to 1, as two CSS variables.
  useEffect(() => {
    const el = stage.current
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
      {/* The shared atmosphere: broad, slow mist over a lavender-to-pearl ground. */}
      <div className="portal-air" aria-hidden="true">
        <span className="portal-mist mist-1" />
        <span className="portal-mist mist-2" />
        <span className="portal-mist mist-3" />
      </div>

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
      </header>

      <div className="portal-stage-wrap">
        <nav className="portal-stage" ref={stage} aria-label="Chapters">
          {/* Light held around the centre, and the pale plane the nearer specimens rest on. */}
          <span className="portal-light" aria-hidden="true" />
          <span className="portal-plane" aria-hidden="true" />
          <PortalAir />

          {CHAPTERS.map((c, k) => {
            const p = PLACE[c.id]
            const art = PORTAL[c.id]
            return (
              <Link
                key={c.id}
                to={`/atlas/${c.id}`}
                className={`portal-specimen specimen-for-${c.id} label-${p.label}${p.ground ? ' is-grounded' : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, '--depth': p.depth, '--phase': `${-k * 3.1}s` }}
              >
                {p.ground && (
                  <>
                    <span className="specimen-contact" aria-hidden="true" />
                    <img className="specimen-reflection" src={art.src} alt="" aria-hidden="true" decoding="async" draggable="false" />
                  </>
                )}
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
      </div>
    </main>
  )
}
