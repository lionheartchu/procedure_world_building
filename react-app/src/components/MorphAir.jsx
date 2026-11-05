import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * The Habitat's M1 (lib/morph.js, docs/19-collective-morphogenesis.md): the
 * cue in the air, drawn where the commons carries it. Each puff is drawn as
 * what it is: a soft region of tinted air at its own place, radius and
 * strength, with the places it passed in the last few seconds behind it, so
 * it reads as air moving rather than as a disc. Nothing here is matter (the
 * films carry that, drawn as before) and nothing here changes the cue.
 *
 *   - colour by how long it has travelled: lilac as it leaves, toward ice,
 *     then silver as it fades (the air study's palette, made paler for D's
 *     sky); never champagne, which marks matter crossing
 *   - opacity by its strength (a little compressed, strength^0.8 over a
 *     reference), so a cue that has spread wide and thin is only faintly there
 *   - tints a step deeper than the pale sky, so the air changes hue rather
 *     than brightening (pale tints laid over D's pale world read as glow)
 *   - two sheets each, one lying over the ground and one standing, each
 *     fading as it turns edge-on (the air study's way of drawing a body of
 *     air), broken by a slow noise so neither shows its outline
 */

/** Places kept behind each puff, and how far apart in time (s). */
const TRAIL = { n: 5, every: 0.8 }
/** Most puffs drawn at once. */
const MOST = 160
/** Strength that shows fully, how it is compressed, and the most opacity a sheet reaches. */
const SHOW = { full: 0.005, power: 0.7, alpha: 0.32 }
/**
 * Fade near the camera, by the distance to the puff's near side (units), so
 * a visitor standing in a wide puff is not inside a wall of colour.
 */
const NEAR = [0.4, 2.2]

const VERTEX = /* glsl */ `
  attribute vec4 aPuff;   // x, y (its floor + height), z, radius
  attribute vec4 aLook;   // opacity, travelled (0..1), seed, sheet (0 lying, 1 standing)
  varying vec2 vUv;
  varying vec4 vLook;
  varying float vFacing;
  varying float vNear;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = position.xy;
    vLook = aLook;
    vec3 c = aPuff.xyz;
    float r = aPuff.w;
    vec3 toCam = cameraPosition - c;
    float dist = length(toCam);
    vec3 v = toCam / max(dist, 1e-4);
    vec3 world;
    if (aLook.w < 0.5) {
      // Lying over the ground.
      world = c + vec3(position.x, 0.0, position.y) * r;
      world.y -= 0.25;
      vFacing = abs(v.y);
    } else {
      // Standing, turned to the camera about the vertical, lower than wide.
      vec3 side = normalize(vec3(-v.z, 0.0, v.x));
      world = c + side * position.x * r + vec3(0.0, 1.0, 0.0) * position.y * r * 0.45;
      vFacing = 1.0 - abs(v.y);
    }
    vNear = smoothstep(${NEAR[0].toFixed(2)}, ${NEAR[1].toFixed(2)}, dist - 0.7 * r);
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uLilac;
  uniform vec3 uIce;
  uniform vec3 uSilver;
  varying vec2 vUv;
  varying vec4 vLook;
  varying float vFacing;
  varying float vNear;
  #include <common>
  #include <fog_pars_fragment>
  float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float seed = vLook.z;
    vec2 q = vUv * 1.7 + seed * 17.0 + vec2(uTime * 0.03, -uTime * 0.02);
    float n = vnoise(q) * 0.6 + vnoise(q * 2.3 + 3.1) * 0.4;
    float body = (1.0 - smoothstep(0.15, 1.0, d)) * (0.45 + 0.9 * n);
    float t = vLook.y;
    vec3 col = mix(uLilac, uIce, smoothstep(0.0, 0.45, t));
    col = mix(col, uSilver, smoothstep(0.45, 1.0, t));
    float a = vLook.x * body * smoothstep(0.08, 0.5, vFacing) * vNear;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.6));
    #include <colorspace_fragment>
    #include <fog_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`

export default function MorphAir({ commons }) {
  const clock = useThree((s) => s.clock)
  const trails = useRef(new Map())
  const mesh = useMemo(() => {
    const quad = new THREE.PlaneGeometry(2, 2, 1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = quad.index
    geometry.setAttribute('position', quad.attributes.position)
    const n = MOST * TRAIL.n * 2
    const puff = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    const look = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aPuff', puff)
    geometry.setAttribute('aLook', look)
    geometry.instanceCount = 0
    const material = new THREE.ShaderMaterial({
      fog: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Premultiplied, laid over the scene: tinted air, not added light.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          // The air study's lilac, ice and silver, a step deeper than D's sky.
          // Apart from the scene's lavender by hue, not by brightness: a
          // pinker lilac, an ice blue, a silver.
          uLilac: { value: new THREE.Color('#C39BDF') },
          uIce: { value: new THREE.Color('#90B6EC') },
          uSilver: { value: new THREE.Color('#B3BBD8') },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    })
    const m = new THREE.Mesh(geometry, material)
    m.frustumCulled = false
    m.renderOrder = 5
    m.name = 'morph-air'
    return m
  }, [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  useFrame(() => {
    const K = commons.K
    const now = commons.n * K.step
    mesh.material.uniforms.uTime.value = clock.elapsedTime
    const puffA = mesh.geometry.attributes.aPuff
    const lookA = mesh.geometry.attributes.aLook
    const seen = new Set()
    let k = 0
    let drawn = 0
    for (const { p, x, z, s, r, age } of commons.now()) {
      if (drawn >= MOST) break
      const a = SHOW.alpha * Math.min(1, Math.pow(s / SHOW.full, SHOW.power))
      if (a < 0.004) continue
      drawn++
      seen.add(p.id)
      // Where it has been, a place every TRAIL.every seconds.
      let tr = trails.current.get(p.id)
      if (!tr) trails.current.set(p.id, (tr = { list: [], last: -1e9 }))
      if (now - tr.last >= TRAIL.every) {
        tr.last = now
        tr.list.unshift([x, z])
        if (tr.list.length > TRAIL.n) tr.list.pop()
      }
      const y = commons.floorAt(x, z) + K.height
      const travelled = Math.min(1, age / (K.fade * 1.6))
      const places = [[x, z], ...tr.list.slice(1)]
      for (let j = 0; j < places.length; j++) {
        const [px, pz] = places[j]
        const fall = 1 - j / (TRAIL.n + 0.5)
        const rr = r * (1 - 0.12 * j)
        for (let sheet = 0; sheet < 2; sheet++) {
          puffA.setXYZW(k, px, y, pz, rr)
          lookA.setXYZW(k, a * fall * (sheet ? 0.8 : 1), travelled, (p.id * 0.618 + j * 0.13) % 1, sheet)
          k++
        }
      }
    }
    for (const id of trails.current.keys()) if (!seen.has(id)) trails.current.delete(id)
    mesh.geometry.instanceCount = k
    puffA.needsUpdate = true
    lookA.needsUpdate = true
  })

  return <primitive object={mesh} />
}
