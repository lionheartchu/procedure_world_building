import { useCallback, useRef, useState } from 'react'
import Scene from './components/Scene'
import SidePanel from './components/SidePanel'
import './App.css'

const DEFAULT_PARAMS = {
  intensity: 0.72,
  drift: 1,
  glow: 0.7,
  rain: 0.55,
  scale: 1,
  turbulence: 1,
  lightning: 0.35,
}

function App() {
  const appRef = useRef(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)

  const handleChange = useCallback((key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  return (
    <div className="app" ref={appRef}>
      <Scene params={params} eventSource={appRef} />

      <header className="app-header">
        <h1 className="brand">Nimbus</h1>
        <p className="tagline">A dreamy storm you can orbit</p>
      </header>

      <SidePanel params={params} onChange={handleChange} />
    </div>
  )
}

export default App
