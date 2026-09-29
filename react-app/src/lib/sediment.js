/**
 * Sediment simulation.
 *
 * A small rule-based cellular model, not an erosion solver. It runs on a fixed
 * grid that is independent of the render resolution, and holds two scalar
 * fields over the static base height H:
 *
 *   S(x, z, t)  sediment depth, in the same units as the height field
 *   A(x, z, t)  recent activity — how much material moved through a cell
 *
 * One step is:
 *
 *   1. supply     exposed ground above the water line sheds a little material
 *   2. transport  each cell pushes part of its mobile sediment to whichever
 *                 neighbours have a lower total surface (H + S)
 *   3. diffuse    a light blur, so piles stay soft rather than pixelated
 *   4. settle     sediment decays slowly, and low ground holds on to more of it
 *
 * `deposition` is what makes material stick: it is the fraction of a cell's
 * sediment that refuses to move this step, so high deposition builds pans and
 * low deposition keeps everything draining downhill.
 */

export const SIM_RES = 128

/** Safety cap on sediment depth. Normal runs settle well below it. */
export const SED_MAX = 0.35

/**
 * Depth that reads as "fully covered" in the maps and in the terrain shader.
 * Separate from the safety cap so the visual scale matches what the model
 * actually produces rather than its worst case.
 */
export const SED_DISPLAY = 0.08

/**
 * Slope (total downhill drop to the four neighbours) at which transport runs at
 * full speed. Below it, movement eases off — which is what makes flat pans hold
 * their material and gentle grades keep feeding the basins. Tuned against the
 * default landform, where neighbouring cells differ by only a few thousandths.
 */
const SLOPE_REFERENCE = 0.008

/**
 * Activity marks the cells carrying the most material *right now*, so it is
 * measured against the field's own current flux rather than a fixed number:
 * a cell moving ACTIVITY_CONTRAST times the average rate reads as fully active.
 * Without this the mint is invisible in the first seconds and everywhere after
 * a few minutes, since absolute flux grows with the amount that has piled up.
 */
const ACTIVITY_CONTRAST = 20

/** Floor on that reference, so a nearly still field does not glow. */
const ACTIVITY_FLOOR = 0.0025

/** Seconds over which activity fades in after a reset. */
const ACTIVITY_WARMUP = 2.5

export class SedimentSim {
  constructor(res = SIM_RES) {
    const n = res * res
    this.res = res
    this.height = new Float32Array(n) // base field H, cell centres
    this.sediment = new Float32Array(n)
    this.activity = new Float32Array(n)
    this.delta = new Float32Array(n)
    this.scratch = new Float32Array(n)
    this.version = 0 // bumped on every change, so views know to redraw
    this.steps = 0
    this.elapsed = 0
    this.fluxScale = 0 // smoothed average flux, the activity reference
  }

  /** Install a new base height field. Always clears whatever had accumulated. */
  setHeight(grid) {
    this.height.set(grid)
    this.reset()
  }

  reset() {
    this.sediment.fill(0)
    this.activity.fill(0)
    this.delta.fill(0)
    this.steps = 0
    this.elapsed = 0
    this.fluxScale = 0
    this.version++
  }

  step(dt, { flow, deposition, supply, waterLevel }) {
    const { res, height: H, sediment: S, activity: A, delta } = this
    const n = res * res

    // 1. Supply: ground standing above the water line releases material. The
    // square root keeps the low shores contributing — with a linear ramp almost
    // all of the exposed field sits just above the water line and sheds nothing.
    const exposureSpan = Math.max(0.05, 1 - waterLevel)
    for (let i = 0; i < n; i++) {
      const exposure = Math.min(1, Math.max(0, (H[i] - waterLevel) / exposureSpan))
      S[i] += supply * Math.sqrt(exposure) * dt
    }

    // 2. Transport toward lower total surface.
    delta.fill(0)
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const c = j * res + i
        const mobile = S[c] * (1 - deposition)
        if (mobile < 1e-6) continue

        const t = H[c] + S[c]
        // Closed boundaries: edge cells simply have fewer downhill options.
        const nL = i > 0 ? c - 1 : -1
        const nR = i < res - 1 ? c + 1 : -1
        const nD = j > 0 ? c - res : -1
        const nU = j < res - 1 ? c + res : -1

        let dL = 0
        let dR = 0
        let dD = 0
        let dU = 0
        if (nL >= 0) dL = Math.max(0, t - (H[nL] + S[nL]))
        if (nR >= 0) dR = Math.max(0, t - (H[nR] + S[nR]))
        if (nD >= 0) dD = Math.max(0, t - (H[nD] + S[nD]))
        if (nU >= 0) dU = Math.max(0, t - (H[nU] + S[nU]))

        const sum = dL + dR + dD + dU
        if (sum <= 1e-7) continue

        // Move a *fraction* of the mobile sediment, eased by how steep the cell
        // is. Because a step can never move more than what a cell holds, the
        // model cannot overshoot however high flow is pushed.
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

    // 3. Apply, track activity, settle.
    const decay = 0.1 * dt
    const activityFade = Math.max(0, 1 - 1.1 * dt)

    let fluxSum = 0
    for (let i = 0; i < n; i++) fluxSum += Math.abs(delta[i])
    const meanRate = fluxSum / n / dt

    // Seeded on the first step rather than eased up from zero: the average has
    // a two-second time constant, and starting it at zero left the reference
    // pinned to its floor for that whole time.
    if (this.steps === 0) this.fluxScale = meanRate
    else this.fluxScale += (meanRate - this.fluxScale) * Math.min(1, dt * 0.5)
    const activityReference = Math.max(ACTIVITY_FLOOR, this.fluxScale * ACTIVITY_CONTRAST)

    // Even seeded, the first second of a run has genuinely tiny but very
    // concentrated flux, so relative activity saturates and the whole field
    // lights up at once. Fading activity in kills that flash and costs nothing
    // afterwards — it is exactly the window in which nothing has happened yet.
    const warmUp = this.elapsed < ACTIVITY_WARMUP ? this.elapsed / ACTIVITY_WARMUP : 1

    for (let i = 0; i < n; i++) {
      let s = S[i] + delta[i]
      if (s < 0) s = 0
      // Sediment sitting below the water line is held; exposed sediment slowly
      // disperses, which is what stops the field growing without bound.
      const held = H[i] < waterLevel ? 0.18 : 1
      s -= s * decay * held
      S[i] = s > SED_MAX ? SED_MAX : s

      // Activity is a flux rate, so it means the same thing at any step size.
      const rate = (Math.abs(delta[i]) / dt / activityReference) * warmUp
      const a = A[i] * activityFade
      A[i] = rate > a ? Math.min(1, rate) : a
    }

    // 4. Light diffusion so accumulations read as soft banks.
    this.#diffuse(0.16)

    this.steps++
    this.elapsed += dt
    this.version++
  }

  /** 5-point blur, weight in 0..1. */
  #diffuse(weight) {
    const { res, sediment: S, scratch } = this
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const c = j * res + i
        const l = i > 0 ? S[c - 1] : S[c]
        const r = i < res - 1 ? S[c + 1] : S[c]
        const d = j > 0 ? S[c - res] : S[c]
        const u = j < res - 1 ? S[c + res] : S[c]
        scratch[c] = S[c] + weight * ((l + r + d + u) * 0.25 - S[c])
      }
    }
    S.set(scratch)
  }
}
