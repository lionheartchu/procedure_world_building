/**
 * M3C (docs/26-colony-motion.md): the colony's tendrils as quiet sensory
 * appendages. Their own drift and an occasional tremble at the tip are the
 * form shader's (TENDRIL), each on its own clock, so no two move together.
 * This is what happens when a stranger comes within reach of a tip:
 *
 *   - after a pause of its own (some at once, some after a second or so),
 *     it registers them: it falls still, and its outer part lifts and turns
 *     a little toward them (the lift is what reads from where they stand:
 *     turning toward them alone moves the tip along their line of sight)
 *   - it makes one or two small reaches along its tip, or none
 *   - after a few seconds it lets go and returns to its own drift, even if
 *     the stranger stays; it registers them again only once they have been
 *     out of its reach for a while
 *   - the bead hanging from it lags behind its tip, and swings a little
 *     before it settles
 *
 * Only the few tips nearest the visitor take part (the shader has eight
 * places for them). Presentation only, on the visitor's clock: it reads the
 * visitor and the tendrils' geometry, and nothing in the world reads it.
 */
export const TENDRIL = {
  /** A tip registers a stranger within this distance of the visitor's eye (units). */
  reach: 3.4,
  /** Its pause before it registers (s), by its own seed, and a little more the further it is. */
  latency: [0.15, 1.5],
  further: 0.5,
  /** How quickly it falls still, and lets go again (s). */
  still: 0.5,
  loosen: 1.4,
  /** How far its tip turns toward the stranger (units; a third of its length, within these), and how quickly (s). */
  turn: [0.12, 0.26],
  turnTime: 1.1,
  /** Its reaches: how many (0..2, by its seed), how far (units), each how long and the pause after (s). */
  reaches: 2,
  reachSize: [0.04, 0.08],
  reachTime: 0.8,
  reachGap: 0.7,
  /** How long it attends before it returns to its own drift (s, by its seed), and the time out of reach before it registers again. */
  attend: [3.2, 6],
  rearm: 2.5,
  /** Its bead's lag: natural frequency (Hz) and damping. */
  lag: { hz: 1.3, damping: 0.22, most: 0.08 },
  /** Places in the shader. */
  slots: 8,
}

/**
 * M3S (docs/27-sheath-and-passage.md): the same attention, without the
 * study's alarmed periscope. Its tip lifts a quarter as far, and instead
 * draws in a little toward the inside of its own arc (its crook deepening,
 * its bulb drawn under), as it leans toward the stranger.
 */
export const TENDRIL_SOFT = { lift: 0.2, draw: 0.55 }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const mix = (a, b, k) => a + (b - a) * k
const ease = (dt, tau) => 1 - Math.exp(-dt / Math.max(tau, 1e-3))

export class Tendrils {
  /** `list`: the tendrils as built (traceForms `userData.tendrils`: id, root, tip, dir, len, seed). */
  /** `lift`: how far its tip lifts as it registers a stranger, `draw`: how far it draws in (shares of its turn). */
  constructor(list, { lift = 0.8, draw = 0 } = {}) {
    this.list = list ?? []
    this.lift = lift
    this.draw = draw
    /** tendril id → its response now */
    this.states = new Map()
    this.time = 0
  }

