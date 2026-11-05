import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import CanvasCapture from './CanvasCapture'
import Terrain, { FIELD_SIZE } from './Terrain'
import Atmosphere from './Atmosphere'
import AmbientAir from './AmbientAir'

const DEEP_INDIGO = '#0B0E1E'
// Haze is deliberately lighter than the background: distance dissolves into a
// pale violet rather than into black, which is what separates the depth layers.
const HAZE = '#262B4F'

/**
 * How the scene is rendered. Explore and the studies use these; the Habitat
 * passes its own (a lower pixel-ratio cap, no thumbnail buffer, no orbit).
 */
const DEFAULT_PROFILE = { dpr: [1, 2], preserve: true, orbit: true, fog: 0.026, background: DEEP_INDIGO, haze: HAZE, sky: null }

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
  accumulation = null,
  profile = DEFAULT_PROFILE,
  far = null,
  waterCue = null,
  farGround = null,
  // The slab's side (a wider world: the Habitat's D).
  size = FIELD_SIZE,
  children,
}) {
  return (
    <Canvas
      className="scene-canvas"
      camera={{ position: [9.5, 5.6, 15], fov: 40, near: 0.1, far: profile.far ?? 220 }}
      dpr={profile.dpr}
      // preserveDrawingBuffer lets the Library grab a thumbnail of the frame.
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: profile.preserve }}
      eventSource={eventSource}
      eventPrefix="client"
      style={{ pointerEvents: 'none' }}
    >
      <color attach="background" args={[profile.background ?? DEEP_INDIGO]} />
      <fogExp2 attach="fog" args={[profile.haze ?? HAZE, profile.fog]} />

      {/* The terrain lights itself in its own shader; these carry the water. */}
      <ambientLight intensity={1.1} color="#7A74AE" />
      <directionalLight position={[-16, 8, -14]} intensity={1.5} color="#C6BFE6" />
      <directionalLight position={[10, 4, 12]} intensity={0.5} color="#565C96" />

      <CanvasCapture onReady={onCapture} />

      {/* The habitat's own air (AmbientAir) replaces the old motes here. */}
      <Atmosphere motes={!air} sky={profile.sky ?? null} />
      {air && (
        <AmbientAir field={field} elevation={params.elevation} waterLevel={params.waterLevel} fieldSize={size} follow={size > FIELD_SIZE} {...air} />
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
        accumulation={accumulation}
        far={far}
        cue={waterCue}
        farGround={farGround}
        size={size}
      />
      {children}

      {profile.orbit && (
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
      )}
    </Canvas>
  )
}
