import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildGreybox, greyboxSites, greyboxState } from '../lib/tissueGreybox'

/**
 * Study 10's tissue greybox, behind `?lifecycle=1&conduit=1&greybox=1`
 * (lib/tissueGreybox.js builds it): the form only, before any material.
 * Opaque, writing depth, no transparency, glow, fog or haze:
 *
 *   - `greybox=1`: unlit. One grey on a leaf's upper side, a darker grey
 *     on its under side, so the space under it reads without light
 *   - `greybox=shaded`: the same greys with one plain light from above, to
 *     read the form's curvature (a reading aid, not a material)
 *
 * Rebuilt when the simulation's state at its knots changes enough to show.
 *
 * Unfinished and paused (24 October 2026): a study of form, not a final one.
 */

const LOOK = { outer: '#ABA8B6', inner: '#5D5A69', light: [0.35, 0.85, 0.4] }

/** Steps the state is quantised to before the form is rebuilt. */
const STEPS = 40

const VERTEX = /* glsl */ `
  attribute float aInner;
  varying float vInner;
  varying vec3 vNormal;
  void main() {
    vInner = aInner;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uOuter;
  uniform vec3 uInner;
  uniform vec3 uLight;
  uniform float uShade;
  varying float vInner;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    // Its under side (the back of its triangles) darker.
    vec3 base = mix(uOuter, uInner, max(clamp(vInner, 0.0, 1.0), gl_FrontFacing ? 0.0 : 1.0));
    float lambert = 0.45 + 0.55 * max(dot(n, normalize(uLight)), 0.0);
    gl_FragColor = vec4(base * mix(1.0, lambert, uShade), 1.0);
    #include <colorspace_fragment>
  }
`

export default function ConduitGreybox({ lifecycle, world, visible }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
          uOuter: { value: new THREE.Color(LOOK.outer) },
          uInner: { value: new THREE.Color(LOOK.inner) },
          uLight: { value: new THREE.Vector3(...LOOK.light) },
          uShade: { value: 0 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      }),
    [],
  )
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), material)
    m.name = 'conduit-greybox'
    m.frustumCulled = false
    m.visible = false
    return m
  }, [material])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      material.dispose()
    },
    [mesh, material],
  )

  const built = useRef({ fold: null, sites: null, key: '' })

  useFrame(() => {
    material.uniforms.uShade.value = lifecycle.greybox === 'shaded' ? 1 : 0
    const fold = lifecycle.fold
    const B = built.current
    if (!fold) {
      mesh.visible = false
      return
    }
    if (B.fold !== fold) {
      B.fold = fold
      B.sites = greyboxSites(fold, lifecycle.conduit)
      B.key = ''
    }
    const states = greyboxState(B.sites, lifecycle)
    const q = (v) => Math.round(v * STEPS)
    const key = states.map((s) => [q(s.memory), q(s.open), ...s.arms.map(q)].join(',')).join('|')
    if (key !== B.key) {
      B.key = key
      const g = buildGreybox(B.sites, states, world)
      mesh.geometry.dispose()
      const geo = new THREE.BufferGeometry()
      if (g) {
        geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3))
        geo.setAttribute('aInner', new THREE.BufferAttribute(g.inner, 1))
        geo.setIndex(g.index)
      }
      mesh.geometry = geo
      // For inspection: the knots, the state the form was built for, and its cost.
      mesh.userData = { sites: B.sites, states, ms: g?.ms, grid: g?.grid, triangles: (g?.index.length ?? 0) / 3, leaves: g?.leaves }
    }
    mesh.visible = visible
  })

  return <primitive object={mesh} />
}
