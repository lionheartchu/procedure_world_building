import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Atmosphere from './Atmosphere'
import CanvasCapture from './CanvasCapture'
import VolumeMesh from './VolumeMesh'

const DEEP_INDIGO = '#0B0E1E'
const HAZE = '#262B4F'

/**
 * The volume study's own scene. Same palette, fog and sky as the terrain view,
 * but framed on a single suspended mass rather than on a landscape, and lit so
 * that cavities and the cut face stay readable from the outside.
 */
export default function VolumeScene({
  params,
  wireframe,
  onStats,
  eventSource,
  onCapture,
}) {
  return (
    <Canvas
      className="scene-canvas"
      camera={{ position: [8.4, 4.6, 9.2], fov: 38, near: 0.1, far: 220 }}
      dpr={[1, 2]}
      // preserveDrawingBuffer lets the Library grab a thumbnail of the frame.
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      eventSource={eventSource}
      eventPrefix="client"
      style={{ pointerEvents: 'none' }}
    >
      <color attach="background" args={[DEEP_INDIGO]} />
      <fogExp2 attach="fog" args={[HAZE, 0.035]} />

      {/* Backlight for silhouette, cool fill so the interior does not go black. */}
      <ambientLight intensity={1.15} color="#7A74AE" />
      <directionalLight position={[-9, 7, -8]} intensity={1.6} color="#C6BFE6" />
      <directionalLight position={[7, 2.5, 8]} intensity={0.55} color="#565C96" />
      <pointLight position={[0, -1.5, 0]} intensity={6} distance={9} color="#4A4F8C" />

      <CanvasCapture onReady={onCapture} />

      <Atmosphere spread={26} lift={9} />
      <VolumeMesh params={params} wireframe={wireframe} onStats={onStats} />

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.45}
        minDistance={5}
        maxDistance={30}
        maxPolarAngle={Math.PI * 0.86}
        target={[0, -0.6, 0]}
      />
    </Canvas>
  )
}
