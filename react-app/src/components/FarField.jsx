import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { FAR } from '../lib/farField'

/**
 * The far field's ground (lib/farField.js builds it; its water is the slab's
 * own, drawn by Terrain). A plain lit ground in the slab ground's colours —
 * no record, no streams, no light held in matter, since none of that exists
 * out there — darkening below the water line and given to the haze.
 */
const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uLightDir;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uSubmerged;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform float uWaterY;
  uniform float uElevation;
  uniform vec2 uDissolve;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec3 n = normalize(vNormal);
    float above = (vWorld.y - uWaterY) / max(uElevation, 1e-3);
    vec3 base = mix(uLow, uHigh, smoothstep(0.0, 0.35, above));
    base = mix(base, uSubmerged, smoothstep(0.0, -0.12, above));
    float wrap = dot(n, uLightDir) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);
    vec3 col = base * (ambient * 0.9 + vec3(0.62, 0.6, 0.78) * wrap * 0.55);
    // Far out it thins into the sky's own horizon, so the land ends in haze, not at a line.
    gl_FragColor = vec4(col, 1.0 - smoothstep(uDissolve.x, uDissolve.y, length(vWorld.xz)));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

const hex = (h) => ({ value: new THREE.Color(h) })

/** `palette`: { low, high, submerged } (the Habitat's `look=soft` comparison); the slab ground's own otherwise. */
export default function FarField({ ground, waterY, elevation, palette = null }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(ground.position, 3))
    geo.setIndex(new THREE.BufferAttribute(ground.index, 1))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  }, [ground])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        fog: true,
        transparent: true,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
            uLow: hex(palette?.low ?? '#4E4B80'),
            uHigh: hex(palette?.high ?? '#6B6698'),
            uSubmerged: hex(palette?.submerged ?? '#24264E'),
            uSkyAmbient: hex('#4C4A7E'),
            uGroundAmbient: hex('#22243F'),
            uWaterY: { value: waterY },
            uElevation: { value: elevation },
            uDissolve: { value: new THREE.Vector2(...FAR.dissolve) },
          },
        ]),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      }),
    [waterY, elevation, palette],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  // Before every other transparent surface: the far water lies over it.
  return <mesh geometry={geometry} material={material} renderOrder={-1} frustumCulled={false} />
}
