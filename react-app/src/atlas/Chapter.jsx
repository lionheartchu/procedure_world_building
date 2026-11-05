import { ASSETS, KINDS } from './assets'
import { CHAPTERS } from './content'
import { AtlasHeader, ChapterIndex, DocRef, Figure, Link, Picture } from './parts'

/**
 * One chapter, from its entry in content.js: its number, title and a short
 * introduction beside one annotated image; one mechanism; a few chosen
 * images; two observations and two open questions; its sources; an archive
 * of further material, closed until asked for; the neighbouring chapters.
 */

/** The chapter's image, with its numbered notes pinned to what they describe. */
function Hero({ chapter }) {
  const { hero, id } = chapter
  const asset = ASSETS[hero.asset]
  return (
    <figure className="chapter-hero">
      <div className="hero-frame" style={{ viewTransitionName: `atlas-hero-${id}` }}>
        <Picture asset={asset} eager />
        {hero.notes.map((note, k) => (
          <div
            key={note.title}
            className={`hero-note${(note.side ?? (note.x > 0.6 ? 'left' : 'right')) === 'left' ? ' to-left' : ''}`}
            style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%`, '--dy': `${note.dy ?? 0}rem` }}
          >
            <span className="hero-dot" aria-hidden="true">
              {k + 1}
            </span>
            <span className="hero-note-label">
              <span className="hero-note-title">{note.title}</span>
              <span className="hero-note-text">{note.text}</span>
            </span>
          </div>
        ))}
      </div>
      <figcaption>
        <span className={`atlas-kind kind-${asset.kind}`}>{KINDS[asset.kind]}</span>
        {asset.credit && <span className="atlas-credit">{asset.credit}</span>}
        <span className="atlas-caption">{asset.caption}</span>
        <DocRef doc={asset.doc} />
      </figcaption>
      {hero.notes.length > 0 && (
        // The notes again, as a list, for narrow screens and for reading.
        <ol className="hero-notes-list">
          {hero.notes.map((note) => (
            <li key={note.title}>
              <strong>{note.title}.</strong> {note.text}
            </li>
          ))}
        </ol>
      )}
    </figure>
  )
}

function Head({ title, status }) {
  return (
    <header className="block-head">
      <h2>{title}</h2>
      {status && <span className="atlas-status">{status}</span>}
    </header>
  )
}

/** Steps in one direction, joined by a single line. */
function Chain({ block }) {
  return (
    <section className="block block-chain">
      <Head title={block.title} />
      <ol className="chain" style={{ '--n': block.items.length }}>
        {block.items.map((item, k) => (
          <li key={item.title}>
            <span className="chain-number">{String(k + 1).padStart(2, '0')}</span>
            <span className="chain-title">{item.title}</span>
            <span className="chain-text">{item.text}</span>
          </li>
        ))}
      </ol>
      {block.note && <p className="block-note">{block.note}</p>}
    </section>
  )
}

/** Four steps around a loop: a drawn ring, the steps at its quarters. */
function Cycle({ block }) {
  return (
    <section className="block block-cycle">
      <Head title={block.title} status={block.status} />
      <div className="cycle">
        <svg className="cycle-ring" viewBox="0 0 400 400" aria-hidden="true">
          <ellipse cx="200" cy="200" rx="150" ry="132" />
          <path className="cycle-arc" d="M 200 68 A 150 132 0 0 1 350 200" />
          {[0, 1, 2, 3].map((k) => {
            const a = (k * Math.PI) / 2 - Math.PI / 2
            return <circle key={k} cx={200 + 150 * Math.cos(a)} cy={200 + 132 * Math.sin(a)} r="5.5" />
          })}
        </svg>
        <ol className="cycle-steps">
          {block.items.map((item, k) => (
            <li key={item.title} className={`cycle-step at-${k}`}>
              <span className="cycle-number">{String(k + 1).padStart(2, '0')}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** A resident's stages as a timeline, and three frames from the demo. */
function Stages({ block }) {
  return (
    <section className="block block-stages">
      <Head title={block.title} status={block.status} />
      <ol className="stages">
        {block.stages.map((stage) => (
          <li key={stage.name}>
            <span className="stage-time">{stage.time}</span>
            <span className="stage-name">{stage.name}</span>
            <span className="stage-text">{stage.text}</span>
          </li>
        ))}
      </ol>
      <ol className="frames">
        {block.frames.map((id, k) => (
          <li key={id}>
            <Picture asset={ASSETS[id]} />
            <span className="frame-time">{block.times[k]}</span>
            <span className="frame-text">{ASSETS[id].caption}</span>
          </li>
        ))}
      </ol>
      <p className="frames-source">
        <span className={`atlas-kind kind-${ASSETS[block.frames[0]].kind}`}>{KINDS[ASSETS[block.frames[0]].kind]}</span>
        Frames from the demo, with the record kept. <DocRef doc={ASSETS[block.frames[0]].doc} />
      </p>
    </section>
  )
}

/** Two or three chosen images. */
function Evidence({ block }) {
  return (
    <section className={`block block-evidence layout-${block.layout ?? 'offset'}`}>
      <Head title={block.title} />
      {block.text && <p className="block-lede">{block.text}</p>}
      <div className={`evidence count-${block.items.length}`}>
        {block.items.map((id) => (
          <Figure key={id} id={id} />
        ))}
      </div>
    </section>
  )
}

function Status({ block }) {
  return (
    <section className="block block-status">
      <Head title={block.title} />
      <ul className="status-list">
        {block.items.map((item) => (
          <li key={item.label}>
            <span className="status-label">{item.label}</span>
            <span className={`status-state state-${item.state.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{item.state}</span>
            <span className="status-note">{item.note}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Studies({ block }) {
  return (
    <section className="block block-studies">
      <Head title={block.title} />
      <ol className="studies">
        {block.items.map((item) => (
          <li key={item.number}>
            <span className="study-number">{item.number}</span>
            <span className="study-thumb">
              {item.asset ? <Picture asset={ASSETS[item.asset]} ratio={1.6} /> : <span className="study-empty">no capture</span>}
            </span>
            <span className="study-body">
              <span className="study-title">{item.title}</span>
              <span className="study-text">{item.text}</span>
            </span>
            <span className="study-state">{item.state}</span>
            <DocRef doc={item.doc} label="Read" />
          </li>
        ))}
      </ol>
    </section>
  )
}

function Collection({ block }) {
  return (
    <section className="block block-collection">
      <Head title={block.title} />
      <p className="block-lede">{block.note}</p>
      <div className="collection">
        {block.items.map((id) => (
          <Figure key={id} id={id} />
        ))}
      </div>
    </section>
  )
}

function List({ block }) {
  return (
    <section className="block block-list">
      <Head title={block.title} />
      {block.note && <p className="block-lede">{block.note}</p>}
      <ul className="fine-list">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

/**
 * External works, two to a row as in a collection: each with what it is,
 * who made it, what was seen in it and what was taken. A work the project
 * keeps no image of says so in place of the image.
 */
function Precedents({ block }) {
  return (
    <section className="block block-precedents">
      <Head title={block.title} />
      {block.note && <p className="block-lede">{block.note}</p>}
      <div className="precedents">
        {block.items.map((item) => {
          const asset = item.asset ? ASSETS[item.asset] : null
          return (
            <figure key={item.title} className="atlas-figure precedent">
              {asset ? <Picture asset={asset} ratio={16 / 9} /> : <span className="precedent-empty">No image kept in the project</span>}
              <figcaption>
                <span className="atlas-kind kind-external">{KINDS.external}</span>
                <span className="precedent-name">
                  <cite>{item.title}</cite> · {item.by}, {item.year}
                  {item.where && <span className="precedent-where">, {item.where}</span>}
                </span>
              </figcaption>
              <dl className="precedent-notes">
                <dt>Observed</dt>
                <dd>{item.saw}</dd>
                <dt>Translated</dt>
                <dd>{item.took}</dd>
              </dl>
            </figure>
          )
        })}
      </div>
    </section>
  )
}

/** Research studied for its mechanism: what it is, what was borrowed, what was not. */
function Research({ block }) {
  return (
    <section className="block block-research">
      <Head title={block.title} />
      {block.note && <p className="block-lede">{block.note}</p>}
      <div className="research">
        {block.items.map((item) => (
          <article key={item.title} className="research-item">
            <h3>
              {item.binomial ? <i>{item.title}</i> : item.title}
              {item.aside && <span className="research-aside"> · {item.aside}</span>}
            </h3>
            <p className="research-basis">{item.basis}</p>
            <dl className="precedent-notes">
              <dt>Borrowed</dt>
              <dd>{item.borrowed}</dd>
              <dt>Not claimed</dt>
              <dd>{item.limit}</dd>
            </dl>
            <DocRef doc={item.doc} />
          </article>
        ))}
      </div>
      {block.sources && (
        <p className="research-sources">
          <span className="research-sources-label">Sources</span>
          {block.sources.map((s) => (
            <a key={s.url} className="atlas-docref" href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          ))}
        </p>
      )}
    </section>
  )
}

/** Reference → observed principle → design translation → how far it has got, one row each. */
function Translation({ block }) {
  return (
    <section className="block block-translation">
      <Head title={block.title} />
      {block.note && <p className="block-lede">{block.note}</p>}
      <ol className="translation">
        <li className="translation-head" aria-hidden="true">
          <span>Reference</span>
          <span>Observed principle</span>
          <span>Design translation</span>
          <span>Status</span>
        </li>
        {block.items.map((item) => (
          <li key={item.reference}>
            <cite className={`translation-reference${item.plain ? ' is-plain' : ''}`}>{item.reference}</cite>
            <span className="translation-principle" data-label="Observed">
              {item.principle}
            </span>
            <span className="translation-design" data-label="Became">
              {item.translation}
            </span>
            <span className="translation-status">
              <span className={`status-state state-${item.state.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{item.state}</span>
              <span className="status-note">
                {item.note} · <DocRef doc={item.doc} />
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

const BLOCKS = {
  chain: Chain,
  cycle: Cycle,
  stages: Stages,
  evidence: Evidence,
  status: Status,
  studies: Studies,
  collection: Collection,
  list: List,
  precedents: Precedents,
  research: Research,
  translation: Translation,
}

export default function Chapter({ chapter }) {
  const at = CHAPTERS.indexOf(chapter)
  const previous = CHAPTERS[at - 1]
  const next = CHAPTERS[at + 1]
  return (
    <main className={`atlas-page atlas-chapter chapter-${chapter.id}`}>
      <AtlasHeader
        right={
          <Link to="/atlas/portal" className="atlas-quiet">
            All chapters
          </Link>
        }
      />

      <section className="chapter-head">
        <div className="chapter-intro">
          <p className="chapter-number">{chapter.number}</p>
          <h1 className="chapter-title">{chapter.title}</h1>
          <p className="atlas-kicker">{chapter.kicker}</p>
          <span className="chapter-rule" aria-hidden="true" />
          <p className="chapter-lede">{chapter.intro}</p>
          <ChapterIndex current={chapter.id} />
        </div>
        <Hero chapter={chapter} />
      </section>

      <div className="chapter-blocks">
        {chapter.blocks.map((block) => {
          const Block = BLOCKS[block.type]
          return Block ? <Block key={block.title} block={block} /> : null
        })}
      </div>

      <section className="chapter-notes">
        <div>
          <h2>Observations</h2>
          <ul className="fine-list">
            {chapter.observations.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Open questions</h2>
          <ul className="fine-list">
            {chapter.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="chapter-further">
        <div className="further-sources">
          <h2>Read further</h2>
          <ul>
            {chapter.sources.map((doc) => (
              <li key={doc}>
                <DocRef doc={doc} />
              </li>
            ))}
          </ul>
        </div>
        {chapter.archive?.length > 0 && (
          <details className="further-archive">
            <summary>
              <span>{chapter.archiveTitle ?? 'More from the archive'}</span>
              <span className="archive-count">{chapter.archive.length}</span>
            </summary>
            <div className="archive-grid">
              {chapter.archive.map((id) => (
                <Figure key={id} id={id} />
              ))}
            </div>
          </details>
        )}
      </section>

      <nav className="chapter-pager" aria-label="Chapters">
        {previous ? (
          <Link to={`/atlas/${previous.id}`} className="pager-link is-previous">
            <span className="pager-dir">← Previous</span>
            <span className="pager-title">
              {previous.number} {previous.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        <Link to="/atlas/portal" className="pager-portal">
          All chapters
        </Link>
        {next ? (
          <Link to={`/atlas/${next.id}`} className="pager-link is-next">
            <span className="pager-dir">Next →</span>
            <span className="pager-title">
              {next.number} {next.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  )
}
