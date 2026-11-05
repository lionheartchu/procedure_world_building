import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { createFormMaterial, setAccumulation } from '../lib/formMaterial'
import { ENCOUNTER } from '../lib/encounter'

/**
 * The Habitat's encounter, drawn: one membrane in its colony's own two
 * materials, with the dent (lib/encounter.js) compiled in (ENCOUNTER in the
 * form vertex shader). Its shape is the membrane's as placed; the dent is
 * the only thing that moves it, besides its sway.
 */
export default function EncounterVeil({ membrane, geometry, meshes, formOptions, accumulation, openness, world }) {
  const materials = useMemo(() => meshes.map((m) => createFormMaterial({ ...m, ...formOptions, encounter: true })), [meshes, formOptions])
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])
  useEffect(
    () => () => {
      geometry.solid?.dispose()
      geometry.film?.dispose()
    },
    [geometry],
  )

  useFrame((state, delta) => {
    membrane.update(Math.min(delta, 0.1))
    const t = state.clock.elapsedTime
    const D = membrane.displacement
    const waterY = world.waterY + Math.sin(t * 0.125) * world.elevation * 0.012
    for (const material of materials) {
      const u = material.uniforms
      u.uGrowth.value = 1
      u.uTime.value = t
      u.uWaterY.value = waterY
      u.uGlow.value = 0.6
      u.uOpenness.value = openness * 1.6
      u.uDent.value.set(D[0], D[1], D[2])
      u.uDentAt.value.set(membrane.at[0], membrane.at[1], membrane.at[2], membrane.radius)
      u.uDentFoot.value.set(membrane.foot, membrane.footSpan, membrane.height, ENCOUNTER.bend)
      setAccumulation(u, accumulation)
    }
  })

  return (
    <group>
      {geometry.solid && <mesh geometry={geometry.solid} material={materials[0]} frustumCulled={false} />}
      {geometry.film && <mesh geometry={geometry.film} material={materials[1]} frustumCulled={false} />}
    </group>
  )
}
