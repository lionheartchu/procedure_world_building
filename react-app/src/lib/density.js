/**
 * Sediment as a volume.
 *
 * The terrain view answers "how high is the ground at (x, z)". This module
 * answers "is there material at (x, y, z)" — one scalar per point in a box,
 * positive inside the mass and negative outside, so the same bed can have
 * thickness, layers, pores and tunnels running through it.
 *
 * The field is built as a short sequence of operations on a single value,
 * written in the order they apply. Everything is kept in world units and in
 * roughly signed-distance terms, so the combinators are the usual ones:
 *
 *     keep both (intersect) ... d = min(d, other)
 *     remove a void .......... d = min(d, distanceOutsideVoid)
 *     add material ........... d = max(d, insideAddition)
 *     perturb ................ d += something small
 *
 * The top surface comes from the same noise stack as the terrain
 * (`createField`), so the volume reads as a piece of the same estuary bed
 * rather than an unrelated object.
 */

import { createField } from './field'
import { createScaffold } from './scaffold'
import { fbm, fbm3, makeSimplex2, makeSimplex3 } from './noise'

/** Working box, in world units. Centred on the origin. */
export const VOLUME_SIZE = [10, 5.2, 10]

const FLOOR_Y = -2.35
const RELIEF = 2.2 // vertical amplitude of the bed surface
const FRAGMENT_RADII = [4.6, 2, 4.6]
const PORE_SCALE = 1.05
const CHANNEL_Y = -0.55
const CAVITY_CENTRE = [-1.25, -0.95, 0.95]

/**
 * The scaffold's clearance is faded in with depth, so hollowing out around the
 * network can never breach the outer skin of the mass.
 */
const SCAFFOLD_INSET = 0.16
const SCAFFOLD_FADE = 0.55
/** Distance over which a strut's material read falls off. */
const SCAFFOLD_BAND = 0.26

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * Depth below the mass boundary over which porosity fades out. Voids bite hard
 * in the rind and leave the core alone, which is what keeps a parent body
 * present at high porosity instead of the mass dissolving evenly at all depths.
 */
const RIND_DEPTH = 0.12
const CORE_DEPTH = 1.15

