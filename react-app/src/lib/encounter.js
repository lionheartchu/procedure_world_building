import { formProxy, PRESENCE } from './presence'

/**
 * The encounter — one membrane that yields to the visitor (the Habitat,
 * docs/12-habitat-v0.md). Not soft-body physics: one dent, a damped spring,
 * coupled to the presence through a contact constraint.
 *
 *   - Where: the dent is centred where the visitor meets the sheet (the
 *     nearest point of its surface, as built), and slides after them, a
 *     little late, as they move along it.
 *   - How far: the sheet gives way as the visitor presses in. It yields
 *     easily at first and stiffens as it deepens, up to `max`, where it
 *     stops them like any other form. Faster approaches carry more of their
 *     speed into it, so they press deeper and it springs back further.
 *   - Which way: it is pushed away from the side the visitor comes from; a
 *     sideways drift drags the dent along with it (shear).
 *   - The whole sheet leans back with it, more toward its top (`bend`).
 *   - After: it springs back, a little past rest and back (the visitor is
 *     nudged as it does), and settles in about two seconds.
 *
 * Visible and felt agree by construction. The same weight that shapes the
 * dent on screen (`weightAt`, mirrored in the form vertex shader's ENCOUNTER
 * block) sets how close the visitor may come at the point they touch: never
 * nearer the displaced surface than their body (PRESENCE.reach).
 *
 * The membrane reads only the visitor. It changes no placement, lifecycle
 * stage or matter, and nothing in the world reads it.
 */

