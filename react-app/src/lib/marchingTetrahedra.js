/**
 * Isosurface extraction by marching tetrahedra.
 *
 * Same family as marching cubes — walk the lattice, find where the field
 * crosses the isolevel along each cell edge, interpolate the crossing, join
 * them into triangles — but each cube is first split into six tetrahedra
 * (the Freudenthal decomposition, all six sharing the cube's main diagonal).
 *
 * Why this variant for a one-week study:
 *
 *   - a tetrahedron has 16 corner states, all of which are unambiguous, so
 *     there is no 256-entry triangle table to transcribe and no ambiguous-face
 *     case that can tear a hole in the surface
 *   - the whole case analysis fits on a screen and can be read and checked
 *   - the cost is roughly twice the triangles of marching cubes for the same
 *     lattice, which is the trade documented in docs/03-voxel-study.md
 *
 * Normals come from the density gradient rather than from face normals, which
 * is what keeps the result smooth and sculptural instead of faceted.
 */

/** Cube corners, x fastest. Corner 0 and corner 6 are the main diagonal. */
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
]

/** The six tetrahedra: every path from corner 0 to corner 6 along cube edges. */
const TETS = [
  [0, 1, 2, 6],
  [0, 1, 5, 6],
  [0, 3, 2, 6],
  [0, 3, 7, 6],
  [0, 4, 5, 6],
  [0, 4, 7, 6],
]

/**
 * For each of the 16 inside/outside states of a tetrahedron, the cut edges in
 * loop order. Three entries make one triangle, four make a quad that is split
 * into two. Each entry is a pair of local tet corner indices.
 */
const TET_CASES = [
  [], // 0000  fully outside
  [[0, 1], [0, 2], [0, 3]], // 0001
  [[1, 0], [1, 3], [1, 2]], // 0010
  [[0, 2], [1, 2], [1, 3], [0, 3]], // 0011
  [[2, 0], [2, 1], [2, 3]], // 0100
  [[0, 1], [2, 1], [2, 3], [0, 3]], // 0101
  [[1, 0], [2, 0], [2, 3], [1, 3]], // 0110
  [[3, 0], [3, 1], [3, 2]], // 0111
  [[3, 0], [3, 2], [3, 1]], // 1000
  [[0, 1], [3, 1], [3, 2], [0, 2]], // 1001
  [[1, 0], [3, 0], [3, 2], [1, 2]], // 1010
  [[2, 0], [2, 3], [2, 1]], // 1011
  [[2, 0], [3, 0], [3, 1], [2, 1]], // 1100
  [[1, 0], [1, 2], [1, 3]], // 1101
  [[0, 1], [0, 3], [0, 2]], // 1110
  [], // 1111  fully inside
]

/** Float32Array that grows by doubling, to avoid per-vertex array churn. */
class Buffer {
  constructor(capacity = 1 << 16) {
    this.data = new Float32Array(capacity)
    this.length = 0
  }

