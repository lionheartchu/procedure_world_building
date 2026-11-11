import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildBlooms, FormWriter } from '../lib/traceForms'
import { createFormMaterial, setAccumulation } from '../lib/formMaterial'
import { LIFECYCLE, RECENT, recentAt } from '../lib/lifecycle'
import { airWaves } from '../lib/air'
import { NOTICE } from '../lib/notice'
import { createFilmMesh } from './AirFragments'
import ConduitLayer from './ConduitLayer'
import ConduitFold from './ConduitFold'
import ConduitGreybox from './ConduitGreybox'

/**
 * Study 10, behind `?lifecycle=1`: the lifecycle's patch, drawn with what the
 * colony already uses (lib/lifecycle.js holds the simulation):
 *
 *   - each resident is one membrane, built by the bloom layer's own builder
 *     in the bloom layer's own materials (`meshes`, from ScatterLayers). It
 *     unfolds as far as its matter allows; lying down, it folds over toward
 *     its lean (the form vertex shader's `uRecline`); ended, it stays as a
 *     low contour on the ground, fainter as its matter is taken up, never
 *     gone (`uFade`)
 *   - the residue is a thin skin lying on the ground, in the colony's own
 *     ground-skin material, as thick as the residual is, granular where it
 *     is thickest, with a faint fold where the deposit thins out: the edge a
 *     new resident rises from
 *   - the films in the air are the air's fragments (AirFragments' mesh and
 *     material), placed where the simulation carries them, fading into the
 *     ground where they settle
 *
 * The simulation steps here, once per frame, on its fixed step.
 *
 * A warm accent can be tried on top (`&warm=1|2|3`, or the inspector; off by
 * default, and then not compiled at all): see WARM.
 */

/** Films shown at once: in flight, or fading where they settled. */
const FILMS = 16

/** A film's matter that shows as a full load (`carriers`): about what one film of a 0.7 resident carries. */
const FULL_LOAD = 0.07

/**
 * A carrier's wake (`carriers`): a few motes of its matter left along its
 * path as it flies, sinking and fading. Display only: the simulation's
 * matter stays in the film until it settles. It marks where matter is going
 * where the film itself, thin and screened, is lost against pale ground.
 */
const WAKE = { per: 22, every: 0.3, life: 6, sink: 0.025, size: 0.028, color: '#EEE6F6' }

/** Where carriers fade near the camera (units): the overview's distances, or (first person) close. */
const NEAR = { overview: [1.2, 2.4], carriers: [0.35, 0.9] }

function createWake() {
  const n = FILMS * WAKE.per
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(n).fill(1e3), 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aLoad', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage))
  const material = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uColor: { value: new THREE.Color(WAKE.color) }, uSize: { value: WAKE.size }, uLife: { value: WAKE.life }, uScale: { value: 400 } },
    ]),
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute float aLoad;
      uniform float uSize;
      uniform float uLife;
      uniform float uScale;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float k = clamp(aAge / uLife, 0.0, 1.0);
        vAlpha = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.4, aAge) * (0.35 + 0.65 * aLoad) * smoothstep(0.3, 0.8, -mvPosition.z);
        gl_PointSize = uSize * (0.7 + 0.5 * aLoad) * uScale / max(-mvPosition.z, 0.1);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a * 0.8);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.name = 'lifecycle-wake'
  return points
}

/** Seconds a settled film lies on the ground before it has merged into the residue. */
const FADE_OUT = 10

/**
 * M3S (`passage`, docs/27-sheath-and-passage.md): the films' real passage,
 * from where each came away to where it settled, drawn to be followed from
 * eye height. All of it read from the simulation (its films' positions,
 * velocities, ages and its record of releases), on its clock; none of it
 * read back.
 *
 *   - `mark`: the thin film's colours round a fresh mark on the resident it
 *     left: rising as it parts (s), gone after `mark[2]` s; and there the
 *     sheet springs back a little as it tears free, settling in a few
 *     seconds (the form shader's PASSAGE)
 *   - `comb`: the film's comb rows, a phase per unit it travels (so rows
 *     cross it about once a second at a typical 0.1 units/s), showing in
 *     its first `comb.rise` s, and at the speeds `comb.speed`; once it has
 *     settled they fade over `comb.settle` s
 *   - `trace`: its wake, the air it has just passed through a little
 *     brighter, along its actual path (a point every `every` s of its
 *     flight, each fading over `life` s), `width` units across and soft at
 *     its sides, near the camera fading as `near`, in the colour of the
 *     residue it becomes. (A fine line read as a strand joining resident
 *     and ground, as if the matter ran along it.)
 *   - `land`: settling, it spreads to `land.spread` times its size over
 *     `land.time` s as it clears into the residue
 *   - `tumble`: and it turns over more as it is carried (flat, from eye
 *     height it was seen only edge on)
 */
const PASSAGE = {
  mark: [0.3, 2.5, 9],
  comb: { phase: 55, rise: 1.2, speed: [0.004, 0.04], settle: 2.5 },
  trace: { every: 0.2, points: 40, life: 6, width: 0.035, near: [0.4, 1.2], alpha: 0.2, color: '#F1ECF8' },
  land: { spread: 1.5, time: 4 },
  /** How far it turns over as it is carried (radians, either way; 0.35 elsewhere). */
  tumble: 1.1,
}

/**
 * M3S: the trace, one camera-facing strip per film, rebuilt each frame from
 * its recorded points (`slots`: the film each strip follows and its points
 * [x, y, z, t] on the simulation's clock).
 */
function createTrace() {
  const T = PASSAGE.trace
  const per = T.points + 1
  const n = FILMS * per * 2
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aAcross', new THREE.BufferAttribute(new Float32Array(n).map((_, k) => (k % 2 ? 1 : -1)), 1))
  const index = []
  for (let f = 0; f < FILMS; f++) {
    for (let k = 0; k < per - 1; k++) {
      const a = (f * per + k) * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  geometry.setIndex(index)
  const material = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(T.color) } }]),
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aAcross;
      varying float vAlpha;
      varying float vAcross;
      #include <fog_pars_vertex>
      void main() {
        vAlpha = aAlpha;
        vAcross = aAcross;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      varying float vAcross;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float a = vAlpha * exp(-3.5 * vAcross * vAcross);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.name = 'lifecycle-trace'
  return { mesh, slots: Array.from({ length: FILMS }, () => ({ id: -1, points: [] })), phase: new Map(), t: null }
}

/** The residue's film: vertices per side, and its lift off the ground (units). */
const DEPOSIT_GRID = 128
const DEPOSIT_LIFT = 0.02

/**
 * How the residue is drawn: in the colony's ground-skin material (tissue),
 * paler and warmer than the colony's own skin; a little softer than the
 * grid holds it (a display blur, radius in cells); granular where it lies
 * thickest (the material's crust); a faint brighter fold where it thins out
 * (its vein light). `full` is the residual that reads as fully present.
 */
const DEPOSIT_LOOK = { blur: 2, tint: '#EEE6F6', full: 0.008 }

/**
 * D1 (`legible`): the residue drawn to be seen from eye height. One
 * resident's films leave a few thousandths in a cell, which at `full` 0.008
 * and a blur of two cells read as a faint haze on the skin around it; here a
 * lighter blur keeps its shape and it shows fully at half as much. The
 * residual itself is the same.
 */
const DEPOSIT_LEGIBLE = { blur: 1, full: 0.004 }

/**
 * M3 (`age`): the residue drawn by how long its matter has lain, from the
 * lifecycle's own record of when matter last arrived in each cell (the clock
 * its rest rule reads): `full` s reads as long lain, and it is re-read every
 * `every` s of simulation time. And an old contour settles toward the ground
 * as it ages (`contour`: s over which, and how much).
 */
const AGE = { full: 240, every: 0.5, contour: [60, 360, 0.3] }

/**
 * The warm accent, a development A/B. Only where matter is crossing from one
 * state to another, for as long as the simulation records it doing so, the
 * surface shifts toward a pale champagne at its own brightness, then returns:
 *
 *   - release   the spot on a lying resident a film has just left, and the
 *               film itself for its first seconds in the air
 *   - deposit   a film just settled (only when the record keeps it), and
 *               the fresh deposit: its thin edge, or (variant 3) all of it
 *   - uptake    the residue being taken up (cells the simulation is drawing
 *               from), the new resident's foot while it takes matter in,
 *               and an old contour while it gives
 *
 * Nothing is drawn along the films' paths: the matter travels as the films,
 * through open air, not along any channel. `fade` is how long (simulation
 * seconds) each cue takes to return after its transition.
 *
 * Variants 4 and 5 are a study of the uptake alone, one approach each, and
 * follow how much is being taken up, not only when (the simulation's
 * recent-uptake records, which forget over RECENT seconds):
 *
 *   - A absorb  the deposit skin, cell by cell, as much as is being drawn out
 *               of it, in the skin's own grain; it recedes with the matter
 *   - B growth  the new resident, from its foot a short way up its own
 *               columns, as far as its recent intake reaches
 */
