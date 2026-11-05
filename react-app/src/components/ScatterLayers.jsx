import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { buildScatterGeometry, buildStreamDebug } from '../lib/traceForms'
import { createFormMaterial, setAccumulation } from '../lib/formMaterial'
import { buildBranchingGeometry, growBranching } from '../lib/branching'
import BranchNetwork from './BranchNetwork'
import LifecycleLayer from './LifecycleLayer'

/** Seconds a full Grow takes. Everything moves; nothing moves fast. */
const GROW_SECONDS = 42

/** How often a running Grow reports back to the panel, in seconds. */
const GROW_REPORT = 0.25

/**
 * One mesh per layer per material, and the visual hierarchy between the
 * three languages lives here, in four kinds of material rather than one:
 * membrane the softest and most luminous, in a cooler blue-white; structure
 * darker, fibrous and taut, with one crisp highlight; residue matte, grainy
 * and settled. Under all of them the colony's tissue, which belongs to the
 * colony rather than to a language and is shown in every view. Light on the
 * ground is not a mesh: the ground, the tissue and the forms all read the
 * light held in what the colonies gathered (lib/accumulation.js).
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
  // Internal debug only (?debug=streams): the water veins' splines.
  { layer: 'spline', part: 'spline', kind: 'halo', renderOrder: 4, tint: '#E4E0FA' },
]

/** Shown in every colony view: it belongs to the colony, not one language. */
const SHARED = new Set(['tissue'])

/** Trace Beads are an accent: fixed glow, never soloed. */
const BEAD_GLOW = 0.5

/** The streams' splines, drawn only when asked for in the URL. */
const DEBUG_STREAMS = typeof window !== 'undefined' && /debug=streams/.test(window.location.search)

/** The bloom layer's two materials: the lifecycle's resident (and the Habitat's encounter) is drawn in them. */
export const RESIDENT_MESHES = MESHES.filter((m) => m.layer === 'bloom')

/** Nothing withheld (a stable default, so the geometry is not rebuilt each render). */
const NONE = []

/** The placement without some membranes (the lifecycle's residents, drawn on their own). */
function withoutResidents(scatter, residents) {
  const bloom = scatter.layers.bloom
  return { ...scatter, layers: { ...scatter.layers, bloom: { ...bloom, instances: bloom.instances.filter((i) => !residents.includes(i)) } } }
}

/** What a mesh shows in each view. */
function shows(layer, view) {
  if (layer === 'spline') return DEBUG_STREAMS
  return view === 'all' || view === layer || SHARED.has(layer)
}

/**
 * The Habitat passes three more things (Explore and the studies pass none):
 * several lifecycles (`lifecycles`, each its own patch), membranes it draws
 * itself (`withhold`, the encounter), and material options for first person
 * (`formOptions`, e.g. the near-camera fade). `frame: false` keeps a
 * lifecycle from moving the camera to its patch; `carriers` shows the
 * matter its films carry; `residue` adds residue no colony holds (drawn
 * with the colonies' own, lib/scatter.js strayResidue).
 */
export default function ScatterLayers({
  world,
  scatter,
  accumulation,
  streams,
  params,
  growing,
  onGrowth,
  onGrowthEnd,
  lifecycle = null,
  lifecycles = null,
  withhold = NONE,
  formOptions = null,
  frame = true,
  carriers = false,
  residue = NONE,
  // Many lifecycles (the Habitat's D): their deposits culled off screen.
  cullLives = false,
  // The Habitat's D1: the lifecycles' passage drawn to be read from eye
  // height (LifecycleLayer `legible`).
  legible = false,
}) {
  const materials = useMemo(() => MESHES.map((m) => createFormMaterial({ ...m, ...formOptions })), [formOptions])
  const residentMeshes = useMemo(() => (formOptions ? RESIDENT_MESHES.map((m) => ({ ...m, ...formOptions })) : RESIDENT_MESHES), [formOptions])

  // Study 10 (?lifecycle=1 only): the lifecycle's residents leave the
  // colony's merged geometry and are drawn by LifecycleLayer instead.
  const lives = useMemo(() => (lifecycles ?? (lifecycle ? [lifecycle] : NONE)).filter((l) => l?.active), [lifecycles, lifecycle])
  const placed = useMemo(() => {
    const apart = [...withhold, ...lives.flatMap((l) => l.first)]
    const kept = apart.length ? withoutResidents(scatter, apart) : scatter
    if (!residue.length) return kept
    const shard = kept.layers.shard
    return { ...kept, layers: { ...kept.layers, shard: { ...shard, instances: [...shard.instances, ...residue] } } }
  }, [scatter, lives, withhold, residue])
  const geometry = useMemo(() => buildScatterGeometry(placed, world), [placed, world])
  // The branching network grows from what the colony placed (and from the
  // membrane surfaces the geometry just built). Structure, so Bridgework's
  // Amount sets how much grows; Accumulation how far it runs down the
  // record; History ages the colony, which adds orders of branching.
  const { seed, bridgeAmount, shardAccumulation } = params
  // (`geometry` is a dependency for its membrane surfaces: the climbing veins
  // grow on them.)
  const networks = useMemo(
    () => buildBranchingGeometry(growBranching(scatter, world, { seed, amount: bridgeAmount, accumulation: shardAccumulation }), world),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scatter, world, geometry, seed, bridgeAmount, shardAccumulation],
  )
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
  const waterLine = useRef(world.waterY)
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
    waterLine.current = waterY

    // The light held in the gathered matter comes up as the colony grows
    // (the ground reads the same value).
    if (accumulation) {
      const g = Math.min(1, Math.max(0, (growth.current - 0.15) / 0.7))
      accumulation.rise.value = g * g * (3 - 2 * g)
    }

    MESHES.forEach((m, k) => {
      const u = materials[k].uniforms
      if (u.uGrowth) u.uGrowth.value = growth.current
      if (u.uTime) u.uTime.value = t
      if (u.uWaterY) u.uWaterY.value = waterY
      if (u.uGlow) u.uGlow.value = m.layer === 'bead' ? BEAD_GLOW : 0.6
      if (u.uOpenness) u.uOpenness.value = m.layer === 'bloom' ? params.bloomOpenness * 1.6 : m.layer === 'bridgework' ? 0.8 : 0
      setAccumulation(u, accumulation)
    })
  })

  return (
    <group>
      <BranchNetwork networks={networks} growth={growth} waterY={waterLine} visible={params.view === 'all' || params.view === 'bridgework'} />
      {lives.map((life, k) => (
        <LifecycleLayer
          key={k}
          lifecycle={life}
          frame={frame}
          carriers={carriers}
          world={world}
          meshes={residentMeshes}
          growth={growth}
          waterLine={waterLine}
          openness={params.bloomOpenness}
          accumulation={accumulation}
          visible={shows('bloom', params.view)}
          cull={cullLives}
          legible={legible}
          light={formOptions?.light ?? null}
        />
      ))}
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