export const ENCOUNTER = {
  /** Deepest dent, as a share of the membrane's height, within [least, most] units. */
  depth: 0.32,
  least: 0.12,
  most: 0.26,
  /** The dent's radius: at rest, and how much wider it grows per unit of depth. */
  radius: 0.16,
  spread: 0.9,
  /** Its foot is held: the dent fades out below this share of the height. */
  foot: 0.3,
  /**
   * The sheet leans with the dent: above its foot, the whole membrane moves
   * this share of the dent, more toward its top, so a press bends it back
   * as a reed is bent, and its outline moves, not only its surface.
   */
  bend: 0.55,
  /** The spring: natural frequency (Hz) and damping ratio. Springs back past rest once, then settles. */
  hz: 0.6,
  damping: 0.32,
  /** How readily it yields at first (share of a press taken by the sheet, not the visitor). */
  give: 0.85,
  /** Inside this distance (beyond the body) a visitor's approach is eased (per second), softer than a fixed form. */
  cushion: 0.55,
  ease: 1.2,
  /** How long the dent's centre takes to follow a visitor along the sheet (s). */
  follow: 0.12,
  /** Shear: how far a sideways drift drags the dent, per unit of speed, at full depth (and at most). */
  shear: 0.35,
  shearMost: 0.08,
  /** How far past rest it may spring back, as a share of the deepest dent. */
  rebound: 0.35,
  /** The share of the dent at the touch the visitor may follow into (see meet). */
  held: 0.8,
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
const ease = (dt, tau) => 1 - Math.exp(-dt / tau)

export class Membrane {
  /**
   * @param positions  the membrane's surfaces as built (world-space vertex arrays)
   * @param foot       the height of its foot (y)
   * @param height     its height (units)
   */
  constructor({ positions, foot, height, size = 26, E = ENCOUNTER }) {
    /** Its response (ENCOUNTER; a resident's own, M3E). */
    this.E = E
    this.proxy = formProxy(positions, { size })
    this.foot = foot
    this.height = height
    this.max = clamp(E.depth * height, E.least, E.most)
    this.footSpan = E.foot * height
    /** The dent: depth at its centre (positive away from the visitor), and its rate. */
    this.depth = 0
    this.rate = 0
    /** Its centre on the sheet, the direction it is pushed from (unit), and its shear. */
    this.at = [0, 0, 0]
    this.from = [0, 0, 1]
    this.shear = [0, 0, 0]
    this.touching = false
    /** For the display and checks: the last approach speed into the sheet, and the visitor's distance. */
    this.approach = 0
    this.distance = Infinity
    this.hit = {}
  }

  /** The dent's radius now. */
  get radius() {
    return this.E.radius + this.E.spread * Math.max(0, this.depth)
  }

  /** How much of the dent reaches the sheet's point (x, y, z), as built: 1 at its centre. (The shader's ENCOUNTER block is the same.) */
  weightAt(x, y, z) {
    const R = this.radius
    const d2 = (x - this.at[0]) ** 2 + (y - this.at[1]) ** 2 + (z - this.at[2]) ** 2
    const lean = this.E.bend * smoothstep(this.foot, this.foot + this.height, y)
    return Math.min(1, Math.exp(-d2 / (R * R)) + lean) * smoothstep(this.foot, this.foot + this.footSpan, y)
  }

  /** The displacement of the dent's centre (the shader's uDent): away from the visitor, plus shear. */
  get displacement() {
    const d = this.depth
    return [-this.from[0] * d + this.shear[0], -this.from[1] * d + this.shear[1], -this.from[2] * d + this.shear[2]]
  }

  /**
   * The visitor meets the sheet. `p` is where the presence would move this
   * step and `v` its velocity (both changed in place): the sheet takes part
   * of a press into it as its own movement and returns the rest. Returns
   * whether it is near enough to matter.
   */
  meet(p, v, dt) {
    const E = this.E
    const reach = PRESENCE.reach
    const h = this.proxy.nearest(p[0], p[1], p[2], reach + E.cushion + this.max, this.hit)
    if (!h) {
      this.touching = false
      this.distance = Infinity
      return false
    }
    const n = [h.nx, h.ny, h.nz]
    const s = [p[0] - n[0] * h.d, p[1] - n[1] * h.d, p[2] - n[2] * h.d]
    if (!this.touching && Math.abs(this.depth) < 0.02 * this.max && Math.abs(this.rate) < 0.05) {
      // A fresh touch: the dent begins where it is met, pushed from this side.
      this.at = s
      this.from = n
    } else {
      const k = ease(dt, E.follow)
      for (let i = 0; i < 3; i++) {
        this.at[i] += (s[i] - this.at[i]) * k
        this.from[i] += (n[i] - this.from[i]) * k
      }
      const len = Math.hypot(...this.from) || 1
      this.from = this.from.map((c) => c / len)
    }

    // How close the visitor may come here: its body, less the dent at this
    // point. (Held a little short of it: the dent's centre trails the touch,
    // so the sheet beside this point can have given way less.)
    const w = this.weightAt(...s) * E.held
    const dentHere = this.depth * w
    let allowed = reach - dentHere
    const into = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2])
    this.approach = into
    const stiff = (Math.max(0, this.depth) / this.max) ** 2

    // Approaching: eased (a rate per second, so it slows the visitor without
    // ever holding them off), more as the sheet deepens toward its limit.
    if (into > 0) {
      const rate = E.ease * (1 + 4 * stiff) * smoothstep(allowed + E.cushion, allowed, h.d)
      const s0 = 1 - Math.exp(-rate * dt)
      for (let i = 0; i < 3; i++) v[i] += n[i] * into * s0
    }

    // Pressing in: the sheet takes its share of the press as depth (and of
    // the speed as its own movement), the visitor is held at the rest.
    const gap = h.d - allowed
    if (gap < 0 && E.pressOnly && into <= 0.02) {
      // (M3E's residents: not pressed, the sheet's own return moves the
      // visitor out; a still visitor no longer holds it deep.)
      for (let i = 0; i < 3; i++) p[i] += n[i] * -gap
    } else if (gap < 0) {
      const press = -gap
      const give = E.give * (1 - stiff)
      const wEff = Math.max(w, 0.35)
      const take = Math.min((press * give) / wEff, this.max - this.depth)
      this.depth += Math.max(0, take)
      allowed = reach - this.depth * w
      const back = Math.max(0, allowed - h.d)
      for (let i = 0; i < 3; i++) p[i] += n[i] * back
      const intoNow = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2])
      if (intoNow > 0) {
        this.rate = Math.max(this.rate, (intoNow * give) / wEff)
        for (let i = 0; i < 3; i++) v[i] += n[i] * intoNow * (1 - give)
      }
    }

    // Shear: a drift along the sheet drags the dent with it, as far as it is deep.
    const along = [0, 1, 2].map((i) => v[i] + n[i] * -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]))
    const share = E.shear * (Math.max(0, this.depth) / this.max)
    let target = along.map((c) => c * share)
    const tl = Math.hypot(...target)
    if (tl > E.shearMost) target = target.map((c) => (c * E.shearMost) / tl)
    const ks = ease(dt, 0.3)
    for (let i = 0; i < 3; i++) this.shear[i] += (target[i] - this.shear[i]) * ks

    this.distance = h.d
    this.touching = h.d < allowed + 0.04
    return true
  }

  /** The sheet's own movement, once per frame: it springs back toward rest. */
  update(dt) {
    const E = this.E
    const w = 2 * Math.PI * E.hz
    // Two half steps keep the spring steady at long frames.
    const h = Math.min(dt, 0.05) / 2
    for (let k = 0; k < 2; k++) {
      this.rate += (-w * w * this.depth - 2 * E.damping * w * this.rate) * h
      this.depth += this.rate * h
    }
    const low = -E.rebound * this.max
    if (this.depth > this.max) {
      this.depth = this.max
      this.rate = Math.min(this.rate, 0)
    } else if (this.depth < low) {
      this.depth = low
      this.rate = Math.max(this.rate, 0)
    }
    if (!this.touching) {
      const k = ease(dt, 0.5)
      for (let i = 0; i < 3; i++) this.shear[i] -= this.shear[i] * k
    }
  }
}