const NONE = { film: 0, left: 0, edge: 0, fresh: 0, drawn: 0, take: 0, give: 0, glow: 0, absorb: null, grow: null }
const WARM = {
  tint: '#EFDCC0',
  fade: { release: 8, land: 4, arrive: 18, drawn: 3, take: 2.5, give: 2.5, left: 3 },
  variants: {
    1: { ...NONE, name: 'edge', film: 0.55, left: 0.5, edge: 0.7, drawn: 0.4, take: 0.4, give: 0.25, glow: 0.03 },
    2: { ...NONE, name: 'uptake', film: 0.75, left: 0.8, edge: 0.7, drawn: 0.8, take: 0.75, give: 0.5, glow: 0.06 },
    3: { ...NONE, name: 'deposit', film: 0.75, left: 0.8, edge: 0.7, fresh: 0.6, drawn: 0.4, take: 0.4, give: 0.25, glow: 0.1 },
    // strength, light, density, grain
    4: { ...NONE, name: 'A absorb', tint: '#EBDBB6', absorb: [1.2, 0.26, 0.12, 1.0] },
    5: { ...NONE, name: 'B growth', tint: '#EBDBB6', grow: { strength: 0.85, reach: [0.08, 0.32], glow: 0.26, density: 0.06 } },
    // The Habitat's D1: the whole passage at once, each cue only where and
    // while the simulation records matter crossing — a film coming away
    // (and in its first seconds in the air), a fresh deposit's edge, the
    // skin as it is drawn out (A), the new resident as it takes it in (B),
    // and an old contour giving part of itself.
    6: { ...NONE, name: 'D1 passage', tint: '#EBDBB6', film: 0.5, left: 0.55, edge: 0.6, give: 0.35, glow: 0.03, absorb: [1.1, 0.2, 0.1, 1.0], grow: { strength: 0.75, reach: [0.08, 0.32], glow: 0.18, density: 0.05 } },
  },
}

/**
 * The Habitat's D1 (`legible`): a resident bent by the air its films ride.
 * The air's horizontal velocity at its crest, on the simulation's clock, as
 * a displacement there (units per unit of air speed), eased over `ease` s
 * (a sheet has some weight). How far it gives is its state: fuller and
 * standing, it holds; half-formed, or lying down, it gives more; ended, it
 * lies on the ground and does not move.
 */
const WIND = { gain: 1.0, ease: 1.5, give: { forming: 1.25, holding: 1, receding: 0.8, releasing: 0.55 } }

/** D1: a film's mark on the resident it left, as wide as this share of its height, and how long it takes to come away (s). */
const MARK = { radius: 0.24, away: 2.5 }

/**
 * M1 (a lifecycle with a commons, lib/morph.js): the cue a resident has
 * gathered, as a cool stain in its film (`full` gathered shows at `most`),
 * the air study's ice-lilac. A signal, drawn apart from matter's champagne.
 */
const STAIN = { full: 0.012, most: 0.5, color: [0.74, 0.8, 1.0] }

/** Matter taken lately from one cell that shows fully (approach A); about the most a cell gives. */
const UPTAKE_FULL = 0.005

/**
 * The Habitat's M3R (`closeRange`): a resident's posture through its life, as
 * the form material's bend from its foot ([bend at the foot (rad), how far up
 * it builds (share of its height), the crest's own fold (rad)]). Read from
 * the simulation's own clock for it (stage, stageTime, recline); nothing in
 * the simulation reads it back.
 *
 *   - forming   it rises from lying low over its lean, its crest curled,
 *               lifting and opening as it unfolds (`young` at its start)
 *   - holding   it stands as built
 *   - receding  it loses tension: the crest folds over first, then the whole
 *               sheet sags from a soft bend along its height (`droop`)
 *   - releasing the bend moves down to its foot until it lies flat on the
 *               ground ahead of it (`lie`), its crest relaxing as it goes
 *   - ended     it lies so, an outline on the ground
 *
 * Each stage ends where the next begins, so there is no jump between them.
 * Its bead (a crest's drop of matter) goes with the last of its films.
 */
const POSTURE = { young: [0.75, 0.45, 0.7], droop: [0.55, 0.75, 0.6], lie: [1.53, 0.12, 0] }

/**
 * The Habitat's M3L (docs/25-living-membrane.md): a resident's membrane as
 * living tissue, drawn only (the form vertex shader's LIVING block):
 *
 *   - at rest, flutes run up the sheet and its rim ruffles and lobes, as
 *     deep as the matter its body holds: a young resident is smooth, a full
 *     one convoluted (how many flutes is its own, by its seed)
 *   - noticing the visitor (lib/notice.js), it gathers: it draws down and a
 *     little in, around its crest, and the length it loses buckles into
 *     deeper flutes and a crumpled rim, its rim and the side the visitor is
 *     on first; on its tension's timing, a taut one quickly and less far, a
 *     slack one slowly and further
 *   - as they leave it opens again, a little past rest before it settles,
 *     the last parts gathered the first to open
 *   - it breathes, very slightly, all the time
 *
 * On the visitor's clock; nothing in the simulation reads it.
 */
const LIVING = {
  /** The membrane's grid, columns across and rows up (buildBlooms `detail`). */
  detail: [3, 1.5],
  /** Flutes across the sheet: how many (by its seed), and how deep (a share of its height), empty .. full. */
  flutes: [3, 5],
  flute: [0.025, 0.085],
  /** The rim's ruffle: how many to a flute, and how deep (share of its height) when full. */
  ruffle: 2.3,
  ruffleDepth: 0.04,
  /** Lobes standing above the bays of its rim (share of its height), empty .. full. */
  lobe: [0.04, 0.16],
  /** How far it draws down when gathered (a share of its length up the sheet; in across, a third as much), slack .. taut. */
  draw: [0.28, 0.18],
  /** Its gathering's spring: natural frequency (Hz) and damping, slack .. taut. */
  hz: [0.32, 0.85],
  damping: [0.6, 0.45],
  /** Its folds relax as it lies down (with the square of how far it lies); an old contour keeps this share of them. */
  contour: 0.15,
  /** Breathing: how much, and its period (s); the ruffle's drift along the rim (rad/s, on the shader's uTime). */
  breath: [0.05, 9],
  drift: 0.12,
  /** How far it cups as it gathers, how its lobes change as it gathers (a share), how round their tops (a power); how far its folds turn up the sheet (rad). */
  form: [0, -0.85, 1],
  twist: 0.7,
}

/**
 * M3C (docs/26-colony-motion.md): the same tissue, refined toward the colony
 * encounter study. At rest fewer, broader folds that turn across the sheet
 * as they rise, not pleats up it; gathering as M3L does, a little cupped,
 * and drawing down less. (Lobes that grew as it gathered, with a deeper cup,
 * sharpened its crest into points: tried, and set aside.)
 */
const LIVING_FAN = {
  ...LIVING,
  flutes: [2, 3],
  flute: [0.015, 0.05],
  ruffle: 2.4,
  ruffleDepth: 0.035,
  lobe: [0.05, 0.14],
  draw: [0.16, 0.1],
  form: [0.4, -0.6, 1],
  twist: 1.6,
  /** Its bead is drawn in fully early in the gathering (M3L: in proportion). */
  beadIn: 0.4,
}

const lerpN = (a, b, k) => a + (b - a) * k

/**
 * M3L: where LIVING moves one vertex of the sheet as built (its normal n,
 * its uv.x, its aSway), for the encounter and the bead. The shader's block,
 * in JS. L: { shape, move, size, lean } as the uniforms.
 */
