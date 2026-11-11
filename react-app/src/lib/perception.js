import { airVelocity } from './air'
import { LIFECYCLE } from './lifecycle'
import { MORPH } from './morph'
import { bloomFits } from './scatter'

/**
 * Distributed perception, study 23 (docs/23-distributed-perception.md): what
 * one resident could read where it stands, taken only from what the world
 * already holds. Development only (the Habitat's `?perceive=1`): it reads,
 * and nothing in the world reads it or is written by it.
 *
 * Each reading says how it stands today:
 *   - functional  a lifecycle rule reads it now (lib/lifecycle.js, lib/morph.js)
 *   - available   derivable from existing state, but no rule reads it
 *   - rendered    drawn only (or physical, the visitor's), or not in the
 *                 world yet
 */
export const READINGS = [
  // --- functional --------------------------------------------------------------
  { key: 'body', kind: 'functional', label: 'its matter', unit: 'of a full body', reads: 'uptake stops at full; the cue can set off only a full resident' },
  { key: 'residue', kind: 'functional', label: 'residue underfoot', unit: 'matter', reads: 'uptake while forming or holding; a resident may form only on ≥ 0.1' },
  { key: 'contours', kind: 'functional', label: 'old contours in reach', unit: 'spare matter', reads: 'uptake draws from them too (each keeps half)' },
  { key: 'rest', kind: 'functional', label: 'since matter last arrived', unit: 's', reads: 'a resident may form only after 22 s', cap: 300 },
  { key: 'fit', kind: 'functional', label: 'ground fit', unit: 'membrane rules', reads: 'a resident may form only where ≥ 0.2 (shore, slope, record)' },
  { key: 'room', kind: 'functional', label: 'standing in its patch', unit: 'residents', reads: 'none forms while 4 stand' },
  { key: 'cue', kind: 'functional', label: 'cue reaching it now', unit: 'cue', reads: 'gathered into its dose (M1 and after)' },
  { key: 'dose', kind: 'functional', label: 'cue gathered', unit: `cue·s (lets go at ${MORPH.threshold})`, reads: 'full: lets go early; still forming: turns' },
  { key: 'turn', kind: 'functional', label: 'its turn', unit: 'share of height', reads: 'where its films will leave from' },
  // --- available -----------------------------------------------------------------
  { key: 'air', kind: 'available', label: 'air at its crest', unit: 'units/s', reads: 'its films ride this air (held by the colony); the resident does not read it (drawn as its bend, D1)' },
  { key: 'airAlong', kind: 'available', label: 'air along its lean', unit: '−1 against … 1 with', reads: 'not read' },
  { key: 'neighbours', kind: 'available', label: 'standing within 2', unit: 'residents, any colony', reads: 'not read (only room, 0.3, at forming)' },
  { key: 'water', kind: 'available', label: 'above the water', unit: 'units', reads: 'read only as the shore band, at forming' },
  { key: 'passage', kind: 'available', label: 'cue passage here', unit: 'cue·s, summed', reads: 'recorded; read by nothing' },
  { key: 'light', kind: 'available', label: 'light held in the ground', unit: '0..1', reads: 'drawn only; fixed when the world is made' },
  // --- rendered / not in the world ---------------------------------------------------
  { key: 'visitor', kind: 'rendered', label: 'the visitor', unit: 'units away', reads: 'physical only (M3E); never ecological' },
  { key: 'dent', kind: 'rendered', label: 'its dent', unit: 'units', reads: 'the encounter (M3E); writes nothing back' },
  { key: 'sun', kind: 'rendered', label: 'illumination', unit: '', reads: 'one fixed light; no cycle (proposed)' },
]

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The light held in the ground at (x, z): the accumulation texture's R (0..1), where there is one. */
function lightAt(world, accumulation, x, z) {
  const img = accumulation?.texture?.image
  if (!img?.data) return null
  const [u, v] = world.toUV(x, z)
  const i = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)))
  const j = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)))
  return img.data[(j * img.width + i) * 4] / 255
}

