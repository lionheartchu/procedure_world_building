import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  buildVolume,
  cellVolume,
  consolidate,
  createDensityField,
  fillPockets,
  removeIslands,
  VOLUME_SIZE,
} from '../lib/density'
import { meshVolume } from '../lib/marchingTetrahedra'
import { meshSurfaceNets } from '../lib/surfaceNets'
import { volumeColor } from '../lib/palette'

/** Width of the mint band on a channel wall, in world units. */
const TRACE_BAND = 0.22

/**
 * World volume of the largest piece the debris filter will drop, at full
 * slider. Squared on the way in, so the useful low end gets most of the travel.
 */
const DEBRIS_MAX = 0.09

/**
 * One pass of the whole pipeline:
 *
 *     density field -> lattice of samples -> mesher -> mesh
 *
 * Both meshers read the same samples with the same isolevel, so switching
 * between them compares the meshing interpretation and nothing else.
 *
 * All three stages run synchronously when a parameter changes. At the default
 * resolution that is well under a frame's worth of work per stage; the panel
 * reports the real numbers so the cost of turning the resolution up is visible
 * rather than theoretical.
 */
export default function VolumeMesh({ params, wireframe, onStats }) {
  const {
    resolution,
    iso,
    seed,
    layers,
    strata,
    porosity,
    channelRadius,
    cavity,
    cut,
    cohesion,
    debris,
    method,
    consolidation,
    scaffold,
    scaffoldNodes,
    scaffoldLoops,
    scaffoldClearance,
    scaffoldCurve,
  } = params

  const geometry = useMemo(() => {
    const field = createDensityField({
      seed,
      layers,
      strata,
      porosity,
      channelRadius,
      cavity,
      cut,
      cohesion,
      scaffold,
      scaffoldNodes,
      scaffoldLoops,
      scaffoldClearance,
      scaffoldCurve,
    })

    const sampledAt = performance.now()
    const volume = buildVolume(field, resolution)

    // Soften the lattice first, so the passes below are cleaning up structure
    // rather than chasing single-cell noise.
    consolidate(volume, resolution, consolidation)

    // Then drop anything too small to read, in both directions: loose fragments
    // of material, and the bubbles trapped inside it. One threshold governs
    // both, because a one-cell shard and a one-cell pocket are equally
    // illegible.
    const minCells =
      debris > 0
        ? Math.max(1, Math.round((debris * debris * DEBRIS_MAX) / cellVolume(resolution)))
        : 0
    const islands = removeIslands(volume, resolution, iso, minCells)
    const pockets = fillPockets(volume, resolution, iso, minCells)
    const sampleMs = performance.now() - sampledAt

    const mesher = method === 'surfaceNets' ? meshSurfaceNets : meshVolume
    const { positions, normals, indices, triangles, ms } = mesher({
      volume,
      res: resolution,
      size: VOLUME_SIZE,
      iso,
    })

    // Colour is decided per vertex from the same field that made the surface,
    // so burial depth, layering and channel walls all stay in register.
    const colors = new Float32Array(positions.length)
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const y = positions[i + 1]
      const z = positions[i + 2]
      // One column lookup per vertex, shared by both field queries.
      const surfaceY = field.columnSurface(x, z)
      const burial = field.burialFrom(surfaceY, y)
      const strata = field.strataPhase(x, y, z)
      const wall =
        field.channelRadius > 0
          ? Math.max(
              0,
              1 - Math.abs(field.channelDistance(x, y, z) - field.channelRadius) / TRACE_BAND,
            )
          : 0
      const strut = field.scaffoldProximity(x, y, z)
      const [r, g, b] = volumeColor(burial, strata, wall * wall, strut)
      colors[i] = r
      colors[i + 1] = g
      colors[i + 2] = b
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // Surface nets shares vertices between faces, so it comes back indexed.
    if (indices) geo.setIndex(new THREE.BufferAttribute(indices, 1))
    geo.computeBoundingSphere()

    geo.userData.stats = {
      resolution,
      cells: resolution ** 3,
      samples: (resolution + 1) ** 3,
      method,
      triangles,
      vertices: positions.length / 3,
      pieces: islands.pieces,
      dropped: islands.dropped,
      filled: pockets.filled,
      segments: field.scaffoldInfo.segments,
      sampleMs,
      meshMs: ms,
      megabytes:
        (positions.byteLength +
          normals.byteLength +
          colors.byteLength +
          (indices?.byteLength ?? 0)) /
        1048576,
    }
    return geo
  }, [
    resolution,
    iso,
    seed,
    layers,
    strata,
    porosity,
    channelRadius,
    cavity,
    cut,
    cohesion,
    debris,
    method,
    consolidation,
    scaffold,
    scaffoldNodes,
    scaffoldLoops,
    scaffoldClearance,
    scaffoldCurve,
  ])

  useEffect(() => {
    onStats?.(geometry.userData.stats)
  }, [geometry, onStats])

  // Free the previous lattice's buffers once the new one is in place.
  const live = useRef(null)
  useEffect(() => {
    const previous = live.current
    live.current = geometry
    if (previous && previous !== geometry) previous.dispose()
  }, [geometry])

  const group = useRef(null)
  useFrame((_, delta) => {
    // Everything moves, nothing moves fast: about four minutes per turn.
    if (group.current) group.current.rotation.y += delta * 0.026
  })

  return (
    <group ref={group}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          wireframe={wireframe}
          roughness={0.92}
          metalness={0.04}
        />
      </mesh>
    </group>
  )
}