function livingAt(n, ux, uy, sway, L, out) {
  const ax = -L.lean[1]
  const az = L.lean[0]
  const dn = ax * n[0] + az * n[2]
  let tx = ax - n[0] * dn + 1e-5
  let ty = -n[1] * dn + 1e-5
  let tz = az - n[2] * dn + 1e-5
  let l = Math.hypot(tx, ty, tz)
  tx /= l
  ty /= l
  tz /= l
  let vx = n[1] * tz - n[2] * ty
  let vy = n[2] * tx - n[0] * tz
  let vz = n[0] * ty - n[1] * tx
  l = Math.hypot(vx, vy, vz) || 1
  vx /= l
  vy /= l
  vz /= l
  const [k1, k2, A1, A2] = L.shape
  const [G, draw, side, crestU] = L.move
  const [halfW, , lobeA, phase] = L.size
  const s = Math.sqrt(Math.max(sway, 0))
  const u = Math.min(1, Math.max(-1, ux / Math.max(halfW, 0.05)))
  const lag = 0.35 * (1 - s) + 0.45 * (0.5 - 0.5 * u * side)
  const gc = G >= 0 ? smoothstep(0, 1, (G * 1.8 - lag) / 0.8) : G
  const th1 = 2 * Math.PI * k1 * (0.5 + 0.5 * u) + phase + 0.9 * Math.sin(3.1 * u + 1.3 * phase) + L.twist * s
  const th2 = 2 * Math.PI * k2 * (0.5 + 0.5 * u) + 1.7 * phase + LIVING.drift * L.time
  const a1 = A1 * Math.pow(s, 1.2) * (1 + 0.9 * gc)
  const a2 = A2 * s * s * s * (1 + 1.6 * gc)
  const [cupA, cupSide, lobeGather, lobePow] = L.form
  const D = a1 * Math.sin(th1) + a2 * Math.sin(th2) + cupA * Math.max(gc, 0) * cupSide * (u * u - 0.33) * s * halfW
  const lobe = lobeA * s * s * s * Math.pow(0.5 + 0.5 * Math.cos(th1), lobePow) * (1 + lobeGather * Math.max(gc, 0))
  const sq = 0.35 * draw * gc * (ux - crestU)
  const down = lobe - draw * gc * uy
  out[0] = n[0] * D + vx * down - tx * sq
  out[1] = n[1] * D + vy * down - ty * sq
  out[2] = n[2] * D + vz * down - tz * sq
  return out
}

/**
 * M3E: a resident's film where the form vertex shader draws it now, before
 * its air (its growth and POSTURE, in JS: the same formulas; and M3N's cup,
 * `cup` over a sheet `cupH` high), for the encounter to meet. Returns the
 * sheet's height above its foot.
 */
function poseFilm(geo, growth, bent, r, tilt, out, cup = 0, cupH = 1, liv = null) {
  const pos = geo.attributes.position.array
  const anc = geo.attributes.aAnchor.array
  const bir = geo.attributes.aBirth.array
  const nor = geo.attributes.normal.array
  const uvs = geo.attributes.uv.array
  const swy = geo.attributes.aSway.array
  const nv = [0, 0, 0]
  const off = [0, 0, 0]
  const [bx, by, bz] = r.desc.p
  const lx = Math.cos(r.desc.lean)
  const lz = Math.sin(r.desc.lean)
  const H = Math.max(r.desc.height * 1.4 * Math.max(r.unfold, 0.05), 0.05)
  const bending = bent && (bent[0] !== 0 || bent[2] !== 0)
  const angle = (u) => bent[0] * (1 - Math.exp(-u / Math.max(bent[1] * H, 1e-3))) + bent[2] * smoothstep(0.25 * H, H, u)
  let top = 0
  for (let i = 0, n = pos.length / 3; i < n; i++) {
    const g = smoothstep(bir[2 * i], bir[2 * i] + Math.max(bir[2 * i + 1], 1e-3), growth)
    let x = anc[3 * i] + (pos[3 * i] - anc[3 * i]) * g
    let y = anc[3 * i + 1] + (pos[3 * i + 1] - anc[3 * i + 1]) * g
    let z = anc[3 * i + 2] + (pos[3 * i + 2] - anc[3 * i + 2]) * g
    if (liv) {
      nv[0] = nor[3 * i]
      nv[1] = nor[3 * i + 1]
      nv[2] = nor[3 * i + 2]
      livingAt(nv, uvs[2 * i], uvs[2 * i + 1], swy[i], liv, off)
      x += off[0]
      y += off[1]
      z += off[2]
    }
    if (bending) {
      const qx = x - bx
      const qy = y - by
      const qz = z - bz
      const a = qx * lx + qz * lz
      const c = -qx * lz + qz * lx
      const h = Math.max(qy, 0)
      let X = 0
      let Y = 0
      const du = h / 10
      for (let k = 0; k < 10; k++) {
        const th = angle((k + 0.5) * du)
        X += Math.sin(th) * du
        Y += Math.cos(th) * du
      }
      const th = angle(h)
      const A = X + a * Math.cos(th)
      const rx = lx * A - lz * c
      const rz = lz * A + lx * c
      let ry = Y - a * Math.sin(th) + Math.min(qy, 0)
      const groundRest = tilt[2] + qx * tilt[0] + qz * tilt[1]
      const groundNow = tilt[2] + rx * tilt[0] + rz * tilt[1]
      ry = Math.max(ry, groundNow + Math.min(0.03, qy - groundRest))
      x = bx + rx
      y = by + ry
      z = bz + rz
    }
    if (cup) {
      const qx = x - bx
      const qz = z - bz
      const a = qx * lx + qz * lz
      const c = -qx * lz + qz * lx
      const kk = cup * (0.35 + 0.65 * Math.min(1, Math.max(0, (y - by) / Math.max(cupH, 0.05))))
      const th = c * kk
      const A = a + (1 - Math.cos(th)) / kk
      const C = Math.sin(th) / kk
      x = bx + lx * A - lz * C
      z = bz + lz * A + lx * C
    }
    out[3 * i] = x
    out[3 * i + 1] = y
    out[3 * i + 2] = z
    top = Math.max(top, y - by)
  }
  return top
}

function postureOf(r) {
  const L = LIFECYCLE
  const { young, droop, lie } = POSTURE
  if (r.stage === 'forming') {
    const lift = smoothstep(0, L.form, r.stageTime)
    return [young[0] * (1 - lift) ** 2, young[1], young[2] * (1 - smoothstep(0.25, 1, lift))]
  }
  if (r.stage === 'receding') {
    const k = r.recline / L.lies
    return [droop[0] * smoothstep(0.15, 1, k), droop[1], droop[2] * smoothstep(0, 0.7, k)]
  }
  if (r.stage === 'releasing') {
    const k = smoothstep(0, 1, (r.recline - L.lies) / (0.95 - L.lies))
    return [droop[0] + (lie[0] - droop[0]) * k, droop[1] + (lie[1] - droop[1]) * k, droop[2] * (1 - smoothstep(0.2, 0.9, k))]
  }
  if (r.stage === 'ended') return lie
  return [0, droop[1], 0]
}

/** 1 when a transition happened `since` seconds ago, 0 once `fade` has passed. */
const recency = (since, fade) => 1 - smoothstep(0, fade, since)

/** Compile the accent into a material, or take it out again (exactly as before). */
function setWarm(material, on) {
  const has = material.defines?.WARM !== undefined
  if (has === on) return
  material.defines = { ...material.defines }
  if (on) material.defines.WARM = ''
  else delete material.defines.WARM
  material.needsUpdate = true
}

/** The accent's uniforms, on one of the lifecycle's own materials. */
function warmUniforms(material) {
  const u = material.uniforms
  u.uWarmTint = { value: new THREE.Color(WARM.tint) }
  u.uWarmGlow = { value: 0 }
  u.uWarmIn = { value: 0 }
  u.uWarmAt = { value: new THREE.Vector4(0, 0, 0, 1) }
  u.uWarm = { value: new THREE.Vector4() }
  u.uAbsorb = { value: new THREE.Vector4() }
  u.uGrow = { value: new THREE.Vector4() }
  return material
}

/** The patch's default view, relative to the colony: inside the orbit's own limits. */
const VIEW = { target: [1.0, 0, -0.33], from: [6.2, 5.0, 0.6] }

/**
 * With the shared tissue: every colony it joins and the ground between, from
 * the south, well above; `from` is per unit of how far the colonies spread.
 */
const VIEW_CONDUIT = { from: [0.03, 1.15, 0.8], least: 7 }

/** A separable box blur of a res × res grid, for display. */
function blur(src, out, res, radius) {
  const tmp = new Float32Array(src.length)
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let s = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const ii = i + k
        if (ii < 0 || ii >= res) continue
        s += src[j * res + ii]
        n++
      }
      tmp[j * res + i] = s / n
    }
  }
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let s = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const jj = j + k
        if (jj < 0 || jj >= res) continue
        s += tmp[jj * res + i]
        n++
      }
      out[j * res + i] = s / n
    }
  }
}

/**
 * As `blur`, inside a window of the grid only ([i0, i1, j0, j1], inclusive),
 * reading the cells around it; the rest of `out` is left as it was. `tmp` is
 * the caller's (as long as the grid).
 */
function blurWindow(src, out, res, radius, [i0, i1, j0, j1], tmp) {
  const ja = Math.max(0, j0 - radius)
  const jb = Math.min(res - 1, j1 + radius)
  for (let j = ja; j <= jb; j++) {
    for (let i = i0; i <= i1; i++) {
      let s = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const ii = i + k
        if (ii < 0 || ii >= res) continue
        s += src[j * res + ii]
        n++
      }
      tmp[j * res + i] = s / n
    }
  }
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      let s = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const jj = j + k
        if (jj < 0 || jj >= res) continue
        s += tmp[jj * res + i]
        n++
      }
      out[j * res + i] = s / n
    }
  }
}

