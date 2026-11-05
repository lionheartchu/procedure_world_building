/**
 * Lifecycle — study 10, behind a dev flag (`?lifecycle=1`). Stages 0–2 of
 * docs/03-DEMO-EXECUTION-PLAN.md: a small patch of the first colony where
 * several residents live out of step, and what one leaves becomes the
 * ground another grows from.
 *
 * A resident (one membrane, built by the bloom layer's own rules):
 *
 *     forming → holding → receding → releasing → ended (an old contour)
 *
 *   - forming    it unfolds by taking up matter from the ground under it:
 *                residue settled there, and old contours. As much as it
 *                finds, so it may stay half-formed. The ground it took from
 *                is thinner afterwards.
 *   - holding    it stands; how long is its own (seeded), so residents do
 *                not change together.
 *   - receding   it lies down: folds over toward its lean, lower and lower.
 *   - releasing  films come away from it, each carrying part of its body;
 *                the body is that much less.
 *   - ended      what did not leave stays where it lay: a low contour, the
 *                old outline of the membrane, holding the rest of its matter.
 *
 * The films are carried by the air (air.js), lose their lift, sink, and
 * settle. Where they settle their matter joins a live residual grid (128²,
 * History's grid and units, kept apart from History), which settles for a
 * moment by the sediment model's own transport rule (sediment.js). It is
 * drawn as a thin film lying on the ground (LifecycleLayer).
 *
 * A new resident forms only where there is a chance to: enough residue,
 * settled for a while, on ground the membrane rules accept (reading the
 * record as it is now: History's trace plus the residual), with room. It
 * rises from the deposit's edge and leans out from it, the way the matter
 * lies. Where nothing qualifies, nothing forms: places stay empty and wait.
 * There is no fallback that brings a resident back as it was.
 *
 * Matter is kept in five places — bodies, films in flight, the residual,
 * old contours, and what left (lost past the field, or unrecorded with
 * feedback off) — and only moves between them; `ledger()` totals it.
 *
 * With feedback off, films are shed, carried and settle exactly the same,
 * but their matter is not written to the residual (it is counted as
 * unrecorded): nothing changes on the ground, and nothing can form from it.
 *
 * Deterministic: a fixed step, seeded randomness, and the air field read on
 * the simulation's own clock.
 *
 * With the shared tissue (`conduit: true`; study 10, toward stage 3), the
 * ground under this colony and the colonies on the same land within reach
 * grows a tissue (conduit.js), by a logic borrowed from mycelium:
 *   - it begins where matter enters the ground: an ended resident's contour
 *     sinks into the tissue below it, and where there is none, a growth
 *     begins there; residue lying on the tissue sinks in too
 *   - matter spreads along its paths (diffusion, as fast as each path is
 *     thick), and its tips grow on the matter they hold, spending a little
 *     of it to become tissue, steering by the record and toward colonies
 *     with room to grow, branching, and fusing where they meet tissue
 *   - a path thickens with what passes along it and thins, when nothing
 *     does, toward a dormant trace; parallel paths compete, and the busiest
 *     becomes the trunk
 *   - each colony's hub draws matter into a pocket while the pocket has
 *     room (up to `room` × its demand, 1 − maturity), so a mature colony is
 *     soon full and matter passes on to a younger one; a pocket is matter a
 *     resident there can form from and take up
 * Matter in the tissue keeps its origin, like the residual.
 *
 * For the display it also keeps when matter last crossed from one place to
 * another (`drawn`, `tookAt`, `gaveAt`, `lastRelease`, beside `arrived`),
 * where each of a resident's films came away (`left`),
 * and how much was taken up in the last moments (`recentUptake`,
 * `recentInflow`). These are records only: nothing in the simulation reads
 * them.
 */

import { airVelocity, colonyAirData, makeFloor } from './air'
import { CONDUIT, TissueNet, tissueColonies } from './conduit'
import { mulberry32 } from './noise'
import { bloomFits, withProtocol } from './scatter'
import { SED_DISPLAY, SLOPE_REFERENCE } from './sediment'

export const LIFECYCLE = {
  /** Fixed simulation step, seconds. */
  step: 0.1,
  /** Seconds each stage takes, at normal speed. */
  form: 26,
  hold: [80, 140],
  recede: 20,
  release: 28,
  /** The first residents' remaining hold, so they change one after another. */
  firstHolds: [14, 110, 210],
  /** Matter in a resident per unit of its height. */
  bodyPerHeight: 0.6,
  /** Share of a body that leaves as films; the rest stays as its contour. */
  shed: 0.6,
  /** Films per release. */
  films: 4,
  /** Seconds over which a film loses its lift (time constant). */
  lift: 4,
  /** A film sinks at this speed besides what the air does (units/s). */
  sink: 0.04,
  /** How far it has lain down when its films begin to come away. */
  lies: 0.4,
  /** A contour keeps at least this share of its matter: its trace remains. */
  keeps: 0.5,
  /** Films move at this share of the air's speed, as the air's fragments do. */
  airSpeed: 0.9,
  /** A film settles this close to the ground or the water; or after `flight` s. */
  settle: 0.1,
  flight: 90,
  /** Sediment-rule steps a fresh deposit settles for. */
  consolidate: 5,
  /** Radius a forming resident gathers matter from. */
  footprint: 0.6,
  /** Least matter within that footprint for a resident to form there. */
  start: 0.1,
  /** Matter has to have lain this long (s) before it can be taken up. */
  rest: 22,
  /** How often (s) the patch looks for a place where a resident can form. */
  look: 2,
  /** Most residents standing in the patch at once (contours not counted). */
  most: 4,
  /** Grid spacing of the places a resident may form on. */
  search: 0.15,
  /** Rate (matter/s) at which a forming resident takes matter up. */
  uptake: 0.03,
  /** How far the patch reaches beyond the colony's radius. */
  margin: 1.2,
}

/**
 * Least rates (matter/s) at which an uptake is recorded for the display: from
 * one cell, into a resident, and out of an old contour. Below them the
 * exchange is a trickle, not worth showing.
 */
const NOTICE = { cell: 2e-4, take: 0.006, give: 0.002 }

/**
 * Seconds over which the record of recent uptake forgets: what it holds is
 * the matter taken in the last few seconds, each amount weighed down by
 * exp(-age / RECENT). Kept lazily (value and when it was last added to).
 */
export const RECENT = 2.5

