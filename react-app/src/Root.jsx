import { Suspense, lazy, useEffect, useState } from 'react'
import { isAtlas, isHabitat, usePath } from './lib/route'

// Explore and the Studies (the 3D app) and the Atlas (editorial pages) load
// separately, so the Atlas never loads the scene, and Explore never loads the
// Atlas.
const App = lazy(() => import('./App.jsx'))
const Atlas = lazy(() => import('./atlas/Atlas.jsx'))
// The Habitat: the curated world in first person, on its own page.
const Habitat = lazy(() => import('./Habitat.jsx'))

/**
 * A Habitat builds its world, and the history before arrival, as it first
 * renders, which holds the page for a few seconds. The page left behind goes
 * first (its canvas freed) and a frame of the site's dark ground is shown, so
 * the wait reads as arriving, as it does when the Habitat is opened directly,
 * rather than as a click that did nothing.
 */
function Arriving({ children }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])
  return ready ? children : null
}

export default function Root() {
  const path = usePath()
  // Each Habitat is its own page: a new one replaces the last whole (its
  // world, simulation and canvas), so two never run at once.
  return (
    <Suspense fallback={null}>
      {isAtlas(path) ? (
        <Atlas path={path} />
      ) : isHabitat(path) ? (
        <Arriving key={path}>
          <Habitat />
        </Arriving>
      ) : (
        <App />
      )}
    </Suspense>
  )
}