  /** One frame: `eye` the visitor's eye, `dt` on their clock (s). */
  update(eye, dt) {
    const T = TENDRIL
    this.time += dt
    const now = this.time
    for (const td of this.list) {
      const d = Math.hypot(td.tip[0] - eye[0], td.tip[1] - eye[1], td.tip[2] - eye[2])
      const inside = d < T.reach
      let s = this.states.get(td.id)
      if (!s) {
        if (!inside) continue
        const k = td.seed
        s = {
          td,
          phase: 'wait',
          at: now + mix(T.latency[0], T.latency[1], (k * 7.31) % 1) + T.further * (d / T.reach),
          attend: mix(T.attend[0], T.attend[1], (k * 3.17) % 1),
          reaches: Math.floor(((k * 5.03) % 1) * (T.reaches + 1)),
          reachSize: mix(T.reachSize[0], T.reachSize[1], (k * 11.3) % 1),
          still: 0,
          turn: [0, 0, 0],
          reach: 0,
          lag: [0, 0, 0],
          lagV: [0, 0, 0],
          prevOff: null,
          prevV: [0, 0, 0],
          out: 0,
          d,
        }
        this.states.set(td.id, s)
      }
      s.d = d
      s.out = inside ? 0 : s.out + dt

      // What it does now.
      let stillTo = 0
      let turnTo = [0, 0, 0]
      let reach = 0
      if (s.phase === 'wait') {
        if (!inside) {
          this.states.delete(td.id)
          continue
        }
        if (now >= s.at) {
          s.phase = 'attend'
          s.since = now
        }
      }
      if (s.phase === 'attend') {
        if (!inside || now - s.since > s.attend) s.phase = 'loosen'
        else {
          stillTo = 1
          const size = clamp(0.3 * td.len, T.turn[0], T.turn[1])
          const v = [eye[0] - td.tip[0], eye[1] - td.tip[1], eye[2] - td.tip[2]]
          const l = Math.hypot(...v) || 1
          const lift = size * this.lift
          const draw = td.inward ? size * this.draw : 0
          const inn = td.inward ?? [0, 0, 0]
          turnTo = [(v[0] / l) * size * 0.6 + inn[0] * draw, (v[1] / l) * size * 0.35 + lift + inn[1] * draw, (v[2] / l) * size * 0.6 + inn[2] * draw]
          // Its reaches, once it has turned: a slow push out along its tip and back.
          const into = now - s.since - T.turnTime
          const period = T.reachTime + T.reachGap
          if (into > 0 && into < s.reaches * period) {
            const q = (into % period) / T.reachTime
            reach = q < 1 ? s.reachSize * Math.sin(Math.PI * q) ** 2 : 0
          }
        }
      }
      if (s.phase === 'loosen') {
        // Back to its own drift; once settled, it waits for the stranger to have gone.
        if (Math.hypot(...s.turn) < 0.002 && s.still < 0.02) s.phase = 'done'
      }
      if (s.phase === 'done' && s.out > T.rearm && Math.hypot(...s.lag) < 0.002) {
        this.states.delete(td.id)
        continue
      }

      s.still += (stillTo - s.still) * ease(dt, stillTo > s.still ? T.still : T.loosen)
      const kt = ease(dt, s.phase === 'attend' ? T.turnTime / 2.5 : T.loosen)
      for (let i = 0; i < 3; i++) s.turn[i] += (turnTo[i] - s.turn[i]) * kt
      s.reach = reach

      // Its bead lags behind what its tip does, as a pendulum.
      const off = [s.turn[0] + td.dir[0] * reach, s.turn[1] + td.dir[1] * reach, s.turn[2] + td.dir[2] * reach]
      if (dt > 0) {
        const v = s.prevOff ? off.map((c, i) => (c - s.prevOff[i]) / dt) : [0, 0, 0]
        const a = v.map((c, i) => (c - s.prevV[i]) / dt)
        const w = 2 * Math.PI * T.lag.hz
        for (let i = 0; i < 3; i++) {
          s.lagV[i] += (-w * w * s.lag[i] - 2 * T.lag.damping * w * s.lagV[i] - clamp(a[i], -4, 4)) * dt
          s.lag[i] = clamp(s.lag[i] + s.lagV[i] * dt, -T.lag.most, T.lag.most)
        }
        s.lag[1] = Math.min(s.lag[1], 0.03)
        s.prevOff = off
        s.prevV = v
      }
    }
  }

  /** Into the structure material's TENDRIL uniforms: the nearest responding tendrils. */
  write(u) {
    if (!u.uTendrilA) return
    const active = [...this.states.values()].filter((s) => s.phase !== 'wait').sort((a, b) => a.d - b.d).slice(0, TENDRIL.slots)
    for (let k = 0; k < TENDRIL.slots; k++) {
      const s = active[k]
      if (!s) {
        u.uTendrilA.value[k].set(-1, 0, 0, 0)
        continue
      }
      u.uTendrilA.value[k].set(s.td.id, s.still, s.reach, 0)
      u.uTendrilB.value[k].set(s.turn[0], s.turn[1], s.turn[2], 0)
      u.uTendrilC.value[k].set(s.td.dir[0], s.td.dir[1], s.td.dir[2], 0)
      u.uTendrilD.value[k].set(s.lag[0], s.lag[1], s.lag[2], 0)
    }
  }
}
