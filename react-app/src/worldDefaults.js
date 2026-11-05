import { MODES } from './components/ShaderPanel'
import { SHAPING_OPS } from './lib/field'

/*
 * The world's default state: Explore opens on it, the studies share it, and
 * the Habitat starts from it (lib/habitat.js pins what it needs). Moved here
 * from App.jsx unchanged, so there is one source for both.
 */

/**
 * Default state is tuned for the sediment-field character: one broad
 * low-frequency landform with a little grain on top, pushed down into basins
 * by the power op, with the tidal plane sitting at the field's midline so
 * roughly half of it floods.
 */
export const DEFAULT_PARAMS = {
  landformScale: 1.5,
  detailScale: 6.4,
  detailAmount: 0.18,
  seed: 42,
  shaping: 'power',
  shapingAmount: SHAPING_OPS.power.slider.default,
  elevation: 2.7,
  waterLevel: 0.5,
  // Fine enough that a stream's channel spans a few vertices.
  resolution: 224,
}

export const DEFAULT_SIM = {
  flow: 1.8,
  deposition: 0.25,
  supply: 0.022,
}

/**
 * The shader study reads the same terrain as the Field view; only the material
 * mode and a couple of its inputs change.
 */
export const DEFAULT_SHADER = {
  mode: 'geological',
  heightInfluence: 1,
  strata: 0.45,
  activity: 0.7,
  pulse: 0.5,
  fresnel: 0.7,
  membrane: 0.5,
  water: 0.6,
  caustics: 0.5,
}

/**
 * The scatter study populates the same world with trace-grown forms. Only
 * design controls live here; slope limits, shore bands, thresholds and the
 * colony's quiet share are protocol, fixed in lib/scatter.js.
 *
 * `view` is the one selector: the whole colony, or one language solo — in
 * the scene, in the plan map and in the panel at once.
 */
export const DEFAULT_SCATTER = {
  view: 'all',
  history: 40,
  seed: 7,
  growth: 1,
  bridgeAmount: 0.6,
  bridgeReach: 5.5,
  bloomAmount: 0.5,
  bloomOpenness: 0.5,
  shardAmount: 0.5,
  shardAccumulation: 0.5,
  // Water veins (assignment 2): part of the shared world, set from here.
  streams: 2,
  streamFlow: 0.5,
  // The air (assignment 3): the scene's ambient particles. Rework phases
  // 1–4: the base atmosphere (dust), residue in moving air (wisps), the
  // colonies' local air, and the basin haze.
  airDensity: 0.6,
  airDrift: 0.5,
  airCurl: 0.5,
  airWisps: 0.5,
  airWispStrength: 0.5,
  airColony: 0.6,
  airHaze: 0.5,
  // Explore's Water appearance: how clearly the submerged ground reads.
  // Presentation only, and only in Explore; 0 is the water as it was.
  underwater: 0,
}

/**
 * The colony stands on the shader study's Dormant reading, so the ground
 * shows the same record the rules read — held down so the forms carry the
 * light. At the shader study's own settings, forty seconds of history lit
 * the whole island.
 */
export const SCATTER_GROUND = {
  ...DEFAULT_SHADER,
  mode: MODES.find((m) => m.id === 'dormant').value,
  // The base revision's shading: plateaus, shoulders and feet (Terrain.jsx).
  relief: 1,
  activity: 0.35,
  pulse: 0.12,
  // The basins hold water here as in every tab. At 0.5 (and with Dormant's
  // clearer veil) the water changed 15% of pixels against Field's 70%, and
  // the basins read as empty pits.
  water: 0.85,
  caustics: 0.35,
  // The cleaned palette (Terrain.jsx): deep cool shadows, a finer record,
  // water reflecting the scene's own sky.
  grade: 1,
}