/**
 * M3E (docs/22-habitat-m3e.md): the encounter with a lifecycle resident.
 * Not one placed veil but whichever standing resident (forming, holding or
 * receding) the visitor comes near, one at a time, met as the Membrane
 * above is met: one dent on a spring, the visitor held at the displaced
 * surface. Two things are its own:
 *
 *   - its surface is the resident as drawn now (its growth and posture,
 *     LifecycleLayer `poseFilm`), rebuilt as it changes, and met where its
 *     air has bent it; so what stops the visitor is what they see
 *   - how it yields is its state: its tension, from the matter its body
 *     holds against a full body for its height, as far as its stage keeps it
 *     (forming, still taking up; holding, all of it; receding, less as it
 *     lies down). Slack, it takes a press deep and slowly, and comes back
 *     without springing past rest; taut, it gives little and quickly, and
 *     springs back once
 *
 * It reads the resident and the visitor, and writes nothing the lifecycle
 * reads: no stage, matter, timing or film changes with it.
 */
export const RESIDENT = {
  /** A standing resident within this distance of the visitor (units, from near its foot) is the one met. */
  near: 1.6,
  /** The stages in which a resident stands to be met. */
  stages: ['forming', 'holding', 'receding'],
  /** The response, slack (tension 0) to taut (1); the rest is ENCOUNTER's. */
  /** It yields only while pressed; when the visitor stops, its return moves them out (Membrane `meet`). */
  pressOnly: true,
  /**
   * The response, slack to taut; the rest is ENCOUNTER's. Slack: a press goes
   * deep and the sheet bends with it as a whole, and comes back slowly
   * without passing rest. Taut: it gives little, quickly, and springs back
   * once. Either way the visitor walks up to it (a short cushion, not the
   * placed veil's long one) and can press it.
   */
  slack: { depth: 0.6, hz: 0.24, damping: 1.0, give: 0.98, rebound: 0.0, bend: 1.0, shear: 0.5, cushion: 0.2, ease: 0.3, held: 0.9, least: 0.08, most: 0.36 },
  taut: { depth: 0.3, hz: 0.95, damping: 0.32, give: 0.82, rebound: 0.35, bend: 0.6, shear: 0.25, cushion: 0.2, ease: 0.3, held: 0.9, least: 0.08, most: 0.36 },
  /** The tensions that count as slack and as taut (a resident's matter rarely leaves this range). */
  range: [0.3, 0.85],
}

