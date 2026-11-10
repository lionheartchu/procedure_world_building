import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { AIR, AIR_GLSL, airDensity, airVelocity, colonyAirData, hoverHeight, makeFloor } from '../lib/air'
import { colonyAirUniforms, setColonyAir } from '../lib/airColony'
import { mulberry32 } from '../lib/noise'
import AirWisps from './AirWisps'
import AirHaze from './AirHaze'
import AirFragments from './AirFragments'

/*
 * The scene's air — rework, phases 1–5: the base atmosphere (dust), residue
 * carried by moving air (AirWisps), the colonies' local air (the field bends,
 * slows and lifts around their forms, lib/air.js; a few residents linger
 * there; matter near them takes a passing tint), the basin haze (AirHaze),
 * and rare fragments of membrane suspended in the air (AirFragments).
 */

/** Internal check: ?debug=colonyair shows only the air the colonies touch. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'colonyair'

/** Kinds of dust by each grain's own random (traits.b): soft, speck, resident, grain. */
const KIND = { soft: 0.02, speck: 0.15, resident: 0.172 }

/** Grains simulated on the GPU: SIDE² (Density draws a share of them). */
const SIDE = 128
const COUNT = SIDE * SIDE

/** The scene's fog density (Scene.jsx), so far grains fade with it. */
const FOG = 0.026

/** Each grain's lifespan, seconds: [shortest, range]. */
const LIFE = [40, 70]

/** Tries at finding a birthplace the density map accepts. */
const TRIES = 8

/* --- the simulation (GPU) -------------------------------------------- */

/**
 * One step of the field for every grain: position in xyz, life in w. When a
 * life ends the grain is reborn where the density map accepts it, at its own
 * height over the floor.
 */
const SIMULATE = /* glsl */ `
  uniform float uDelta;
  uniform sampler2D uTraits;
  // The volume's middle (xz): the origin, or the visitor when it follows them.
  uniform vec2 uCentre;
  ${AIR_GLSL}

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 s = texture2D(texturePosition, uv);
    vec4 traits = texture2D(uTraits, uv);
    bool resident = traits.b >= ${KIND.speck} && traits.b < ${KIND.resident};
    float pref = resident ? 0.15 + 1.7 * pow(traits.r, 1.6) : airHover(traits.r);
    float life = s.w + uDelta / traits.g;
    vec3 p = s.xyz;
    // A resident that has drifted out of its colony (where it is no longer
    // seen) ends its life soon and is born again among the forms, so most
    // residents are lingering in a colony at any moment, without any pull
    // gathering them.
    if (resident) life += 4.0 * uDelta / traits.g * (1.0 - smoothstep(0.02, 0.2, colonyNear(p)));
    if (life >= 1.0 && resident && uColonyCount > 0) {
      // A resident is born in a colony, among its forms.
      float e = fract(uTime * 0.0173) * 91.0;
      int pick = int(floor(hash12(uv * 53.3 + e) * float(uColonyCount)));
      vec4 c = uColonies[0];
      for (int i = 0; i < ${6}; i++) if (i == pick) c = uColonies[i];
      float a = hash12(uv * 19.1 + e) * 6.2832;
      float r = c.w * (0.25 + 0.85 * sqrt(hash12(uv * 23.7 + e)));
      vec2 xz = c.xz + vec2(cos(a), sin(a)) * r;
      p = vec3(xz.x, airFloor(xz) + pref, xz.y);
      life = 0.0;
    } else if (life >= 1.0) {
      float e = fract(uTime * 0.0173) * 91.0;
      // Accept a try with the map's probability; if none is accepted, keep
      // the densest try, never a random one.
      vec2 xz = vec2(0.0);
      float best = -1.0;
      for (int k = 0; k < ${TRIES}; k++) {
        float ek = e + float(k) * 7.31;
        vec2 c = uCentre + (vec2(hash12(uv * 113.1 + ek), hash12(uv * 71.7 + ek + 5.3)) - 0.5) * ${(2 * AIR.halfWidth).toFixed(1)};
        // A little more matter is born around colonies.
        float d = min(1.0, airDensity(c, uTime) + 0.6 * colonyNear(vec3(c.x, airFloor(c) + 0.5, c.y)));
        if (d > best) { best = d; xz = c; }
        if (hash12(uv * 37.9 + ek + 2.1) < d) { xz = c; break; }
      }
      p = vec3(xz.x, airFloor(xz) + pref, xz.y);
      life = 0.0;
    } else {
      p += airVelocity(p, pref) * uDelta;
      float W = ${AIR.halfWidth.toFixed(1)};
      p.xz = mod(p.xz - uCentre + W, 2.0 * W) - W + uCentre;
      p.y = min(p.y, ${AIR.top.toFixed(1)});
    }
    gl_FragColor = vec4(p, life);
  }
`