/** A lazily forgetting sum, read at `now`. */
export const recentAt = (value, at, now) => value * Math.exp(-(now - at) / RECENT)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Working grids, one set per grid size, shared by every lifecycle: each is
 * used only within one call (a deposit settling, a look for a place) and
 * left as it began (`fresh` all zero; the rest written in full before they
 * are read), and lifecycles step one after another. With many lifecycles
 * (the Habitat's D: 13) this saves four whole-world grids and a table each.
 */
const WORKING = new Map()
function working(res) {
  let w = WORKING.get(res)
  if (!w) {
    const n = res * res
    w = { fresh: new Float32Array(n), surface: new Float32Array(n), delta: new Float32Array(n), scratch: new Float32Array(n), sat: new Float64Array((res + 1) * (res + 1)) }
    WORKING.set(res, w)
  }
  return w
}
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * The first residents: the colony's veils that no strand reaches toward, so
 * its structure stays whole while they live and die. Up to three.
 */
export function chooseResidents(scatter, colonyIndex = 0) {
  if (!scatter) return []
  const blooms = scatter.layers.bloom.instances.filter((b) => b.colony === colonyIndex && b.role === 'secondary')
  const reaches = scatter.layers.bridgework.instances.filter((r) => r.colony === colonyIndex && r.type === 'reach')
  const reached = (b) => reaches.some((r) => Math.hypot(r.b[0] - b.p[0], r.b[2] - b.p[2]) < 0.4)
  return blooms.filter((b) => !reached(b)).sort((a, b) => b.height - a.height).slice(0, 3)
}

export class Lifecycle {
  /**
   * @param world    world data (worldData.js)
   * @param scatter  placeScatter() output
   * @param history  runHistory() output: { sim }
   * @param field    the carved field (for the air's floor)
   * @param streams  stream centrelines (streams.js), kept clear as in placement
   * @param simParams the record's rules: flow and deposition, as History used them
   * @param air      the air's settings { drift, curl, colony }: a function
   *                 returning them, or a ref holding them
   * @param feedback whether settled matter is written to the residual
   * @param seed     the colony seed
   * @param conduit  whether a shared tissue joins this colony to another
   * @param fold     with the tissue, choose one stretch for the fold study (display only)
   * @param colony   the colony whose patch this is (its index); the first by default
   * @param holds    the first residents' remaining holds (s): a valid starting
   *                 state of its own, so patches need not change together
   * @param commons  the Habitat's M1 only (lib/morph.js): the cue the
   *                 lifecycles share. Its films' releases breathe cue into
   *                 the air, and its residents gather it and may respond
   *                 (`gather`). None: as before, exactly.
   * @param worldOffset with a commons: this lifecycle's steps at arrival (its age / step)
   */
  constructor({ world, scatter, history, field, streams, simParams, air, feedback = true, seed = 1, conduit = false, fold = false, colony = 0, holds = LIFECYCLE.firstHolds, airNear = false, commons = null, worldOffset = 0 }) {
    this.world = world
    this.history = history
    this.feedback = feedback
    this.simParams = simParams
    this.air = air
    this.seed = seed | 0
    this.protocol = withProtocol({})
    this.random = mulberry32(this.seed * 7919 + 101)

    const res = world.res
    this.res = res
    this.cell = world.size / res
    this.residual = new Float32Array(res * res)
    // Working grids (shared: see WORKING).
    const w = working(res)
    this.fresh = w.fresh
    this.surface = w.surface
    this.delta = w.delta
    this.scratch = w.scratch
    this.sat = w.sat
    /** The residual by where it came from: resident id → its grid. Their sum is `residual`. */
    this.bySource = new Map()
    /** When matter last arrived in each cell (simulation seconds). */
    this.arrived = new Float32Array(res * res).fill(-1e9)
    /** When matter was last taken up from each cell (a record for the display). */
    this.drawn = new Float32Array(res * res).fill(-1e9)
    /** Matter taken up from each cell lately (recentAt), and when last (records for the display). */
    this.uptake = new Float32Array(res * res)
    this.uptakeAt = new Float32Array(res * res).fill(-1e9)
    this.version = 0

    this.floor = makeFloor(field, { size: world.size, elevation: world.elevation, waterLevel: world.waterLevel })
    this.colony = scatter.colonies.find((c) => c.index === colony)
    // `airNear` (a world with more membranes than the air holds: the
    // Habitat's D): the ones nearest this colony, where its films fly.
    this.colonyAir = colonyAirData(scatter.colonies, scatter.layers.bloom.instances, airNear && this.colony ? { near: [this.colony.x, this.colony.z] } : undefined)
    const anchor = scatter.layers.bloom.instances.find((b) => b.colony === colony && b.role === 'anchor')
    this.anchor = anchor
    this.lean = anchor ? [Math.cos(anchor.lean), Math.sin(anchor.lean)] : this.colony?.dir ?? [1, 0]

    const first = chooseResidents(scatter, colony)
    this.first = first
    // Where nothing may form: the colony's other membranes, as placed, and
    // the streams. The residents' own places are not claimed: when they
    // end, their ground is open again.
    this.claims = []
    for (const b of scatter.layers.bloom.instances) {
      if (first.includes(b)) continue
      this.claims.push(b.p[0], b.p[2], 0.25 + 0.25 * b.height)
    }
    for (const sl of streams ?? []) {
      for (let k = 0; k < sl.points.length; k += 3) this.claims.push(sl.points[k].x, sl.points[k].z, sl.width[k] * 1.5)
    }

    // The colonies it lives in: its own, and with the shared tissue every
    // other colony within reach on the same land. Each has its anchor's
    // lean, a pocket of matter its hub has drawn from the tissue, and a
    // demand: how much room it has to grow.
    const joined = conduit ? tissueColonies(world, scatter, this.colony) : null
    const siteOf = (c) => {
      const a = scatter.layers.bloom.instances.find((b) => b.colony === c.index && b.role === 'anchor')
      return {
        colony: c,
        anchor: a,
        lean: a ? [Math.cos(a.lean), Math.sin(a.lean)] : c.dir ?? [1, 0],
        demand: 1 - c.maturity,
        pocket: { matter: 0, bySource: new Map(), heldSince: null },
      }
    }
    this.sites = (joined ?? [this.colony]).map(siteOf)
    /** The shared tissue (null without it): a network that grows. Its own randomness, so the rest runs as without it. */
    this.conduit = joined ? new TissueNet(world, joined, mulberry32(this.seed * 9973 + 17)) : null
    if (this.conduit) {
      const N = CONDUIT.capacity
      /** Matter in the tissue, node by node, by where it came from: resident id → its array. */
      this.inTissue = new Map()
      /** The tissue's total per node, after each step. */
      this.tissue = new Float64Array(N)
      /** Net flow along each edge in the last step (matter/s, from its first node to its second). */
      this.flow = new Float32Array(N)
      this.spread = new Float64Array(N)
      /** Matter the tissue is made of: spent by its tips on growing. */
      this.structure = 0
      /** Matter that has passed through each node so far (a record: the tissue's slow memory of use). */
      this.passed = new Float64Array(N)
      /** The fold study: whether to choose a stretch, and the one chosen (null until then). */
      this.foldStudy = fold
      this.fold = null
      /** Grid cells close enough to the tissue for residue on them to sink in: cell → [node, weight, distance]. */
      this.intake = new Map()
      this.intakeNodes = 0
      this.seeped = 0
      this.fusions = 0
      this.nextSeepNote = 10
      this.nextFoldLook = 2
    }

    this.t = 0
    /** Steps run, and (with a commons) how many of them were before arrival. */
    this.steps = 0
    this.commons = commons
    this.worldOffset = worldOffset
    this.acc = 0
    this.paused = false
    this.speed = 1
    /** Development display, not the simulation: the warm accent's variant (0 none; LifecycleLayer). */
    this.warm = 0
    this.nextId = 0
    this.nextLook = LIFECYCLE.look
    this.residents = first.map((desc, k) => {
      const body = LIFECYCLE.bodyPerHeight * desc.height
      return this.makeResident({ ...desc }, {
        stage: 'holding',
        hold: holds[k] ?? 200 + 90 * k,
        body,
        need: body,
        taken: body,
        unfold: 1,
        origin: 'placed',
      })
    })
    this.films = []
    this.log = []
    this.lost = 0
    this.unrecorded = 0
    this.initial = this.ledger().total
  }

  get active() {
    return this.residents.length > 0
  }

  makeResident(desc, state) {
    const id = ++this.nextId
    return { id, desc, stageTime: 0, recline: 0, released: 0, schedule: [], contour: 0, contour0: 0, taken: 0, sources: [], inflow: 0, inflowAt: -1e9, ...state }
  }

  /* --- the clock --------------------------------------------------------- */

  /** Development controls: pause, and run faster for inspection. */
  setPaused(paused) {
    this.paused = paused
  }

  setSpeed(speed) {
    this.speed = speed
  }

  setWarm(variant) {
    this.warm = variant
  }

  /** Run whole steps for `seconds` of simulated time (fractions carry over). */
  advance(seconds) {
    if (!this.active || this.paused) return 0
    this.acc += seconds * this.speed
    let n = 0
    while (this.acc >= LIFECYCLE.step - 1e-9) {
      this.acc -= LIFECYCLE.step
      this.stepOnce()
      n++
    }
    return n
  }

  /** With a commons: the world step this lifecycle is at (0 at arrival). */
  get worldStep() {
    return this.steps - this.worldOffset
  }

  stepOnce() {
    const dt = LIFECYCLE.step
    this.t += dt
    this.steps++
    // The shared cue first brought up to this world step (lib/morph.js).
    if (this.commons) this.commons.reach(this.worldStep)
    for (const r of this.residents) this.live(r, dt)
    for (const f of this.films) this.carry(f, dt)
    if (this.conduit) this.circulate(dt)
    if (this.t >= this.nextLook - 1e-9) {
      this.nextLook += LIFECYCLE.look
      this.lookForPlace()
    }
    if (this.commons && this.worldStep % this.commons.K.every === 0) this.gather(this.worldStep)
  }

  /**
   * The Habitat's M1 (lib/morph.js): its residents gather the cue the air
   * brings them, as it was LAG steps ago (so what every lifecycle released
   * by then is in it, whichever ran first), and forget it slowly. The one new
   * rule: a resident standing full and a while gathers past the threshold
   * and lets go — it begins to lie down now. Any other resident is reached
   * (its gathered cue is kept, for the display) but does not respond.
   */
  gather(w) {
    const K = this.commons.K
    const dt = K.every * LIFECYCLE.step
    const keep = Math.exp(-dt / K.forget)
    for (const r of this.residents) {
      if (r.stage === 'ended') {
        r.cue = 0
        continue
      }
      const c = this.commons.cueAt(r.desc.p[0], r.desc.p[2], w - K.lag, r.id)
      const top = this.commons.top
      r.cue = c
      r.dose = (r.dose ?? 0) * keep + c * dt
      // Still taking matter up: it turns toward where the release was, and holds it.
      if (!r.reach) r.reach = [0, 0]
      const fade = Math.exp(-dt / K.reach.memory)
      r.reach[0] *= fade
      r.reach[1] *= fade
      const taking = (r.stage === 'forming' || r.stage === 'holding') && r.taken < K.full * r.need
      if (taking && top && c > 0) {
        const dx = top.x0 - r.desc.p[0]
        const dz = top.z0 - r.desc.p[2]
        const d = Math.hypot(dx, dz)
        if (d > 1e-3) {
          r.reach[0] += (dx / d) * c * dt * K.reach.gain
          r.reach[1] += (dz / d) * c * dt * K.reach.gain
          const m = Math.hypot(r.reach[0], r.reach[1])
          if (m > K.reach.most) {
            r.reach[0] *= K.reach.most / m
            r.reach[1] *= K.reach.most / m
          }
        }
      }
      const ready = r.stage === 'holding' && r.taken >= K.full * r.need && r.stageTime >= K.stood
      if (ready && r.dose >= K.threshold && r.stageTime < r.hold) {
        r.hold = r.stageTime
        r.respondedAt = this.t
        const top = this.commons.top
        this.commons.responses.push({ n: w, colony: this.colony.index, resident: r.id, at: [r.desc.p[0], r.desc.p[2]], dose: r.dose, from: top && { colony: top.colony, resident: top.resident, born: top.born } })
        this.event('respond', { resident: r.id, dose: +r.dose.toFixed(4) })
      }
    }
  }

  event(kind, data) {
    this.log.push({ t: Math.round(this.t * 10) / 10, kind, ...data })
  }

  /* --- a resident's life ------------------------------------------------- */

  live(r, dt) {
    r.stageTime += dt
    const L = LIFECYCLE
    if (r.stage === 'forming') {
      // It unfolds as far as the matter it has taken up allows.
      if (r.taken < r.need) {
        const got = this.takeUp(r, Math.min(L.uptake * dt, r.need - r.taken))
        r.taken += got
        r.body += got
      }
      r.unfold = Math.min(r.taken / r.need, smoothstep(0, L.form * 0.8, r.stageTime))
      if (r.stageTime >= L.form) {
        r.unfold = r.taken / r.need
        this.to(r, 'holding')
        r.hold = lerp(L.hold[0], L.hold[1], this.random())
      }
    } else if (r.stage === 'holding') {
      // A resident that could not unfold fully takes up matter that arrives
      // under it later, and opens further: a deposit changes it too.
      if (r.taken < r.need - 1e-6) {
        const got = this.takeUp(r, Math.min(L.uptake * 0.5 * dt, r.need - r.taken))
        if (got > 0) {
          r.taken += got
          r.body += got
          r.unfold = r.taken / r.need
        }
      }
      if (r.stageTime >= r.hold) this.to(r, 'receding')
    } else if (r.stage === 'receding') {
      r.recline = L.lies * smoothstep(0, L.recede, r.stageTime)
      if (r.stageTime >= L.recede) {
        // Its films come away at its own times, through the release.
        const n = L.films
        r.schedule = Array.from({ length: n }, (_, k) => L.release * (0.1 + (0.8 * (k + 0.5 * this.random())) / n))
        r.shedTotal = r.body * L.shed
        this.to(r, 'releasing')
      }
    } else if (r.stage === 'releasing') {
      r.recline = L.lies + (0.95 - L.lies) * smoothstep(0, L.release, r.stageTime)
      while (r.schedule.length && r.schedule[0] <= r.stageTime) {
        r.schedule.shift()
        this.release(r, r.shedTotal / L.films)
      }
      if (r.stageTime >= L.release) {
        // What did not leave stays where it lay.
        r.contour = r.body
        r.contour0 = r.body
        r.body = 0
        this.to(r, 'ended')
      }
    }
  }

  to(r, stage) {
    r.stage = stage
    r.stageTime = 0
    this.event('stage', { resident: r.id, stage })
  }

  /** A film comes away from a lying resident, carrying `matter` of its body. */
  release(r, matter) {
    const d = r.desc
    const lean = [Math.cos(d.lean), Math.sin(d.lean)]
    const across = [-lean[1], lean[0]]
    const along = (this.random() - 0.5) * 0.8 * (d.width ?? d.height * 0.9)
    // From its upper part, which is lower and further out the more it lies.
    const up = d.height * (1 - r.recline) * (0.55 + 0.4 * this.random()) + 0.1
    const out = d.height * r.recline * (0.3 + 0.5 * this.random())
    // M1: a resident turned toward a neighbour's release lets its films go from the turned sheet.
    const turn = r.reach ? d.height * (1 - r.recline) : 0
    const x = d.p[0] + across[0] * along + lean[0] * out + (r.reach ? r.reach[0] * turn : 0)
    const z = d.p[2] + across[1] * along + lean[1] * out + (r.reach ? r.reach[1] * turn : 0)
    r.body -= matter
    r.released += matter
    r.lastRelease = { t: this.t, at: [x, this.groundAt(x, z) + up, z] }
    // Every release, for the display (a record only, like lastRelease):
    // where each film came away, and how far the resident lay then.
    if (!r.left) r.left = []
    r.left.push({ t: this.t, along, height: up, recline: r.recline })
    // With the shared tissue, part of what it releases goes down into the
    // ground at its base (where there is no tissue yet, a growth begins);
    // the rest leaves as a film. Without the tissue, all of it is a film.
    let down = 0
    if (this.conduit && this.feedback) {
      const node = this.tissueUnder(r)
      if (node >= 0) {
        down = matter * CONDUIT.down
        this.toTissue(node, r.id, down)
        r.sankAt = this.t
      }
    }
    matter -= down
    const f = {
      id: this.films.length,
      from: r.id,
      p: [x, this.groundAt(x, z) + up, z],
      v: [0, 0, 0],
      lift: up,
      age: 0,
      matter,
      size: 0.4 + 0.18 * this.random(),
      seed: this.random() * 100,
      state: 'flight',
      settledAt: 0,
    }
    this.films.push(f)
    // M1: the disturbance breathed into the air where it left (a signal: no matter).
    if (this.commons) this.commons.emit({ n: this.worldStep, x, z, matter, colony: this.colony.index, resident: r.id })
    this.event('release', { resident: r.id, film: f.id, matter: +matter.toFixed(4), at: [+x.toFixed(3), +z.toFixed(3)] })
  }

  /** One step of a film's flight, on the air, until it settles. */
  carry(f, dt) {
    if (f.state !== 'flight') {
      f.age += dt
      return
    }
    const air = typeof this.air === 'function' ? this.air() : this.air.current
    const controls = { drift: air.drift, curl: air.curl }
    const held = air.colony > 0 && this.colonyAir.obstacles.length ? { strength: air.colony, obstacles: this.colonyAir.obstacles } : null
    // It loses its lift as it goes: the air's own pull to a height (air.js)
    // draws it down as that height falls away; and it is heavier than dust.
    const pref = f.lift * Math.exp(-f.age / LIFECYCLE.lift)
    const v = airVelocity(f.p, pref, this.t, controls, this.floor, held)
    const k = LIFECYCLE.airSpeed
    f.v = [v[0] * k, v[1] * k - LIFECYCLE.sink, v[2] * k]
    f.p[0] += f.v[0] * dt
    f.p[1] += f.v[1] * dt
    f.p[2] += f.v[2] * dt
    f.age += dt

    const half = this.world.size / 2 - 0.4
    if (Math.abs(f.p[0]) > half || Math.abs(f.p[2]) > half) {
      f.state = 'lost'
      f.settledAt = f.age
      this.lost += f.matter
      this.event('lost', { film: f.id, matter: f.matter })
      return
    }
    const ground = this.groundAt(f.p[0], f.p[2])
    if (f.p[1] - Math.max(ground, this.world.waterY) < LIFECYCLE.settle || f.age >= LIFECYCLE.flight) this.settle(f, ground)
  }

  /** It settles (over water, onto the bed below); its matter joins the residual. */
  settle(f, ground) {
    f.state = 'settled'
    f.settledAt = f.age
    f.p[1] = Math.max(ground, this.world.waterY)
    if (this.feedback) {
      // Only the new deposit settles, over the record as it already is.
      this.splat(this.fresh, f.p[0], f.p[2], f.matter)
      this.consolidate(this.fresh, LIFECYCLE.consolidate)
      let mine = this.bySource.get(f.from)
      if (!mine) this.bySource.set(f.from, (mine = new Float32Array(this.residual.length)))
      for (let i = 0; i < this.residual.length; i++) {
        if (this.fresh[i] > 1e-6) this.arrived[i] = this.t
        this.residual[i] += this.fresh[i]
        mine[i] += this.fresh[i]
      }
      this.fresh.fill(0)
      this.version++
    } else {
      this.unrecorded += f.matter
    }
    this.event('settle', {
      film: f.id,
      from: f.from,
      at: [+f.p[0].toFixed(3), +f.p[2].toFixed(3)],
      underwater: ground < this.world.waterY,
      flight: +f.age.toFixed(1),
      recorded: this.feedback,
    })
  }

  /* --- the live residual ------------------------------------------------- */

  cellOf(x, z) {
    return [(x / this.world.size + 0.5) * this.res - 0.5, (z / this.world.size + 0.5) * this.res - 0.5]
  }

  /** Add matter at (x, z) to a grid, bilinear over the four nearest cells. */
  splat(grid, x, z, matter) {
    const { res } = this
    const [gx, gz] = this.cellOf(x, z)
    const i0 = Math.max(0, Math.min(res - 2, Math.floor(gx)))
    const j0 = Math.max(0, Math.min(res - 2, Math.floor(gz)))
    const fx = clamp01(gx - i0)
    const fz = clamp01(gz - j0)
    grid[j0 * res + i0] += matter * (1 - fx) * (1 - fz)
    grid[j0 * res + i0 + 1] += matter * fx * (1 - fz)
    grid[(j0 + 1) * res + i0] += matter * (1 - fx) * fz
    grid[(j0 + 1) * res + i0 + 1] += matter * fx * fz
  }

  /**
   * A fresh deposit settles by the sediment model's own rules (sediment.js,
   * steps 2 and 4): part of each cell's matter moves toward neighbours whose
   * total surface (ground, History's sediment and the residual) is lower,
   * eased by steepness, then a light blur. No supply and no decay.
   */
  consolidate(R, steps) {
    const { res, delta, scratch, surface: S } = this
    const H = this.history.sim.height
    const S0 = this.history.sim.sediment
    const P = this.residual
    for (let c = 0; c < S.length; c++) S[c] = S0[c] + P[c]
    const dt = LIFECYCLE.step
    const { flow, deposition } = this.simParams
    for (let s = 0; s < steps; s++) {
      delta.fill(0)
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
          const c = j * res + i
          const mobile = R[c] * (1 - deposition)
          if (mobile < 1e-7) continue
          const t = H[c] + S[c] + R[c]
          const nL = i > 0 ? c - 1 : -1
          const nR = i < res - 1 ? c + 1 : -1
          const nD = j > 0 ? c - res : -1
          const nU = j < res - 1 ? c + res : -1
          const dL = nL >= 0 ? Math.max(0, t - (H[nL] + S[nL] + R[nL])) : 0
          const dR = nR >= 0 ? Math.max(0, t - (H[nR] + S[nR] + R[nR])) : 0
          const dD = nD >= 0 ? Math.max(0, t - (H[nD] + S[nD] + R[nD])) : 0
          const dU = nU >= 0 ? Math.max(0, t - (H[nU] + S[nU] + R[nU])) : 0
          const sum = dL + dR + dD + dU
          if (sum <= 1e-7) continue
          const steepness = Math.min(1, sum / SLOPE_REFERENCE)
          const move = Math.min(mobile, mobile * flow * dt * steepness)
          if (move <= 0) continue
          delta[c] -= move
          if (dL > 0) delta[nL] += (move * dL) / sum
          if (dR > 0) delta[nR] += (move * dR) / sum
          if (dD > 0) delta[nD] += (move * dD) / sum
          if (dU > 0) delta[nU] += (move * dU) / sum
        }
      }
      for (let c = 0; c < R.length; c++) R[c] = Math.max(0, R[c] + delta[c])
      // The model's own soft-bank blur (sediment.js, weight 0.16).
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
          const c = j * res + i
          const l = i > 0 ? R[c - 1] : R[c]
          const r = i < res - 1 ? R[c + 1] : R[c]
          const d = j > 0 ? R[c - res] : R[c]
          const u = j < res - 1 ? R[c + res] : R[c]
          scratch[c] = R[c] + 0.16 * ((l + r + d + u) * 0.25 - R[c])
        }
      }
      R.set(scratch)
    }
  }

  /** Cells within `r` of (x, z), with a weight falling to 0 at r. */
  footprint(x, z, r, fn) {
    const { res, cell } = this
    const [ci, cj] = this.cellOf(x, z)
    const span = Math.ceil(r / cell)
    for (let j = Math.max(0, Math.floor(cj) - span); j <= Math.min(res - 1, Math.ceil(cj) + span); j++) {
      for (let i = Math.max(0, Math.floor(ci) - span); i <= Math.min(res - 1, Math.ceil(ci) + span); i++) {
        const d = Math.hypot(i - ci, j - cj) * cell
        if (d < r) fn(j * res + i, 1 - (d / r) ** 2)
      }
    }
  }

  /** The matter within a footprint, by where it came from. */
  provenance(x, z) {
    const out = {}
    for (const [id, g] of this.bySource) {
      let m = 0
      this.footprint(x, z, LIFECYCLE.footprint, (c, w) => (m += g[c] * w))
      if (m > 1e-4) out[`#${id}`] = +m.toFixed(4)
    }
    return out
  }

  /** Residual matter within the footprint of (x, z), weighted to its centre. */
  matterAt(x, z) {
    let m = 0
    this.footprint(x, z, LIFECYCLE.footprint, (c, w) => (m += this.residual[c] * w))
    return m
  }

  /**
   * Take up to `amount` of matter from the ground under a forming resident:
   * from the residual (each cell in proportion to what it holds and how
   * central it is) and from old contours whose place it stands on. Returns
   * what it got; the ground keeps the rest.
   */
  takeUp(r, amount) {
    const { residual } = this
    const [x, , z] = r.desc.p
    const R = LIFECYCLE.footprint
    // A contour gives up only part of itself: its trace remains.
    const spare = (o) => Math.max(0, o.contour - LIFECYCLE.keeps * o.contour0)
    const contours = this.residents.filter((o) => o.stage === 'ended' && spare(o) > 1e-6 && Math.hypot(o.desc.p[0] - x, o.desc.p[2] - z) < R + 0.4 * o.desc.height)
    let pool = 0
    const cells = []
    this.footprint(x, z, R, (c, w) => {
      const m = residual[c] * w
      if (m > 1e-9) {
        cells.push([c, m])
        pool += m
      }
    })
    const contourPool = contours.reduce((s, o) => s + spare(o), 0)
    // With the shared conduit: what its colony's hub has drawn from the tissue.
    const site = this.conduit ? this.siteFor(r.desc.colony) : null
    const pocketPool = site ? this.pocketAt(site, x, z) : 0
    const total = pool + contourPool + pocketPool
    if (total <= 1e-9) return 0
    const got = Math.min(amount, total)
    const k = got / total
    const dt = LIFECYCLE.step
    if (got / dt > NOTICE.take) r.tookAt = this.t
    r.inflow = recentAt(r.inflow, r.inflowAt, this.t) + got
    r.inflowAt = this.t
    r.takenFrom = r.takenFrom ?? {}
    for (const [c, m] of cells) {
      // Each source gives up the same share of what it holds in this cell.
      const share = (m * k) / residual[c]
      for (const [id, g] of this.bySource) {
        const part = g[c] * share
        if (part > 0) {
          g[c] -= part
          r.takenFrom[`residue of #${id}`] = (r.takenFrom[`residue of #${id}`] ?? 0) + part
        }
      }
      residual[c] -= m * k
      if ((m * k) / dt > NOTICE.cell) this.drawn[c] = this.t
      this.uptake[c] = recentAt(this.uptake[c], this.uptakeAt[c], this.t) + m * k
      this.uptakeAt[c] = this.t
    }
    for (const o of contours) {
      const part = spare(o) * k
      o.contour -= part
      if (part / dt > NOTICE.give) o.gaveAt = this.t
      r.takenFrom[`contour of #${o.id}`] = (r.takenFrom[`contour of #${o.id}`] ?? 0) + part
      if (!r.sources.includes(o.id)) r.sources.push(o.id)
    }
    if (pocketPool > 0) {
      // Each source in the pocket gives up the same share of what it holds there.
      const p = site.pocket
      const share = (pocketPool * k) / p.matter
      for (const [id, q] of p.bySource) {
        const part = q * share
        p.bySource.set(id, q - part)
        r.takenFrom[`tissue: #${id}`] = (r.takenFrom[`tissue: #${id}`] ?? 0) + part
      }
      p.matter -= pocketPool * k
    }
    if (pool > 0) this.version++
    return got
  }

  /* --- the shared conduit -------------------------------------------------- */

  /** The lifecycle's colony with this index (its own when undefined). */
  siteFor(index) {
    return this.sites.find((s) => s.colony.index === (index ?? this.colony.index)) ?? this.sites[0]
  }

  /**
   * The part of a colony's pocket a footprint at (x, z) reaches: what the
   * tissue brings up within the colony (its radius), so it is there to take
   * where the tissue runs (as the footprint weighs the ground: all of it on
   * a fibre, none a footprint away), not at the colony's middle.
   */
  pocketAt(site, x, z) {
    const p = site.pocket
    if (!this.conduit || p.matter <= 1e-9) return 0
    const C = this.conduit
    if (site.nodesAt !== C.version) {
      // The tissue within the colony itself (it grows, so looked at again when it has).
      site.nodesAt = C.version
      site.nodes = []
      for (let n = 0; n < C.count; n++) if (Math.hypot(C.x[n] - site.colony.x, C.z[n] - site.colony.z) < site.colony.radius) site.nodes.push(n)
    }
    const R = LIFECYCLE.footprint
    let near = 0
    for (const n of site.nodes) {
      const d = Math.hypot(C.x[n] - x, C.z[n] - z)
      if (d < R) near = Math.max(near, 1 - (d / R) ** 2)
    }
    return p.matter * near
  }

  toTissue(n, id, amount) {
    let g = this.inTissue.get(id)
    if (!g) this.inTissue.set(id, (g = new Float64Array(CONDUIT.capacity)))
    g[n] += amount
  }

  /**
   * The tissue under a resident's base: the nearest node close enough, and
   * where there is none, a growth begins there (not under water; then -1,
   * and it looks again for tissue that may grow close later).
   */
  tissueUnder(r) {
    const C = this.conduit
    if (r.tissueNode === undefined || r.tissueNode === -2) {
      const near = C.near(r.desc.p[0], r.desc.p[2], CONDUIT.intake + 0.3 * r.desc.height)
      if (near.length) r.tissueNode = near[0][0]
      else if (r.tissueNode === undefined) {
        r.tissueNode = C.seed(r.desc.p[0], r.desc.p[2], r.desc.colony ?? this.colony.index)
        if (r.tissueNode >= 0) this.event('begin', { resident: r.id, at: [+r.desc.p[0].toFixed(2), +r.desc.p[2].toFixed(2)] })
        else r.tissueNode = -2
      }
    }
    return r.tissueNode >= 0 ? r.tissueNode : -1
  }

  /** The matter at a tissue node, all sources together. */
  heldAt(n) {
    let m = 0
    for (const g of this.inTissue.values()) m += g[n]
    return m
  }

  /**
   * One step of the shared tissue: what lies on it sinks in (or a growth
   * begins), its tips grow, matter spreads along it, each hub draws on it,
   * and its paths thicken or thin with use.
   */
  circulate(dt) {
    const C = this.conduit
    const K = CONDUIT
    if (this.feedback) {
      // An old contour's spare part sinks into the ground below it: into the
      // tissue if there is some close by, and where there is none, a growth
      // begins (not under water). The contour keeps its trace.
      const seep = 1 - Math.exp(-dt / K.seepContour)
      for (const r of this.residents) {
        if (r.stage !== 'ended') continue
        const spare = r.contour - LIFECYCLE.keeps * r.contour0
        if (spare <= 1e-9) continue
        if (this.tissueUnder(r) < 0) continue
        const a = spare * seep
        r.contour -= a
        r.sankAt = this.t
        this.toTissue(r.tissueNode, r.id, a)
        this.seeped += a
      }
      // Residue lying on the tissue sinks into it too: the cells near new
      // tissue are added as it grows.
      if (this.intakeNodes < C.count) {
        for (; this.intakeNodes < C.count; this.intakeNodes++) {
          const n = this.intakeNodes
          this.footprint(C.x[n], C.z[n], K.intake, (c, w) => {
            const prev = this.intake.get(c)
            if (!prev || w > prev[1]) this.intake.set(c, [n, w])
          })
        }
        this.intakeList = [...this.intake].map(([c, [n, w]]) => [c, n, w])
      }
      let moved = false
      for (const [c, n, w] of this.intakeList ?? []) {
        const m = this.residual[c]
        if (m < 1e-9) continue
        const a = m * w * K.seepResidue * dt
        const share = a / m
        for (const [id, g] of this.bySource) {
          const part = g[c] * share
          if (part > 0) {
            g[c] -= part
            this.toTissue(n, id, part)
          }
        }
        this.residual[c] -= a
        this.seeped += a
        moved = true
      }
      if (moved) this.version++
    }
    if (this.t >= this.nextSeepNote - 1e-9) {
      this.nextSeepNote += 10
      if (this.seeped > 1e-5) this.event('seep', { matter: +this.seeped.toFixed(4) })
      this.seeped = 0
    }

    // Growing tips draw matter toward themselves along the few nodes behind
    // them (as hyphal tips draw what they grow on), then grow on what they
    // hold.
    const pull = 1 - Math.exp(-K.grow.pull * dt)
    for (const t of C.tips) {
      if (t.state !== 'growing') continue
      const L = t.lineage
      for (let k = Math.max(0, L.length - 5); k < L.length - 1; k++) {
        for (const g of this.inTissue.values()) {
          const q = g[L[k]] * pull
          g[L[k]] -= q
          g[t.node] += q
        }
      }
    }
    const spend = (n, amount) => {
      const m = this.heldAt(n)
      if (m <= 0) return
      const share = Math.min(1, amount / m)
      for (const g of this.inTissue.values()) g[n] -= g[n] * share
      this.structure += Math.min(amount, m)
    }
    const carry = (from, to, share) => {
      for (const g of this.inTissue.values()) {
        const q = g[from] * share
        g[from] -= q
        g[to] += q
      }
    }
    for (const e of C.grow(dt, (n) => this.heldAt(n), spend, carry)) {
      if (e.kind === 'reach') this.event('reach', { colony: e.colony, from: e.home })
      else if (e.kind === 'fuse') this.fusions++
    }

    // Matter spreads along the tissue, as fast as each path is thick: in
    // explicit substeps short enough that no node gives more than half of
    // what it holds (stable, and nothing is lost).
    const E = C.edgeCount
    if (!this.kd) this.kd = new Float64Array(CONDUIT.capacity)
    const kd = this.kd
    let worst = 0
    for (let e = 0; e < E; e++) {
      const L = Math.max(C.len[e], K.spacing * 0.8)
      kd[e] = (K.diffusion * C.g[e] * dt) / (L * L)
      worst = Math.max(worst, kd[e] * 2 * Math.max(C.at[C.a[e]].length, C.at[C.b[e]].length))
    }
    const sub = Math.max(1, Math.ceil(worst))
    for (let e = 0; e < E; e++) kd[e] /= sub
    const delta = this.spread
    this.flow.fill(0, 0, E)
    for (const g of this.inTissue.values()) {
      for (let s = 0; s < sub; s++) {
        delta.fill(0, 0, C.count)
        for (let e = 0; e < E; e++) {
          const f = kd[e] * (g[C.a[e]] - g[C.b[e]])
          delta[C.a[e]] -= f
          delta[C.b[e]] += f
          this.flow[e] += f
        }
        for (let n = 0; n < C.count; n++) g[n] += delta[n]
      }
    }
    for (let e = 0; e < E; e++) this.flow[e] /= dt

    // A record of what has passed through each node (half of what passes
    // along each edge at either end).
    for (let e = 0; e < E; e++) {
      const q = Math.abs(this.flow[e]) * dt * 0.5
      this.passed[C.a[e]] += q
      this.passed[C.b[e]] += q
    }

    // Each colony's hub draws on the tissue into its pocket while the pocket
    // has room: up to `room` × the colony's demand.
    for (const site of this.sites) {
      if (site.hubAt !== C.version) {
        site.hubAt = C.version
        site.hub = []
        for (let n = 0; n < C.count; n++) if (C.hubOf[n] === site.colony.index) site.hub.push(n)
      }
      if (!site.hub.length) continue
      const p = site.pocket
      const room = Math.max(0, 1 - p.matter / (K.room * site.demand))
      const take = (1 - Math.exp(-K.absorb * dt)) * room
      for (const [id, g] of this.inTissue) {
        let got = 0
        for (const n of site.hub) {
          const a = g[n] * take
          g[n] -= a
          got += a
        }
        if (got > 0) {
          p.bySource.set(id, (p.bySource.get(id) ?? 0) + got)
          p.matter += got
        }
      }
      // A pocket holding enough to form from, since when (the rest rule).
      if (p.matter >= LIFECYCLE.start) {
        if (p.heldSince === null) {
          p.heldSince = this.t
          this.event('arrive', { colony: site.colony.index, matter: +p.matter.toFixed(4), on: this.pocketSources(site) })
        }
      } else if (p.matter < LIFECYCLE.start * 0.8) p.heldSince = null
    }

    // Use: a path thickens with what passes along it, and thins back toward
    // a dormant floor when nothing does.
    const U = K.use
    for (let e = 0; e < E; e++) {
      C.g[e] = Math.min(U.cap, Math.max(U.floor, C.g[e] + dt * (U.gain * Math.abs(this.flow[e]) - U.decay * (C.g[e] - U.floor))))
    }

    // The tissue's total per node.
    this.tissue.fill(0, 0, C.count)
    for (const g of this.inTissue.values()) for (let n = 0; n < C.count; n++) this.tissue[n] += g[n]

    if (this.foldStudy && !this.fold && this.t >= this.nextFoldLook - 1e-9) {
      this.nextFoldLook += 2
      this.chooseFold()
    }
  }

  /**
   * The fold study (display only): one stretch of tissue into a colony other
   * than this one, chosen once it has carried enough to last, and kept for
   * the session. From the hub node most matter has passed through, outward
   * along the nodes most has passed through, up to `fold.length` units.
   * Reads the simulation; changes nothing in it.
   */
  chooseFold() {
    const C = this.conduit
    const F = CONDUIT.fold
    for (const site of this.sites) {
      if (site.colony.index === this.colony.index || !site.hub?.length) continue
      let start = site.hub[0]
      for (const n of site.hub) if (this.passed[n] > this.passed[start]) start = n
      const nodes = [start]
      const edges = []
      const seen = new Set(nodes)
      let length = 0
      let n = start
      while (length < F.length) {
        let next = -1
        let along = -1
        for (const e of C.at[n]) {
          const o = C.a[e] === n ? C.b[e] : C.a[e]
          if (!seen.has(o) && (next < 0 || this.passed[o] > this.passed[next])) {
            next = o
            along = e
          }
        }
        if (next < 0) break
        nodes.push(next)
        edges.push(along)
        seen.add(next)
        length += C.len[along]
        n = next
      }
      if (length < F.least) continue
      let g = 0
      for (const e of edges) g += C.g[e]
      if (g / edges.length < F.thick) continue
      this.fold = { colony: site.colony.index, nodes, edges, at: this.t, length }
      return
    }
  }

  /** What a colony's pocket holds, by where it came from. */
  pocketSources(site) {
    const out = {}
    for (const [id, q] of site.pocket.bySource) if (q > 1e-4) out[`#${id}`] = +q.toFixed(4)
    return out
  }

  /** The ground as drawn (History's, which is what the terrain shows). */
  groundAt(x, z) {
    const [u, v] = this.world.toUV(x, z)
    return this.world.groundY(u, v)
  }

  /** The residual at (u, v), bilinear. */
  residualAt(u, v) {
    const { res, residual } = this
    const x = clamp01(u) * res - 0.5
    const y = clamp01(v) * res - 0.5
    const i0 = Math.max(0, Math.min(res - 1, Math.floor(x)))
    const j0 = Math.max(0, Math.min(res - 1, Math.floor(y)))
    const i1 = Math.min(res - 1, i0 + 1)
    const j1 = Math.min(res - 1, j0 + 1)
    const fx = clamp01(x - i0)
    const fy = clamp01(y - j0)
    return (
      residual[j0 * res + i0] * (1 - fx) * (1 - fy) +
      residual[j0 * res + i1] * fx * (1 - fy) +
      residual[j1 * res + i0] * (1 - fx) * fy +
      residual[j1 * res + i1] * fx * fy
    )
  }

  /** The record's trace channel with the residual added (worldData.js: S / SED_DISPLAY). */
  liveTrace(u, v, trace) {
    return clamp01(trace + this.residualAt(u, v) / SED_DISPLAY)
  }

  clear(x, z, r) {
    const a = this.claims
    for (let k = 0; k < a.length; k += 3) {
      const dx = a[k] - x
      const dz = a[k + 1] - z
      const rr = a[k + 2] + r
      if (dx * dx + dz * dz < rr * rr) return false
    }
    // Room among the residents standing now (old contours may be grown over).
    for (const o of this.residents) {
      if (o.stage === 'ended') continue
      const rr = 0.35 + 0.3 * o.desc.height + r
      if (Math.hypot(o.desc.p[0] - x, o.desc.p[2] - z) < rr) return false
    }
    return true
  }

  /* --- where a resident can form ------------------------------------------ */

  /**
   * Look over the patch for a place where a resident can form. It needs:
   *   - residue: at least `start` within its footprint
   *   - time: nothing new has arrived there for `rest` seconds, so a deposit
   *     always lies a while before anything rises from it
   *   - ground the membrane rules accept, reading the record as it is now
   *   - room among the residents standing there, and none forming already
   * The best place has the most matter on the deposit's edge; the resident
   * rises there and leans out from the deposit. If nothing qualifies,
   * nothing forms.
   */
  lookForPlace() {
    // A summed-area table of the residual, so a place that cannot hold
    // enough is passed over before its matter is weighed (the same choice,
    // sooner).
    const res = this.res
    const T = this.sat
    for (let j = 0; j < res; j++) {
      let row = 0
      for (let i = 0; i < res; i++) {
        row += this.residual[j * res + i]
        T[(j + 1) * (res + 1) + i + 1] = T[j * (res + 1) + i + 1] + row
      }
    }
    for (const site of this.sites) this.lookAt(site)
  }

  /** All the residual in the cells within r of (x, z) (a box around it): never less than matterAt. */
  matterBound(x, z, r) {
    const res = this.res
    const T = this.sat
    const [ci, cj] = this.cellOf(x, z)
    const k = Math.ceil(r / this.cell) + 1
    const i0 = Math.max(0, Math.floor(ci) - k)
    const i1 = Math.min(res - 1, Math.ceil(ci) + k)
    const j0 = Math.max(0, Math.floor(cj) - k)
    const j1 = Math.min(res - 1, Math.ceil(cj) + k)
    const W = res + 1
    return T[(j1 + 1) * W + i1 + 1] - T[j0 * W + i1 + 1] - T[(j1 + 1) * W + i0] + T[j0 * W + i0]
  }

  /** Look for a place in one of the lifecycle's colonies. */
  lookAt(site) {
    const L = LIFECYCLE
    const c = site.colony
    const standing = this.residents.filter((r) => r.stage !== 'ended' && (r.desc.colony ?? 0) === c.index)
    if (standing.length >= L.most || standing.some((r) => r.stage === 'forming')) return
    // Nothing to find if all the matter within reach (and a footprint
    // beyond), with the colony's pocket, is less than a resident needs to
    // start: no place there can hold enough.
    {
      const span = c.radius + L.margin + L.footprint
      const [ci, cj] = this.cellOf(c.x, c.z)
      const k = Math.ceil(span / this.cell) + 1
      let near = site.pocket.matter
      for (let j = Math.max(0, Math.floor(cj) - k); j <= Math.min(this.res - 1, Math.ceil(cj) + k) && near < L.start; j++) {
        for (let i = Math.max(0, Math.floor(ci) - k); i <= Math.min(this.res - 1, Math.ceil(ci) + k); i++) near += this.residual[j * this.res + i]
      }
      if (near < L.start) return
    }
    const world = this.world
    const reach = c.radius + L.margin
    const d = {}
    let best = null
    let waiting = null
    for (let z = c.z - reach; z <= c.z + reach + 1e-9; z += L.search) {
      for (let x = c.x - reach; x <= c.x + reach + 1e-9; x += L.search) {
        if (Math.hypot(x - c.x, z - c.z) > reach) continue
        // Each colony looks only on its own ground: nearer it than any other.
        if (this.sites.length > 1 && this.sites.some((o) => o !== site && Math.hypot(x - o.colony.x, z - o.colony.z) < Math.hypot(x - c.x, z - c.z))) continue
        if (this.matterBound(x, z, L.footprint) + site.pocket.matter < L.start) continue
        // What lies here: residue, and (with the shared conduit) what the
        // colony's hub has drawn from the tissue.
        const fromPocket = this.pocketAt(site, x, z)
        const m = this.matterAt(x, z) + fromPocket
        if (m < L.start) continue
        const [u, v] = world.toUV(x, z)
        if (u < 0.02 || u > 0.98 || v < 0.02 || v > 0.98) continue
        world.sample(u, v, d)
        d.trace = this.liveTrace(u, v, d.trace)
        const suit = bloomFits(d, this.protocol)
        if (suit < 0.2 || !this.clear(x, z, 0.3)) continue
        let latest = -1e9
        this.footprint(x, z, L.footprint, (cell) => (latest = Math.max(latest, this.arrived[cell])))
        // A pocket has lain since it came to hold enough to form from.
        if (fromPocket > 1e-6) latest = Math.max(latest, site.pocket.heldSince ?? this.t)
        if (this.t - latest < L.rest) {
          if (!waiting || m > waiting.m) waiting = { x, z, m, since: latest }
          continue
        }
        // The deposit's edge: where its matter falls away, and which way.
        const g = this.gradient(x, z)
        const edge = smoothstep(0.15, 0.6, (Math.hypot(g[0], g[1]) * L.footprint) / Math.max(m, 1e-6))
        const score = suit * m * (0.35 + 0.65 * edge)
        if (!best || score > best.score) best = { x, z, m, suit, edge, g, score, fromPocket }
      }
    }
    if (best) this.form(best, site)
    else if (waiting && (site.lastWait === undefined || this.t - site.lastWait > 10)) {
      site.lastWait = this.t
      this.event('wait', { at: [+waiting.x.toFixed(2), +waiting.z.toFixed(2)], matter: +waiting.m.toFixed(3), lain: +(this.t - waiting.since).toFixed(1) })
    }
  }

  /** The residual's gradient at (x, z), from its footprint-weighted matter. */
  gradient(x, z) {
    const e = 0.3
    return [(this.matterAt(x + e, z) - this.matterAt(x - e, z)) / (2 * e), (this.matterAt(x, z + e) - this.matterAt(x, z - e)) / (2 * e)]
  }

  /**
   * A new resident at a place on a deposit's edge. Its height, crests and
   * openness follow placement's own veil rules (scatter.js). Its lean is
   * the deposit's: out from where the matter lies thickest (down the
   * residual's gradient), turned a little toward the colony's lean. It needs
   * matter for its height, and takes it up as it forms.
   */
  form(site, home = this.sites[0]) {
    const c = home.colony
    const lean = home.lean
    const world = this.world
    const d = {}
    world.sample(...world.toUV(site.x, site.z), d)
    const gl = Math.hypot(site.g[0], site.g[1])
    const out = gl > 1e-6 ? [-site.g[0] / gl, -site.g[1] / gl] : lean
    const lx = out[0] * 0.75 + lean[0] * 0.25
    const lz = out[1] * 0.75 + lean[1] * 0.25
    const rc = Math.hypot(site.x - c.x, site.z - c.z)
    const H = home.anchor?.height ?? 2.5
    const h = Math.max(0.6, H * lerp(0.48, 0.2, Math.min(1, rc / c.radius)) * (0.9 + 0.2 * this.random()))
    const two = h > 0.42 * H && c.maturity > 0.75
    const cellIndex = Math.floor((site.x / world.size + 0.5) * this.res) + this.res * Math.floor((site.z / world.size + 0.5) * this.res)
    const desc = {
      ...(this.first[0] ?? {}),
      role: 'secondary',
      colony: c.index,
      p: [site.x, this.groundAt(site.x, site.z), site.z],
      lean: Math.atan2(lz, lx),
      height: h,
      crests: two ? 2 : 1,
      width: h * (two ? 1.4 : 0.85),
      openness: 0.25 + 0.75 * smoothstep(-0.1, this.protocol.bloomReach, d.shore),
      glow: Math.pow(d.flow, 1.5) * 0.7,
      maturity: c.maturity * (1 - 0.4 * Math.min(1, rc / c.radius)),
      ribs: 0,
      birth: 0,
      seed: (this.seed * 31 + cellIndex * 7919 + this.nextId * 104729) % 1000003,
    }
    const r = this.makeResident(desc, { stage: 'forming', body: 0, need: LIFECYCLE.bodyPerHeight * h, unfold: 0, origin: 'formed' })
    this.residents.push(r)
    this.event('form', {
      resident: r.id,
      at: [+site.x.toFixed(3), +site.z.toFixed(3)],
      matter: +site.m.toFixed(4),
      edge: +site.edge.toFixed(2),
      lean: +((desc.lean * 180) / Math.PI).toFixed(0),
      height: +h.toFixed(3),
      need: +r.need.toFixed(3),
      on: this.provenance(site.x, site.z),
      ...(site.fromPocket > 1e-6 ? { colony: c.index, viaTissue: this.share(home, site.fromPocket) } : {}),
    })
  }

  /** A part of a colony's pocket, by where it came from. */
  share(site, amount) {
    const out = {}
    const p = site.pocket
    for (const [id, q] of p.bySource) if (q > 1e-6) out[`#${id}`] = +((q * amount) / p.matter).toFixed(4)
    return out
  }

  /* --- the ledger -------------------------------------------------------- */

  /** Where all the matter is. Its total stays what it began as. */
  ledger() {
    let bodies = 0
    let contours = 0
    for (const r of this.residents) {
      bodies += r.body
      contours += r.contour
    }
    let flight = 0
    for (const f of this.films) if (f.state === 'flight') flight += f.matter
    let residual = 0
    for (const v of this.residual) residual += v
    const out = this.lost + this.unrecorded
    if (!this.conduit) return { bodies, flight, residual, contours, out, total: bodies + flight + residual + contours + out }
    // With the shared conduit: in the tissue, and in the colonies' pockets.
    let tissue = 0
    for (const g of this.inTissue.values()) for (let n = 0; n < this.conduit.count; n++) tissue += g[n]
    let pockets = 0
    for (const site of this.sites) pockets += site.pocket.matter
    const structure = this.structure
    return { bodies, flight, residual, contours, tissue, structure, pockets, out, total: bodies + flight + residual + contours + tissue + structure + pockets + out }
  }

  /* --- for the inspector ------------------------------------------------- */

  status() {
    const films = { flight: 0, settled: 0, lost: 0 }
    for (const f of this.films) films[f.state]++
    return {
      t: this.t,
      feedback: this.feedback,
      paused: this.paused,
      speed: this.speed,
      warm: this.warm,
      residents: this.residents.map((r) => ({
        id: r.id,
        stage: r.stage,
        origin: r.origin,
        body: r.body,
        contour: r.contour,
        unfold: r.unfold,
        at: [r.desc.p[0], r.desc.p[2]],
      })),
      films,
      ledger: this.ledger(),
      initial: this.initial,
      events: this.log.filter((e) => e.kind !== 'stage').slice(-5),
      ...(this.conduit
        ? {
            pockets: this.sites.map((s) => ({ colony: s.colony.index, matter: s.pocket.matter, demand: s.demand, ready: s.pocket.heldSince !== null })),
            tissue: {
              nodes: this.conduit.count,
              growing: this.conduit.tips.filter((t) => t.state === 'growing').length,
              dormant: this.conduit.tips.filter((t) => t.state === 'dormant').length,
              fusions: this.fusions,
            },
          }
        : {}),
    }
  }
}
