import { useEffect, useLayoutEffect, useRef } from 'react'
import { chapterById } from './content'
import Landing from './Landing'
import Portal from './Portal'
import Chapter from './Chapter'
import { AtlasHeader, Link } from './parts'
import './atlas.css'

/**
 * The Atlas: an editorial archive of the project, on pages of its own.
 *
 *   /atlas             the landing
 *   /atlas/portal      the five chapters, as fragments to open
 *   /atlas/<chapter>   a chapter (world, life-cycles, matter-exchange,
 *                      field-notes, fragments)
 *
 * It loads no 3D scene: its images are the project's own captures, diagrams
 * and references, from docs/. Its words are in content.js.
 */

/** The editorial serif, loaded only when the Atlas opens. */
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap'

function useFont() {
  useEffect(() => {
    if (document.querySelector('link[data-atlas-font]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONT_URL
    link.dataset.atlasFont = ''
    document.head.appendChild(link)
  }, [])
}

function NotFound() {
  return (
    <main className="atlas-page atlas-missing">
      <AtlasHeader />
      <p>There is no such page in the Atlas.</p>
      <Link to="/atlas/portal" className="atlas-button">
        Back to the chapters →
      </Link>
    </main>
  )
}

export default function Atlas({ path }) {
  useFont()
  const scroller = useRef(null)
  const rest = path.replace(/^\/atlas\/?/, '').replace(/\/$/, '')
  const chapter = rest && rest !== 'portal' ? chapterById(rest) : null

  // Each page opens at its top.
  useLayoutEffect(() => {
    scroller.current?.scrollTo(0, 0)
  }, [rest])

  useEffect(() => {
    const base = 'Residual Ecology'
    document.title = !rest ? `Atlas · ${base}` : rest === 'portal' ? `Chapters · Atlas · ${base}` : chapter ? `${chapter.title} · Atlas · ${base}` : `Atlas · ${base}`
    return () => {
      document.title = base
    }
  }, [rest, chapter])

  let page
  if (!rest) page = <Landing />
  else if (rest === 'portal') page = <Portal />
  else if (chapter) page = <Chapter chapter={chapter} />
  else page = <NotFound />

  return (
    <div className="atlas" ref={scroller}>
      <div className="atlas-enter" key={rest}>
        {page}
      </div>
    </div>
  )
}