/** Bilinear read of a res × res grid at (u, v). */
function sample(grid, res, u, v) {
  const x = Math.min(1, Math.max(0, u)) * res - 0.5
  const y = Math.min(1, Math.max(0, v)) * res - 0.5
  const i0 = Math.max(0, Math.min(res - 1, Math.floor(x)))
  const j0 = Math.max(0, Math.min(res - 1, Math.floor(y)))
  const i1 = Math.min(res - 1, i0 + 1)
  const j1 = Math.min(res - 1, j0 + 1)
  const fx = Math.min(1, Math.max(0, x - i0))
  const fy = Math.min(1, Math.max(0, y - j0))
  return (
    grid[j0 * res + i0] * (1 - fx) * (1 - fy) +
    grid[j0 * res + i1] * fx * (1 - fy) +
    grid[j1 * res + i0] * (1 - fx) * fy +
    grid[j1 * res + i1] * fx * fy
  )
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const tmp = {
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
  x: new THREE.Vector3(),
  y: new THREE.Vector3(),
  z: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
}

/** One resident: its membrane, its own two materials, its own stage. */
function Resident({ resident: r, lifecycle, world, meshes, growth, waterLine, openness, accumulation, visible, legible = false, age = false, closeRange = false, encounter = null, notice = null, living = false, passage = false }) {
  // M3R (`closeRange`): its posture (POSTURE), and a closed sheet.
  const posture = closeRange
  const shared = !!lifecycle.commons
  const materials = useMemo(
    () =>
      meshes.map((m) =>
        warmUniforms(
          createFormMaterial({
            ...m,
            ...(legible ? { wind: true, release: true, passage } : null),
            ...(shared ? { stain: true } : null),
            ...(posture ? { posture: true } : null),
            ...(encounter ? { encounter: true } : null),
            ...(notice ? { notice: NOTICE.tint } : null),
            ...(living ? { living: true } : null),
          }),
        ),
      ),
    [meshes, legible, shared, posture, encounter, notice, living, passage],
  )
  // M3R: the ground under it, as a plane (its slope along x and z, and its
  // height at the foot against the foot's own), for it to lie on.
  const tilt = useMemo(() => {
    if (!posture) return null
    const [x, y, z] = r.desc.p
    const g = (gx, gz) => world.groundY(...world.toUV(gx, gz))
    const e = 0.35
    return [(g(x + e, z) - g(x - e, z)) / (2 * e), (g(x, z + e) - g(x, z - e)) / (2 * e), g(x, z) - y]
  }, [posture, r, world])
  // D1: where its films came away (as it stood), and the air bending it now.
  const marks = useRef({ list: [] })
  const bend = useRef(new THREE.Vector3())
  // M3E: its film as drawn now, for the encounter (only while it is the one met).
  const posed = useRef({ array: null, tick: 0 })
  const edgeGlows = useMemo(() => materials.map((m) => m.uniforms.uEdgeGlow?.value ?? 0), [materials])
  // (M3C, `living: 'fan'`: the refined preset.)
  const LV = living === 'fan' ? LIVING_FAN : LIVING
  const geo = useMemo(() => buildBlooms([r.desc], world, new FormWriter(), living ? { detail: LIVING.detail } : undefined), [r, world, living])
  // M3L: its own shape of folds (by its seed), how gathered it is (a spring,
  // on the visitor's clock) and from which side; and the film's point its
  // bead hangs from.
  const fold = useMemo(() => {
    if (!living) return null
    const seed = r.desc.seed ?? 0
    const f = (k) => ((seed * k) % 997) / 997
    const k1 = LV.flutes[0] + Math.floor(f(7) * (LV.flutes[1] - LV.flutes[0] + 1))
    return { k1, k2: k1 * LV.ruffle + f(13), phase: f(29) * 2 * Math.PI, breath: f(41) * 2 * Math.PI }
  }, [living, r, LV])
  const gather = useRef({ G: 0, v: 0, side: 0 })
  // M3L: where across the sheet its crest stands (uv.x of its highest point), which it closes around.
  const crestU = useMemo(() => {
    if (!living || !geo.film) return 0
    const p = geo.film.attributes.position.array
    const uvA = geo.film.attributes.uv.array
    let best = 0
    let top = -Infinity
    for (let i = 0; i < p.length / 3; i++) {
      if (p[3 * i + 1] > top) {
        top = p[3 * i + 1]
        best = uvA[2 * i]
      }
    }
    return best
  }, [living, geo])
  const tip = useMemo(() => {
    if (!living || !geo.solid || !geo.film || !geo.solid.attributes.position.count) return -1
    const a = geo.solid.attributes.aAnchor.array
    const p = geo.film.attributes.position.array
    let best = -1
    let bd = Infinity
    for (let i = 0; i < p.length / 3; i++) {
      const d = (p[3 * i] - a[0]) ** 2 + (p[3 * i + 1] - a[1]) ** 2 + (p[3 * i + 2] - a[2]) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }, [living, geo])
  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose())
      geo.solid?.dispose()
      geo.film?.dispose()
    },
    [materials, geo],
  )
  const solid = useRef(null)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const ended = r.stage === 'ended'
    if (legible) {
      const d = r.desc
      // Where its films came away (the simulation's record of each release):
      // its place across the sheet, and its height on the resident as it
      // stood, from how far it lay then.
      const m = marks.current
      const left = r.left ?? []
      while (m.list.length < Math.min(4, left.length)) {
        const e = left[m.list.length]
        const k = Math.min(1, Math.max(0, (e.height - 0.1) / Math.max(d.height * (1 - e.recline), 1e-3)))
        m.list.push([e.along, d.height * k, MARK.radius * d.height, e.t])
      }
      // The air at its crest, on the simulation's own clock.
      const target = tmp.x.set(0, 0, 0)
      const give = WIND.give[r.stage] ?? 0
      if (give > 0) {
        const air = typeof lifecycle.air === 'function' ? lifecycle.air() : lifecycle.air.current
        const w = airWaves(d.p[0], d.p[1] + d.height * 0.8, d.p[2], lifecycle.t, air)
        const full = r.need > 0 ? Math.min(1, r.taken / r.need) : 1
        const k = WIND.gain * give * (1.4 - 0.4 * full) * (1 - r.recline) * r.unfold
        target.set(w.vx * k, 0, w.vz * k)
      }
      // M1: turned toward a neighbour's release (the simulation's `reach`), as far as it stands.
      if (r.reach && r.stage !== 'ended') {
        const turn = d.height * (1 - r.recline) * r.unfold
        target.x += r.reach[0] * turn
        target.z += r.reach[1] * turn
      }
      bend.current.lerp(target, Math.min(1, Math.min(delta, 0.1) / WIND.ease))
    }
    // Releasing, it thins as its films leave; ended, its contour is as
    // present as the matter it still holds, and never less than a trace.
    // D1 (`legible`): as present as the matter its body holds now, against
    // a full body for its height — faint as it begins to form, filling as it
    // takes matter up, a little denser than the colony's placed veils when
    // full, thinner as its films leave, and as an old contour, as much as
    // it still holds.
    const full = LIFECYCLE.bodyPerHeight * r.desc.height
    // (M3, `age`: an old contour settles toward the ground as it ages.)
    const settled = age && ended ? 1 - AGE.contour[2] * smoothstep(AGE.contour[0], AGE.contour[1], r.stageTime) : 1
    // (M3R, `closeRange`: as it ends, from the one to the other over a few
    // seconds, not at once: the body becomes the contour, it does not dim.)
    const asEnded = (0.2 + 0.75 * (r.contour / full)) * settled
    const presence = legible
      ? ended
        ? closeRange
          ? asEnded + (0.3 + 0.85 * Math.min(1.1, r.contour / full) - asEnded) * (1 - smoothstep(0, 6, r.stageTime))
          : asEnded
        : 0.3 + 0.85 * Math.min(1.1, r.body / full)
      : ended
        ? 0.22 + 0.4 * (r.contour0 > 0 ? r.contour / r.contour0 : 0)
        : r.stage === 'releasing'
          ? 1 - 0.3 * smoothstep(0, LIFECYCLE.release, r.stageTime)
          : 1
    // M3N: noticing the visitor (lib/notice.js), on the visitor's clock: its
    // lean and its crest's fold drawn with its air and posture (so the
    // encounter meets it where it is drawn), and its frost.
    const seen = notice ? notice.of(r, (ended ? r.contour : r.body) / full) : null
    let bent = posture ? postureOf(r) : null
    if (bent && seen?.curl) bent = [bent[0], bent[1], bent[2] + seen.curl]
    // (The air's bend grows with the square of the height over r.desc.height,
    // so the crest's own displacement is set through that.)
    const crest = Math.max(0.05, Math.min(1.4, 1.4 * Math.max(r.unfold, 0.05)) ** 2)
    const sheetH = r.desc.height * 1.4 * Math.max(r.unfold, 0.05)
    // M3L: its folds now, and how gathered it is.
    let liv = null
    if (fold) {
      const Gs = gather.current
      const k = seen ? seen.tension : Gs.k ?? 0.5
      Gs.k = k
      const w = 2 * Math.PI * lerpN(LV.hz[0], LV.hz[1], k)
      const zeta = lerpN(LV.damping[0], LV.damping[1], k)
      const dt = Math.min(delta, 0.05)
      Gs.v += (w * w * ((seen ? seen.target : 0) - Gs.G) - 2 * zeta * w * Gs.v) * dt
      Gs.G = Math.min(1.25, Math.max(-0.35, Gs.G + Gs.v * dt))
      const lx = Math.cos(r.desc.lean)
      const lz = Math.sin(r.desc.lean)
      if (seen) {
        Gs.side = seen.side[0] * -lz + seen.side[1] * lx
        // (M3C: the side it cups away from: in front of its face or behind it.)
        Gs.cup = Math.min(1, Math.max(-1, 3 * (seen.side[0] * lx + seen.side[1] * lz)))
      }
      // As deep as the matter it holds; relaxing as it lies down; grown as far as it has.
      const fill = Math.min(1, (ended ? r.contour : r.body) / full)
      const amp = r.desc.height * Math.min(1, r.unfold * 1.2) * (ended ? LV.contour : Math.max(LV.contour, (1 - r.recline) ** 2))
      const breath = LV.breath[0] * Math.sin((t * 2 * Math.PI) / LV.breath[1] + fold.breath)
      liv = {
        shape: [fold.k1, fold.k2, amp * lerpN(LV.flute[0], LV.flute[1], fill), amp * LV.ruffleDepth * fill],
        move: [Gs.G + breath, lerpN(LV.draw[0], LV.draw[1], k), Gs.side, crestU],
        size: [(r.desc.width ?? r.desc.height * 0.9) / 2, sheetH, amp * lerpN(LV.lobe[0], LV.lobe[1], fill), fold.phase],
        form: [LV.form[0], Gs.cup ?? 0, LV.form[1], LV.form[2]],
        twist: LV.twist,
        lean: [lx, lz],
        time: t,
      }
    }
    const leanX = bend.current.x + (seen ? seen.lean[0] / crest : 0)
    const leanZ = bend.current.z + (seen ? seen.lean[1] / crest : 0)
    // M3R: its bead goes with the last of its films (it shrinks into the
    // crest it hangs from), rather than vanishing once it has lain down.
    const bead = posture && r.stage === 'releasing' ? 1 - smoothstep(0.55, 1, r.stageTime / LIFECYCLE.release) : 1
    materials.forEach((material, k) => {
      const u = material.uniforms
      // (M3L: its bead draws into its crest while it is gathered.)
      const drawn = liv ? (LV.beadIn ? 1 - smoothstep(0.03, LV.beadIn, liv.move[0]) : 1 - 0.9 * Math.min(1, Math.max(0, liv.move[0]))) : 1
      u.uGrowth.value = r.unfold * growth.current * (k === 0 ? bead * drawn : 1)
      if (bent && u.uPosture) {
        u.uPosture.value.set(bent[0], bent[1], bent[2], r.desc.height * 1.4 * Math.max(r.unfold, 0.05))
        u.uTilt.value.set(...tilt)
      }
      u.uTime.value = t
      u.uWaterY.value = waterLine.current
      u.uGlow.value = 0.6
      // M3R: a living sheet stays closed (its thin spots light, never a few
      // holes, which read as eyes); it opens only where its films left.
      u.uOpenness.value = closeRange ? Math.min(openness * 1.6, 0.34 / Math.max(r.desc.openness ?? 1, 1e-3)) : openness * 1.6
      u.uRecline.value = r.recline
      u.uBase.value.set(r.desc.p[0], r.desc.p[1], r.desc.p[2])
      u.uLean.value.set(Math.cos(r.desc.lean), Math.sin(r.desc.lean))
      u.uFade.value = presence
      // A contour's rim is quiet: it lies on the ground, it is not an object.
      if (u.uEdgeGlow) u.uEdgeGlow.value = ended ? 0.06 : edgeGlows[materials.indexOf(material)]
      setAccumulation(u, accumulation)
      if (u.uWind) u.uWind.value.set(leanX, 0, leanZ, r.desc.height)
      if (u.uLivingShape && liv) {
        u.uLivingShape.value.set(...liv.shape)
        u.uLivingMove.value.set(...liv.move)
        u.uLivingSize.value.set(...liv.size)
        u.uLivingForm.value.set(...liv.form)
        u.uLivingTwist.value = liv.twist
      }
      if (u.uLivingTip) {
        if (liv && tip >= 0) {
          const A = geo.film.attributes
          const at = livingAt([A.normal.array[3 * tip], A.normal.array[3 * tip + 1], A.normal.array[3 * tip + 2]], A.uv.array[2 * tip], A.uv.array[2 * tip + 1], A.aSway.array[tip], liv, [0, 0, 0])
          u.uLivingTip.value.set(at[0], at[1], at[2])
        } else u.uLivingTip.value.set(0, 0, 0)
      }
      if (u.uNotice) {
        if (seen) {
          u.uNotice.value.set(seen.side[0], seen.side[1], seen.frost, seen.spread)
          u.uNoticeAt.value.set(r.desc.p[0], r.desc.p[1], r.desc.p[2], sheetH)
          u.uNoticeCup.value.set(seen.cup, sheetH, 0, 0)
        } else {
          u.uNotice.value.z = 0
          u.uNoticeCup.value.x = 0
        }
      }
      if (u.uStain) u.uStain.value.set(...STAIN.color, ended ? 0 : STAIN.most * Math.min(1, Math.sqrt((r.dose ?? 0) / STAIN.full)))
      if (u.uLeft) {
        const list = marks.current.list
        for (let k = 0; k < 4; k++) {
          const e = list[k]
          if (e) u.uLeft.value[k].set(e[0], e[1], e[2], smoothstep(0, MARK.away, lifecycle.t - e[3]))
          else u.uLeft.value[k].set(0, 0, 1, 0)
          // M3S: how freshly it parted there, and how long ago (the sheet's spring back).
          if (u.uLeftFresh) {
            const since = e ? lifecycle.t - e[3] : 1e9
            const [rise, full, gone] = PASSAGE.mark
            u.uLeftFresh.value.setComponent(k, smoothstep(0, rise, since) * (1 - smoothstep(full, gone, since)))
            u.uLeftSince.value.setComponent(k, e ? since : -1)
          }
        }
        u.uAcross.value.set(-Math.sin(r.desc.lean), Math.cos(r.desc.lean))
      }
    })
    // The warm accent (only the membrane carries it): where matter crosses
    // this body now, and how recently.
    const W = WARM.variants[lifecycle.warm]
    const film = materials[1]
    if (film) {
      setWarm(film, !!W && !!(W.left || W.take || W.give || W.grow))
      if (W) {
        const u = film.uniforms
        const now = lifecycle.t
        u.uWarmTint.value.set(W.tint ?? WARM.tint)
        // B: the matter it has taken in over the last few seconds, as a share
        // of what full-rate uptake brings in that time.
        const g = W.grow
        const taking = g && (r.stage === 'forming' || r.stage === 'holding')
        const n = taking ? Math.min(1, recentAt(r.inflow, r.inflowAt, now) / (LIFECYCLE.uptake * RECENT)) : 0
        if (g) u.uGrow.value.set(g.strength * n, g.reach[0] + g.reach[1] * n, g.glow, g.density)
        else u.uGrow.value.set(0, 1, 0, 0)
        const [x, y, z] = r.desc.p
        let strength = 0
        if (r.stage === 'ended') {
          // An old contour giving part of itself to a resident forming on it.
          strength = W.give * recency(now - (r.gaveAt ?? -1e9), WARM.fade.give)
          u.uWarmAt.value.set(x, y, z, 0.3 + 0.6 * r.desc.height)
        } else if (r.stage === 'releasing' && r.lastRelease) {
          // Where its last film came away.
          strength = W.left * recency(now - r.lastRelease.t, WARM.fade.left)
          u.uWarmAt.value.set(...r.lastRelease.at, 0.35)
        } else {
          // Its foot, while it takes matter in from the ground.
          strength = W.take * recency(now - (r.tookAt ?? -1e9), WARM.fade.take)
          u.uWarmAt.value.set(x, y, z, 0.45)
        }
        u.uWarmIn.value = strength
        u.uWarmGlow.value = W.glow
      }
    }
    // M3E: the one met gives the encounter its surface as drawn (a few
    // times a second, and at once when first met) and its air; it shows the
    // dent. Every other resident shows none.
    if (encounter) {
      const mine = encounter.resident === r && geo.film
      if (mine) {
        const P = posed.current
        if (!P.array) P.array = new Float32Array(geo.film.attributes.position.count * 3)
        if (!encounter.ready || ++P.tick % 4 === 0) {
          const top = poseFilm(geo.film, r.unfold * growth.current, bent, r, tilt ?? [0, 0, 0], P.array, seen?.cup ?? 0, sheetH, liv)
          encounter.surface(r, P.array, r.desc.p[1], top)
        }
        encounter.wind = [leanX, 0, leanZ, r.desc.height]
      }
      const D = mine ? encounter.displacement : null
      for (const material of materials) {
        const u = material.uniforms
        if (!u.uDent) continue
        if (D) {
          u.uDent.value.set(D[0], D[1], D[2])
          u.uDentAt.value.set(encounter.at[0], encounter.at[1], encounter.at[2], encounter.radius)
          u.uDentFoot.value.set(encounter.foot, encounter.footSpan, encounter.height, encounter.E.bend)
        } else u.uDent.value.set(0, 0, 0)
      }
    }
    if (solid.current) solid.current.visible = visible && !ended
  })

  return (
    <group>
      {geo.solid && <mesh ref={solid} geometry={geo.solid} material={materials[0]} frustumCulled={false} />}
      {geo.film && <mesh geometry={geo.film} material={materials[1]} visible={visible} frustumCulled={false} />}
    </group>
  )
}

