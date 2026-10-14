import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AIR_GLSL } from '../lib/air'
import { colonyAirUniforms } from '../lib/airColony'
import { mulberry32 } from '../lib/noise'

/*
 * Basin haze — rework, phase 4 (revised): mist lying low over the water and
 * the low ground.
 *
 * A volume, not particles. Every pixel's line of sight is marched through a
 * slab of air above the water, stopping where it meets the land (so hills
 * hide the mist behind them). Seen across a basin the mist gathers; seen
 * from above it is thin, as mist is.
 *
 * One continuous 3D field, not layers. (An earlier version built it from
 * thin horizontal sheets; seen edge-on from a low camera, a sheet collapses
 * into a flat band or rectangle.) The mist is densest low and thins upward,
 * and is eroded more the higher it is, so it rises in billows rather than
 * ending at a ceiling. Its forms come from 3D gradient noise, bent by the
 * air's swirls; the air low down drifts more slowly than higher up, blended
 * smoothly with height, so the forms slide over one another without any
 * layer having an edge. Broad soft areas of it alternate with clear air.
 *
 * Colour: translucent silver-blue and lilac from a slow field of its own;
 * mint and pearl only as a faint iridescence at the thin fringes of the
 * forms, here and there. Distant air is cooler, for depth.
 *
 * Laid over the scene in two parts, so it adds atmosphere without flattening
 * it: a slight veiling (what lies behind is dimmed a little, capped), and the
 * mist's own light screened on top (it shows over the dark water and basins
 * and adds little over bright membranes; it can never clip). Drawn at half
 * resolution (it has no fine detail), before the dust and the residue, which
 * stay crisp in front of it.
 */

/** The haze's slab: from below the lowest ground to this far above the water. */
const TOP = 2.4

/** Steps along each line of sight through the slab. */
const STEPS = 36

/** Extinction per unit of density per unit of length. */
const EXTINCTION = '0.16'

/** How much of the mist's opacity dims the scene behind it, and the most it may. */
const VEILING = '0.45'
const MAX_VEILING = '0.18'

/** The brightest the mist's own light may be (it is screened over the scene). */
const MAX_LIGHT = '0.36'

/** Draws the haze at this share of the screen's resolution, in CSS pixels
 *  (the mist has no fine detail, so a dense display gains nothing). */
const RESOLUTION = 0.5

/** How far around a point the ground is judged for the veils, in floor cells. */
const AROUND = 6

/** The floor blurred over AROUND cells each way (a separable box blur), as a
 *  texture like the floor's, so the veils read it once. */
function makeFloorAround(floor) {
  const { n, grid, min, max } = floor
  const blur = (src, dx, dy) => {
    const out = new Float32Array(n * n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let k = -AROUND; k <= AROUND; k++) {
          const x = Math.min(n - 1, Math.max(0, i + k * dx))
          const y = Math.min(n - 1, Math.max(0, j + k * dy))
          sum += src[y * n + x]
        }
        out[j * n + i] = sum / (2 * AROUND + 1)
      }
    }
    return out
  }
  const soft = blur(blur(grid, 1, 0), 0, 1)
  const data = new Uint8Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = Math.round(((soft[i] - min) / (max - min)) * 255)
    data[i * 4 + 3] = 255
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