/* --- the look ----------------------------------------------------------- */

/**
 * Three sizes of the same matter, by each grain's own random (traits.b):
 *
 *   grain  most of it: tiny and mostly very faint; round or nearly so
 *   speck  about one in eight: a little larger, often elongated or irregular
 *          (a lobed outline), each turning slowly
 *   soft   one in fifty: larger and very faint, as if out of focus; seen only
 *          in the foreground, for depth
 *
 * Depth: grains fade out close to the camera and far from it, so the middle
 * distance carries the field; specks reach a little nearer and further; soft
 * ones exist only near the camera. Everything thins with height over the
 * ground, so the sky stays nearly empty, and a grain with only sky behind it
 * dims (it would read as a star); everything fades with the scene's fog. A
 * point smaller than a pixel and a quarter fades away rather than being
 * drawn larger, so distant matter becomes atmosphere, never snow.
 *
 * Colour: pale lavender, silver-blue, blue-white and, rarely, a restrained
 * mint; cooler over the low ground and water, and drifting across the scene
 * in broad, slow regions so the palette is never one flat purple.
 *
 * Additive with low alpha. Because the field never concentrates matter (see
 * lib/air.js), no place can gather enough grains to glow.
 */
const POINT_VERTEX = /* glsl */ `
  ${AIR_GLSL}
  attribute vec2 aRef;
  uniform vec2 uCentre;
  uniform sampler2D uPositions;
  uniform sampler2D uTraits;
  uniform float uScale;
  uniform float uDpr;
  uniform float uDebug;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vAspect;
  varying float vAngle;
  varying float vLobe;
  varying float vSoft;
  varying float vSeed;

  const vec3 LAVENDER = vec3(0.80, 0.77, 0.95);
  const vec3 SILVER_BLUE = vec3(0.70, 0.80, 1.0);
  const vec3 BLUE_WHITE = vec3(0.88, 0.93, 1.0);
  const vec3 MINT = vec3(0.70, 0.92, 0.85);

  void main() {
    vec4 s = texture2D(uPositions, aRef);
    vec4 traits = texture2D(uTraits, aRef);
    vec3 p = s.xyz;
    float kind = traits.b;
    float tone = traits.a;
    float u1 = fract(tone * 7.31);
    float u2 = fract(tone * 13.7);
    float u3 = fract(tone * 3.97);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;

    float size;
    float alpha;
    vAspect = 1.0;
    vLobe = 0.0;
    vSoft = 0.0;
    if (kind < 0.02) {
      // soft
      size = mix(0.08, 0.15, u1);
      alpha = mix(0.04, 0.08, u2);
      vSoft = 1.0;
      alpha *= smoothstep(0.5, 1.4, dist) * (1.0 - smoothstep(5.0, 11.0, dist));
    } else if (kind < ${KIND.speck}) {
      // speck
      size = mix(0.026, 0.05, u1);
      alpha = mix(0.18, 0.55, pow(u2, 1.4));
      vAspect = mix(1.0, 2.6, u3 * u3);
      vLobe = step(0.6, fract(tone * 5.3));
      alpha *= smoothstep(1.2, 3.0, dist) * (1.0 - 0.85 * smoothstep(16.0, 36.0, dist));
    } else if (kind < ${KIND.resident}) {
      // resident: states of the same matter, lingering in a colony
      if (u1 < 0.45) {
        // soft floating matter
        size = mix(0.06, 0.12, u2);
        alpha = mix(0.22, 0.36, u3);
        vSoft = 0.6;
        vAspect = mix(1.0, 1.4, u3);
      } else if (u1 < 0.82) {
        // a translucent fragment, turning slowly
        size = mix(0.07, 0.15, u2);
        alpha = mix(0.26, 0.4, u3);
        vAspect = mix(1.4, 2.6, u3);
        vLobe = 1.0;
      } else {
        // an occasional brighter mote
        size = mix(0.024, 0.045, u2);
        alpha = mix(0.5, 0.75, u3);
      }
      // Only near a colony: it fades as it drifts away.
      alpha *= smoothstep(0.03, 0.25, colonyNear(p));
      alpha *= smoothstep(0.8, 2.0, dist) * (1.0 - smoothstep(16.0, 30.0, dist));
    } else {
      // grain
      size = mix(0.01, 0.022, u1);
      alpha = 0.07 + 0.45 * pow(u2, 2.2);
      vAspect = mix(1.0, 1.35, u3);
      alpha *= smoothstep(1.6, 4.0, dist) * (1.0 - 0.9 * smoothstep(13.0, 32.0, dist));
    }
    bool resident = kind >= ${KIND.speck} && kind < ${KIND.resident};

    // Where the map is dense the matter reads a little thicker, where thin a
    // little fainter, so the bands show as structure, not only as counts.
    if (!resident) alpha *= 0.4 + 1.2 * airDensity(p.xz, uTime);

    // Thinner with height over the ground: the sky stays nearly empty.
    alpha *= 1.0 - 0.85 * smoothstep(1.5, 4.5, p.y - airFloor(p.xz));

    // Against the sky a pale grain has far more contrast than against the
    // land, and reads as a star. Look on past the grain along the line of
    // sight: if no ground or water comes behind it, it dims.
    if (kind >= 0.02) {
      vec3 dir = normalize(p - cameraPosition);
      float clear = 1e3;
      for (int k = 1; k <= 6; k++) {
        vec3 q = p + dir * (float(k) * 3.0);
        clear = min(clear, q.y - airFloor(q.xz));
      }
      alpha *= mix(1.0, 0.25, smoothstep(-0.3, 0.6, clear));
    }
    alpha *= exp(-${FOG} * ${FOG} * dist * dist);
    // Fade at the volume's sides, where grains wrap, and at birth and death.
    vec2 side = abs(p.xz - uCentre);
    alpha *= 1.0 - smoothstep(${(AIR.halfWidth - 3).toFixed(1)}, ${AIR.halfWidth.toFixed(1)}, max(side.x, side.y));
    alpha *= smoothstep(0.0, 0.12, s.w) * (1.0 - smoothstep(0.85, 1.0, s.w));

    // Colour: by the grain, cooled over low ground and water, and shifted in
    // broad slow regions across the scene.
    vec3 col = mix(LAVENDER, SILVER_BLUE, smoothstep(0.35, 0.65, tone));
    col = mix(col, BLUE_WHITE, smoothstep(0.75, 0.95, tone) * 0.8);
    float low = 1.0 - smoothstep(0.15, 1.5, airFloor(p.xz) - uWaterY);
    float region = 0.5 + 0.5 * sin(0.08 * p.x - 0.05 * p.z + 0.01 * uTime + 1.0);
    col = mix(col, SILVER_BLUE, 0.35 * low);
    col = mix(col, MINT, step(0.9, u1) * (0.3 + 0.45 * region * low));
    // Near a colony: residents take its colours; other matter a passing tint.
    if (resident) col = mix(SILVER_BLUE, colonyHue(p + vec3(tone * 4.0), uTime), 0.75);
    else col = mix(col, colonyHue(p, uTime), 0.55 * colonyTint(p, uTime));
    vColor = col;
    if (uDebug > 0.5) {
      // Only the air the colonies touch: held matter in mint, residents in pearl.
      float held = 0.0;
      for (int j = 0; j < ${28}; j++) {
        if (j >= uObsCount) break;
        held += obstacleMask(j, p, 1.0);
      }
      float near = colonyNear(p);
      alpha = resident ? alpha * 2.0 : alpha * 2.5 * smoothstep(0.02, 0.2, max(near, held));
      vColor = resident ? vec3(1.0, 0.85, 0.6) : mix(vec3(0.6, 0.62, 0.8), vec3(0.4, 1.0, 0.75), smoothstep(0.0, 0.4, held));
    }

    // Below a pixel and a quarter the light fades rather than spreading.
    float px = size * uScale / max(dist, 0.1);
    float least = 1.25 * uDpr;
    alpha *= min(1.0, (px / least) * (px / least));
    vAlpha = alpha;
    vAngle = tone * 31.0 + uTime * mix(-0.05, 0.05, u2) * (resident ? 3.0 : 1.0);
    vSeed = tone;
    gl_PointSize = clamp(px, least, 40.0 * uDpr);
    gl_Position = projectionMatrix * mv;
  }
`