/**
 * The residue: a film lying on the ground over the patch, reading the live
 * residual. Rebuilt only when the residual changes.
 */
function Deposit({ lifecycle, world, waterLine, accumulation, visible, cull = false, light = null, legible = false, age = false }) {
  const LOOK = legible ? { ...DEPOSIT_LOOK, ...DEPOSIT_LEGIBLE } : DEPOSIT_LOOK
  // D1 (`light`): the residue lit as the ground it lies on is (its own entry, else the colony skin's).
  const material = useMemo(() => warmUniforms(createFormMaterial({ kind: 'tissue', tint: DEPOSIT_LOOK.tint, light: light && { tissue: light.deposit ?? light.tissue }, age })), [light, age])
  // M3: the age field, and when it was last read.
  const ageField = useMemo(() => (age ? { cells: new Float32Array(lifecycle.residual.length), shown: new Float32Array(lifecycle.residual.length), at: -1e9 } : null), [age, lifecycle])
  const shown = useMemo(() => new Float32Array(lifecycle.residual.length), [lifecycle])
  // The warm accent's grids: how recently matter arrived in each cell, and
  // was taken up from it (1 now, 0 faded), as drawn (blurred like the residue).
  const warmth = useMemo(() => {
    const n = lifecycle.residual.length
    return { arrived: new Float32Array(n), drawn: new Float32Array(n), arrivedShown: new Float32Array(n), drawnShown: new Float32Array(n), soft: new Float32Array(n), t: -1, variant: 0, any: false }
  }, [lifecycle])
  const { geometry, uvs } = useMemo(() => {
    const c = lifecycle.colony
    const half = c.radius + LIFECYCLE.margin + 0.6
    const n = DEPOSIT_GRID
    const position = []
    const uvs = []
    const index = []
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = c.x + (i / (n - 1) - 0.5) * 2 * half
        const z = c.z + (j / (n - 1) - 0.5) * 2 * half
        const [u, v] = world.toUV(x, z)
        position.push(x, Math.max(world.groundY(u, v), world.waterY - 0.6) + DEPOSIT_LIFT, z)
        uvs.push([u, v])
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i
        index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
      }
    }
    const count = n * n
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(count).fill([0, 1, 0]).flat(), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(position.filter((_, k) => k % 3 !== 1), 2))
    geometry.setAttribute('aAnchor', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('aBirth', new THREE.Float32BufferAttribute(new Array(count).fill([0, 0.001]).flat(), 2))
    const look = new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4)
    const edge = new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1)
    look.setUsage(THREE.DynamicDrawUsage)
    edge.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aLook', look)
    geometry.setAttribute('aEdge', edge)
    geometry.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(count), 1))
    // Read only when the warm accent is compiled in.
    const warm = new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2)
    warm.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aWarm', warm)
    // Read only with M3's age (AGE).
    const ageAttr = new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1)
    ageAttr.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aAge', ageAttr)
    geometry.setIndex(index)
    geometry.computeBoundingSphere()
    return { geometry, uvs }
  }, [lifecycle, world])
  // Culled (the Habitat's D, where each grid spans the whole wider world):
  // the display's work only over the cells this deposit reads, with room
  // for its blurs, so its result there is the same. `scratch` for blurWindow.
  const win = useMemo(() => {
    if (!cull) return null
    const res = lifecycle.res
    let u0 = 1
    let u1 = 0
    let v0 = 1
    let v1 = 0
    for (const [u, v] of uvs) {
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const M = 8
    const at = (t, edge) => Math.max(0, Math.min(res - 1, Math.floor(t * res) + edge))
    return [at(u0, -M), at(u1, M), at(v0, -M), at(v1, M)]
  }, [cull, uvs, lifecycle])
  const scratch = useMemo(() => (cull ? new Float32Array(lifecycle.residual.length) : null), [cull, lifecycle])
  const blurShown = (src, out, radius) => (win ? blurWindow(src, out, lifecycle.res, radius, win, scratch) : blur(src, out, lifecycle.res, radius))
  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )
  const seen = useRef(-1)
  // Culled only: whether anything has settled here yet.
  const [empty, setEmpty] = useState(true)

  useFrame((state) => {
    if (lifecycle.version !== seen.current) {
      seen.current = lifecycle.version
      blurShown(lifecycle.residual, shown, LOOK.blur)
      const look = geometry.attributes.aLook
      const F = LOOK.full
      for (let k = 0; k < uvs.length; k++) {
        const r = sample(shown, lifecycle.res, uvs[k][0], uvs[k][1])
        // The tissue material reads (thickness, vein light, presence, crust).
        const fold = smoothstep(F * 0.04, F * 0.15, r) * (1 - smoothstep(F * 0.15, F * 0.45, r))
        look.setXYZW(k, smoothstep(0, F, r), 0.35 * fold, smoothstep(F * 0.04, F * 0.5, r), 0.9 * smoothstep(F * 0.3, F * 1.5, r))
      }
      look.needsUpdate = true
      // Culled (a world of many lifecycles: the Habitat's D): nothing is drawn
      // until something has settled here.
      if (cull) {
        let any = false
        for (let k = 0; k < uvs.length && !any; k++) any = look.getX(k) > 0.002
        if (any === empty) setEmpty(!any)
      }
    }
    const u = material.uniforms
    u.uGrowth.value = 1
    u.uTime.value = state.clock.elapsedTime
    u.uWaterY.value = waterLine.current
    setAccumulation(u, accumulation)

    // M3: how long the matter in each cell has lain, re-read now and then.
    if (ageField && (!cull || !empty) && lifecycle.t - ageField.at >= AGE.every) {
      ageField.at = lifecycle.t
      const res = lifecycle.res
      const [i0, i1, j0, j1] = win ?? [0, res - 1, 0, res - 1]
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * res + i
        ageField.cells[c] = Math.min(1, Math.max(0, (lifecycle.t - lifecycle.arrived[c]) / AGE.full))
      }
      blurShown(ageField.cells, ageField.shown, 1)
      const attr = geometry.attributes.aAge
      for (let k = 0; k < uvs.length; k++) attr.setX(k, sample(ageField.shown, res, uvs[k][0], uvs[k][1]))
      attr.needsUpdate = true
    }

    const W = WARM.variants[lifecycle.warm]
    const on = !!W && !!(W.edge || W.fresh || W.drawn || W.absorb)
    setWarm(material, on)
    if (on && (warmth.t !== lifecycle.t || warmth.variant !== lifecycle.warm)) {
      warmth.t = lifecycle.t
      warmth.variant = lifecycle.warm
      const now = lifecycle.t
      let any = false
      const res = lifecycle.res
      const [i0, i1, j0, j1] = win ?? [0, res - 1, 0, res - 1]
      for (let c0 = j0 * res + i0, j = j0; j <= j1; j++, c0 += res) for (let c = c0; c <= c0 + i1 - i0; c++) {
        const a = recency(now - lifecycle.arrived[c], WARM.fade.arrive)
        // A: how much was drawn from here lately; otherwise how recently.
        const d = W.absorb
          ? Math.min(1, recentAt(lifecycle.uptake[c], lifecycle.uptakeAt[c], now) / UPTAKE_FULL)
          : recency(now - lifecycle.drawn[c], WARM.fade.drawn)
        warmth.arrived[c] = a
        warmth.drawn[c] = d > 0.002 ? d : 0
        if (a > 0 || warmth.drawn[c] > 0) any = true
      }
      // Nothing recent, now or last time: the attribute already reads 0.
      if (any || warmth.any) {
        blurShown(warmth.arrived, warmth.arrivedShown, LOOK.blur)
        // A keeps close to the cells it is drawn from: two light passes, so
        // the cells' grid does not show.
        if (W.absorb) {
          blurShown(warmth.drawn, warmth.soft, 1)
          blurShown(warmth.soft, warmth.drawnShown, 1)
        } else blurShown(warmth.drawn, warmth.drawnShown, LOOK.blur)
        const attr = geometry.attributes.aWarm
        for (let k = 0; k < uvs.length; k++) {
          attr.setXY(k, sample(warmth.arrivedShown, lifecycle.res, uvs[k][0], uvs[k][1]), sample(warmth.drawnShown, lifecycle.res, uvs[k][0], uvs[k][1]))
        }
        attr.needsUpdate = true
      }
      warmth.any = any
    }
    if (on) {
      u.uWarm.value.set(W.edge, W.fresh, W.drawn, W.glow)
      u.uAbsorb.value.set(...(W.absorb ?? [0, 0, 0, 0]))
      u.uWarmTint.value.set(W.tint ?? WARM.tint)
    }
  })

  // Culled (a world of many lifecycles: the Habitat's D): off screen, or
  // before anything has settled, it is not drawn.
  if (cull) return <mesh geometry={geometry} material={material} visible={visible && !empty} />
  return <mesh geometry={geometry} material={material} visible={visible} frustumCulled={false} />
}