/** Tileable low-frequency 2D noise (fbm of value noise), N×N, a different one in each channel: the broad areas of mist and the colour field. */
function makeNoise(N = 256) {
  const random = mulberry32(5521)
  const octaves = [
    { cells: 4, amp: 0.55 },
    { cells: 8, amp: 0.27 },
    { cells: 16, amp: 0.13 },
    { cells: 32, amp: 0.05 },
  ]
  const smooth = (t) => t * t * (3 - 2 * t)
  const data = new Uint8Array(N * N * 4)
  for (let channel = 0; channel < 4; channel++) {
    const lattices = octaves.map(({ cells }) => Array.from({ length: cells * cells }, () => random()))
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let v = 0
        octaves.forEach(({ cells, amp }, o) => {
          const L = lattices[o]
          const x = (i / N) * cells
          const y = (j / N) * cells
          const x0 = Math.floor(x)
          const y0 = Math.floor(y)
          const fx = smooth(x - x0)
          const fy = smooth(y - y0)
          const at = (a, b) => L[((b + cells) % cells) * cells + ((a + cells) % cells)]
          const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
          const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
          v += amp * (top * (1 - fy) + bottom * fy)
        })
        data[(j * N + i) * 4 + channel] = Math.round(Math.min(1, Math.max(0, v)) * 255)
      }
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

/**
 * Tileable 3D gradient noise (fbm, three octaves), N³, in R: the mist's own
 * forms. Gradient rather than value noise, which has blocky, axis-aligned
 * shapes. About 40 ms to make.
 */
function makeNoise3(N = 64) {
  const random = mulberry32(7741)
  const octaves = [
    { cells: 4, amp: 0.6 },
    { cells: 8, amp: 0.28 },
    { cells: 16, amp: 0.12 },
  ]
  const grads = octaves.map(({ cells }) => {
    const g = new Float32Array(cells * cells * cells * 3)
    for (let i = 0; i < cells * cells * cells; i++) {
      const z = random() * 2 - 1
      const a = random() * Math.PI * 2
      const r = Math.sqrt(1 - z * z)
      g[i * 3] = r * Math.cos(a)
      g[i * 3 + 1] = r * Math.sin(a)
      g[i * 3 + 2] = z
    }
    return g
  })
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  const data = new Uint8Array(N * N * N)
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let v = 0
        octaves.forEach(({ cells, amp }, o) => {
          const g = grads[o]
          const x = (i / N) * cells
          const y = (j / N) * cells
          const z = (k / N) * cells
          const x0 = Math.floor(x)
          const y0 = Math.floor(y)
          const z0 = Math.floor(z)
          let sum = 0
          for (let c = 0; c < 8; c++) {
            const dx = c & 1
            const dy = (c >> 1) & 1
            const dz = (c >> 2) & 1
            const gi = ((((z0 + dz) % cells) * cells + ((y0 + dy) % cells)) * cells + ((x0 + dx) % cells)) * 3
            const fx = x - x0 - dx
            const fy = y - y0 - dy
            const fz = z - z0 - dz
            const w =
              (dx ? fade(x - x0) : 1 - fade(x - x0)) *
              (dy ? fade(y - y0) : 1 - fade(y - y0)) *
              (dz ? fade(z - z0) : 1 - fade(z - z0))
            sum += w * (g[gi] * fx + g[gi + 1] * fy + g[gi + 2] * fz)
          }
          v += amp * sum
        })
        // About ±0.42 at most: centred on 0.5.
        data[(k * N + j) * N + i] = Math.round(Math.min(1, Math.max(0, v / 0.84 + 0.5)) * 255)
      }
    }
  }
  const t = new THREE.Data3DTexture(data, N, N, N)
  t.format = THREE.RedFormat
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.unpackAlignment = 1
  t.needsUpdate = true
  return t
}

