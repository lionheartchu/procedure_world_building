import { Canvas, useThree } from '@react-three/fiber'

// TEMPORARY evaluation handle — remove before finishing.
function DevHandle() {
  const state = useThree()
  if (import.meta.env.DEV) window.__three = state
  return null
}
import { OrbitControls } from '@react-three/drei'
import CanvasCapture from './CanvasCapture'
import Terrain from './Terrain'
import Atmosphere from './Atmosphere'
import AmbientAir from './AmbientAir'

const DEEP_INDIGO = '#0B0E1E'
// Haze is deliberately lighter than the background: distance dissolves into a
// pale violet rather than into black, which is what separates the depth layers.
const HAZE = '#262B4F'

export default function Scene({
  field,
  params,
  sim,
  simParams,
  running,
  wireframe,
  eventSource,
  onCapture,
  shader = null,
  streams = null,
  air = null,
  children,
}) {
  return (
    <Canvas
      className="scene-canvas"
      camera={{ position: [9.5, 5.6, 15], fov: 40, near: 0.1, far: 220 }}
      dpr={[1, 2]}
      // preserveDrawingBuffer lets the Library grab a thumbnail of the frame.
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      eventSource={eventSource}
      eventPrefix="client"
      style={{ pointerEvents: 'none' }}
    >
      <color attach="background" args={[DEEP_INDIGO]} />
      <fogExp2 attach="fog" args={[HAZE, 0.026]} />

      {/* The terrain lights itself in its own shader; these carry the water. */}
      <ambientLight intensity={1.1} color="#7A74AE" />
      <directionalLight position={[-16, 8, -14]} intensity={1.5} color="#C6BFE6" />
      <directionalLight position={[10, 4, 12]} intensity={0.5} color="#565C96" />

      <CanvasCapture onReady={onCapture} />
      <DevHandle />

      {/* The habitat's own air (AmbientAir) replaces the old motes here. */}
      <Atmosphere motes={!air} />
      {air && (
        <AmbientAir field={field} elevation={params.elevation} waterLevel={params.waterLevel} {...air} />
      )}
      <Terrain
        field={field}
        params={params}
        sim={sim}
        simParams={simParams}
        running={running}
        wireframe={wireframe}
        shader={shader}
        streams={streams}
      />
      {children}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.45}
        minDistance={7}
        maxDistance={44}
        maxPolarAngle={Math.PI * 0.492}
        target={[0, -0.8, 0]}
      />
    </Canvas>
  )
}
