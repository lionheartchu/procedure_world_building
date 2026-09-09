import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Terrain from './Terrain'
import Atmosphere from './Atmosphere'

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
}) {
  return (
    <Canvas
      className="scene-canvas"
      camera={{ position: [9.5, 5.6, 15], fov: 40, near: 0.1, far: 220 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
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

      <Atmosphere />
      <Terrain
        field={field}
        params={params}
        sim={sim}
        simParams={simParams}
        running={running}
        wireframe={wireframe}
      />

      <OrbitControls
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