export function createDensityField({
  seed = 42,
  strata = 0.5,
  layers = 7,
  porosity = 0.45,
  channelRadius = 0.62,
  cavity = 0.55,
  cut = 0,
  cohesion = 0.55,
  scaffold = 0,
  scaffoldNodes = 4,
  scaffoldLoops = 0.5,
  scaffoldClearance = 0,
  scaffoldCurve = 0.5,
}) {
  // Same stack the terrain uses, fixed to a broad landform: this is the lid of
  // the volume, not a separate shape language.
  const bed = createField({
    seed,
    landformScale: 1.6,
    detailScale: 6,
    detailAmount: 0.25,
    shaping: 'power',
    shapingAmount: 1.5,
  })

  const warpNoise = makeSimplex2(seed + 311)
  const poreNoise = makeSimplex3(seed + 907)
  const network =
    scaffold > 0
      ? createScaffold({
          seed,
          size: VOLUME_SIZE,
          divisions: scaffoldNodes,
          loops: scaffoldLoops,
          radius: scaffold * 0.34,
          curve: scaffoldCurve,
        })
      : null

  const [sizeX, , sizeZ] = VOLUME_SIZE
  const cutX = sizeX * 0.5 + 0.25 - cut * (sizeX + 0.5)
  const strataFrequency = layers * 0.92
  const strataAmplitude = strata * 0.13
  const poreThreshold = 0.75 - porosity * 0.8
  const cavityRadius = cavity * 2.05
  const clearance = scaffoldClearance * 0.6

  /** Height of the bed surface above a column. Constant down a column, so the
   *  volume builder evaluates it once per (x, z) instead of once per voxel. */
  function columnSurface(x, z) {
    const u = x / sizeX + 0.5
    const v = z / sizeZ + 0.5
    return (bed.sample(u, v) - 0.5) * RELIEF
  }

  /** Signed phase of the sediment layering at a point, in -1..1. */
  function strataPhase(x, y, z) {
    const warp = fbm(warpNoise, x * 0.28, z * 0.28, 2) * 0.45
    return Math.sin((y + warp) * strataFrequency)
  }

  /** Distance to the axis of the meandering channel. */
  function channelDistance(x, y, z) {
    const meander = Math.sin(x * 0.55) * 1.75 + Math.sin(x * 0.21 + 1.7) * 0.8
    const dz = z - meander
    const dy = y - (CHANNEL_Y + Math.sin(x * 0.4) * 0.22)
    return Math.sqrt(dz * dz + dy * dy)
  }

  /**
   * Steps 1-3: the mass before anything is taken out of it — bed, floor and
   * fragment. Shared, because the scaffold needs to know where sediment was in
   * the first place, both when clearing around itself and when colouring.
   */
  function bodyAt(x, y, z, surfaceY) {
    // 1. bed — solid below the surface the noise stack describes
    let d = surfaceY - y

    // 2. floor — close the bottom so the mass is a solid, not an open shell
    const floor = y - FLOOR_Y
    if (floor < d) d = floor

    // 3. fragment — intersect a soft ellipsoid, leaving a piece of bed rather
    //    than a rectangular block cut out of the world
    const ex = x / FRAGMENT_RADII[0]
    const ey = (y + 0.25) / FRAGMENT_RADII[1]
    const ez = z / FRAGMENT_RADII[2]
    const fragment = (1 - Math.sqrt(ex * ex + ey * ey + ez * ez)) * 3
    return fragment < d ? fragment : d
  }

  /** How far inside the mass a point is, 0 at the skin and 1 well within. */
  function insideDepth(x, y, z, surfaceY) {
    const inside = (bodyAt(x, y, z, surfaceY) - SCAFFOLD_INSET) / SCAFFOLD_FADE
    return inside <= 0 ? 0 : inside < 1 ? inside : 1
  }

  /**
   * Density at a point. `surfaceY` is passed in by the volume builder; it is
   * the only term that is constant down a column.
   */
  function densityAt(x, y, z, surfaceY) {
    let d = bodyAt(x, y, z, surfaceY)
    const body = d

    // 4. strata — deposition layers, as a small vertical ripple in the density.
    //    Invisible on the outside, clearly banded wherever the mass is opened.
    const phase = strataPhase(x, y, z)
    d += strataAmplitude * phase

    // 5. pores — subtract the high lobes of a 3D noise, making the mass porous
    //    rather than solid. Two things keep this from dissolving the body:
    //
    //    - voids open preferentially on the weak plane between two strata, so
    //      breakage reads as delamination along the bedding rather than as
    //      isotropic shatter
    //    - the cut is eased back toward solid with depth, so the rind can
    //      fracture freely while the core stays continuous
    if (porosity > 0) {
      // Two octaves, not three: the third was small enough to punch pinholes
      // through the rind, which is what read as peppering rather than as voids.
      const pore = fbm3(poreNoise, x * PORE_SCALE, y * PORE_SCALE * 1.7, z * PORE_SCALE, 2)
      const weakPlane = clamp01(-phase)
      const threshold = poreThreshold - strata * weakPlane * 0.32
      const outsidePore = (threshold - pore) * 1.3
      if (outsidePore < d) {
        const core = cohesion * smoothstep(RIND_DEPTH, CORE_DEPTH, d)
        d = outsidePore + (d - outsidePore) * core
      }
    }

    // 6. channel — carve a meandering tunnel through the mass
    if (channelRadius > 0) {
      const outsideChannel = channelDistance(x, y, z) - channelRadius
      if (outsideChannel < d) d = outsideChannel
    }

    // 7. cavity — hollow a chamber under the surface. The radius is pushed
    //    around by noise: a mathematically perfect sphere was the one shape in
    //    here that read as a placed object rather than as grown space, and it
    //    became unmistakable as an isolated ball whenever the section opened
    //    onto it.
    if (cavityRadius > 0) {
      const cx = x - CAVITY_CENTRE[0]
      const cy = y - CAVITY_CENTRE[1]
      const cz = z - CAVITY_CENTRE[2]
      const wobble = poreNoise(x * 0.55 + 41.2, y * 0.55 - 17.9, z * 0.55 + 8.4)
      const radius = cavityRadius * (1 + wobble * 0.42)
      const outsideCavity = Math.sqrt(cx * cx + cy * cy + cz * cz) - radius
      if (outsideCavity < d) d = outsideCavity
    }

    // 8. scaffold — the one operation that adds, and the only one that knows
    //    about *connection*. The network is built as a graph and queried as a
    //    distance field, so it can span open space rather than only surviving
    //    inside material the way a noise threshold does.
    //
    //    It runs *after* every void, which is the whole point: carve the
    //    channel and the chamber first, then thread the structure through them.
    //    Put it before them and the voids simply delete it. Only the section
    //    comes later, so a cut still slices the network open.
    //
    //    Two effects from one distance. The clearance hollows the substrate
    //    back from the network, and the strut is then unioned into the gap that
    //    leaves — so the structure both grows and displaces what it grew
    //    through. At clearance zero it sits flush inside the mass; turned up,
    //    struts stand clear and bridge the opening.
    if (network) {
      const sd = network.distanceAt(x, y, z)
      if (sd < Infinity) {
        const clear = clearance * insideDepth(x, y, z, surfaceY)
        if (clear > 0) {
          const hollow = sd - clear
          if (hollow < d) d = hollow
        }
        // Clipped to the untouched mass, so struts never reach outside the bed.
        const strut = -sd < body ? -sd : body
        if (strut > d) d = strut
      }
    }

    // 9. section — a flat cut, so the inside can actually be looked at
    const outsideCut = cutX - x
    if (outsideCut < d) d = outsideCut

    return d
  }

  return {
    columnSurface,
    densityAt,
    strataPhase,
    channelDistance,
    channelRadius,
    /**
     * 0..1 across a strut, for the material read. Unlike the substrate the
     * scaffold is meant to be seen wherever it is exposed, so this is not faded
     * by depth — if a strut is on the surface, something opened the mass to it.
     */
    scaffoldProximity: (x, y, z) =>
      network ? network.proximityAt(x, y, z, SCAFFOLD_BAND) : 0,
    scaffoldInfo: network
      ? { segments: network.segmentCount, binLoad: network.binLoad }
      : { segments: 0, binLoad: 0 },
    sample: (x, y, z) => densityAt(x, y, z, columnSurface(x, z)),
    /** 0..1 depth below the bed surface, for the stratigraphic colour ramp. */
    burialFrom: (surfaceY, y) => clamp01((surfaceY - y) / 2.6),
    burial: (x, y, z) => clamp01((columnSurface(x, z) - y) / 2.6),
  }
}

