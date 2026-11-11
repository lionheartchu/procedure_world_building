import { LIFECYCLE } from './lifecycle'
import { RESIDENT, tensionOf } from './encounter'

/**
 * M3N (docs/24-noticing.md): a resident notices the visitor. Before any
 * touch, the one or two residents nearest the visitor respond to their
 * nearness, each as its own state has it, and settle back once they leave:
 *
 *   - it frosts on the side the visitor comes from: a pearl clouding of its
 *     film, as dense as the matter its body holds (a full one turns milky,
 *     a young one only hazes), so its state shows as it responds
 *   - it closes: its sheet cups away from the visitor about its spine, as a
 *     leaf folds shut
 *   - it draws back from the visitor, its crest folding away: a slack one
 *     (young, or lying down) sags away slowly and far, a taut one (full,
 *     holding) barely moves but answers at once (the encounter's tension,
 *     lib/encounter.js)
 *   - it settles back over several seconds, and grows used to a visitor who
 *     stays or comes straight back (`habit`), recovering in about a minute
 *   - an old contour on the ground only frosts, faintly, as it is passed
 *
 * Presentation only, on the visitor's clock: it reads the residents and the
 * visitor and writes nothing the lifecycle reads. Its lean is drawn through
 * the same channel as the resident's air (the form shader's WIND), so the
 * encounter meets the sheet where it is drawn.
 */
