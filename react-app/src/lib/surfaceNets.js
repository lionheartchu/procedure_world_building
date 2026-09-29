/**
 * Isosurface extraction by surface nets.
 *
 * The dual of marching tetrahedra: instead of placing vertices *on* the lattice
 * edges and building triangles inside each cell, surface nets places **one
 * vertex per cell** (at the average of that cell's edge crossings) and builds a
 * quad across every lattice edge where the field changes sign, joining the four
 * cells around it.
 *
 * Consequences, which are the point of the comparison:
 *
 *   - vertices are shared between neighbouring faces, so the mesh comes out
 *     indexed and far smaller
 *   - faces are quads on a regular grid, so patches are larger and more even
 *   - the surface shrink-wraps slightly, since a cell contributes one averaged
 *     point rather than following every crossing exactly
 *
 * Normals come from the density gradient, same as the tetrahedra path, so the
 * two meshers can be compared on geometry alone rather than on shading.
 */

/** Cube corners. Bit 0 is x, bit 1 is y, bit 2 is z. */
const CORNER = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
]

/** The twelve cube edges as corner pairs. */
const EDGES = [
  [0, 1], [0, 2], [0, 4],
  [1, 3], [1, 5],
  [2, 3], [2, 6],
  [3, 7],
  [4, 5], [4, 6],
  [5, 7],
  [6, 7],
]

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
export function meshSurfaceNets({ volume, res, size, iso = 0 }) {
  const started = performance.now()
  const side = res + 1

  const positions = new Buffer()
  const normals = new Buffer()
  const indices = []

  const stepX = size[0] / res
  const stepY = size[1] / res
  const stepZ = size[2] / res

  const at = (ix, iy, iz) => volume[(iz * side + iy) * side + ix]

  // Density increases inwards, so the outward normal is the negated gradient.
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

  // One vertex slot per cell, -1 until the cell turns out to hold surface.
  const cells = res * res * res
  const vertexOf = new Int32Array(cells).fill(-1)
  const dx = 1
  const dy = res
  const dz = res * res

  const value = new Float32Array(8)
  const grad = [0, 0, 0]
  const normal = [0, 0, 0]
  let vertexCount = 0

  for (let cz = 0; cz < res; cz++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cx = 0; cx < res; cx++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const v = at(cx + CORNER[c][0], cy + CORNER[c][1], cz + CORNER[c][2])
          value[c] = v
          if (v > iso) mask |= 1 << c
        }
        if (mask === 0 || mask === 255) continue

        // Vertex position: the average of this cell's edge crossings.
        let ax = 0
        let ay = 0
        let az = 0
        let crossings = 0
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0]
          const b = EDGES[e][1]
          const inA = (mask & (1 << a)) !== 0
          const inB = (mask & (1 << b)) !== 0
          if (inA === inB) continue
          const va = value[a]
          const vb = value[b]
          const denom = vb - va
          const t = Math.abs(denom) < 1e-9 ? 0.5 : (iso - va) / denom
          ax += CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * t
          ay += CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * t
          az += CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * t
          crossings++
        }
        if (crossings === 0) continue

        const fx = ax / crossings
        const fy = ay / crossings
        const fz = az / crossings

        positions.push3(
          ((cx + fx) / res - 0.5) * size[0],
          ((cy + fy) / res - 0.5) * size[1],
          ((cz + fz) / res - 0.5) * size[2],
        )

        // Gradient trilinearly interpolated from the cell's eight corners, so
        // the normal follows the field rather than the cell lattice.
        normal[0] = 0
        normal[1] = 0
        normal[2] = 0
        for (let c = 0; c < 8; c++) {
          const wx = CORNER[c][0] ? fx : 1 - fx
          const wy = CORNER[c][1] ? fy : 1 - fy
          const wz = CORNER[c][2] ? fz : 1 - fz
          const w = wx * wy * wz
          if (w <= 0) continue
          gradient(cx + CORNER[c][0], cy + CORNER[c][1], cz + CORNER[c][2], grad)
          normal[0] += grad[0] * w
          normal[1] += grad[1] * w
          normal[2] += grad[2] * w
        }
        const len = Math.hypot(normal[0], normal[1], normal[2]) || 1
        normals.push3(normal[0] / len, normal[1] / len, normal[2] / len)

        const m = (cz * res + cy) * res + cx
        vertexOf[m] = vertexCount++

        // A quad for each of the three lattice edges leaving corner 0 that
        // changes sign, joining the four cells that share that edge. The two
        // cells behind it must already exist, hence the index guards.
        const inside0 = (mask & 1) !== 0
        for (let axis = 0; axis < 3; axis++) {
          const opposite = (mask & (1 << (1 << axis))) !== 0
          if (opposite === inside0) continue

          let du
          let dv
          if (axis === 0) {
            if (cy === 0 || cz === 0) continue
            du = dy
            dv = dz
          } else if (axis === 1) {
            if (cz === 0 || cx === 0) continue
            du = dz
            dv = dx
          } else {
            if (cx === 0 || cy === 0) continue
            du = dx
            dv = dy
          }

          const a = vertexOf[m]
          const b = vertexOf[m - du]
          const c = vertexOf[m - du - dv]
          const d = vertexOf[m - dv]
          if (b < 0 || c < 0 || d < 0) continue

          if (inside0) indices.push(a, b, c, a, c, d)
          else indices.push(a, d, c, a, c, b)
        }
      }
    }
  }

  const position = positions.trimmed()
  const normal32 = normals.trimmed()
  const index = Uint32Array.from(indices)

  orient(position, normal32, index)

  return {
    positions: position,
    normals: normal32,
    indices: index,
    vertices: position.length / 3,
    triangles: index.length / 3,
    ms: performance.now() - started,
  }
}

/**
 * Flip any triangle whose winding disagrees with its gradient normals. The quad
 * rule above should already be right; this makes the result independent of
 * getting that rule right, exactly as in the tetrahedra path.
 */
function orient(position, normal, index) {
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3
    const b = index[i + 1] * 3
    const c = index[i + 2] * 3

    const ux = position[b] - position[a]
    const uy = position[b + 1] - position[a + 1]
    const uz = position[b + 2] - position[a + 2]
    const vx = position[c] - position[a]
    const vy = position[c + 1] - position[a + 1]
    const vz = position[c + 2] - position[a + 2]

    const fx = uy * vz - uz * vy
    const fy = uz * vx - ux * vz
    const fz = ux * vy - uy * vx

    const nx = normal[a] + normal[b] + normal[c]
    const ny = normal[a + 1] + normal[b + 1] + normal[c + 1]
    const nz = normal[a + 2] + normal[b + 2] + normal[c + 2]

    if (fx * nx + fy * ny + fz * nz < 0) {
      const swap = index[i + 1]
      index[i + 1] = index[i + 2]
      index[i + 2] = swap
    }
  }
}
