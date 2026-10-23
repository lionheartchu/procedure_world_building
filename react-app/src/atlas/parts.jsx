import QuietNav from '../components/QuietNav'
import { ASSETS, KINDS } from './assets'
import { CHAPTERS } from './content'
import { DOCS, docUrl } from './docs'
import { atlasNavigate, leaveFor } from './navigation'

/** A link within the Atlas: a real href (so it can be opened in a new tab), with soft navigation. */
export function Link({ to, children, ...rest }) {
  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    atlasNavigate(to)
  }
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  )
}

/** A link out to Explore or the Studies. */
export function AppLink({ studies = false, children, ...rest }) {
  const onClick = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    leaveFor(studies)
  }
  return (
    <a href="/" onClick={onClick} {...rest}>
      {children}
    </a>
  )
}

/**
 * An image, or one panel of a labelled sheet (its crop), at its own
 * proportions, or trimmed (centred, never beyond its crop) to `ratio`.
 * Lazy unless asked otherwise.
 */
export function Picture({ asset, className = '', eager = false, name, fill = false, ratio }) {
  const [W, H] = asset.size
  let [x, y, w, h] = asset.crop ?? [0, 0, W, H]
  if (ratio) {
    if (w / h > ratio) {
      x += (w - h * ratio) / 2
      w = h * ratio
    } else {
      y += (h - w / ratio) / 2
      h = w / ratio
    }
  }
  const cropped = !!asset.crop || !!ratio
  const style = cropped ? { width: `${(W / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` } : undefined
  return (
    <div className={`atlas-pic${cropped ? ' is-crop' : ''}${fill ? ' is-fill' : ''} ${className}`} style={{ aspectRatio: fill ? undefined : `${w} / ${h}`, viewTransitionName: name }}>
      <img src={asset.src} alt={asset.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" style={style} />
    </div>
  )
}

/** Where a statement or an image comes from: the document online, or its local path. */
export function DocRef({ doc, label }) {
  const url = docUrl(doc)
  const title = label ?? DOCS[doc]?.title
  if (!DOCS[doc]) return null
  return url ? (
    <a className="atlas-docref" href={url} target="_blank" rel="noreferrer">
      {title}
    </a>
  ) : (
    <span className="atlas-docref is-local" title={`Not yet published; in the working copy at ${DOCS[doc].path}`}>
      {title} <span className="atlas-docref-path">· local</span>
    </span>
  )
}

/** An image with what it is, its caption, and its source. */
export function Figure({ id, className = '', eager = false, caption = true }) {
  const asset = ASSETS[id]
  return (
    <figure className={`atlas-figure ${className}`}>
      <Picture asset={asset} eager={eager} />
      <figcaption>
        <span className={`atlas-kind kind-${asset.kind}`}>{KINDS[asset.kind]}</span>
        {asset.credit && <span className="atlas-credit">{asset.credit}</span>}
        {caption && <span className="atlas-caption">{asset.caption}</span>}
        <DocRef doc={asset.doc} />
      </figcaption>
    </figure>
  )
}

/**
 * The global navigation, as on every Atlas page: quiet until it is wanted
 * (QuietNav). `right` stays shown: a light way back.
 */
export function AtlasHeader({ tone = 'light', right }) {
  return (
    <header className={`atlas-top tone-${tone}`}>
      <QuietNav label="Residual Ecology: menu">
        <Link to="/atlas" className="atlas-brand">
          Residual Ecology
        </Link>
        <nav className="atlas-nav" aria-label="Main">
          <AppLink>Explore</AppLink>
          <Link to="/atlas/portal" aria-current="page">
            Atlas
          </Link>
          <AppLink studies>Studies</AppLink>
        </nav>
      </QuietNav>
      {right}
    </header>
  )
}

/** The five chapters, as a quiet numbered index. */
export function ChapterIndex({ current }) {
  return (
    <ol className="atlas-index" aria-label="Chapters">
      {CHAPTERS.map((c) => (
        <li key={c.id} className={c.id === current ? 'is-current' : ''}>
          <Link to={`/atlas/${c.id}`} aria-current={c.id === current ? 'page' : undefined}>
            <span>{c.number}</span> {c.title}
          </Link>
        </li>
      ))}
    </ol>
  )
}