/** A resident's tension (0 slack .. 1 taut): its matter against a full body, as far as its stage holds it. */
export function tensionOf(r, bodyPerHeight, lies) {
  const fill = clamp(r.body / (bodyPerHeight * r.desc.height), 0, 1)
  const stage = r.stage === 'forming' ? 0.55 : r.stage === 'holding' ? 1 : r.stage === 'receding' ? 1 - clamp(r.recline / lies, 0, 1) : 0
  return fill * stage
}

export class ResidentEncounter extends Membrane {
  constructor({ world }) {
    super({ positions: [], foot: 0, height: 1, size: world.size })
    this.size = world.size
    /** The resident met now, and its tension. */
    this.resident = null
    this.tension = 0
    /** Its air's bend (the form shader's uWind: displacement at its crest, and its height), and its foot. */
    this.wind = [0, 0, 0, 1]
    this.base = [0, 0, 0]
    /** Whether the resident's surface has been given since it was chosen. */
    this.ready = false
  }

  /** Its response for a tension (0..1). */
  respond(tension) {
    this.tension = tension
    const k = smoothstep(RESIDENT.range[0], RESIDENT.range[1], tension)
    const E = { ...ENCOUNTER, pressOnly: RESIDENT.pressOnly }
    for (const key in RESIDENT.slack) E[key] = RESIDENT.slack[key] + (RESIDENT.taut[key] - RESIDENT.slack[key]) * k
    this.E = E
    this.max = clamp(E.depth * this.height, E.least, E.most)
    this.footSpan = E.foot * this.height
  }

  /** At rest: a new resident may be chosen. */
  get resting() {
    return !this.touching && Math.abs(this.depth) < 0.01 && Math.abs(this.rate) < 0.05
  }

  /**
   * Which resident is met, from where the visitor is (p): the nearest
   * standing one within reach; another only once the last has come to rest.
   */
  choose(p, lifecycles) {
    let best = null
    let bestD = RESIDENT.near
    for (const life of lifecycles) {
      for (const r of life.residents) {
        if (!RESIDENT.stages.includes(r.stage) || r.desc.height * r.unfold < 0.08) continue
        const x = r.desc.p[0] + Math.cos(r.desc.lean) * 0.2
        const z = r.desc.p[2] + Math.sin(r.desc.lean) * 0.2
        const d = Math.hypot(p[0] - x, p[2] - z)
        if (d < bestD) {
          bestD = d
          best = r
        }
      }
    }
    // The one met stays met while it stands and the visitor is near it.
    const current = this.resident
    if (current && RESIDENT.stages.includes(current.stage) && Math.hypot(p[0] - current.desc.p[0], p[2] - current.desc.p[2]) < RESIDENT.near + 0.4) return
    if (best === current || !this.resting) return
    this.resident = best
    this.ready = false
    this.depth = 0
    this.rate = 0
    this.shear = [0, 0, 0]
    this.proxy = formProxy([], { size: this.size })
  }

  /** The chosen resident's film as drawn now, before its air (world positions), its foot and its height. */
  surface(r, positions, foot, height) {
    if (r !== this.resident) return
    this.proxy = formProxy([positions], { size: this.size })
    this.foot = foot
    this.height = Math.max(height, 0.05)
    this.base = r.desc.p
    this.ready = true
    this.respond(this.tension)
  }

  /** The air bends the drawn sheet (the shader's WIND): met there. */
  windAt(y) {
    const hb = clamp((y - this.base[1]) / Math.max(this.wind[3], 0.05), 0, 1.4)
    return [this.wind[0] * hb * hb, this.wind[2] * hb * hb]
  }

  meet(p, v, dt) {
    if (!this.resident || !this.ready) {
      this.touching = false
      this.distance = Infinity
      return false
    }
    const [wx, wz] = this.windAt(p[1])
    const q = [p[0] - wx, p[1], p[2] - wz]
    const near = super.meet(q, v, dt)
    p[0] = q[0] + wx
    p[1] = q[1]
    p[2] = q[2] + wz
    return near
  }
}

