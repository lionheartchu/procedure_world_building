import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { airVelocity } from '../lib/air'
import { WARM_GLSL } from '../lib/formMaterial'

/*
 * Rare fragments — rework, phase 5 (second revision): residual films shed by
 * the colonies and carried by the air.
 *
 * Now and then a skin of film comes away from a colony's membranes and is
 * carried off on the air: residual matter, not ornament. A few in the
 * habitat at once (at most six), most of them drifting downwind of the
 * colonies they came from, lingering where the colonies hold the air, and
 * now and then one carried past the viewer. Far away they dissolve.
 *
 * Each is an irregular patch of thin film: smooth-edged but lopsided,
 * elongated, with one soft bite, and often one cleaner edge where it tore
 * away. Not a disc and not a two-tipped strip (which read as a petal or a
 * leaf). Each is in one of five structural states, the membranes' own
 * states in a lighter, residual form:
 *   - a shed skin: a single gently waved film
 *   - a rolled skin: one edge rolled into a scroll, tightening as it dries
 *   - a lace remnant: a skin with apertures like the bloom's, widening as it
 *     ages (one large and several small, never just two)
 *   - a rib remnant: film still clinging to a fibre it tore from, the fibre
 *     trailing off past the film as a fine thread
 *   - a folded skin: folded along a crease, its two sides at an angle
 *
 * The material is a thin, clear film: nearly transparent in the middle, the
 * colour gathering toward its edges and at grazing angles as an opalescent
 * shift (pearl, rose-lilac, periwinkle, a little aqua), a fine coloured rim,
 * a soft highlight along a fold, lit by the colonies' own light. Screened
 * over the scene, as the residue is: it shows over the dark air and fades
 * over bright ground, never darkening it and never passing white.
 *
 * Carried, not tumbling: each lies along the flow, rocking gently about it.
 * Near the eye it softens and fades before it can grow large on the screen;
 * seen edge-on it thins out.
 */

const FRAGMENTS = {
  slots: 6, // at most this many in the whole habitat
  // slot 0 rides the air past the viewer; the rest come away from colonies
  // (without colonies, slot 1 drifts through the view from upwind)
  life: [60, 110], // seconds a skin lasts
  rest: [18, 48], // seconds a colony slot stays empty between skins
  passRest: [30, 70], // the same for a passing slot
  size: [0.22, 0.42], // world units, half its extent: beside membranes a few units tall
  speed: 0.9, // of the air's own speed
}

/** Angular size (half-extent over distance) above which a skin softens, and fades out. */
const SOFTEN = [0.05, 0.12]
const TOO_BIG = [0.1, 0.16]

/** Distance from the eye within which a skin fades out, and beyond which it dissolves. */
const NEAR = [1.2, 2.4]
const FAR = [16, 28]

/** Its state, from its seed: shared by both shaders. */
const STATE_GLSL = /* glsl */ `
  float h1(float n) {
    return fract(sin(n * 12.9898 + 4.1414) * 43758.5453);
  }
  // 0 shed skin, 1 rolled, 2 lace, 3 rib, 4 folded.
  float stateOf(float s) {
    float x = h1(s * 9.7);
    return x < 0.28 ? 0.0 : x < 0.48 ? 1.0 : x < 0.68 ? 2.0 : x < 0.84 ? 3.0 : 4.0;
  }
`

const VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aFade;
  attribute float aSoft;
  attribute float aAge;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vFade;
  varying float vSoft;
  varying float vAge;
  varying float vCrease;
  #ifdef WARM
  // Study 10's warm accent: a film from the lifecycle just released or just
  // settled (LifecycleLayer). Never defined for the air's own skins.
  attribute float aWarm;
  varying float vWarm;
  #endif

  #include <fog_pars_vertex>

  ${STATE_GLSL}

  // The film shaped in its own space: a rolled or a folded part (the film
  // beyond a line across it bends round an arc of radius r through angle A,
  // then carries straight on), then a gentle wave over the whole.
  vec3 shape(vec2 p, float s, float t, float age, out float crease) {
    float st = stateOf(s);
    vec3 q = vec3(p, 0.0);
    crease = 10.0;
    float ad = h1(s * 4.1) * 6.28318;
    vec2 d = vec2(cos(ad), sin(ad));
    float w0 = 0.0;
    float r = 1.0;
    float A = 0.0;
    if (st == 1.0) {
      w0 = 0.05 + 0.25 * h1(s * 4.7);
      r = mix(0.24, 0.13, age) * (0.8 + 0.4 * h1(s * 6.2));
      A = 5.4;
    } else if (st == 4.0) {
      w0 = (h1(s * 4.7) - 0.5) * 0.4;
      r = 0.05;
      A = 0.7 + 0.8 * h1(s * 7.7);
    }
    float x = dot(p, d) - w0;
    if (st == 4.0) crease = x;
    if (A > 0.0 && x > 0.0) {
      float arc = r * A;
      float nx;
      float dz;
      if (x < arc) {
        nx = r * sin(x / r);
        dz = r * (1.0 - cos(x / r));
      } else {
        float x1 = x - arc;
        nx = r * sin(A) + x1 * cos(A);
        dz = r * (1.0 - cos(A)) + x1 * sin(A);
      }
      q.xy += d * (nx - x);
      q.z += dz;
    }
    q.z += (h1(s * 3.1) - 0.5) * 0.3 * p.x * p.x + (h1(s * 5.7) - 0.5) * 0.25 * p.y * p.y;
    q.z += 0.03 * sin(2.0 * p.x + 1.3 * p.y + t * (0.4 + 0.3 * h1(s * 8.8)) + s * 10.0) * dot(p, p);
    return q;
  }

  void main() {
    vec2 p = position.xy;
    float s = aSeed;
    float crease;
    float c0;
    vec3 q = shape(p, s, uTime, aAge, crease);
    float e = 0.02;
    vec3 qx = shape(p + vec2(e, 0.0), s, uTime, aAge, c0);
    vec3 qy = shape(p + vec2(0.0, e), s, uTime, aAge, c0);
    vec3 n = normalize(cross(qx - q, qy - q));

    mat4 m = modelMatrix * instanceMatrix;
    vec4 world = m * vec4(q, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(m) * n);
    vUv = p;
    vSeed = s;
    vFade = aFade;
    vSoft = aSoft;
    vAge = aAge;
    vCrease = crease;
    #ifdef WARM
    vWarm = aWarm;
    #endif

    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uLightDir;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uBright;
  uniform vec3 uPearl;
  uniform vec3 uRose;
  uniform vec3 uPeri;
  uniform vec3 uAqua;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vSeed;
  varying float vFade;
  varying float vSoft;
  varying float vAge;
  varying float vCrease;

  #include <common>
  #include <fog_pars_fragment>

  ${STATE_GLSL}
  ${WARM_GLSL}
  #ifdef WARM
  uniform float uWarmGlow;
  varying float vWarm;
  #endif

  float h2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Periodic value noise around the rim: n random radii, eased between.
  float ring(float a, float s, float n) {
    float x = a / 6.28318 * n;
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(h1(mod(i, n) + s * 13.0), h1(mod(i + 1.0, n) + s * 13.0), f);
  }

  // The outline: an irregular, smooth patch — elongated, lopsided, with
  // two soft bites — as a distance in from its edge (negative outside);
  // a is the angle round it.
  float outline(vec2 p, float s, out float a) {
    float el = 1.15 + 1.1 * h1(s * 1.9);
    vec2 e = vec2(p.x, p.y * el);
    float r = length(e);
    a = atan(e.y, e.x) + 3.14159;
    float R = 0.46 + 0.3 * ring(a, s, 3.0) + 0.1 * ring(a + 1.3, s + 5.0, 6.0) + 0.04 * ring(a + 0.4, s + 9.0, 11.0);
    // Soft scallops, not V-notches (a notch at the end of a rounded shape
    // reads as a heart).
    R -= (0.12 + 0.18 * h1(s * 6.7)) * pow(max(0.0, cos(a - s * 11.0)), 3.0);
    R -= (0.05 + 0.1 * h1(s * 7.3)) * pow(max(0.0, cos(a - s * 17.0)), 4.0);
    return (R - r) / el;
  }

  // Opalescence: a smooth cycle of soft colours, as on a thin film.
  vec3 opal(float x) {
    x = fract(x) * 4.0;
    if (x < 1.0) return mix(uPearl, uRose, smoothstep(0.0, 1.0, x));
    if (x < 2.0) return mix(uRose, uPeri, smoothstep(1.0, 2.0, x));
    if (x < 3.0) return mix(uPeri, uAqua, smoothstep(2.0, 3.0, x));
    return mix(uAqua, uPearl, smoothstep(3.0, 4.0, x));
  }

  void main() {
    float s = vSeed;
    float st = stateOf(s);
    vec2 p = vUv;

    float a;
    float edgeO = outline(p, s, a);
    // Along part of its outline the film thins away to nothing; elsewhere
    // it ends in a fine rim. So no piece is drawn round like a sticker.
    float crisp = smoothstep(0.25, 0.55, ring(a + 2.0, s + 21.0, 5.0));
    float edgeX = 10.0; // the other edges: a tear, apertures, a fibre
    float rimX = 0.0;
    // Often one cleaner edge where it tore away.
    if (h1(s * 14.7) > 0.35) {
      float at = h1(s * 12.3) * 6.28318;
      vec2 nT = vec2(cos(at), sin(at));
      float tear = 0.1 + 0.3 * h1(s * 13.1) + 0.02 * sin(6.0 * dot(p, vec2(-nT.y, nT.x)) + s) - dot(p, nT);
      edgeX = min(edgeX, tear);
      rimX = max(rimX, 1.0 - smoothstep(0.0, 0.06, tear));
    }
    // Lace: the film is decaying toward one side (more with age): it thins
    // away there, and that edge has opened in scallops. Nothing inside the
    // film: a few marks on a pale sheet read as a face.
    float decay = 0.0;
    if (st == 2.0) {
      float ad = h1(s * 20.3) * 6.28318;
      vec2 dl = vec2(cos(ad), sin(ad));
      decay = smoothstep(-0.2, 0.6, dot(p, dl)) * (0.55 + 0.45 * vAge);
      vec2 g = p * 3.2 + s;
      vec2 ci = floor(g);
      float bites = 10.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 c = ci + vec2(float(i), float(j));
          vec2 o = c + 0.5 + (vec2(h2(c + 3.7), h2(c + 7.1)) - 0.5) * 0.7;
          vec2 op = (o - s) / 3.2;
          float rh = (0.35 + 0.25 * h2(c + 1.9)) * (0.8 + 0.4 * vAge);
          float ao;
          // Only a few, only where the film is decaying, and only at its
          // edge: long soft openings, not round bites.
          if (h2(c + 2.3) > 0.5 || dot(op, dl) < 0.0 || outline(op, s, ao) > rh * 0.3 / 3.2) continue;
          float ang = h2(c + 5.3) * 3.14159;
          vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (g - o);
          bites = min(bites, (length(q * vec2(1.0, 1.6 + 1.2 * h2(c + 8.1))) - rh) / 3.2);
        }
      }
      edgeX = min(edgeX, bites);
      rimX = max(rimX, 0.25 * (1.0 - smoothstep(0.0, 0.04, bites)));
    }
    // Rib: the film hangs from a fibre along one side, the fibre trailing
    // on past the film at one end as a fine thread.
    float strand = 0.0;
    if (st == 3.0) {
      float k = (h1(s * 18.1) - 0.5) * 0.6;
      float off = (h1(s * 18.7) - 0.5) * 0.5;
      float sd = h1(s * 19.3) > 0.5 ? 1.0 : -1.0;
      float flap = h1(s * 19.9) > 0.5 ? 1.0 : -1.0;
      float vc = off + k * p.x * p.x + 0.04 * sin(3.0 * p.x + s);
      float cut = (p.y - vc) * flap;
      edgeX = min(edgeX, cut);
      float ws = 0.02 * (1.0 - 0.5 * smoothstep(0.3, 0.95, p.x * sd));
      float along = smoothstep(-0.95, -0.55, p.x * sd) * (1.0 - smoothstep(0.75, 0.97, p.x * sd));
      float inside = smoothstep(-0.05, 0.02, edgeO);
      strand = (1.0 - smoothstep(ws * 0.5, ws, abs(p.y - vc))) * along * max(inside, step(0.0, p.x * sd) * 0.7);
    }

    float edgeSoft = mix(0.012, 0.04, vSoft);
    float body = smoothstep(0.0, mix(0.16, 0.012, crisp) + edgeSoft, edgeO) * smoothstep(0.0, edgeSoft, edgeX);
    float edge = min(edgeO, edgeX);

    float shape = max(body, strand);
    if (shape * vFade < 0.003) discard;
    float rim = max((1.0 - smoothstep(0.0, 0.07, edgeO)) * crisp, rimX) * body;
    // Clear in the middle, thicker toward the edges.
    float thick = 0.3 + 0.7 * (1.0 - smoothstep(0.0, 0.22, edge));
    float crease = exp(-vCrease * vCrease / 0.004) * body;

    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;
    vec3 view = normalize(cameraPosition - vWorld);
    float facing = abs(dot(n, view));
    float fres = pow(1.0 - facing, 2.0);
    vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);
    float wrap = dot(n, uLightDir) * 0.5 + 0.5;

    // The colour shifts with the angle and across the film, strongest toward
    // its edges and at grazing angles; the middle stays nearly clear.
    vec3 film = opal(1.6 * (1.0 - facing) + 0.6 * p.x + 0.5 * thick + h1(s * 1.7));
    float sheen = 0.45 + 0.55 * max(fres, rim);
    vec3 col = film * (0.22 + 0.5 * wrap + 0.9 * dot(ambient, vec3(0.3, 0.4, 0.3))) * sheen;
    float spec = pow(max(dot(n, normalize(uLightDir + view)), 0.0), 36.0);
    col += uBright * (0.25 * spec + 0.08 * rim + 0.14 * crease + 0.12 * strand) + film * 0.22 * rim;

    float alpha = body * (0.14 + 0.16 * thick + 0.3 * fres + 0.4 * rim + 0.18 * spec + 0.22 * crease) * (1.0 - 0.6 * decay);
    alpha = max(alpha, strand * 0.45);
    // Older skins grow thinner.
    alpha *= vFade * mix(1.0, 0.8, vSoft) * (1.0 - 0.25 * vAge);

    #ifdef WARM
    // Screened light over the scene: it cannot darken into brown, so no gate.
    col = warmed(col, vWarm) + uWarmTint * vWarm * uWarmGlow * body;
    #endif
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.55));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    // Screened over the scene (premultiplied): it shows over the dark air
    // and fades over bright ground, never darkening it into a grey chip.
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`

/** A square from -1 to 1: the film before it is shaped and cut. */
function makePatch() {
  return new THREE.PlaneGeometry(2, 2, 40, 40)
}

const hexUniform = (hex) => ({ value: new THREE.Color(hex) })
const between = ([a, b]) => a + Math.random() * (b - a)
const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const tmp = {
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  s: new THREE.Vector3(),
  p: new THREE.Vector3(),
  x: new THREE.Vector3(),
  y: new THREE.Vector3(),
  z: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  forward: new THREE.Vector3(),
}

/**
 * The films' mesh: n instances of one patch, with the skins' own material.
 * Exported so the lifecycle experiment (study 10) can show its shed films
 * in exactly this material; AirFragments uses it for its own slots.
 */
export function createFilmMesh(n) {
  const geometry = makePatch()
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(n), 1))
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
  const soft = new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
  const age = new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
  fade.setUsage(THREE.DynamicDrawUsage)
  soft.setUsage(THREE.DynamicDrawUsage)
  age.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('aFade', fade)
  geometry.setAttribute('aSoft', soft)
  geometry.setAttribute('aAge', age)
  const material = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Screen: the residue's way (AirWisps), never darker, never past white.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneMinusDstColorFactor,
    blendDst: THREE.OneFactor,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        // The colonies' film light (lib/formMaterial.js), so they share one scene.
        uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
        uSkyAmbient: hexUniform('#4C4A7E'),
        uGroundAmbient: hexUniform('#22243F'),
        uBright: hexUniform('#E2DEF6'),
        // Opalescent: pearl, rose-lilac, periwinkle, a little aqua.
        uPearl: hexUniform('#F3EEF2'),
        uRose: hexUniform('#E2BCE6'),
        uPeri: hexUniform('#AEBDF4'),
        uAqua: hexUniform('#AFE6E2'),
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
  const m = new THREE.InstancedMesh(geometry, material, n)
  m.frustumCulled = false
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  for (let i = 0; i < n; i++) m.setMatrixAt(i, tmp.m.makeScale(0, 0, 0))
  return m
}

/**
 * The skins, on the same floor, clock and air as the rest (AmbientAir). No
 * control of their own: their number is set by construction.
 */
export default function AirFragments({ floor, time, drift, curl, colonyData, colony }) {
  const camera = useThree((s) => s.camera)

  const mesh = useMemo(() => createFilmMesh(FRAGMENTS.slots), [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  // Each slot: empty (waiting) or one skin.
  const slots = useMemo(
    () =>
      Array.from({ length: FRAGMENTS.slots }, (_, i) => ({
        alive: false,
        // Staggered, so they do not all arrive at once.
        wait: i === 0 ? between([10, 25]) : 6 * i + between([0, 12]),
      })),
    [],
  )

  const pace = useMemo(() => ({ cooldown: 0 }), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = time.current
    mesh.material.uniforms.uTime.value = t
    const controls = { drift, curl }
    const held = colony > 0 && colonyData.obstacles.length ? { strength: colony, obstacles: colonyData.obstacles } : null
    const seeds = mesh.geometry.attributes.aSeed
    const fades = mesh.geometry.attributes.aFade
    const softs = mesh.geometry.attributes.aSoft
    const ages = mesh.geometry.attributes.aAge
    const eye = camera.position

    // A gentle floor: when few colony skins are about (as when a generation
    // ends together), one waiting skin comes sooner — at most one every ten
    // seconds, so they never arrive in a burst.
    const colonyAlive = slots.reduce((n, f) => n + (f.alive && f.kind === 'colony' ? 1 : 0), 0)
    pace.cooldown -= dt
    if (colonyAlive < 2 && pace.cooldown <= 0) {
      const next = slots.reduce((b, f, i) => (i > 0 && !f.alive && f.wait > 8 && (!b || f.wait < b.wait) ? f : b), null)
      if (next) {
        next.wait = between([2, 8])
        pace.cooldown = 10
      }
    }
    slots.forEach((f, i) => {
      if (!f.alive) {
        f.wait -= dt
        if (f.wait <= 0 && spawn(f, i, { floor, t, controls, colonyData, camera })) seeds.setX(i, f.seed)
        else {
          mesh.setMatrixAt(i, tmp.m.makeScale(0, 0, 0))
          fades.setX(i, 0)
          return
        }
      }

      // Carried by the air, a little slower than it.
      const v = airVelocity(f.p, f.pref, t, controls, floor, held)
      f.p[0] += v[0] * FRAGMENTS.speed * dt
      f.p[1] += (v[1] * FRAGMENTS.speed + 0.01 * Math.sin(0.29 * t + f.seed)) * dt
      f.p[2] += v[2] * FRAGMENTS.speed * dt
      f.age += dt

      // Lying along the flow: its length turned slowly toward where the air
      // goes (wandering a little), rocking gently about that length.
      const speed = Math.hypot(v[0], v[1], v[2])
      if (speed > 1e-4) {
        tmp.x.set(v[0], v[1] * 0.5, v[2]).normalize()
        tmp.x.applyAxisAngle(tmp.up, 0.35 * Math.sin(0.11 * t + f.seed * 3.0))
        tmp.z.copy(tmp.up).addScaledVector(tmp.x, -tmp.x.dot(tmp.up)).normalize()
        const roll = f.roll + 0.45 * Math.sin(f.rock * t + f.seed)
        tmp.y.crossVectors(tmp.z, tmp.x)
        tmp.z.multiplyScalar(Math.cos(roll)).addScaledVector(tmp.y, Math.sin(roll))
        tmp.y.crossVectors(tmp.z, tmp.x)
        tmp.q.setFromRotationMatrix(tmp.m.makeBasis(tmp.x, tmp.y, tmp.z))
        f.q.slerp(tmp.q, 1 - Math.exp(-0.5 * dt))
      }

      const outside = Math.abs(f.p[0]) > 13.5 || Math.abs(f.p[2]) > 13.5 || f.p[1] > floor.waterY + 4.5
      if (f.age > f.life || outside) {
        f.alive = false
        f.wait = between(f.kind === 'colony' ? FRAGMENTS.rest : FRAGMENTS.passRest)
        mesh.setMatrixAt(i, tmp.m.makeScale(0, 0, 0))
        fades.setX(i, 0)
        return
      }

      // Coming away from a membrane, a skin opens out to its size.
      const grow = f.kind === 'colony' ? 0.45 + 0.55 * smoothstep(0, 10, f.age) : 1
      const length = f.size * grow
      tmp.p.set(f.p[0], f.p[1], f.p[2])
      const dist = tmp.p.distanceTo(eye)
      const angular = length / Math.max(dist, 1e-3)
      const life = smoothstep(0, 8, f.age) * (1 - smoothstep(f.life - 10, f.life, f.age))
      const near = smoothstep(NEAR[0], NEAR[1], dist)
      const far = 1 - smoothstep(FAR[0], FAR[1], dist)
      const notTooBig = 1 - smoothstep(TOO_BIG[0], TOO_BIG[1], angular)
      // Seen edge-on, a film is a line: let it thin out.
      tmp.z.set(0, 0, 1).applyQuaternion(f.q)
      tmp.forward.copy(tmp.p).sub(eye).normalize()
      const edgeOn = 0.3 + 0.7 * smoothstep(0.08, 0.4, Math.abs(tmp.z.dot(tmp.forward)))
      fades.setX(i, life * near * far * notTooBig * edgeOn)
      softs.setX(i, smoothstep(SOFTEN[0], SOFTEN[1], angular))
      ages.setX(i, Math.min(1, f.age / f.life))
      mesh.setMatrixAt(i, tmp.m.compose(tmp.p, f.q, tmp.s.setScalar(length)))
    })
    mesh.instanceMatrix.needsUpdate = true
    seeds.needsUpdate = true
    fades.needsUpdate = true
    softs.needsUpdate = true
    ages.needsUpdate = true
  })

  return <primitive object={mesh} renderOrder={6} />
}

/** Starts a skin in slot i; false if there is nowhere for it now. */
function spawn(f, i, { floor, t, controls, colonyData, camera }) {
  const membranes = colonyData.obstacles.filter((o) => o.h > 0.4 && o.la < 2.5)
  let kind = 'colony'
  if (i === 0) kind = 'passing'
  else if (!membranes.length) {
    // Without colonies, one slot drifts through the view from upwind.
    if (i > 1) {
      f.wait = between(FRAGMENTS.passRest)
      return false
    }
    kind = 'through'
  }

  let p
  if (kind !== 'colony') {
    // Upwind of a point in front of the viewer, traced back along the air
    // for about half a minute so that, drifting forward, it arrives: the
    // air curls, and a straight line upwind misses. A passing skin comes
    // close, near the line of sight; one drifting through, farther.
    camera.getWorldDirection(tmp.forward)
    tmp.forward.y = 0
    if (tmp.forward.lengthSq() < 1e-6) tmp.forward.set(0, 0, -1)
    tmp.forward.normalize()
    const close = kind === 'passing'
    const side = (Math.random() < 0.5 ? -1 : 1) * between(close ? [0.3, 1.0] : [0.5, 3])
    const d = between(close ? [3.5, 6] : [6, 14])
    const target = [
      camera.position.x + tmp.forward.x * d - tmp.forward.z * side,
      0,
      camera.position.z + tmp.forward.z * d + tmp.forward.x * side,
    ]
    // At the viewer's height, but within the air over the land.
    const below = floor.at(target[0], target[2])
    target[1] = Math.min(Math.max(camera.position.y + between([-0.3, 0.5]), below + 0.4), floor.waterY + 3.5)
    const pref = target[1] - floor.at(target[0], target[2])
    p = [...target]
    const steps = 12
    const back = between([24, 36])
    for (let k = 0; k < steps; k++) {
      const w = airVelocity(p, pref, t - (k * back) / steps, controls, floor, null)
      p[0] -= (w[0] * FRAGMENTS.speed * back) / steps
      p[2] -= (w[2] * FRAGMENTS.speed * back) / steps
    }
    f.travel = back
  } else {
    // From the surface of one membrane, somewhere along it and up it, on
    // its downwind side.
    const o = membranes[Math.floor(Math.random() * membranes.length)]
    const along = (Math.random() - 0.5) * 1.6 * o.la
    const base = [o.c[0] + o.b[0] * along, o.c[1] + o.h * between([0.35, 0.95]), o.c[2] + o.b[1] * along]
    const w = airVelocity(base, o.h * 0.6, t, controls, floor, null)
    const speed = Math.hypot(w[0], w[2]) || 1e-3
    const off = Math.max(o.lc, 0.2) * between([0.3, 0.9])
    p = [base[0] + (w[0] / speed) * off, base[1], base[2] + (w[2] / speed) * off]
  }
  const ground = floor.at(p[0], p[2])
  if (p[1] < ground + 0.25) p[1] = ground + 0.25

  f.alive = true
  f.kind = kind
  f.p = p
  f.pref = p[1] - ground
  f.age = 0
  f.life = kind === 'colony' ? between(FRAGMENTS.life) : f.travel + between([35, 55])
  f.size = kind === 'passing' ? between([0.28, 0.4]) : between(FRAGMENTS.size)
  f.seed = Math.random() * 100
  // Tilted well up from lying flat, so it is seen face-on more often than
  // edge-on from the usual low views.
  f.roll = between([0.7, 1.5]) * (Math.random() < 0.5 ? -1 : 1)
  f.rock = between([0.25, 0.5])
  // Starts lying along the air where it is.
  const w0 = airVelocity(p, f.pref, t, controls, floor, null)
  tmp.x.set(w0[0], 0, w0[2]).normalize()
  if (tmp.x.lengthSq() < 1e-8) tmp.x.set(1, 0, 0)
  tmp.z.set(0, 1, 0)
  tmp.y.crossVectors(tmp.z, tmp.x)
  f.q = new THREE.Quaternion().setFromRotationMatrix(tmp.m.makeBasis(tmp.x, tmp.y, tmp.z))
  return true
}