/**
 * Sample the field onto a (res + 1)^3 lattice.
 *
 * Index order is x fastest, then y, then z. Cost is cubic in `res`, which is
 * the whole reason this study stays small: doubling the resolution multiplies
 * both the sampling and the meshing work by eight.
 */
export function buildVolume(field, res) {
  const side = res + 1
  const volume = new Float32Array(side * side * side)
  const [sizeX, sizeY, sizeZ] = VOLUME_SIZE

  for (let iz = 0; iz < side; iz++) {
    const z = (iz / res - 0.5) * sizeZ
    for (let ix = 0; ix < side; ix++) {
      const x = (ix / res - 0.5) * sizeX
      // Evaluated once per column rather than once per voxel.
      const surfaceY = field.columnSurface(x, z)
      const edgeColumn = ix === 0 || ix === res || iz === 0 || iz === res
      for (let iy = 0; iy < side; iy++) {
        const y = (iy / res - 0.5) * sizeY
        let d = field.densityAt(x, y, z, surfaceY)
        // Seal the outer shell of the lattice. Without this, anything still
        // solid where the samples run out leaves an open rim in the mesh.
        if (edgeColumn || iy === 0 || iy === res) d = Math.min(d, -0.05)
        volume[(iz * side + iy) * side + ix] = d
      }
    }
  }

  return volume
}

