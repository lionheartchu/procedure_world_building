import { Suspense, lazy } from 'react'
import { isAtlas, usePath } from './lib/route'

// Explore and the Studies (the 3D app) and the Atlas (editorial pages) load
// separately, so the Atlas never loads the scene, and Explore never loads the
// Atlas.
const App = lazy(() => import('./App.jsx'))
const Atlas = lazy(() => import('./atlas/Atlas.jsx'))

export default function Root() {
  const path = usePath()
  return <Suspense fallback={null}>{isAtlas(path) ? <Atlas path={path} /> : <App />}</Suspense>
}
