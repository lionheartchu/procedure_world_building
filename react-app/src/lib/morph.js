/**
 * Collective morphogenesis, a first exploration (docs/19-collective-morphogenesis.md;
 * the Habitat's M1, `/habitat/m1` only).
 *
 * The commons: what the many lifecycles share. Not matter: a signal. When a
 * resident lets a film go, the disturbance is breathed into the air at that
 * place, as a puff of cue that the same air carries downwind (lib/air.js,
 * the waves the films and the dust ride), spreading and fading as it goes.
 * It carries nothing of the resident's body; the film does that, as before.
 *
 * What it does, by two new rules (Lifecycle `commons`). A standing resident
 * gathers the cue that reaches it, and forgets it slowly. What it does with
 * it depends on its own state:
 *   - full (it has taken up all its body needs) and standing a while: past a
 *     threshold it lets go — it begins to lie down now rather than at the
 *     end of its own hold
 *   - still taking matter up: it turns toward where the release was, and
 *     holds the turn (a slow memory); its own films later leave from the
 *     turned sheet, so where its matter goes follows what reached it
 *   - lying down, or ended: reached, not changed
 * So a release can set off others downwind, with the delay the air takes to
 * carry it, and differently where the residents differ.
 *
 * And a slow record (`passage`): where the cue has passed, summed over time
 * on a coarse grid of the world. In this first prototype nothing reads it
 * but the display and the report; it is where a later, slower consequence
 * would come from.
 *
 * Deterministic, however the page's frames fall:
 *   - one world clock: world step 0 is the arrival; a lifecycle begun at age
 *     A is at world step (its steps − A / step)
 *   - the commons steps the cue on that clock, at fixed steps; a lifecycle
 *     arriving at a world step brings the commons up to it first
 *   - lifecycles step at most two world steps apart (they advance by the
 *     same frame time, each a fraction of a step ahead of the next), so a
 *     lifecycle at world step w reads the cue as it was at w − LAG: every
 *     release up to then has been recorded, by whichever lifecycle made it,
 *     and the cue's positions then are kept (a short ring per puff)
 *   - before arrival the lifecycles are run together, one world step at a
 *     time (prerunTogether), each from its own beginning
 */

import { airWaves } from './air'

export const MORPH = {
  /** World step, seconds: the lifecycle's own. */
  step: 0.1,
  /** Steps a reading lags the world (> the two steps lifecycles may be apart). */
  lag: 3,
  /** Positions kept per puff: the lag, the spread between lifecycles, and margin. */
  ring: 8,
  /** A puff: its strength per unit of matter its film carried; how fast it fades (s); its lifetime (s). */
  strength: 1,
  fade: 70,
  life: 220,
  /** Its radius: at release, and how it spreads (units per √s). */
  radius: [0.45, 0.22],
  /** It moves at this share of the air's horizontal speed, at this height above its floor. */
  carry: 0.9,
  height: 0.5,
  /** A resident gathers the cue every `every` steps, and forgets what it gathered over `forget` s. */
  every: 5,
  forget: 25,
  /** Ready to respond: full (taken ≥ this share of its need) and standing this long (s). */
  full: 0.98,
  stood: 20,
  /** What it must have gathered to let go (cue · s). */
  threshold: 0.004,
  /**
   * A resident still taking matter up turns toward where the cue's release
   * was: this much turn (share of its height, at the crest) per unit gathered
   * (cue · s), held with this memory (s), at most `most`.
   */
  reach: { gain: 12, memory: 150, most: 0.3 },
  /** The slow record: grid cells across the world, and how often (steps) the cue is laid into it. */
  passageRes: 96,
  passageEvery: 10,
}

export class Commons {
  /**
   * @param world  world data (worldData.js): its size and floor
   * @param air    the air's settings, a ref { current: { drift, curl } } as the lifecycles hold it
   */
  constructor({ world, air, rules = MORPH }) {
    this.world = world
    this.air = air
    this.K = rules
    /** The world step the cue has been carried to. */
    this.n = -Infinity
    this.puffs = []
    this.nextId = 0
    /** Releases recorded, and responses: the record the display and the report read. */
    this.releases = []
    this.responses = []
    const R = rules.passageRes
    this.passage = new Float32Array(R * R)
    this.passageVersion = 0
  }

  /** Start the clock (the world step the earliest lifecycle begins at). */
  start(n) {
    this.n = n
  }

  /** Bring the cue up to world step n (no further). */
  reach(n) {
    while (this.n < n) this.tick(this.n + 1)
  }

  tick(n) {
    this.n = n
    const K = this.K
    const dt = K.step
    const t = n * dt
    const half = this.world.size / 2 - 0.2
    const air = this.air.current
    const controls = { drift: air.drift, curl: air.curl }
    let alive = 0
    for (const p of this.puffs) {
      const age = (n - p.born) * dt
      if (age > K.life + K.ring * dt) continue
      this.puffs[alive++] = p
      if (p.at >= n || p.gone) continue
      this.carryOne(p, n, t, dt, controls, half)
    }
    this.puffs.length = alive
    if (n % K.passageEvery === 0) this.lay(n)
  }

