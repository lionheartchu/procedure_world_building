import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createTendrilMaterial, createTissueMapMaterial, createVeinMaterial } from '../lib/formMaterial'

/**
 * The branching network in the scene (lib/branching.js): one THREE.LOD per
 * colony, centred on it. Near, the tissue drape on a fine grid, the membrane
 * veins and the transition strands; further out a coarser drape with the
 * veins and strands; far, a coarse drape only. The tissue map is mipmapped, so its fine growth falls away
 * with distance on its own. Grows with the colony on the shared clock.
 */
export default function BranchNetwork({ networks, growth, waterY, visible }) {
  const gl = useThree((s) => s.gl)
  const veinMaterial = useMemo(() => createVeinMaterial(), [])
  const tendrilMaterial = useMemo(() => createTendrilMaterial(), [])
  useEffect(
    () => () => {
      veinMaterial.dispose()
      tendrilMaterial.dispose()
    },
    [veinMaterial, tendrilMaterial],
  )

  const built = useMemo(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    return networks.map((net) => {
      net.texture.anisotropy = anisotropy
      const tissue = createTissueMapMaterial(net.texture)
      const lod = new THREE.LOD()
      lod.position.set(...net.center)
      net.levels.forEach((level, k) => {
        const group = new THREE.Group()
        // Geometry is in world space; the level sits back at the origin.
        group.position.set(-net.center[0], -net.center[1], -net.center[2])
        if (level.drape) {
          const mesh = new THREE.Mesh(level.drape, tissue)
          mesh.frustumCulled = false
          mesh.renderOrder = -1
          group.add(mesh)
        }
        if (level.veins) {
          const mesh = new THREE.Mesh(level.veins, veinMaterial)
          mesh.frustumCulled = false
          mesh.renderOrder = 2
          group.add(mesh)
        }
        if (level.tendrils) {
          const mesh = new THREE.Mesh(level.tendrils, tendrilMaterial)
          mesh.frustumCulled = false
          mesh.renderOrder = 2
          group.add(mesh)
        }
        lod.addLevel(group, net.distances[k])
      })
      return { lod, tissue }
    })
  }, [networks, veinMaterial, tendrilMaterial, gl])

  useEffect(
    () => () => {
      for (const b of built) b.tissue.dispose()
      for (const net of networks) {
        net.texture.dispose()
        const seen = new Set()
        for (const level of net.levels) {
          for (const geo of [level.drape, level.veins, level.tendrils]) {
            if (geo && !seen.has(geo)) {
              seen.add(geo)
              geo.dispose()
            }
          }
        }
      }
    },
    [built, networks],
  )

  useFrame(() => {
    veinMaterial.uniforms.uGrowth.value = growth.current
    tendrilMaterial.uniforms.uGrowth.value = growth.current
    tendrilMaterial.uniforms.uWaterY.value = waterY.current
    for (const b of built) {
      b.tissue.uniforms.uGrowth.value = growth.current
      b.tissue.uniforms.uWaterY.value = waterY.current
    }
  })

  return (
    <group visible={visible}>
      {built.map((b, k) => (
        <primitive key={k} object={b.lod} />
      ))}
    </group>
  )
}
