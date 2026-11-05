import { createField, withRelief } from './field'
import { buildStreamWater, carveStreams, streamLines, streamMaterial, traceStreams } from './streams'
import { buildWorldData, runHistory } from './worldData'
import { placeScatter } from './scatter'

/**
 * The world, derived once from one applied state: the same chain Explore
 * memoises stage by stage in App.jsx (base field → relief → streams carved
 * in → History → world data → placement), as one pure call. For a view that
 * never regenerates (the Habitat), so it needs no per-stage memoisation.
 *
 * @param params      world params (DEFAULT_PARAMS' shape)
 * @param simParams   the record's rules (DEFAULT_SIM's shape)
 * @param scatter     the scatter design (DEFAULT_SCATTER's shape)
 * @param size        the slab's side (Terrain's FIELD_SIZE)
 */
export function deriveWorld({ params, simParams, scatter: design, size }) {
  const baseField = createField({
    seed: params.seed,
    landformScale: params.landformScale,
    detailScale: params.detailScale,
    detailAmount: params.detailAmount,
    shaping: params.shaping,
    shapingAmount: params.shapingAmount,
    shapingOp: params.shapingOp ?? null,
    stretch: params.stretch ?? null,
  })
  const relieved = withRelief(baseField, { waterLevel: params.waterLevel, seed: params.seed, shape: params.relief ?? null })
  const streams = traceStreams(relieved, {
    size,
    elevation: params.elevation,
    waterLevel: params.waterLevel,
    count: design.streams,
    flow: design.streamFlow,
    seed: params.seed,
  })
  const field = carveStreams(relieved, streams)
  const streamLook = { material: streamMaterial(streams), water: buildStreamWater(streams, field), lines: streamLines(streams), stats: streams.stats }
  const history = runHistory(field, simParams, params.waterLevel, design.history, { res: params.historyRes })
  const world = buildWorldData({
    field,
    size,
    elevation: params.elevation,
    waterLevel: params.waterLevel,
    history,
    seed: design.seed,
  })
  const scatter = placeScatter(world, {
    seed: design.seed,
    bridgeAmount: design.bridgeAmount,
    bridgeReach: design.bridgeReach,
    bloomAmount: design.bloomAmount,
    shardAmount: design.shardAmount,
    shardAccumulation: design.shardAccumulation,
    streams: streamLook.lines,
    colonyMax: design.colonyMax,
    gatherBy: design.gatherBy,
    deplete: design.deplete,
  })
  return { baseField, field, streams, streamLook, history, world, scatter }
}