/** World position of a lattice point. */
export function latticePosition(ix, iy, iz, res, out = [0, 0, 0]) {
  out[0] = (ix / res - 0.5) * VOLUME_SIZE[0]
  out[1] = (iy / res - 0.5) * VOLUME_SIZE[1]
  out[2] = (iz / res - 0.5) * VOLUME_SIZE[2]
  return out
}

/**
 * Drop disconnected pieces smaller than `minCells` lattice points.
 *
 * Porosity leaves behind a lot of dust: islands a couple of voxels across that
 * float free of the mass and read as debris rather than as sediment. This is a
 * flood fill over the solid samples (6-connected) that pushes every small
 * component below the isolevel, so the main body and any substantial shards
 * survive and the dust disappears before meshing.
 *
 * Mutates `volume`. Returns what it found, so the panel can report it.
 */
export function removeIslands(volume, res, iso, minCells) {
  const side = res + 1
  const count = volume.length
  const label = new Int32Array(count).fill(-1)
  const stack = new Int32Array(count)
  const sizes = []

  for (let start = 0; start < count; start++) {
    if (volume[start] <= iso || label[start] !== -1) continue

    const id = sizes.length
    let size = 0
    let top = 0
    stack[top++] = start
    label[start] = id

    while (top > 0) {
      const i = stack[--top]
      size++

      const ix = i % side
      const iy = ((i / side) | 0) % side
      const iz = (i / (side * side)) | 0
      const plane = side * side

      // 6-connected neighbours, skipping anything off the lattice. Written out
      // rather than looped: this is the inner loop of the whole pass.
      let j
      if (ix > 0 && label[(j = i - 1)] === -1 && volume[j] > iso) {
        label[j] = id
        stack[top++] = j
      }
      if (ix < res && label[(j = i + 1)] === -1 && volume[j] > iso) {
        label[j] = id
        stack[top++] = j
      }
      if (iy > 0 && label[(j = i - side)] === -1 && volume[j] > iso) {
        label[j] = id
        stack[top++] = j
      }
      if (iy < res && label[(j = i + side)] === -1 && volume[j] > iso) {
        label[j] = id
        stack[top++] = j
      }
      if (iz > 0 && label[(j = i - plane)] === -1 && volume[j] > iso) {
        label[j] = id
        stack[top++] = j
      }
      if (iz < res && label[(j = i + plane)] === -1 && volume[j] > iso) {
        label[j] = id
        stack[top++] = j
      }
    }

    sizes.push(size)
  }

  let largest = 0
  for (let i = 0; i < sizes.length; i++) if (sizes[i] > largest) largest = sizes[i]

  if (minCells <= 1) {
    return { pieces: sizes.length, dropped: 0, largest }
  }

  let dropped = 0
  for (let id = 0; id < sizes.length; id++) if (sizes[id] < minCells) dropped++

  if (dropped > 0) {
    const below = iso - 0.1
    for (let i = 0; i < count; i++) {
      const id = label[i]
      if (id !== -1 && sizes[id] < minCells) volume[i] = below
    }
  }

  return { pieces: sizes.length - dropped, dropped, largest }
}

/** Lattice points in one cell, for converting a world volume into a count. */
export function cellVolume(res) {
  return (VOLUME_SIZE[0] / res) * (VOLUME_SIZE[1] / res) * (VOLUME_SIZE[2] / res)
}