  push3(a, b, c) {
    if (this.length + 3 > this.data.length) {
      const grown = new Float32Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    this.data[this.length++] = a
    this.data[this.length++] = b
    this.data[this.length++] = c
  }

  trimmed() {
    return this.data.subarray(0, this.length)
  }
}

/**
 * @param volume  Float32Array of (res + 1)^3 samples, x fastest then y then z
 * @param res     cells per axis
 * @param size    world size of the lattice, [x, y, z]
 * @param iso     isolevel; density above it counts as inside
 */
export function meshVolume({ volume, res, size, iso = 0 }) {
  const started = performance.now()
  const side = res + 1
  const positions = new Buffer()
  const normals = new Buffer()

  const stepX = size[0] / res
  const stepY = size[1] / res
  const stepZ = size[2] / res

  const at = (ix, iy, iz) => volume[(iz * side + iy) * side + ix]

  // Central-difference gradient, one-sided at the lattice boundary. Density
  // increases inwards, so the outward normal is the negated gradient.
  const gradient = (ix, iy, iz, out) => {
    const xa = ix > 0 ? ix - 1 : ix
    const xb = ix < res ? ix + 1 : ix
    const ya = iy > 0 ? iy - 1 : iy
    const yb = iy < res ? iy + 1 : iy
    const za = iz > 0 ? iz - 1 : iz
    const zb = iz < res ? iz + 1 : iz
    out[0] = -(at(xb, iy, iz) - at(xa, iy, iz)) / ((xb - xa) * stepX)
    out[1] = -(at(ix, yb, iz) - at(ix, ya, iz)) / ((yb - ya) * stepY)
    out[2] = -(at(ix, iy, zb) - at(ix, iy, za)) / ((zb - za) * stepZ)
    return out
  }

  // Scratch state, reused for every cell.
  const cornerValue = new Float32Array(8)
  const cornerIndex = new Int32Array(24)
  const vertex = new Float32Array(12) // up to 4 cut points, xyz each
  const vertexNormal = new Float32Array(12)
  const gradA = [0, 0, 0]
  const gradB = [0, 0, 0]

  for (let cz = 0; cz < res; cz++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cx = 0; cx < res; cx++) {
        // Gather the cell's eight corners.
        let anyInside = false
        let allInside = true
        for (let c = 0; c < 8; c++) {
          const ix = cx + CORNERS[c][0]
          const iy = cy + CORNERS[c][1]
          const iz = cz + CORNERS[c][2]
          cornerIndex[c * 3] = ix
          cornerIndex[c * 3 + 1] = iy
          cornerIndex[c * 3 + 2] = iz
          const v = at(ix, iy, iz)
          cornerValue[c] = v
          if (v > iso) anyInside = true
          else allInside = false
        }
        // Cells entirely inside or entirely outside hold no surface.
        if (!anyInside || allInside) continue

        for (let t = 0; t < 6; t++) {
          const tet = TETS[t]
          let state = 0
          for (let c = 0; c < 4; c++) {
            if (cornerValue[tet[c]] > iso) state |= 1 << c
          }

          const cuts = TET_CASES[state]
          if (cuts.length === 0) continue

          for (let e = 0; e < cuts.length; e++) {
            const ca = tet[cuts[e][0]]
            const cb = tet[cuts[e][1]]
            const va = cornerValue[ca]
            const vb = cornerValue[cb]
            const denom = vb - va
            const tt = Math.abs(denom) < 1e-9 ? 0.5 : (iso - va) / denom

            const ax = cornerIndex[ca * 3]
            const ay = cornerIndex[ca * 3 + 1]
            const az = cornerIndex[ca * 3 + 2]
            const bx = cornerIndex[cb * 3]
            const by = cornerIndex[cb * 3 + 1]
            const bz = cornerIndex[cb * 3 + 2]

            vertex[e * 3] = ((ax + (bx - ax) * tt) / res - 0.5) * size[0]
            vertex[e * 3 + 1] = ((ay + (by - ay) * tt) / res - 0.5) * size[1]
            vertex[e * 3 + 2] = ((az + (bz - az) * tt) / res - 0.5) * size[2]

            gradient(ax, ay, az, gradA)
            gradient(bx, by, bz, gradB)
            let nx = gradA[0] + (gradB[0] - gradA[0]) * tt
            let ny = gradA[1] + (gradB[1] - gradA[1]) * tt
            let nz = gradA[2] + (gradB[2] - gradA[2]) * tt
            const len = Math.hypot(nx, ny, nz) || 1
            vertexNormal[e * 3] = nx / len
            vertexNormal[e * 3 + 1] = ny / len
            vertexNormal[e * 3 + 2] = nz / len
          }

          emit(positions, normals, vertex, vertexNormal, 0, 1, 2)
          if (cuts.length === 4) {
            emit(positions, normals, vertex, vertexNormal, 0, 2, 3)
          }
        }
      }
    }
  }

  const position = positions.trimmed()
  return {
    positions: position,
    normals: normals.trimmed(),
    triangles: position.length / 9,
    ms: performance.now() - started,
  }
}

/**
 * Append one triangle, orienting it to agree with the gradient normals. Doing
 * it here rather than in the case table means the table only has to describe
 * *which* edges are cut, not which way round they wind.
 */
function emit(positions, normals, vertex, vertexNormal, a, b, c) {
  const ax = vertex[a * 3], ay = vertex[a * 3 + 1], az = vertex[a * 3 + 2]
  const bx = vertex[b * 3], by = vertex[b * 3 + 1], bz = vertex[b * 3 + 2]
  const cx = vertex[c * 3], cy = vertex[c * 3 + 1], cz = vertex[c * 3 + 2]

  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  const fx = uy * vz - uz * vy
  const fy = uz * vx - ux * vz
  const fz = ux * vy - uy * vx

  const nx = vertexNormal[a * 3] + vertexNormal[b * 3] + vertexNormal[c * 3]
  const ny = vertexNormal[a * 3 + 1] + vertexNormal[b * 3 + 1] + vertexNormal[c * 3 + 1]
  const nz = vertexNormal[a * 3 + 2] + vertexNormal[b * 3 + 2] + vertexNormal[c * 3 + 2]

  const flip = fx * nx + fy * ny + fz * nz < 0
  const second = flip ? c : b
  const third = flip ? b : c

  positions.push3(ax, ay, az)
  normals.push3(vertexNormal[a * 3], vertexNormal[a * 3 + 1], vertexNormal[a * 3 + 2])
  positions.push3(vertex[second * 3], vertex[second * 3 + 1], vertex[second * 3 + 2])
  normals.push3(
    vertexNormal[second * 3],
    vertexNormal[second * 3 + 1],
    vertexNormal[second * 3 + 2],
  )
  positions.push3(vertex[third * 3], vertex[third * 3 + 1], vertex[third * 3 + 2])
  normals.push3(
    vertexNormal[third * 3],
    vertexNormal[third * 3 + 1],
    vertexNormal[third * 3 + 2],
  )
}
