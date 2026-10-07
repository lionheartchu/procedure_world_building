import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeSimplex2 } from '../lib/noise'

/**
 * The cross-section of the slab's edge, as (outward, down) offsets in world
 * units from the terrain's rim: tucked just under the rim, rounding out a
 * little, curving back in (a slight undercut), and gone well before it gets
 * deep. Short on purpose — it is mist below the land, not a wall under it.
 */
const PROFILE = [
  [-0.03, 0],
  [0.03, -0.05],
  [0.06, -0.14],
  [0.05, -0.26],
  [0.0, -0.4],
  [-0.07, -0.56],
  [-0.12, -0.75],
]

/** Samples along each side of the square field. */
const PER_SIDE = 80

/**
 * Walk the field's perimeter and hang the profile from it. The rim height
 * comes from the scatter world's own ground (base field, relief and
 * sediment lift), so the edge meets the terrain without a seam. Thickness
 * and lip vary slowly along the perimeter, so the edge is not extruded.
 */
function buildEdge(world) {
  const half = world.size / 2
  const noise = makeSimplex2(9311)
  const corners = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]
  const ring = []
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side]
    const [bx, bz] = corners[(side + 1) % 4]
    for (let k = 0; k < PER_SIDE; k++) {
      const t = k / PER_SIDE
      ring.push([ax + (bx - ax) * t, az + (bz - az) * t])
    }
  }

  const I = ring.length
  const J = PROFILE.length - 1
  const position = new Float32Array(I * (J + 1) * 3)
  const depth = new Float32Array(I * (J + 1))
  const above = new Float32Array(I * (J + 1))
  const perimeter = world.size * 4

  for (let i = 0; i < I; i++) {
    const [x, z] = ring[i]
    // Outward: the side's normal, the diagonal at a corner.
    let ox = Math.abs(x) >= half - 1e-6 ? Math.sign(x) : 0
    let oz = Math.abs(z) >= half - 1e-6 ? Math.sign(z) : 0
    const len = Math.hypot(ox, oz) || 1
    ox /= len
    oz /= len
    const [u, v] = world.toUV(x, z)
    const top = world.groundY(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)))
    const along = (i / I) * perimeter
    const thick = 1 + 0.3 * noise(along * 0.12, 3.1)
    const lip = 1 + 0.35 * noise(along * 0.21, 7.7)
    for (let j = 0; j <= J; j++) {
      const [out, down] = PROFILE[j]
      const k = i * (J + 1) + j
      const o = out * (out > 0 ? lip : 1)
      position[k * 3] = x + ox * o
      position[k * 3 + 1] = top + down * thick
      position[k * 3 + 2] = z + oz * o
      depth[k] = j / J
      above[k] = top - world.waterY
    }
  }

  const index = []
  for (let i = 0; i < I; i++) {
    const n = (i + 1) % I
    for (let j = 0; j < J; j++) {
      const a = i * (J + 1) + j
      const b = n * (J + 1) + j
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1))
  geo.setAttribute('aAbove', new THREE.BufferAttribute(above, 1))
  geo.setIndex(index)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

const hex = (value) => ({ value: new THREE.Color(value) })

/**
 * Mist, not a body. The first version shaded the edge like a solid: a lit
 * lip over a body that deepened toward black — darker than the night behind
 * it (measured 6/7/25 against 11/13/41), so from a low camera the land sat
 * on a black halo. Now the edge is unlit: it starts at the terrain's own
 * dim rim value, turns into a faint lavender mist a touch *lighter* than the
 * dark around it, and dissolves early. Nothing on it is ever darker than the
 * atmosphere, and nothing glows.
 */
function createEdgeMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uTop: hex('#2C2B62'),
        uMist: hex('#24244F'),
        uWet: hex('#1C1D45'),
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aDepth;
      attribute float aAbove;
      varying float vDepth;
      varying float vAbove;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vDepth = aDepth;
        vAbove = aAbove;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uMist;
      uniform vec3 uWet;
      varying float vDepth;
      varying float vAbove;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        // Where the rim is under water, start from the water's darker value.
        float wet = 1.0 - smoothstep(-0.2, 0.2, vAbove);
        vec3 top = mix(uTop, uWet, wet);
        vec3 col = mix(top, uMist, smoothstep(0.0, 0.55, vDepth));
        // A very slow drift in the mist, so it is not a flat band.
        float drift = 0.94 + 0.06 * sin(uTime * 0.12 + vWorld.x * 0.35 - vWorld.z * 0.25);
        float alpha = (1.0 - smoothstep(0.08, 0.95, vDepth)) * drift;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/**
 * The slab's edge: a body under the terrain's rim, so in Scatter the ground
 * reads as a thick, grounded mass rather than a cloth cut off at its border.
 * Part of the base revision, Scatter only for now.
 */
export default function BaseEdge({ world }) {
  const mesh = useRef(null)
  const geometry = useMemo(() => buildEdge(world), [world])
  const material = useMemo(() => createEdgeMaterial(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useFrame((state) => {
    const uniforms = mesh.current?.material.uniforms
    if (uniforms) uniforms.uTime.value = state.clock.elapsedTime
  })
  return <mesh ref={mesh} geometry={geometry} material={material} />
}