/**
 * Soften the lattice before meshing.
 *
 * One 6-neighbour blend toward the local average. High-frequency detail — the
 * pinholes, slivers and single-cell debris that read as peppering rather than
 * as structure — does not survive it, while anything larger than a couple of
 * cells barely moves. This is what gives the mass a grown, settled surface
 * instead of a crumbled one.
 */
export function consolidate(volume, res, amount) {
  if (amount <= 0) return
  const side = res + 1
  const src = Float32Array.from(volume)
  const plane = side * side

  for (let iz = 0; iz < side; iz++) {
    for (let iy = 0; iy < side; iy++) {
      for (let ix = 0; ix < side; ix++) {
        const i = (iz * side + iy) * side + ix
        const here = src[i]
        const mean =
          ((ix > 0 ? src[i - 1] : here) +
            (ix < res ? src[i + 1] : here) +
            (iy > 0 ? src[i - side] : here) +
            (iy < res ? src[i + side] : here) +
            (iz > 0 ? src[i - plane] : here) +
            (iz < res ? src[i + plane] : here)) /
          6
        volume[i] = here + (mean - here) * amount
      }
    }
  }
}

/**
 * Fill sealed voids smaller than `minCells` — the mirror of `removeIslands`.
 *
 * Porosity leaves the mass riddled with bubbles a cell or two across. They are
 * too small to read as interior space; what they produce is a pinhole wherever
 * one grazes the surface. Filling them leaves fewer, larger, legible openings.
 *
 * A void that reaches the edge of the lattice is open air, never a pocket, so
 * it is left alone however large or small it is.
 */
export function fillPockets(volume, res, iso, minCells) {
  if (minCells <= 1) return { pockets: 0, filled: 0 }

  const side = res + 1
  const count = volume.length
  const label = new Int32Array(count).fill(-1)
  const stack = new Int32Array(count)
  const sizes = []
  const open = []

  for (let start = 0; start < count; start++) {
    if (volume[start] > iso || label[start] !== -1) continue

    const id = sizes.length
    let size = 0
    let top = 0
    let touchesEdge = false
    stack[top++] = start
    label[start] = id

    while (top > 0) {
      const i = stack[--top]
      size++

      const ix = i % side
      const iy = ((i / side) | 0) % side
      const iz = (i / (side * side)) | 0
      const plane = side * side
      if (ix === 0 || ix === res || iy === 0 || iy === res || iz === 0 || iz === res) {
        touchesEdge = true
      }

      let j
      if (ix > 0 && label[(j = i - 1)] === -1 && volume[j] <= iso) { label[j] = id; stack[top++] = j }
      if (ix < res && label[(j = i + 1)] === -1 && volume[j] <= iso) { label[j] = id; stack[top++] = j }
      if (iy > 0 && label[(j = i - side)] === -1 && volume[j] <= iso) { label[j] = id; stack[top++] = j }
      if (iy < res && label[(j = i + side)] === -1 && volume[j] <= iso) { label[j] = id; stack[top++] = j }
      if (iz > 0 && label[(j = i - plane)] === -1 && volume[j] <= iso) { label[j] = id; stack[top++] = j }
      if (iz < res && label[(j = i + plane)] === -1 && volume[j] <= iso) { label[j] = id; stack[top++] = j }
    }

    sizes.push(size)
    open.push(touchesEdge)
  }

  let filled = 0
  for (let id = 0; id < sizes.length; id++) {
    if (!open[id] && sizes[id] < minCells) filled++
  }

  if (filled > 0) {
    const above = iso + 0.1
    for (let i = 0; i < count; i++) {
      const id = label[i]
      if (id !== -1 && !open[id] && sizes[id] < minCells) volume[i] = above
    }
  }

  return { pockets: sizes.length - open.filter(Boolean).length, filled }
}
