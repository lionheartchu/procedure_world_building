import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildHeightGrid } from '../lib/field'
import { SED_DISPLAY, SIM_RES } from '../lib/sediment'
import { PALETTE, RAMP } from '../lib/palette'

export const FIELD_SIZE = 26

// The simulation runs on its own fixed clock so its behaviour does not change
// with frame rate or with the render grid resolution.
const SIM_STEP = 1 / 30
const MAX_STEPS_PER_FRAME = 3

/** How much of a unit of sediment shows up as actual elevation. Kept small. */
const SEDIMENT_LIFT = 1

const colorUniform = (rgb) => ({ value: new THREE.Color(rgb[0], rgb[1], rgb[2]) })
const hexUniform = (hex) => ({ value: new THREE.Color(hex) })

/**
 * Height-aware terrain shader.
 *
 * Colour comes from the base height relative to the water line (the ramp is
 * mirrored from `palette.js`), normals are derived per-fragment so the surface
 * stays faceted, and the sediment texture both lifts the surface slightly and
 * tints it. Mint appears only where the simulation is currently moving
 * material.
 */
function createTerrainMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSediment: { value: null },
        uFieldSize: { value: FIELD_SIZE },
        uSedScale: { value: SED_DISPLAY },
        uSedLift: { value: 1 },
        uWaterLevel: { value: 0.5 },

        uDeepBasin: colorUniform(RAMP.deepBasin),
        uSubmerged: colorUniform(RAMP.submerged),
        uWetMargin: colorUniform(RAMP.wetMargin),
        uFlats: colorUniform(RAMP.flats),
        uMidLavender: colorUniform(RAMP.midLavender),
        uCrest: colorUniform(RAMP.crest),
        uSedimentTint: hexUniform('#B4ADD8'),
        uMint: hexUniform(PALETTE.moonlitMint),
        uHaze: hexUniform('#5E5C93'),

        uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
        uLightColor: hexUniform('#8E88C0'),
        uSkyAmbient: hexUniform('#4C4A7E'),
        uGroundAmbient: hexUniform('#22243F'),
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aHeight;

      uniform sampler2D uSediment;
      uniform float uFieldSize;
      uniform float uSedScale;
      uniform float uSedLift;

      varying float vHeight;
      varying float vSediment;
      varying float vActivity;
      varying vec3 vWorldPos;

      #include <common>
      #include <fog_pars_vertex>

      void main() {
        // Field coordinates, matching field.sample(u, v) exactly.
        vec2 fuv = position.xz / uFieldSize + 0.5;
        vec4 sed = texture2D(uSediment, fuv);

        vSediment = sed.r * uSedScale;
        vActivity = sed.g;
        vHeight = aHeight;

        vec3 transformed = position;
        transformed.y += vSediment * uSedLift;

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uWaterLevel;
      uniform float uSedScale;

      uniform vec3 uDeepBasin;
      uniform vec3 uSubmerged;
      uniform vec3 uWetMargin;
      uniform vec3 uFlats;
      uniform vec3 uMidLavender;
      uniform vec3 uCrest;
      uniform vec3 uSedimentTint;
      uniform vec3 uMint;
      uniform vec3 uHaze;

      uniform vec3 uLightDir;
      uniform vec3 uLightColor;
      uniform vec3 uSkyAmbient;
      uniform vec3 uGroundAmbient;

      varying float vHeight;
      varying float vSediment;
      varying float vActivity;
      varying vec3 vWorldPos;

      #include <common>
      #include <fog_pars_fragment>

      // Mirrors sedimentColor() in lib/palette.js.
      vec3 rampColor(float d) {
        vec3 c = uDeepBasin;
        c = mix(c, uSubmerged, smoothstep(-0.35, -0.06, d));
        c = mix(c, uWetMargin, smoothstep(-0.06, 0.0, d));
        c = mix(c, uFlats, smoothstep(0.0, 0.12, d));
        c = mix(c, uMidLavender, smoothstep(0.10, 0.34, d));
        c = mix(c, uCrest, smoothstep(0.32, 0.60, d));
        return c;
      }

      void main() {
        // Faceted normals from screen-space derivatives (core in WebGL2), so
        // vertex displacement never needs a normal rebuild on the CPU.
        vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (n.y < 0.0) n = -n;

        vec3 base = rampColor(vHeight - uWaterLevel);

        // Eased so the first sediment to arrive already reads, rather than
        // only showing up once a basin is nearly full.
        float sed = clamp(vSediment / uSedScale, 0.0, 1.0);
        base = mix(base, uSedimentTint, pow(sed, 0.75) * 0.6);

        vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);
        float wrap = dot(n, uLightDir) * 0.5 + 0.5;
        vec3 lit = base * (ambient + uLightColor * wrap);

        // Soft grazing-angle lift keeps silhouettes hazy rather than hard.
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
        lit += uHaze * fres * 0.3;

        // The one mint in the scene: material currently on the move. The curve
        // keeps it to the few channels actually carrying flow.
        float flowActive = clamp(vActivity, 0.0, 1.0);
        lit += uMint * pow(flowActive, 1.3) * 0.5;

        gl_FragColor = vec4(lit, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/**
 * The sediment field: base terrain from the height field, a tidal plane, and
 * the running simulation written into a texture the terrain shader reads.
 */
export default function Terrain({ field, params, sim, simParams, running, wireframe }) {
  const { resolution, elevation, waterLevel } = params

  const material = useMemo(() => createTerrainMaterial(), [])

  // One texture carries the simulation to the GPU: R = sediment, G = activity.
  const { texture, pixels } = useMemo(() => {
    const pixels = new Uint8Array(SIM_RES * SIM_RES * 4)
    const texture = new THREE.DataTexture(pixels, SIM_RES, SIM_RES, THREE.RGBAFormat)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return { texture, pixels }
  }, [])

  material.uniforms.uSediment.value = texture

  const geometry = useMemo(() => {
    const grid = buildHeightGrid(field, resolution)
    const geo = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE, resolution, resolution)
    geo.rotateX(-Math.PI / 2)

    // After the rotation, vertex k = j * (res + 1) + i sits at u = i / res,
    // v = j / res — the same order buildHeightGrid() writes.
    const position = geo.attributes.position
    const heights = new Float32Array(position.count)
    for (let k = 0; k < position.count; k++) {
      const h = Number.isFinite(grid[k]) ? grid[k] : 0.5
      heights[k] = h
      // Centre the field on the origin so amplitude does not slide the terrain.
      position.setY(k, (h - 0.5) * elevation)
    }
    geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1))
    position.needsUpdate = true
    // Positions changed after construction, so the culling volumes have to be
    // rebuilt or the mesh can be culled at the wrong moment.
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
    return geo
  }, [field, resolution, elevation])

  const waterY = (waterLevel - 0.5) * elevation
  const waterRef = useRef(null)
  const accumulator = useRef(0)
  const uploaded = useRef(-1)
  const liveGeometry = useRef(null)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime

    // Uniforms are pushed here rather than from an effect: one place, always
    // after commit, and no lifecycle to get wrong.
    const uniforms = material.uniforms
    uniforms.uSediment.value = texture
    uniforms.uWaterLevel.value = waterLevel
    uniforms.uSedLift.value = elevation * SEDIMENT_LIFT
    material.wireframe = wireframe

    // Release the previous grid once a new resolution has taken over.
    if (liveGeometry.current && liveGeometry.current !== geometry) {
      liveGeometry.current.dispose()
    }
    liveGeometry.current = geometry

    // Everything moves, nothing moves fast: a ~50s tide.
    if (waterRef.current) {
      waterRef.current.position.y = waterY + Math.sin(t * 0.125) * elevation * 0.012
    }

    if (running) {
      accumulator.current += Math.min(delta, 0.12)
      let steps = 0
      while (accumulator.current >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
        sim.step(SIM_STEP, { ...simParams, waterLevel })
        accumulator.current -= SIM_STEP
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator.current = 0
    }

    if (sim.version !== uploaded.current) {
      uploaded.current = sim.version
      const { sediment, activity } = sim
      for (let i = 0; i < sediment.length; i++) {
        const p = i * 4
        pixels[p] = Math.min(255, (sediment[i] / SED_DISPLAY) * 255)
        pixels[p + 1] = Math.min(255, activity[i] * 255)
        pixels[p + 3] = 255
      }
      texture.needsUpdate = true
    }
  })

  return (
    <group>
      <mesh geometry={geometry} material={material} />

      <mesh position={[0, waterY, 0]} rotation={[-Math.PI / 2, 0, 0]} ref={waterRef}>
        <planeGeometry args={[FIELD_SIZE * 7, FIELD_SIZE * 7]} />
        <meshStandardMaterial
          color="#2A3060"
          emissive="#565C96"
          emissiveIntensity={0.32}
          roughness={0.45}
          metalness={0.12}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