const POINT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vAspect;
  varying float vAngle;
  varying float vLobe;
  varying float vSoft;
  varying float vSeed;
  void main() {
    if (vAlpha <= 0.002) discard;
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float c = cos(vAngle);
    float s = sin(vAngle);
    q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    q.y *= vAspect;
    float r = length(q);
    // An irregular, lobed outline for some specks.
    float th = atan(q.y, q.x);
    float edge = 1.0 - vLobe * (0.16 * (0.5 + 0.5 * sin(2.0 * th + vSeed * 40.0)) + 0.12 * (0.5 + 0.5 * sin(3.0 * th + vSeed * 70.0)));
    float d = r / edge;
    if (d > 1.0) discard;
    float shape = exp(-d * d * mix(3.2, 1.6, vSoft)) * (1.0 - smoothstep(0.75, 1.0, d));
    gl_FragColor = vec4(vColor * vAlpha * shape, 1.0);
  }
`

/**
 * The scene's air: fine suspended matter for the whole habitat, moved by one
 * divergence-free field and born where a composed density map allows
 * (lib/air.js).
 */
export default function AmbientAir({
  field,
  elevation,
  waterLevel,
  density,
  drift,
  curl,
  wisps,
  wispStrength,
  colony,
  colonies,
  blooms,
  haze,
  // The air's own skins (AirFragments). The Habitat leaves them out, so the
  // only films in its air are the lifecycle's, carrying matter.
  fragments = true,
  // The ground's extent (units), and whether the volume follows the visitor
  // (a world wider than the volume: the Habitat's D). The same grains either
  // way; following, the colonies it holds are the visitor's nearest.
  fieldSize = 26,
  follow = false,
  // The Habitat's M2: the commons' cue drawn in the wisps (AirWisps `cue`),
  // and (following) the wisps' colony air at the visitor's nearest colonies.
  cue = null,
  wispFollow = false,
  // M3: the cue drawn the same wherever the visitor stands (AirWisps `cueGlobal`).
  cueGlobal = false,
}) {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)

  const floor = useMemo(() => makeFloor(field, { size: fieldSize, elevation, waterLevel }), [field, fieldSize, elevation, waterLevel])
  const floorTexture = useMemo(() => {
    const data = new Uint8Array(floor.n * floor.n * 4)
    for (let i = 0; i < floor.n * floor.n; i++) {
      const v = Math.round(((floor.grid[i] - floor.min) / (floor.max - floor.min)) * 255)
      data[i * 4] = v
      data[i * 4 + 3] = 255
    }
    const t = new THREE.DataTexture(data, floor.n, floor.n, THREE.RGBAFormat)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [floor])
  useEffect(() => () => floorTexture.dispose(), [floorTexture])

  // Each grain's own constants: hover height, lifespan, size class, tone.
  const { traits, seedTraits } = useMemo(() => {
    const random = mulberry32(4207)
    const data = new Float32Array(COUNT * 4)
    for (let i = 0; i < COUNT; i++) {
      data[i * 4] = random()
      data[i * 4 + 1] = LIFE[0] + random() * LIFE[1]
      data[i * 4 + 2] = random()
      data[i * 4 + 3] = random()
      // Residents live 25–75 s.
      if (isResident(data[i * 4 + 2])) data[i * 4 + 1] = 25 + 50 * random()
    }
    const t = new THREE.DataTexture(data, SIDE, SIDE, THREE.RGBAFormat, THREE.FloatType)
    t.needsUpdate = true
    return { traits: t, seedTraits: data }
  }, [])

  // The simulation. Built once per landform; the controls are uniforms. The
  // first frame is already composed: grains start where the map puts them.
  const sim = useMemo(() => {
    const gpu = new GPUComputationRenderer(SIDE, SIDE, gl)
    const start = gpu.createTexture()
    const random = mulberry32(911)
    const a = start.image.data
    for (let i = 0; i < COUNT; i++) {
      let x = 0
      let z = 0
      let best = -1
      for (let k = 0; k < TRIES; k++) {
        const cx = (random() - 0.5) * 2 * AIR.halfWidth
        const cz = (random() - 0.5) * 2 * AIR.halfWidth
        const d = airDensity(cx, cz, 0, floor)
        if (d > best) [best, x, z] = [d, cx, cz]
        if (random() < d) {
          ;[x, z] = [cx, cz]
          break
        }
      }
      a[i * 4] = x
      a[i * 4 + 1] = floor.at(x, z) + hoverHeight(seedTraits[i * 4])
      a[i * 4 + 2] = z
      // Residents are born again within seconds, in a colony.
      a[i * 4 + 3] = isResident(seedTraits[i * 4 + 2]) ? 0.92 + 0.08 * random() : random()
    }
    const variable = gpu.addVariable('texturePosition', SIMULATE, start)
    gpu.setVariableDependencies(variable, [variable])
    variable.material.uniforms = {
      ...variable.material.uniforms,
      ...airUniforms(),
      uDelta: { value: 0 },
      uTraits: { value: traits },
    }
    const error = gpu.init()
    if (error) {
      console.warn('Ambient air disabled:', error)
      return null
    }
    return { gpu, variable }
  }, [gl, traits, seedTraits, floor])
  useEffect(() => () => sim?.gpu.dispose(), [sim])

  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const ref = new Float32Array(COUNT * 2)
    for (let i = 0; i < COUNT; i++) {
      ref[i * 2] = ((i % SIDE) + 0.5) / SIDE
      ref[i * 2 + 1] = (Math.floor(i / SIDE) + 0.5) / SIDE
    }
    geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 2))
    // Positions come from the texture; this is only for three's bookkeeping.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 40)
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...airUniforms(),
        uPositions: { value: null },
        uTraits: { value: traits },
        uScale: { value: 1 },
        uDpr: { value: 1 },
        uDebug: { value: DEBUG ? 1 : 0 },
      },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
    })
    return new THREE.Points(geo, material)
  }, [traits])
  useEffect(
    () => () => {
      points.geometry.dispose()
      points.material.dispose()
    },
    [points],
  )

  // The colonies as the air sees them (phase 3): their membranes and bounds.
  const allColonyData = useMemo(() => colonyAirData(colonies, blooms), [colonies, blooms])
  // Following: the nearest, chosen again every few seconds.
  const nearColonies = useRef({ at: -Infinity, data: null })
  const colonyData = allColonyData
  const footprints = useMemo(() => (DEBUG ? obstacleOutlines(colonyData) : null), [colonyData])
  const arrows = useMemo(() => (DEBUG ? flowArrows() : null), [])

  const time = useRef(0)

  useFrame((_, delta) => {
    if (!sim) return
    const dt = Math.min(delta, 0.05)
    time.current += dt
    let held = colonyData
    if (follow) {
      const near = nearColonies.current
      if (time.current - near.at > 2) {
        near.at = time.current
        near.data = colonyAirData(colonies, blooms, { near: [camera.position.x, camera.position.z] })
      }
      held = near.data
    }
    const state = { t: time.current, drift, curl, floor, floorTexture, colonyData: held, colony }

    const u = sim.variable.material.uniforms
    setAir(u, state)
    if (follow) u.uCentre.value.set(camera.position.x, camera.position.z)
    u.uDelta.value = dt
    sim.gpu.compute()

    if (arrows) updateArrows(arrows, { t: time.current, drift, curl, floor, colonies, colonyData, colony })

    const pu = points.material.uniforms
    setAir(pu, state)
    if (follow) pu.uCentre.value.set(camera.position.x, camera.position.z)
    pu.uPositions.value = sim.gpu.getCurrentRenderTarget(sim.variable).texture
    const dpr = gl.getPixelRatio()
    pu.uScale.value = (size.height * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360))
    pu.uDpr.value = dpr
    points.geometry.setDrawRange(0, Math.round(COUNT * density))
  })

  if (!sim) return null
  return (
    <group>
      <primitive object={points} frustumCulled={false} renderOrder={5} />
      <AirHaze floor={floor} floorTexture={floorTexture} time={time} drift={drift} amount={haze} />
      {footprints && <primitive object={footprints} />}
      {arrows && <primitive object={arrows.lines} frustumCulled={false} renderOrder={9} />}
      <AirWisps
        floor={floor}
        floorTexture={floorTexture}
        time={time}
        drift={drift}
        curl={curl}
        amount={wisps}
        strength={wispStrength}
        colonyData={colonyData}
        colony={colony}
        debug={DEBUG}
        cue={cue}
        colonyRef={wispFollow && follow ? nearColonies : null}
        cueGlobal={cueGlobal}
      />
      {fragments && <AirFragments floor={floor} time={time} drift={drift} curl={curl} colonyData={colonyData} colony={colony} />}
    </group>
  )
}

/** Uniforms the field's GLSL declares (lib/air.js). */
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
    uCentre: { value: new THREE.Vector2() },
    ...colonyAirUniforms(),
  }
}

function setAir(u, { t, drift, curl, floor, floorTexture, colonyData, colony }) {
  u.uTime.value = t
  u.uDrift.value = drift
  u.uCurl.value = curl
  u.uFloor.value = floorTexture
  u.uFloorMin.value = floor.min
  u.uFloorSpan.value = floor.max - floor.min
  u.uWaterY.value = floor.waterY
  u.uFieldSize.value = floor.size
  setColonyAir(u, colonyData, colony)
}

function isResident(b) {
  return b >= KIND.speck && b < KIND.resident
}

/** Internal check only: the colonies' influence as flow arrows. */
const ARROWS = { spacing: 0.38, extent: 1.7, height: 0.6, max: 9000, every: 1 }

function flowArrows() {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARROWS.max * 6), 3))
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ARROWS.max * 6), 3))
  geo.setDrawRange(0, 0)
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false }))
  return { lines, last: -Infinity }
}

/**
 * Over each colony, a grid of arrows just above the ground, from the same
 * field the particles move in: its direction and speed with the colonies,
 * coloured by what the colony does there (mint: slowed; pearl: rising;
 * grey: unchanged). Recomputed once a second.
 */
function updateArrows(arrows, { t, drift, curl, floor, colonies, colonyData, colony }) {
  if (t - arrows.last < ARROWS.every) return
  arrows.last = t
  const pos = arrows.lines.geometry.attributes.position.array
  const col = arrows.lines.geometry.attributes.color.array
  const controls = { drift, curl }
  const held = { strength: colony, obstacles: colonyData.obstacles }
  let n = 0
  for (const c of colonies ?? []) {
    const R = ARROWS.extent * c.radius
    for (let x = c.x - R; x <= c.x + R; x += ARROWS.spacing) {
      for (let z = c.z - R; z <= c.z + R; z += ARROWS.spacing) {
        if (n >= ARROWS.max || Math.hypot(x - c.x, z - c.z) > R) continue
        const y = floor.at(x, z) + ARROWS.height
        const v = airVelocity([x, y, z], ARROWS.height, t, controls, floor, held)
        const v0 = airVelocity([x, y, z], ARROWS.height, t, controls, floor, null)
        const ratio = Math.hypot(v[0], v[2]) / Math.max(1e-6, Math.hypot(v0[0], v0[2]))
        const slowed = Math.min(1, Math.max(0, (1 - ratio) / 0.5))
        const rising = Math.min(1, Math.max(0, (v[1] - v0[1]) / 0.03))
        const head = [0.55 + 0.45 * rising - 0.1 * slowed, 0.6 + 0.4 * slowed, 0.65 + 0.15 * slowed - 0.2 * rising]
        const L = 5
        pos.set([x, y, z, x + v[0] * L, y + v[1] * L, z + v[2] * L], n * 6)
        col.set([head[0] * 0.15, head[1] * 0.15, head[2] * 0.15, ...head], n * 6)
        n++
      }
    }
  }
  arrows.lines.geometry.setDrawRange(0, n * 2)
  arrows.lines.geometry.attributes.position.needsUpdate = true
  arrows.lines.geometry.attributes.color.needsUpdate = true
}

/** Internal check only: each obstacle's footprint, as an ellipse at its base. */
function obstacleOutlines({ obstacles }) {
  const pos = []
  for (const o of obstacles) {
    for (let k = 0; k < 48; k++) {
      for (const kk of [k, k + 1]) {
        const a = (kk / 48) * Math.PI * 2
        const u = Math.cos(a) * o.la
        const v = Math.sin(a) * o.lc
        pos.push(o.c[0] + o.b[0] * u - o.b[1] * v, o.c[1] + 0.05, o.c[2] + o.b[1] * u + o.b[0] * v)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#7fe8c4', transparent: true, opacity: 0.6, depthTest: false }))
}
