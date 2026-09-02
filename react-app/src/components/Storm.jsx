import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const PARTICLE_COUNT = 2800
const RAIN_COUNT = 600

function createStormPositions(count, radius, height) {
  const positions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)
  const offsets = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const r = Math.pow(Math.random(), 0.55) * radius
    const y = (Math.random() - 0.5) * height

    positions[i * 3] = Math.cos(theta) * r
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = Math.sin(theta) * r
    speeds[i] = 0.15 + Math.random() * 0.55
    offsets[i] = Math.random() * Math.PI * 2
  }

  return { positions, speeds, offsets }
}

function createRainPositions(count, radius, height) {
  const positions = new Float32Array(count * 3)
  const speeds = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const r = Math.random() * radius
    positions[i * 3] = Math.cos(theta) * r
    positions[i * 3 + 1] = (Math.random() - 0.5) * height
    positions[i * 3 + 2] = Math.sin(theta) * r
    speeds[i] = 1.2 + Math.random() * 2.4
  }

  return { positions, speeds }
}

export default function Storm({ params }) {
  const cloudRef = useRef(null)
  const mistRef = useRef(null)
  const rainRef = useRef(null)
  const coreRef = useRef(null)
  const glowRef = useRef(null)
  const fillLightRef = useRef(null)
  const warmLightRef = useRef(null)
  const flashRef = useRef(0)
  const paramsRef = useRef(params)

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  const cloud = useMemo(() => createStormPositions(PARTICLE_COUNT, 2.6, 2.2), [])
  const mist = useMemo(() => createStormPositions(900, 3.4, 2.8), [])
  const rain = useMemo(() => createRainPositions(RAIN_COUNT, 2.8, 3.2), [])

  const cloudPositions = useMemo(() => cloud.positions.slice(), [cloud])
  const mistPositions = useMemo(() => mist.positions.slice(), [mist])
  const rainPositions = useMemo(() => rain.positions.slice(), [rain])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const {
      intensity,
      drift,
      glow,
      rain: rainAmount,
      scale,
      turbulence,
      lightning,
    } = paramsRef.current

    if (cloudRef.current) {
      const pos = cloudRef.current.geometry.attributes.position.array
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3
        const ox = cloud.positions[i3]
        const oy = cloud.positions[i3 + 1]
        const oz = cloud.positions[i3 + 2]
        const speed = cloud.speeds[i]
        const offset = cloud.offsets[i]
        const angle = t * speed * 0.35 * drift + offset
        const swirl = (0.12 + Math.sin(t * 0.4 + offset) * 0.04) * turbulence
        const lift = Math.sin(t * 0.7 + offset) * 0.18 * turbulence

        pos[i3] =
          (ox * Math.cos(angle) - oz * Math.sin(angle) + Math.cos(t + offset) * swirl) *
          scale
        pos[i3 + 1] = (oy + lift) * scale
        pos[i3 + 2] =
          (ox * Math.sin(angle) + oz * Math.cos(angle) + Math.sin(t * 0.8 + offset) * swirl) *
          scale
      }
      cloudRef.current.geometry.attributes.position.needsUpdate = true
      cloudRef.current.rotation.y = t * 0.04 * drift
      cloudRef.current.material.opacity = 0.35 + intensity * 0.55
      cloudRef.current.material.size = 0.03 + intensity * 0.03
    }

    if (mistRef.current) {
      const pos = mistRef.current.geometry.attributes.position.array
      for (let i = 0; i < 900; i++) {
        const i3 = i * 3
        const ox = mist.positions[i3]
        const oy = mist.positions[i3 + 1]
        const oz = mist.positions[i3 + 2]
        const speed = mist.speeds[i]
        const offset = mist.offsets[i]
        const angle = t * speed * 0.12 * drift + offset

        pos[i3] = (ox * Math.cos(angle) - oz * Math.sin(angle)) * scale
        pos[i3 + 1] = (oy + Math.sin(t * 0.35 + offset) * 0.25 * turbulence) * scale
        pos[i3 + 2] = (ox * Math.sin(angle) + oz * Math.cos(angle)) * scale
      }
      mistRef.current.geometry.attributes.position.needsUpdate = true
      mistRef.current.material.opacity = 0.12 + intensity * 0.28
      mistRef.current.material.size = 0.08 + intensity * 0.06
    }

    if (rainRef.current) {
      const pos = rainRef.current.geometry.attributes.position.array
      const visibleCount = Math.floor(RAIN_COUNT * rainAmount)
      for (let i = 0; i < RAIN_COUNT; i++) {
        const i3 = i * 3
        if (i >= visibleCount) {
          pos[i3 + 1] = 100
          continue
        }
        pos[i3 + 1] -= rain.speeds[i] * delta * (0.6 + rainAmount * 1.4)
        if (pos[i3 + 1] < -1.6 * scale) {
          pos[i3 + 1] = 1.6 * scale
          const theta = Math.random() * Math.PI * 2
          const r = Math.random() * 2.6 * scale
          pos[i3] = Math.cos(theta) * r
          pos[i3 + 2] = Math.sin(theta) * r
        }
      }
      rainRef.current.geometry.attributes.position.needsUpdate = true
      rainRef.current.material.opacity = 0.15 + rainAmount * 0.5
    }

    if (coreRef.current) {
      coreRef.current.scale.setScalar(scale)
      coreRef.current.material.opacity = 0.08 + intensity * 0.18
      coreRef.current.material.emissiveIntensity = 0.15 + glow * 0.45
    }

    flashRef.current -= delta
    if (flashRef.current <= 0 && Math.random() < 0.004 + lightning * 0.02) {
      flashRef.current = 0.1 + Math.random() * 0.22
    }

    if (glowRef.current) {
      const base = 0.2 + glow * 0.55
      const pulse =
        flashRef.current > 0
          ? base * (2.2 + Math.random() * 1.6) * (0.5 + lightning)
          : base + Math.sin(t * 0.9) * 0.12 * glow
      glowRef.current.intensity = pulse
      glowRef.current.position.x = Math.sin(t * 0.3 * drift) * 0.8 * scale
      glowRef.current.position.y = 0.4 * scale
      glowRef.current.position.z = Math.cos(t * 0.25 * drift) * 0.6 * scale
      glowRef.current.distance = 6 + scale * 4
    }

    if (fillLightRef.current) {
      fillLightRef.current.intensity = 0.25 + glow * 0.45
      fillLightRef.current.position.set(-1.5 * scale, 1.2 * scale, scale)
    }

    if (warmLightRef.current) {
      warmLightRef.current.intensity = 0.1 + glow * 0.25
      warmLightRef.current.position.set(1.8 * scale, -0.4 * scale, -1.2 * scale)
    }
  })

  return (
    <group>
      <points ref={cloudRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[cloudPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.045}
          color="#9ec9d9"
          transparent
          opacity={0.72}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>

      <points ref={mistRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[mistPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.11}
          color="#6f8fa3"
          transparent
          opacity={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>

      <points ref={rainRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[rainPositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.02}
          color="#c8e4ef"
          transparent
          opacity={0.45}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>

      <mesh ref={coreRef}>
        <sphereGeometry args={[1.15, 32, 32]} />
        <meshStandardMaterial
          color="#4a6d7c"
          emissive="#2a4a58"
          emissiveIntensity={0.35}
          transparent
          opacity={0.18}
          roughness={1}
          metalness={0}
        />
      </mesh>

      <pointLight
        ref={glowRef}
        color="#b8e6f5"
        intensity={0.4}
        distance={8}
        position={[0, 0.4, 0]}
      />
      <pointLight
        ref={fillLightRef}
        color="#7ea8b8"
        intensity={0.55}
        distance={10}
        position={[-1.5, 1.2, 1]}
      />
      <pointLight
        ref={warmLightRef}
        color="#d4c4a8"
        intensity={0.25}
        distance={8}
        position={[1.8, -0.4, -1.2]}
      />
    </group>
  )
}
