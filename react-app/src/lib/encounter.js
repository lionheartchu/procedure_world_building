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
  constructor({ positions, foot, height }) {
    this.proxy = formProxy(positions)
    this.foot = foot
    this.height = height
    this.max = clamp(ENCOUNTER.depth * height, ENCOUNTER.least, ENCOUNTER.most)
    this.footSpan = ENCOUNTER.foot * height
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
    return ENCOUNTER.radius + ENCOUNTER.spread * Math.max(0, this.depth)
  }

  /** How much of the dent reaches the sheet's point (x, y, z), as built: 1 at its centre. (The shader's ENCOUNTER block is the same.) */
  weightAt(x, y, z) {
    const R = this.radius
    const d2 = (x - this.at[0]) ** 2 + (y - this.at[1]) ** 2 + (z - this.at[2]) ** 2
    const lean = ENCOUNTER.bend * smoothstep(this.foot, this.foot + this.height, y)
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
    const E = ENCOUNTER
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
    if (gap < 0) {
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
    const E = ENCOUNTER
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