const VERTEX = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  ${AIR_GLSL}
  uniform sampler2D uNoise;
  uniform highp sampler3D uNoise3;
  uniform sampler2D uFloorAround;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uEye;
  uniform float uAmount;
  varying vec2 vNdc;

  // The air's mean heading (lib/air.js), and across it.
  const vec2 ALONG = vec2(0.980, -0.199);
  const vec2 ACROSS = vec2(0.199, 0.980);

  // Translucent silver-blue and lilac; mint and pearl only as accents.
  // (Green never above red in the base colours: over the dark blue water
  // even a slightly green silver reads as teal.)
  // Cooler and cleaner than at first (study 09, palette): the mist is
  // screened over the scene, which lifts the darks the most, and near-white
  // silver and lilac laid over dark indigo came out as grey-lavender — the
  // muddy midtone. With more blue in them they lift the darks toward a cool
  // blue instead of toward grey. Density, extent and veiling are unchanged.
  const vec3 SILVER = vec3(0.7, 0.7, 1.0);
  const vec3 ICE = vec3(0.64, 0.64, 1.0);
  const vec3 LILAC = vec3(0.78, 0.67, 1.0);
  const vec3 MINT = vec3(0.64, 0.92, 0.84);
  const vec3 PEARL = vec3(1.0, 0.92, 0.85);

  vec4 noiseAt(vec2 uv) {
    return texture2D(uNoise, uv);
  }

  // The ground's height averaged over a few units around xz (as airFloor).
  float floorAround(vec2 xz) {
    if (abs(xz.x) > uFieldSize * 0.5 || abs(xz.y) > uFieldSize * 0.5) return uWaterY;
    vec2 uv = clamp(xz / uFieldSize + 0.5, 0.0, 1.0);
    return uFloorMin + texture2D(uFloorAround, uv).r * uFloorSpan;
  }

  // Where a layer moving at 'rate' times the air's drift has carried xz from.
  vec2 carried(vec2 xz, float rate, float t) {
    return xz - ALONG * rate * uDrift * 0.12 * t;
  }


  // The mist's density at p (-1 under the land), and its colour there.
  float haze(vec3 p, float t, float dist, out vec3 colour) {
    colour = vec3(0.0);
    float fl = airFloor(p.xz);
    float above = p.y - fl;
    if (above < 0.0) return -1.0;
    float y = p.y - uWaterY;

    // Over the low ground: judged over a few units around (the blurred
    // floor), so the mist thins towards the hills instead of ending at a
    // shore.
    float low = 1.0 - smoothstep(0.25, 1.3, floorAround(p.xz) - uWaterY);
    // Densest low, thinning upward; soft at the ground.
    float env = exp(-max(y, 0.0) / 0.7) * smoothstep(0.0, 0.25, above);
    // Within the land: none over the void beyond its edge.
    float reach = 1.0 - smoothstep(0.42, 0.5, max(abs(p.x), abs(p.z)) / uFieldSize);
    // Where the mist gathers: broad soft areas, with clear air between.
    float area = smoothstep(0.44, 0.62, noiseAt(carried(p.xz, 0.6, t) / 34.0 + vec2(0.13, 0.71)).r);
    float where = low * env * reach * area;
    if (where < 0.002) return 0.0;

    // The mist itself is a 3D field, so its forms have no flat tops, bottoms
    // or sides: lumps of mist somewhat flatter than tall and longer along
    // the drift, bent by the air's swirls. The air low down drifts more
    // slowly than higher up; the two blend smoothly with height, so the
    // forms slide over one another without any layer having an edge.
    vec2 q = p.xz + airWaves(p, t).xy * 18.0;
    vec3 s = vec3(dot(q, ALONG) / 1.25, y * 2.2, dot(q, ACROSS));
    float D = uDrift * 0.12 * t;
    float slow = texture(uNoise3, (s - vec3(0.5 * D, 0.0, 0.0)) / 22.0).r;
    float fast = texture(uNoise3, (s - vec3(1.4 * D, 0.0, 0.0)) / 22.0 + vec3(0.37, 0.11, 0.53)).r;
    float fine = texture(uNoise3, (s - vec3(0.9 * D, 0.0, 0.0)) / 7.0 + vec3(0.71, 0.29, 0.07)).r;
    float n = 0.78 * mix(slow, fast, smoothstep(0.2, 1.4, y)) + 0.22 * fine;
    // Eroded more the higher it is, so it thins upward in billows, not at a
    // ceiling, with soft edges that grow softer with height, so the forms
    // grade into clear air rather than ending. Thresholds from the noise's
    // own distribution: at the water it starts about the 50th percentile
    // and is full by the 85th; Haze lowers them a little.
    float thr = 0.5 + 0.085 * y - 0.025 * uAmount;
    float cover = smoothstep(thr, thr + 0.13 + 0.06 * y, n);

    // Haze thickens the mist much less than linearly: 1 is about 1.3× 0.5.
    float d = 3.8 * cover * where * pow(2.0 * uAmount, 0.35);
    if (d <= 0.0) return 0.0;

    // Colour: translucent silver-blue and lilac from a slow field of its
    // own, a little icier near the water.
    vec4 c = noiseAt(carried(p.xz, 0.7, t) / 23.0 + vec2(0.52, 0.08) + 0.0008 * t);
    colour = mix(SILVER, LILAC, smoothstep(0.36, 0.64, c.a));
    colour = mix(colour, ICE, 0.35 * (1.0 - smoothstep(0.0, 0.6, y)));
    // Iridescence: only at the thin fringes of the forms, and only here and
    // there, a faint mint or pearl.
    float fringe = 4.0 * cover * (1.0 - cover);
    float accent = fringe * smoothstep(0.6, 0.72, c.r);
    colour = mix(colour, mix(MINT, PEARL, smoothstep(0.42, 0.58, c.g)), 0.55 * accent);
    // Distant air is cooler and dimmer, for depth.
    colour = mix(colour, ICE * 0.85, 0.3 * smoothstep(12.0, 32.0, dist));
    return d;
  }

  void main() {
    // The line of sight through this pixel.
    vec4 view = uInvProj * vec4(vNdc, 1.0, 1.0);
    vec3 dir = normalize((uCamWorld * vec4(view.xyz / view.w, 0.0)).xyz);
    vec3 eye = uEye;

    // Where it is inside the slab.
    float yTop = uWaterY + ${TOP.toFixed(1)};
    float yBottom = uFloorMin - 0.1;
    float t0 = 0.0;
    float t1 = 30.0;
    if (abs(dir.y) > 1e-4) {
      float ta = (yTop - eye.y) / dir.y;
      float tb = (yBottom - eye.y) / dir.y;
      t0 = max(min(ta, tb), 0.0);
      t1 = min(max(ta, tb), 30.0);
    } else if (eye.y > yTop || eye.y < yBottom) {
      t1 = 0.0;
    }
    if (t1 <= t0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Lines of sight that graze the thin layer of mist cross a long stretch
    // of it and stack it into a flat band along the horizon: thin it along
    // them. (Looking down at the land, as the default view does, it is
    // untouched.)
    float grazing = mix(0.4, 1.0, smoothstep(0.03, 0.16, abs(dir.y)));

    // March, dithered per pixel so the steps never band.
    float dt = (t1 - t0) / ${STEPS}.0;
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float T = 1.0;
    vec3 L = vec3(0.0);
    for (int i = 0; i < ${STEPS}; i++) {
      float t = t0 + (float(i) + jitter) * dt;
      vec3 colour;
      float d = haze(eye + dir * t, uTime, t, colour);
      if (d < 0.0) break;
      // None near the eye (the camera never sits in a fog, and close views
      // keep a clear foreground), thinning into the distance — early enough
      // that from a low camera the far mist does not stack, along grazing
      // lines of sight, into a flat band on the horizon.
      d *= smoothstep(1.0, 6.0, t) * (1.0 - smoothstep(12.0, 30.0, t)) * grazing;
      if (d <= 0.0) continue;
      float a = 1.0 - exp(-d * dt * ${EXTINCTION});
      L += T * a * colour;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
    // Light (screened over the scene) and veiling (dims it), both capped.
    float brightest = max(L.r, max(L.g, L.b));
    if (brightest > ${MAX_LIGHT}) L *= ${MAX_LIGHT} / brightest;
    gl_FragColor = vec4(L, min((1.0 - T) * ${VEILING}, ${MAX_VEILING}));
  }
`

const COMPOSITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Read softened: the mist has no fine detail, and this hides the march's
// dithering (four bilinear taps cover 4×4 texels of the half-resolution
// buffer).
const SOFT_READ = /* glsl */ `
  uniform sampler2D uHaze;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec4 hazeAt() {
    vec2 o = uTexel * 0.9;
    return 0.25 * (texture2D(uHaze, vUv + vec2(o.x, o.y)) + texture2D(uHaze, vUv + vec2(-o.x, o.y))
                 + texture2D(uHaze, vUv + vec2(o.x, -o.y)) + texture2D(uHaze, vUv - o));
  }
`

// Veiling: dims the scene behind the mist a little.
const VEIL_FRAGMENT = /* glsl */ `
  ${SOFT_READ}
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, hazeAt().a);
  }