export const NOTICE = {
  /** Standing residents: noticed from `reach`, fully at `close` (units, from the foot); old contours, from `faint`. */
  reach: 3.2,
  close: 1.2,
  faint: [1.8, 0.6],
  /** At most this many of each (the nearest) respond at once. */
  most: 2,
  stages: ['forming', 'holding', 'receding'],
  /** Seconds to respond, slack .. taut; and to settle back. */
  rise: [1.4, 0.45],
  settle: [6.5, 4],
  /** How far its crest draws back (a share of its height as drawn now), and its crest's fold (rad), slack .. taut. */
  lean: [0.45, 0.12],
  curl: [0.3, 0.35],
  /** How far it cups its sheet away from the visitor, closing (curvature, 1/units), slack .. taut. */
  cup: [2.6, 3.4],
  /**
   * Frosting: its density, least and most (by the matter its body holds),
   * an old contour's share of it, and how far across the sheet it has spread
   * at full response (from the visitor's side, 0, to the far side, 1).
   */
  frost: [0.3, 0.75],
  contour: 0.45,
  spread: 1.3,
  /**
   * Getting used to a visitor who stays: past `after` of response, per
   * second at full response; back per second once it has settled; and the
   * most it takes off.
   */
  habit: { after: 0.5, gain: 1 / 60, loss: 1 / 120, most: 0.45 },
  /** How quickly the side it is approached from follows the visitor (s). */
  follow: 0.5,
  /** The frost's colour: a cool pearl, apart from the cue's ice-lilac and matter's champagne. */
  tint: '#F0EBFA',
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
const mix = (a, b, k) => a + (b - a) * k

export class Noticing {
  /**
   * `frost` scales the frost, `cup` keeps the cup and `curl` the crest's
   * fold: M3L gathers the membrane itself (LifecycleLayer LIVING), so it
   * asks for neither, and less frost, and the shape carries the response.
   */
  constructor({ frost = 1, cup = true, curl = true } = {}) {
    /** resident → { level, side: [x, z] (unit, toward the visitor), habit, tension, ended } */
    this.states = new Map()
    this.frostScale = frost
    this.cupOn = cup
    this.curlOn = curl
  }

  /** One frame: `p` the visitor's position, on the visitor's clock (dt, s). */
  update(p, lifecycles, dt) {
    const N = NOTICE
    const near = []
    const lying = []
    for (const life of lifecycles) {
      for (const r of life.residents) {
        const d = Math.hypot(p[0] - r.desc.p[0], p[2] - r.desc.p[2])
        if (r.stage === 'ended') {
          if (d < N.faint[0]) lying.push({ r, d })
        } else if (N.stages.includes(r.stage) && r.desc.height * r.unfold >= 0.08 && d < N.reach) near.push({ r, d })
      }
    }
    near.sort((a, b) => a.d - b.d)
    lying.sort((a, b) => a.d - b.d)
    const chosen = new Map()
    for (const { r, d } of near.slice(0, N.most)) chosen.set(r, smoothstep(N.reach, N.close, d))
    for (const { r, d } of lying.slice(0, N.most)) chosen.set(r, smoothstep(N.faint[0], N.faint[1], d))
    for (const r of chosen.keys()) if (!this.states.has(r)) this.states.set(r, { level: 0, side: null, habit: 0, tension: 0, ended: false })

    for (const [r, s] of this.states) {
      const ended = r.stage === 'ended'
      s.ended = ended
      s.tension = ended ? 0 : tensionOf(r, LIFECYCLE.bodyPerHeight, LIFECYCLE.lies)
      const k = smoothstep(RESIDENT.range[0], RESIDENT.range[1], s.tension)
      const near = chosen.get(r) ?? 0
      const target = near * (1 - s.habit)
      // (M3L's membrane answers this directly, with its own body's timing.)
      s.target = target
      const tau = target > s.level ? mix(N.rise[0], N.rise[1], k) : mix(N.settle[0], N.settle[1], k)
      s.level += (target - s.level) * (1 - Math.exp(-dt / tau))
      // The side it is approached from: toward the visitor, following them.
      const dx = p[0] - r.desc.p[0]
      const dz = p[2] - r.desc.p[2]
      const len = Math.hypot(dx, dz)
      if (near > 0 && len > 1e-3) {
        const to = [dx / len, dz / len]
        if (!s.side) s.side = to
        else {
          const f = 1 - Math.exp(-dt / N.follow)
          const x = s.side[0] + (to[0] - s.side[0]) * f
          const z = s.side[1] + (to[1] - s.side[1]) * f
          const l = Math.hypot(x, z) || 1
          s.side = [x / l, z / l]
        }
      }
      s.habit = clamp(s.habit + (s.level > N.habit.after ? N.habit.gain * s.level : s.level < 0.1 ? -N.habit.loss : 0) * dt, 0, N.habit.most)
      if (!chosen.has(r) && s.level < 1e-3 && s.habit <= 0) this.states.delete(r)
    }
  }

  /**
   * How resident `r` is drawn now, or null: its lean (the crest's
   * displacement, x and z), its crest's extra fold, its cup (curvature,
   * signed toward its lean), and its frost (the side it is approached from,
   * how dense, how far across it has spread).
   */
  of(r, fill) {
    const s = this.states.get(r)
    if (!s || !s.side || (s.level < 1e-3 && !(s.target > 0))) return null
    const N = NOTICE
    const k = smoothstep(RESIDENT.range[0], RESIDENT.range[1], s.tension)
    const frost = smoothstep(0, 0.3, s.level) * mix(N.frost[0], N.frost[1], clamp(fill, 0, 1)) * (s.ended ? N.contour : 1) * this.frostScale
    const spread = s.level * N.spread
    const now = { level: s.level, target: s.target ?? 0, tension: k }
    if (s.ended) return { ...now, lean: [0, 0], curl: 0, cup: 0, side: s.side, frost, spread }
    const back = s.level * mix(N.lean[0], N.lean[1], k) * r.desc.height * 1.4 * Math.max(r.unfold, 0.05)
    // Cupped, and its crest folded, away from the visitor: toward its lean
    // when they stand behind it, away from it when in front, not at all from
    // the side.
    const facing = s.side[0] * Math.cos(r.desc.lean) + s.side[1] * Math.sin(r.desc.lean)
    const away = -clamp(facing * 3, -1, 1)
    const cup = this.cupOn ? s.level * mix(N.cup[0], N.cup[1], k) * away : 0
    const curl = this.curlOn ? s.level * mix(N.curl[0], N.curl[1], k) * away : 0
    return { ...now, lean: [-s.side[0] * back, -s.side[1] * back], curl, cup: Math.abs(cup) < 1e-3 ? 0 : cup, side: s.side, frost, spread }
  }
}