/**
 * `carriers` (the Habitat): the films show the matter they carry as grains
 * (AirFragments' CARRIER), so they read apart from the air's own particles.
 */
export default function LifecycleLayer({ lifecycle, world, meshes, growth, waterLine, openness, accumulation, visible, frame = true, carriers = false, cull = false, legible = false, light = null, age = false, closeRange = false, encounter = null, kinFilms = false, notice = null, living = false, passage = false }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  // (M3S: its passage traced instead.)
  const wake = useMemo(() => (carriers && !passage ? { points: createWake(), next: new Map(), slot: new Map(), cursor: 0 } : null), [carriers, passage])
  useEffect(
    () => () => {
      wake?.points.geometry.dispose()
      wake?.points.material.dispose()
    },
    [wake],
  )
  const trace = useMemo(() => (passage ? createTrace() : null), [passage])
  useEffect(
    () => () => {
      trace?.mesh.geometry.dispose()
      trace?.mesh.material.dispose()
    },
    [trace],
  )
  const size = useThree((s) => s.size)
  const films = useMemo(() => {
    const mesh = createFilmMesh(FILMS, { carrier: carriers, over: legible, kin: kinFilms, passage })
    mesh.name = 'lifecycle-films'
    warmUniforms(mesh.material)
    const warm = new THREE.InstancedBufferAttribute(new Float32Array(FILMS), 1)
    warm.setUsage(THREE.DynamicDrawUsage)
    mesh.geometry.setAttribute('aWarm', warm)
    return mesh
  }, [carriers, legible, kinFilms, passage])
  useEffect(
    () => () => {
      films.geometry.dispose()
      films.material.dispose()
    },
    [films],
  )
  // New residents are new components: the count is the only thing React sees.
  const [count, setCount] = useState(lifecycle.residents.length)

  // The patch's view, once, when the experiment begins.
  const framed = useRef(false)
  useEffect(() => {
    if (!frame || framed.current || !controls) return
    framed.current = true
    if (lifecycle.conduit) {
      // Every colony the tissue joins, from the south, well above, as far
      // back as they are spread (never nearer than `least`).
      const cs = lifecycle.conduit.colonies
      const xs = cs.map((c) => c.x)
      const zs = cs.map((c) => c.z)
      const tx = (Math.min(...xs) + Math.max(...xs)) / 2
      const tz = (Math.min(...zs) + Math.max(...zs)) / 2
      const spread = Math.max(VIEW_CONDUIT.least, Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * 1.6)
      const y = world.groundY(...world.toUV(tx, tz))
      const [fx, fy, fz] = VIEW_CONDUIT.from
      controls.target.set(tx, y, tz)
      camera.position.set(tx + fx * spread, y + fy * spread, tz + fz * spread)
      controls.update()
      return
    }
    const c = lifecycle.colony
    const y = world.groundY(...world.toUV(c.x, c.z))
    controls.target.set(c.x + VIEW.target[0], y + VIEW.target[1], c.z + VIEW.target[2])
    camera.position.set(c.x + VIEW.target[0] + VIEW.from[0], y + VIEW.from[1], c.z + VIEW.target[2] + VIEW.from[2])
    controls.update()
  }, [frame, controls, camera, lifecycle, world])

  useFrame((state, delta) => {
    lifecycle.advance(Math.min(delta, 0.1))
    if (lifecycle.residents.length !== count) setCount(lifecycle.residents.length)
    const t = state.clock.elapsedTime

    // The films: in flight, then fading where they settled.
    films.material.uniforms.uTime.value = t
    const seeds = films.geometry.attributes.aSeed
    const fades = films.geometry.attributes.aFade
    const softs = films.geometry.attributes.aSoft
    const ages = films.geometry.attributes.aAge
    const warms = films.geometry.attributes.aWarm
    const loads = films.geometry.attributes.aLoad
    const W = WARM.variants[lifecycle.warm]
    setWarm(films.material, !!W && W.film > 0)
    if (W) films.material.uniforms.uWarmGlow.value = W.glow
    const shown = lifecycle.films.filter((f) => f.state === 'flight' || (f.state === 'settled' && f.age - f.settledAt < FADE_OUT)).slice(-FILMS)
    // M3S: the simulation's time since the last frame (0 while it is paused).
    const passes = films.geometry.attributes.aPass
    const simDt = trace ? (trace.t == null ? 0 : Math.max(0, lifecycle.t - trace.t)) : 0
    if (trace) trace.t = lifecycle.t
    for (let i = 0; i < FILMS; i++) {
      const f = shown[i]
      if (!f) {
        films.setMatrixAt(i, tmp.m.makeScale(0, 0, 0))
        fades.setX(i, 0)
        warms.setX(i, 0)
        loads?.setX(i, 0)
        passes?.setXY(i, 0, 0)
        continue
      }
      if (passes) {
        // Its comb rows: as far as it has travelled since the last frame, and
        // as strongly as it is moving; settled, they fade where they stand.
        const C = PASSAGE.comb
        let c = trace.phase.get(f.id)
        if (!c) trace.phase.set(f.id, (c = { phase: f.seed * 3.7, k: 0 }))
        if (f.state === 'flight') {
          const speed = Math.hypot(f.v[0], f.v[1], f.v[2])
          c.phase += speed * simDt * C.phase
          c.k = smoothstep(0, C.rise, f.age) * smoothstep(C.speed[0], C.speed[1], speed)
          passes.setXY(i, c.phase, c.k)
        } else passes.setXY(i, c.phase, c.k * (1 - smoothstep(0, C.settle, f.age - f.settledAt)))
      }
      // Lying along the air that carries it, tilted up from flat.
      tmp.x.set(f.v[0], f.v[1] * 0.5, f.v[2])
      if (tmp.x.lengthSq() < 1e-10) tmp.x.set(1, 0, 0)
      tmp.x.normalize()
      tmp.z.copy(tmp.up).addScaledVector(tmp.x, -tmp.x.dot(tmp.up)).normalize()
      tmp.y.crossVectors(tmp.z, tmp.x)
      const settling = f.state === 'settled' ? Math.max(0, 1 - (f.age - f.settledAt) / FADE_OUT) : 1
      // Coming to rest it lies flat.
      // (M3S: carried, it turns over more, a thin film tumbling in the air, so
      // from eye height it shows its face now and then rather than its edge.)
      const turn = passage
        ? PASSAGE.tumble * Math.sin(0.5 * t + f.seed) * (f.state === 'flight' ? 1 : 1 - smoothstep(0, 1.5, f.age - f.settledAt))
        : 0.35 * Math.sin(0.4 * t + f.seed)
      const roll = (0.9 * Math.sin(f.seed) + turn) * settling
      tmp.z.multiplyScalar(Math.cos(roll)).addScaledVector(tmp.y, Math.sin(roll))
      tmp.y.crossVectors(tmp.z, tmp.x)
      tmp.q.setFromRotationMatrix(tmp.m.makeBasis(tmp.x, tmp.y, tmp.z))
      // (M3E, `kinFilms`: as large as the matter it carries, about a quarter of
      // its resident's sheet for its quarter of the shed matter; the
      // simulation's own `size` drew each as large as the resident.)
      let length = (kinFilms ? 0.11 + 0.07 * Math.sqrt(Math.min(1, f.matter / FULL_LOAD)) : f.size) * (0.6 + 0.4 * smoothstep(0, 3, f.age))
      // M3S: settling, it spreads as it clears into the residue.
      if (passage && f.state === 'settled') length *= 1 + (PASSAGE.land.spread - 1) * smoothstep(0, PASSAGE.land.time, f.age - f.settledAt)
      tmp.p.set(f.p[0], f.p[1] + (f.state === 'settled' ? DEPOSIT_LIFT : 0), f.p[2])
      const dist = tmp.p.distanceTo(camera.position)
      const [near0, near1] = carriers ? NEAR.carriers : NEAR.overview
      const fade = smoothstep(0, 1, f.age) * settling * smoothstep(near0, near1, dist) * (1 - smoothstep(18, 30, dist))
      seeds.setX(i, f.seed)
      fades.setX(i, fade)
      softs.setX(i, smoothstep(0.05, 0.12, length / Math.max(dist, 1e-3)))
      ages.setX(i, Math.min(1, f.age / 20))
      // Warm just after it leaves its resident, and just after it settles
      // where the record keeps it (with feedback off, nothing is kept).
      const released = f.state === 'flight' ? recency(f.age, WARM.fade.release) : 0
      const landed = f.state === 'settled' && lifecycle.feedback ? recency(f.age - f.settledAt, WARM.fade.land) : 0
      warms.setX(i, W ? W.film * Math.max(released, landed) : 0)
      loads?.setX(i, Math.min(1, f.matter / FULL_LOAD))
      films.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(length)))
    }
    films.instanceMatrix.needsUpdate = true
    seeds.needsUpdate = true
    fades.needsUpdate = true
    softs.needsUpdate = true
    ages.needsUpdate = true
    warms.needsUpdate = true
    if (loads) loads.needsUpdate = true
    if (passes) passes.needsUpdate = true

    // M3S: each film's path, from where it came away to where it settled.
    if (trace) {
      const T = PASSAGE.trace
      const now = lifecycle.t
      const traced = lifecycle.films.filter((f) => f.state === 'flight' || (f.state === 'settled' && f.age - f.settledAt < T.life))
      const byId = new Map(traced.map((f) => [f.id, f]))
      for (const slot of trace.slots) if (slot.id >= 0 && !byId.has(slot.id)) slot.id = -1
      for (const f of traced.slice(-FILMS)) {
        let slot = trace.slots.find((x) => x.id === f.id)
        if (!slot) {
          slot = trace.slots.find((x) => x.id < 0)
          if (!slot) break
          slot.id = f.id
          slot.points = [[f.p[0], f.p[1], f.p[2], now]]
          slot.flying = f.state === 'flight'
          continue
        }
        const last = slot.points[slot.points.length - 1]
        if (f.state === 'flight' && now - last[3] >= T.every) slot.points.push([f.p[0], f.p[1], f.p[2], now])
        else if (f.state === 'settled' && slot.flying) slot.points.push([f.p[0], f.p[1] + DEPOSIT_LIFT, f.p[2], now])
        slot.flying = f.state === 'flight'
        if (slot.points.length > T.points) slot.points.shift()
      }
      for (const [id] of trace.phase) if (!byId.has(id) && !shown.some((f) => f.id === id)) trace.phase.delete(id)

      const pos = trace.mesh.geometry.attributes.position
      const alpha = trace.mesh.geometry.attributes.aAlpha
      const per = T.points + 1
      const cam = camera.position
      const pts = []
      trace.slots.forEach((slot, si) => {
        pts.length = 0
        if (slot.id >= 0) {
          pts.push(...slot.points)
          // On to the film where it is now.
          const f = byId.get(slot.id)
          if (f && f.state === 'flight') pts.push([f.p[0], f.p[1], f.p[2], now])
        }
        for (let k = 0; k < per; k++) {
          const v = (si * per + k) * 2
          const q = pts[Math.min(k, pts.length - 1)]
          if (!q || k >= pts.length) {
            if (q) {
              pos.setXYZ(v, q[0], q[1], q[2])
              pos.setXYZ(v + 1, q[0], q[1], q[2])
            }
            alpha.setX(v, 0)
            alpha.setX(v + 1, 0)
            continue
          }
          const a = pts[Math.max(0, k - 1)]
          const b = pts[Math.min(pts.length - 1, k + 1)]
          tmp.x.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
          tmp.y.set(cam.x - q[0], cam.y - q[1], cam.z - q[2])
          const dist = tmp.y.length()
          tmp.z.crossVectors(tmp.x, tmp.y)
          if (tmp.z.lengthSq() < 1e-12) tmp.z.set(0, 1, 0)
          const age = Math.min(1, (now - q[3]) / T.life)
          // (Spreading a little as it fades, as disturbed air does.)
          tmp.z.normalize().multiplyScalar(T.width * (0.6 + 0.6 * age))
          pos.setXYZ(v, q[0] - tmp.z.x, q[1] - tmp.z.y, q[2] - tmp.z.z)
          pos.setXYZ(v + 1, q[0] + tmp.z.x, q[1] + tmp.z.y, q[2] + tmp.z.z)
          // Faint where it is oldest; clear right at the eye.
          const fade = T.alpha * (1 - age) ** 2 * smoothstep(T.near[0], T.near[1], dist) * (1 - smoothstep(18, 30, dist)) * (pts.length > 1 ? 1 : 0)
          alpha.setX(v, fade)
          alpha.setX(v + 1, fade)
        }
      })
      pos.needsUpdate = true
      alpha.needsUpdate = true
    }

    // The carriers' wakes: a mote of each one's matter left where it is, now
    // and then, while it flies (on the simulation's clock, so a paused or
    // faster lifecycle leaves them as it moves).
    if (wake) {
      const pos = wake.points.geometry.attributes.position
      const age = wake.points.geometry.attributes.aAge
      const load = wake.points.geometry.attributes.aLoad
      const dt = Math.min(delta, 0.1) * (lifecycle.paused ? 0 : lifecycle.speed)
      const n = age.count
      for (let k = 0; k < n; k++) {
        const a = age.getX(k) + dt
        age.setX(k, a)
        if (a < WAKE.life) pos.setY(k, pos.getY(k) - WAKE.sink * dt)
      }
      for (const f of lifecycle.films) {
        if (f.state !== 'flight') continue
        const due = wake.next.get(f.id) ?? f.age
        if (f.age < due) continue
        wake.next.set(f.id, f.age + WAKE.every)
        const k = wake.cursor
        wake.cursor = (wake.cursor + 1) % n
        pos.setXYZ(k, f.p[0] + (Math.sin(f.seed + f.age * 7.1) * 0.03), f.p[1] - 0.02, f.p[2] + (Math.cos(f.seed * 1.3 + f.age * 5.3) * 0.03))
        age.setX(k, 0)
        load.setX(k, Math.min(1, f.matter / FULL_LOAD))
      }
      pos.needsUpdate = true
      age.needsUpdate = true
      load.needsUpdate = true
      // Pixels per unit at unit distance, so a mote is its size in the world.
      wake.points.material.uniforms.uScale.value = (size.height * 0.5 * state.viewport.dpr) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    }
  })

  const residents = lifecycle.residents.slice(0, count)
  return (
    <group>
      <Deposit lifecycle={lifecycle} world={world} waterLine={waterLine} accumulation={accumulation} visible={visible} cull={cull} light={light} legible={legible} age={age} />
      {lifecycle.conduit && <ConduitLayer lifecycle={lifecycle} world={world} visible={visible} />}
      {lifecycle.greybox && <ConduitGreybox lifecycle={lifecycle} world={world} visible={visible} />}
      {lifecycle.foldStudy && !lifecycle.greybox && (
        <ConduitFold
          lifecycle={lifecycle}
          world={world}
          meshes={meshes}
          waterLine={waterLine}
          openness={openness}
          accumulation={accumulation}
          visible={visible}
        />
      )}
      {residents.map((r) => (
        <Resident
          key={r.id}
          resident={r}
          lifecycle={lifecycle}
          world={world}
          meshes={meshes}
          growth={growth}
          waterLine={waterLine}
          openness={openness}
          accumulation={accumulation}
          visible={visible}
          legible={legible}
          age={age}
          closeRange={closeRange}
          encounter={encounter}
          notice={notice}
          living={living}
          passage={passage}
        />
      ))}
      <primitive object={films} renderOrder={6} />
      {wake && <primitive object={wake.points} renderOrder={6} />}
      {trace && <primitive object={trace.mesh} renderOrder={6} />}
    </group>
  )
}