`

// The mist's own light, screened over the scene.
const LIGHT_FRAGMENT = /* glsl */ `
  ${SOFT_READ}
  void main() {
    gl_FragColor = vec4(hazeAt().rgb, 0.0);
  }
`

function airUniforms() {
  return {
    uTime: { value: 0 },
    uDrift: { value: 0.5 },
    uCurl: { value: 0.5 },
    uFloor: { value: null },
    uFloorMin: { value: 0 },
    uFloorSpan: { value: 1 },
    uFieldSize: { value: 26 },
    uWaterY: { value: 0 },
    // Declared by AIR_GLSL; the haze does not use the colonies.
    ...colonyAirUniforms(),
  }
}

const clearColor = new THREE.Color()

/**
 * The basin haze, from the same floor and clock as the rest of the air
 * (AmbientAir). `amount` 0..1; at 0 nothing is drawn.
 */
export default function AirHaze({ floor, floorTexture, time, drift, amount }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const layer = useMemo(() => {
    const noise = makeNoise()
    const noise3 = makeNoise3()
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
    const quad = new THREE.PlaneGeometry(2, 2)
    const march = new THREE.Mesh(
      quad,
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...airUniforms(),
          uNoise: { value: noise },
          uNoise3: { value: noise3 },
          uFloorAround: { value: null },
          uInvProj: { value: new THREE.Matrix4() },
          uCamWorld: { value: new THREE.Matrix4() },
          uEye: { value: new THREE.Vector3() },
          uAmount: { value: 0.5 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      }),
    )
    march.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(march)
    // Laid over the scene in two parts: the veiling dims what lies behind
    // (scene × (1 − veiling)), then the mist's light is screened on top
    // (scene + light × (1 − scene)), so it never clips.
    const texel = { value: new THREE.Vector2(1, 1) }
    const overlay = (fragmentShader, blendSrc, blendDst) => {
      const mesh = new THREE.Mesh(
        quad,
        new THREE.ShaderMaterial({
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendSrc,
          blendDst,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor,
          uniforms: { uHaze: { value: target.texture }, uTexel: texel },
          vertexShader: COMPOSITE_VERTEX,
          fragmentShader,
        }),
      )
      mesh.frustumCulled = false
      return mesh
    }
    const veil = overlay(VEIL_FRAGMENT, THREE.ZeroFactor, THREE.OneMinusSrcAlphaFactor)
    const light = overlay(LIGHT_FRAGMENT, THREE.OneMinusDstColorFactor, THREE.OneFactor)
    return { noise, noise3, target, texel, scene, march, veil, light, camera: new THREE.Camera() }
  }, [])
  useEffect(
    () => () => {
      layer.noise.dispose()
      layer.noise3.dispose()
      layer.target.dispose()
      layer.march.geometry.dispose()
      layer.march.material.dispose()
      layer.veil.material.dispose()
      layer.light.material.dispose()
    },
    [layer],
  )

  const floorAround = useMemo(() => makeFloorAround(floor), [floor])
  useEffect(() => () => floorAround.dispose(), [floorAround])

  useFrame(() => {
    const on = amount > 0.001
    layer.veil.visible = on
    layer.light.visible = on
    if (!on) return
    const u = layer.march.material.uniforms
    u.uTime.value = time.current
    u.uDrift.value = drift
    u.uFloor.value = floorTexture
    u.uFloorAround.value = floorAround
    u.uFloorMin.value = floor.min
    u.uFloorSpan.value = floor.max - floor.min
    u.uWaterY.value = floor.waterY
    u.uAmount.value = amount
    u.uInvProj.value.copy(camera.projectionMatrixInverse)
    u.uCamWorld.value.copy(camera.matrixWorld)
    u.uEye.value.setFromMatrixPosition(camera.matrixWorld)

    const scale = Math.min(gl.getPixelRatio(), 1) * RESOLUTION
    const w = Math.max(1, Math.round(size.width * scale))
    const h = Math.max(1, Math.round(size.height * scale))
    if (layer.target.width !== w || layer.target.height !== h) {
      layer.target.setSize(w, h)
      layer.texel.value.set(1 / w, 1 / h)
    }
    const before = gl.getRenderTarget()
    const autoClear = gl.autoClear
    gl.getClearColor(clearColor)
    const clearAlpha = gl.getClearAlpha()
    gl.setRenderTarget(layer.target)
    gl.setClearColor(0x000000, 0)
    gl.clear(true, false, false)
    gl.autoClear = false
    gl.render(layer.scene, layer.camera)
    gl.autoClear = autoClear
    gl.setClearColor(clearColor, clearAlpha)
    gl.setRenderTarget(before)
  })

  return (
    <>
      <primitive object={layer.veil} renderOrder={3} />
      <primitive object={layer.light} renderOrder={3.5} />
    </>
  )
}
