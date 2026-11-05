/**
 * The Habitat's D (docs/17-habitat-d.md): a wider world of rises and
 * shallows, colonies across it, and age. What D adds to the world's
 * generation and to how its lifecycles begin; everything else is the
 * Habitat's own code.
 */

import { chooseResidents, LIFECYCLE } from './lifecycle'
import { supportAt } from './presence'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * The landform's shaping for D: the `power` shaping, then the ground under
 * the water level raised toward it. Depth below `level` is kept in
 * proportion `keep`, eased in from the shore (the first `knee` of depth is
 * kept whole), so the shore keeps its slope and the water beyond it is a
 * shallow sheet over a softly varied bed, not a basin. Land above the level
 * is untouched, and so is where the shoreline lies.
 */
export function shallows({ level, keep = 0.4, knee = 0.02 }) {
  return {
    label: 'Shallows',
    note: 'Power, with the bed under the water raised toward it (Habitat D).',
    apply: (n, exponent) => {
      const p = clamp01(Math.pow(n, exponent))
      const d = level - p
      if (d <= 0) return p
      return level - (keep * d + (1 - keep) * knee * (1 - Math.exp(-d / knee)))
    },
  }
}

/* --- age ------------------------------------------------------------------ */

/**
 * How long each colony has lived when the visitor arrives (simulated
 * seconds). A colony's maturity comes from the record around it (more
 * matter settled there, an older colony: scatter.js describeColony), so the
 * most mature has lived `span` and the least mature has just begun, the
 * rest in proportion between. Only the start is given: everything after it
 * is the colony's own lifecycle, run for that long before arrival.
 */
export function colonyAges(colonies, span) {
  const ms = colonies.map((c) => c.maturity)
  const lo = Math.min(...ms)
  const hi = Math.max(...ms)
  const ages = new Map()
  for (const c of colonies) ages.set(c.index, hi > lo ? span * ((c.maturity - lo) / (hi - lo)) : 0)
  return ages
}

/** Run a lifecycle for `seconds` of its own time, as it would have run (its fixed step, its own air). */
export function prerun(life, seconds) {
  const steps = Math.round(seconds / LIFECYCLE.step)
  for (let k = 0; k < steps; k++) life.stepOnce()
  return steps
}

/* --- composition ------------------------------------------------------------ */

const ARRIVE = {
  /** The colony met first: this far off (units), and among the younger ones (share of the age span). */
  near: [4, 8],
  young: 0.45,
  /** The view: within this angle of the near colony's direction, colonies at middle distance and far. */
  cone: 0.6,
  middle: [10, 22],
  far: [22, 46],
}

/**
 * D's composition, by rule from whatever world D's configuration makes:
 *   - patches: every colony with residents, each its own lifecycle, each
 *     begun at its own age (colonyAges)
 *   - arrival: on land a few units from a young colony (one still living
 *     through its first residents), facing it, with another colony at
 *     middle distance and one far off within the view, and the shallows
 *     between; the ground not hiding them
 *   - encounter: the tallest veil no lifecycle takes, near the arrival
 */
export function composeDistributed(space, { world, scatter }) {
  const seed = space.scatter.seed
  const span = space.age?.span ?? 0
  const ages = colonyAges(scatter.colonies, span)
  const patches = scatter.colonies
    .filter((c) => chooseResidents(scatter, c.index).length > 0)
    .map((c) => ({ colony: c.index, seed: seed + 3 * c.index, age: ages.get(c.index) }))
  const arrival = arriveDistributed(world, scatter, ages, span, space.bound)
  const taken = new Set(patches.flatMap((p) => chooseResidents(scatter, p.colony)))
  const [ax, , az] = arrival?.p ?? [0, 0, 0]
  const encounter =
    scatter.layers.bloom.instances
      .filter((b) => b.role === 'secondary' && !taken.has(b) && b.height >= 0.5)
      .map((b) => ({ b, s: b.height - 0.08 * Math.hypot(b.p[0] - ax, b.p[2] - az) }))
      .sort((p, q) => q.s - p.s)[0]?.b ?? null
  return { scatter, patches, ages, encounter, arrival }
}

function arriveDistributed(world, scatter, ages, span, bound) {
  const A = ARRIVE
  const cs = scatter.colonies
  const eye = 0.5
  const top = (c) => supportAt(world, c.x, c.z) + 1.2
  // Whether the ground stays below the line from (x, y, z) to colony c.
  const seen = (x, y, z, c) => {
    const ty = top(c)
    for (let t = 0.08; t < 0.92; t += 0.06) {
      const px = x + (c.x - x) * t
      const pz = z + (c.z - z) * t
      if (world.groundY(...world.toUV(px, pz)) > y + (ty - y) * t - 0.05) return false
    }
    return true
  }
  const wetAlong = (x, z, c) => {
    let w = 0
    for (let t = 0.1; t < 0.9; t += 0.1) w += world.groundY(...world.toUV(x + (c.x - x) * t, z + (c.z - z) * t)) < world.waterY ? 1 : 0
    return w / 8
  }
  let best = null
  const lim = bound - 1.5
  for (let z = -lim; z <= lim; z += 0.75) {
    for (let x = -lim; x <= lim; x += 0.75) {
      if (world.groundY(...world.toUV(x, z)) <= world.waterY + 0.02) continue
      if (cs.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + 1)) continue
      const y = supportAt(world, x, z) + eye
      for (const c of cs) {
        const d = Math.hypot(c.x - x, c.z - z)
        if (d < A.near[0] || d > A.near[1]) continue
        const youth = 1 - (ages.get(c.index) ?? 0) / Math.max(span, 1)
        if (youth < 1 - A.young) continue
        if (!seen(x, y, z, c)) continue
        const fx = (c.x - x) / d
        const fz = (c.z - z) / d
        let middle = 0
        let far = 0
        let water = 0
        for (const o of cs) {
          if (o === c) continue
          const od = Math.hypot(o.x - x, o.z - z)
          const along = ((o.x - x) * fx + (o.z - z) * fz) / od
          if (along < Math.cos(A.cone)) continue
          if (od >= A.middle[0] && od <= A.middle[1] && seen(x, y, z, o)) {
            middle++
            water = Math.max(water, wetAlong(x, z, o))
          } else if (od > A.far[0] && od <= A.far[1] && seen(x, y, z, o)) far++
        }
        const score = (middle > 0 ? 1 : 0) + (far > 0 ? 0.8 : 0) + 0.15 * Math.min(middle + far, 4) + 0.5 * water + 0.3 * youth - 0.04 * Math.abs(d - 6)
        if (!best || score > best.score) best = { score, x, z, y, c }
      }
    }
  }
  if (!best) return null
  const { x, z, y, c } = best
  return { p: [x, y, z], look: [c.x, top(c) - 0.7, c.z], colony: c.index }
}
