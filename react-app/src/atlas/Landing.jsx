import { ASSETS } from './assets'
import { AppLink, AtlasHeader, Link } from './parts'

/**
 * The Atlas's first page: the world as the app shows it (a real capture of
 * the default overview), drifting very slowly behind the title. Only the
 * title, its introduction and the two ways in.
 */
export default function Landing() {
  const scene = ASSETS.overview
  return (
    <main className="atlas-landing">
      <div className="landing-scene" aria-hidden="true">
        <div className="landing-cover">
          <img src={scene.src} alt="" className="landing-image" />
        </div>
        <div className="landing-veil" />
        <div className="landing-bloom" />
      </div>

      {/* The way in, so its links stay shown here rather than fading. */}
      <AtlasHeader tone="dark" always />

      <section className="landing-copy">
        <p className="landing-kicker">Residual Ecology</p>
        <h1 className="landing-title">Atlas</h1>
        <p className="landing-tagline">A living archive of a world becoming.</p>
        <p className="landing-text">
          An exploration of a speculative ecology — its evolving landscape, living forms, material exchanges, and the traces they leave behind.
        </p>
        <div className="landing-actions">
          <Link to="/atlas/portal" className="atlas-button is-primary">
            Enter the Atlas <span aria-hidden="true">→</span>
          </Link>
          <AppLink className="atlas-button">Explore the World</AppLink>
        </div>
      </section>
    </main>
  )
}
