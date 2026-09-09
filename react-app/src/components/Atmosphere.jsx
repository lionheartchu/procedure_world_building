import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FIELD_SIZE } from './Terrain'
import { mulberry32 } from '../lib/noise'

const MOTE_COUNT = 420

/**
 * Suspended sediment in the air: sparse, slow, lavender. Depth here comes from
 * fog and layering rather than from more geometry.
 */
function Motes() {
  const ref = useRef(null)

  const { positions, drift } = useMemo(() => {
    const positions = new Float32Array(MOTE_COUNT * 3)
    const drift = new Float32Array(MOTE_COUNT * 2)
    const random = mulberry32(9137)
    for (let i = 0; i < MOTE_COUNT; i++) {
      positions[i * 3] = (random() - 0.5) * FIELD_SIZE * 1.5
      positions[i * 3 + 1] = random() * 4.5 - 1
      positions[i * 3 + 2] = (random() - 0.5) * FIELD_SIZE * 1.5
      drift[i * 2] = random() * Math.PI * 2
      drift[i * 2 + 1] = 0.3 + random() * 0.7
    }
    return { positions, drift }
  }, [])

  const basePositions = useMemo(() => positions.slice(), [positions])

  useFrame((state) => {
    const points = ref.current
    if (!points) return
    const t = state.clock.elapsedTime
    const array = points.geometry.attributes.position.array
    for (let i = 0; i < MOTE_COUNT; i++) {
      const i3 = i * 3
      const phase = drift[i * 2]
      const speed = drift[i * 2 + 1]
      array[i3] = basePositions[i3] + Math.sin(t * 0.045 * speed + phase) * 1.6
      array[i3 + 1] =
        basePositions[i3 + 1] + Math.sin(t * 0.03 * speed + phase * 1.7) * 0.5
      array[i3 + 2] =
        basePositions[i3 + 2] + Math.cos(t * 0.038 * speed + phase) * 1.6
    }
    points.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color="#B9B2DA"
        transparent
        opacity={0.26}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  )
}

/** Inverted gradient shell: a quiet horizon the terrain can fade into. */
function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          uHorizon: { value: new THREE.Color('#3B3F70') },
          uZenith: { value: new THREE.Color('#0C0F26') },
        },
        vertexShader: `
          varying vec3 vWorld;
          void main() {
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uHorizon;
          uniform vec3 uZenith;
          varying vec3 vWorld;
          void main() {
            // View direction, so the haze band sits on the true horizon
            // rather than on the dome's equator.
            float y = normalize(vWorld - cameraPosition).y;
            float t = smoothstep(-0.02, 0.5, y);
            vec3 sky = mix(uHorizon, uZenith, t);
            // A little extra lift right along the horizon line.
            sky += uHorizon * 0.4 * (1.0 - smoothstep(0.0, 0.12, abs(y)));
            gl_FragColor = vec4(sky, 1.0);
          }
        `,
      }),
    [],
  )

  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[70, 32, 24]} />
    </mesh>
  )
}

export default function Atmosphere() {
  return (
    <>
      <Sky />
      <Motes />
    </>
  )
}