  /** One step of a puff on the air, from step p.at to p.at + 1 (= n). */
  carryOne(p, n, t, dt, controls, half) {
    const K = this.K
    const prev = (p.at % K.ring + K.ring) % K.ring
    let x = p.xs[prev]
    let z = p.zs[prev]
    if (!p.gone) {
      const y = this.floorAt(x, z) + K.height
      const w = airWaves(x, y, z, t, controls)
      x += w.vx * K.carry * dt
      z += w.vz * K.carry * dt
      if (Math.abs(x) > half || Math.abs(z) > half) p.gone = true
    }
    const k = (n % K.ring + K.ring) % K.ring
    p.xs[k] = x
    p.zs[k] = z
    p.at = n
  }

  floorAt(x, z) {
    const w = this.world
    return Math.max(w.groundY(...w.toUV(x, z)), w.waterY)
  }

  /**
   * A film has come away (lifecycle `release`): a puff of cue where it left,
   * at world step n, as strong as the matter it carried. If the commons is
   * already past n (another lifecycle ran ahead), it is carried up to now at
   * once, by the same steps: where it is does not depend on who ran first.
   */
  emit({ n, x, z, matter, colony, resident }) {
    const K = this.K
    const p = { id: this.nextId++, born: n, at: n, x0: x, z0: z, s0: matter * K.strength, xs: new Float32Array(K.ring), zs: new Float32Array(K.ring), colony, resident, gone: false }
    const k = (n % K.ring + K.ring) % K.ring
    p.xs[k] = x
    p.zs[k] = z
    this.puffs.push(p)
    this.releases.push({ n, x, z, matter, colony, resident })
    if (this.n > n) {
      const air = this.air.current
      const controls = { drift: air.drift, curl: air.curl }
      const half = this.world.size / 2 - 0.2
      for (let m = n + 1; m <= this.n; m++) this.carryOne(p, m, m * K.step, K.step, controls, half)
    }
    return p
  }

  /** A puff's strength and radius at world step m (analytic: they depend on its age only). */
  shape(p, m) {
    const K = this.K
    const age = (m - p.born) * K.step
    const r = K.radius[0] + K.radius[1] * Math.sqrt(Math.max(age, 0))
    // Spread thinner as it widens, and fading.
    const s = p.s0 * Math.exp(-age / K.fade) * (K.radius[0] / r) ** 2
    return { s, r, age }
  }

  /**
   * The cue at (x, z) as it was at world step m, from puffs released at or
   * before m (excluding `self`, a resident's own), and the direction it came
   * from (where its strongest part came from, for the display).
   */
  cueAt(x, z, m, self = null) {
    const K = this.K
    let c = 0
    // The puff that gave most (a record for the report and display: whose release this was).
    this.top = null
    let topV = 0
    for (const p of this.puffs) {
      if (p.born > m || p.at < m || m - p.at <= -K.ring) continue
      if (self && p.resident === self) continue
      const { s, r, age } = this.shape(p, m)
      if (age > K.life) continue
      const k = (m % K.ring + K.ring) % K.ring
      const dx = p.xs[k] - x
      const dz = p.zs[k] - z
      const d2 = (dx * dx + dz * dz) / (r * r)
      if (d2 > 9) continue
      const v = s * Math.exp(-d2)
      c += v
      if (v > topV) {
        topV = v
        this.top = p
      }
    }
    return c
  }

  /** Lay the cue as it is now into the slow record (a coarse grid over the world). */
  lay(n) {
    const K = this.K
    const R = K.passageRes
    const size = this.world.size
    const cell = size / R
    const k = (n % K.ring + K.ring) % K.ring
    for (const p of this.puffs) {
      if (p.at !== n || p.gone) continue
      const { s, r, age } = this.shape(p, n)
      if (age > K.life || s < 1e-5) continue
      const gx = (p.xs[k] / size + 0.5) * R - 0.5
      const gz = (p.zs[k] / size + 0.5) * R - 0.5
      const span = Math.ceil((2 * r) / cell)
      for (let j = Math.max(0, Math.floor(gz) - span); j <= Math.min(R - 1, Math.ceil(gz) + span); j++) {
        for (let i = Math.max(0, Math.floor(gx) - span); i <= Math.min(R - 1, Math.ceil(gx) + span); i++) {
          const d2 = ((i - gx) ** 2 + (j - gz) ** 2) * (cell * cell) / (r * r)
          if (d2 < 9) this.passage[j * R + i] += s * Math.exp(-d2) * K.passageEvery * K.step
        }
      }
    }
    this.passageVersion++
  }

  /** The puffs as they are now, for the display: position, strength, radius, age. */
  *now() {
    const K = this.K
    const k = (this.n % K.ring + K.ring) % K.ring
    for (const p of this.puffs) {
      if (p.at !== this.n || p.gone) continue
      const { s, r, age } = this.shape(p, this.n)
      if (age > K.life) continue
      yield { p, x: p.xs[k], z: p.zs[k], s, r, age }
    }
  }
}

/**
 * Run lifecycles together before arrival, one world step at a time, each
 * from its own beginning (its age before arrival), so that what one
 * releases can reach another on the same clock. Without a commons this is
 * the same as running each alone (each reads nothing of the others).
 */
export function prerunTogether(lives, ages) {
  const step = MORPH.step
  const starts = lives.map((l, k) => -Math.round((ages[k] ?? 0) / step))
  const first = Math.min(0, ...starts)
  for (const l of lives) l.commons?.start(first - 1)
  for (let w = first; w < 0; w++) {
    for (let k = 0; k < lives.length; k++) if (w >= starts[k]) lives[k].stepOnce()
  }
}
