import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { buildScatterGeometry, buildStreamDebug } from '../lib/traceForms'
import { createFormMaterial } from '../lib/formMaterial'

/** Seconds a full Grow takes. Everything moves; nothing moves fast. */
const GROW_SECONDS = 42

/** How often a running Grow reports back to the panel, in seconds. */
const GROW_REPORT = 0.25

/**
 * One mesh per layer per material, and the visual hierarchy between the
 * three languages lives here, in four kinds of material rather than one:
 * membrane the softest and most luminous, in a cooler blue-white; structure
 * darker, fibrous and taut, with one crisp highlight; residue matte, grainy
 * and settled. Under all of them the colony's tissue and its light on the
 * ground, which belong to the colony rather than to a language and are
 * shown in every view.
 */
const MESHES = [
  { layer: 'tissue', part: 'skin', kind: 'tissue', renderOrder: -2, tint: '#BDB6DF' },
  { layer: 'bridgework', part: 'solid', kind: 'tension', gain: 0.6, body: 0.78 },
  { layer: 'bridgework', part: 'film', kind: 'film', renderOrder: 2, gain: 0.8, edgeGlow: 0.08 },
  { layer: 'bloom', part: 'solid', kind: 'solid', gain: 0.9 },
  { layer: 'bloom', part: 'film', kind: 'film', renderOrder: 2, tint: '#CDD3F5', gain: 1.5, edgeGlow: 0.3, specular: 0.12 },
  { layer: 'shard', part: 'glass', kind: 'sediment', tint: '#C4BEE2', gain: 0.6, body: 1.3 },
  { layer: 'shard', part: 'solid', kind: 'sediment', tint: '#C4BEE2', gain: 0.6, body: 1.3 },
  { layer: 'bead', part: 'solid', kind: 'solid' },
  // The ground's response under each colony, drawn before the water so the
  // water veils it where the colony meets the shallows.
  { layer: 'halo', part: 'glow', kind: 'halo', renderOrder: -3, tint: '#B4ADD8' },
  // Internal debug only (?debug=streams): the water veins' splines.
  { layer: 'spline', part: 'spline', kind: 'halo', renderOrder: 4, tint: '#E4E0FA' },
]

/** Shown in every colony view: they belong to the colony, not one language. */
const SHARED = new Set(['tissue', 'halo'])

/** Trace Beads are an accent: fixed glow, never soloed. */
const BEAD_GLOW = 0.5

/** The streams' splines, drawn only when asked for in the URL. */
const DEBUG_STREAMS = typeof window !== 'undefined' && /debug=streams/.test(window.location.search)

/** What a mesh shows in each view. */
function shows(layer, view) {
  if (layer === 'spline') return DEBUG_STREAMS
  return view === 'all' || view === layer || SHARED.has(layer)
}

export default function ScatterLayers({ world, scatter, streams, params, growing, onGrowth, onGrowthEnd }) {
  const materials = useMemo(() => MESHES.map((m) => createFormMaterial(m)), [])

  const geometry = useMemo(() => buildScatterGeometry(scatter, world), [scatter, world])
  const debugGeometry = useMemo(
    () => (DEBUG_STREAMS ? buildStreamDebug(streams?.lines, world) : { spline: null }),
    [streams, world],
  )
  useEffect(() => () => debugGeometry.spline?.dispose(), [debugGeometry])

  // Geometry is rebuilt on every placement change; the old buffers go with it.
  useEffect(
    () => () => {
      for (const layer of Object.values(geometry)) {
        for (const geo of Object.values(layer)) geo?.dispose()
      }
    },
    [geometry],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  // The growth clock. Handled entirely inside the frame loop, with refs,
  // because a frame can land between a render and its effects: a Grow must
  // restart from zero on its very first frame, and end exactly once even if
  // the parent has not re-rendered yet.
  const growth = useRef(params.growth)
  const reported = useRef(0)
  const wasGrowing = useRef(false)
  const ended = useRef(false)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime

    if (growing && !wasGrowing.current) {
      growth.current = 0
      reported.current = 0
      ended.current = false
    }
    wasGrowing.current = growing

    if (growing) {
      if (!ended.current) {
        growth.current = Math.min(1, growth.current + Math.min(delta, 0.1) / GROW_SECONDS)
        reported.current += delta
        if (growth.current >= 1) {
          ended.current = true
          onGrowth(1)
          onGrowthEnd()
        } else if (reported.current >= GROW_REPORT) {
          reported.current = 0
          onGrowth(growth.current)
        }
      }
    } else {
      growth.current = params.growth
    }

    // The same ~50 s tide as the terrain's water, so the waterline on the
    // forms rises and falls with the surface.
    const waterY = world.waterY + Math.sin(t * 0.125) * world.elevation * 0.012

    MESHES.forEach((m, k) => {
      const u = materials[k].uniforms
      if (u.uGrowth) u.uGrowth.value = growth.current
      if (u.uTime) u.uTime.value = t
      if (u.uWaterY) u.uWaterY.value = waterY
      if (u.uGlow) u.uGlow.value = m.layer === 'bead' ? BEAD_GLOW : 0.6
      if (u.uOpenness) u.uOpenness.value = m.layer === 'bloom' ? params.bloomOpenness * 1.6 : m.layer === 'bridgework' ? 0.8 : 0
    })
  })

  return (
    <group>
      {MESHES.map((m, k) => {
        const geo = (m.layer === 'spline' ? debugGeometry : geometry[m.layer])?.[m.part]
        if (!geo) return null
        return (
          <mesh
            key={`${m.layer}-${m.part}`}
            geometry={geo}
            material={materials[k]}
            // One selector: the whole colony, or one language solo.
            visible={shows(m.layer, params.view)}
            frustumCulled={false}
          />
        )
      })}
    </group>
  )
}