/** The cue's passage record at (x, z), as morph.js lays it (its grid over the world). */
function passageAt(commons, x, z) {
  if (!commons?.passage) return null
  const R = commons.K.passageRes
  const size = commons.world.size
  const i = Math.min(R - 1, Math.max(0, Math.round((x / size + 0.5) * R - 0.5)))
  const j = Math.min(R - 1, Math.max(0, Math.round((z / size + 0.5) * R - 0.5)))
  return commons.passage[j * R + i]
}

const tmp = {}

/**
 * What resident `r` of lifecycle `life` can read now: { key: value } for
 * READINGS (null where the reading does not exist in this space). `ctx`:
 * the other lifecycles, the accumulation, the visitor's position and the
 * resident encounter (M3E), all optional.
 */
export function perceive(life, r, { lifecycles = [life], accumulation = null, visitor = null, encounter = null } = {}) {
  const { world } = life
  const [x, y, z] = r.desc.p
  const [u, v] = world.toUV(x, z)
  const L = LIFECYCLE
  const out = {}

  out.body = r.body / (L.bodyPerHeight * r.desc.height)
  out.residue = life.matterAt(x, z)
  const spare = (o) => Math.max(0, o.contour - L.keeps * o.contour0)
  out.contours = life.residents
    .filter((o) => o !== r && o.stage === 'ended' && Math.hypot(o.desc.p[0] - x, o.desc.p[2] - z) < L.footprint + 0.4 * o.desc.height)
    .reduce((s, o) => s + spare(o), 0)
  let latest = -1e9
  life.footprint(x, z, L.footprint, (cell) => (latest = Math.max(latest, life.arrived[cell])))
  out.rest = Math.min(300, life.t - latest)
  world.sample(u, v, tmp)
  tmp.trace = life.liveTrace(u, v, tmp.trace)
  out.fit = bloomFits(tmp, life.protocol)
  out.room = life.residents.filter((o) => o.stage !== 'ended').length
  out.cue = life.commons ? (r.cue ?? 0) : null
  out.dose = life.commons ? (r.dose ?? 0) : null
  out.turn = life.commons ? Math.hypot(...(r.reach ?? [0, 0])) / r.desc.height : null

  // The air at its crest as its films would ride it there (lifecycle.js
  // `carry`: the air, held by the colony's forms).
  const air = typeof life.air === 'function' ? life.air() : life.air?.current
  if (air) {
    const held = air.colony > 0 && life.colonyAir?.obstacles?.length ? { strength: air.colony, obstacles: life.colonyAir.obstacles } : null
    const crest = r.desc.height * 0.8
    const w = airVelocity([x, y + crest, z], crest, life.t, { drift: air.drift, curl: air.curl }, life.floor, held)
    out.air = Math.hypot(w[0], w[2])
    out.airAlong = out.air > 1e-6 ? (w[0] * Math.cos(r.desc.lean) + w[2] * Math.sin(r.desc.lean)) / out.air : 0
  } else {
    out.air = null
    out.airAlong = null
  }
  let n = 0
  for (const other of lifecycles) {
    for (const o of other.residents) {
      if (o === r || o.stage === 'ended') continue
      if (Math.hypot(o.desc.p[0] - x, o.desc.p[2] - z) < 2) n++
    }
  }
  out.neighbours = n
  out.water = world.groundY(u, v) - world.waterY
  out.passage = passageAt(life.commons, x, z)
  out.light = lightAt(world, accumulation, x, z)

  out.visitor = visitor ? Math.hypot(visitor[0] - x, visitor[2] - z) : null
  out.dent = encounter ? (encounter.resident === r ? Math.max(0, encounter.depth) : 0) : null
  out.sun = null
  out.fitTrace = clamp01(tmp.trace)
  return out
}
