import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Storm from './Storm'

export default function Scene({ params, eventSource }) {
  return (
    <Canvas
      className="scene-canvas"
      camera={{ position: [0, 1.4, 5.2], fov: 45, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      eventSource={eventSource}
      eventPrefix="client"
      style={{ pointerEvents: 'none' }}
    >
      <color attach="background" args={['#0d1419']} />
      <fog attach="fog" args={['#0d1419', 4.5, 14]} />

      <ambientLight intensity={0.28} color="#8aa4b3" />
      <directionalLight
        position={[3, 5, 2]}
        intensity={0.45}
        color="#c5d8e2"
      />

      <Storm params={params} />

      <OrbitControls
        enableDamping
        dampingFactor={0.06}
        minDistance={2.5}
        maxDistance={10}
        maxPolarAngle={Math.PI * 0.85}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
