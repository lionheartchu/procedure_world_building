import { Suspense, lazy } from 'react'
import { isAtlas, isHabitat, usePath } from './lib/route'

// Explore and the Studies (the 3D app) and the Atlas (editorial pages) load
// separately, so the Atlas never loads the scene, and Explore never loads the
// Atlas.
const App = lazy(() => import('./App.jsx'))
const Atlas = lazy(() => import('./atlas/Atlas.jsx'))
// The Habitat: the curated world in first person, on its own page.
const Habitat = lazy(() => import('./Habitat.jsx'))

export default function Root() {
  const path = usePath()
  return <Suspense fallback={null}>{isAtlas(path) ? <Atlas path={path} /> : isHabitat(path) ? <Habitat /> : <App />}</Suspense>
}
