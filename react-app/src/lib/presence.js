import { airVelocity, colonyAirData } from './air'

/**
 * Presence — study 11, first-person exploration, phase A (docs/
 * 11-presence-study.md), behind `?presence=1`. The visitor as a small
 * physical presence drifting through Explore's world: a position, a velocity
 * and a gaze, kept clear of the ground, the water and the forms, and carried
 * a little by the World's own air (air.js).
 *
 * The world lives without it. It reads the world and the forms and changes
 * nothing: no growth, placement, lifecycle stage or event depends on where
 * it is or how it moves.
 *
 * Pure data and a fixed rule per step, so it can be checked in Node; the
 * camera, input and the flights in and out are components/PresenceCamera.jsx.
 */

export const PRESENCE = {
  /** Height above the floor (ground or water) it settles at on arrival, and its range (units). */
  eye: 0.5,
  low: 0.3,
  high: 3.2,
  /** Never nearer the floor than this, whatever else happens (the camera's near plane is 0.1). */
  floor: 0.22,
  /** How far around its foot it reads the ground, so a slope never rises into view. */
  footprint: 0.22,
  /** Drift speed, and with Shift (units/s); rising and sinking. */
  speed: 0.7,
  fast: 1.6,
  climb: 0.4,
  /** Seconds to take up a new speed, and to come to rest when let go: some inertia, but it settles. */
  ease: 0.5,
  glide: 0.5,
  /** Seconds to follow the ground's height as it drifts over it. */
  settle: 0.5,
  /**
   * The share of the air's speed it is carried by, and how slowly it takes it
   * up (s). The air (air.js) moves at 0.03 to 0.17 units/s, mostly toward +x;
   * at this share a visitor standing still slides 0.2 to 1.2 units a minute,
   * less inside a colony, which holds the air.
   */
  carried: 0.12,
  carry: 2.5,
  /** The nearest a form's surface comes (its body), and where approach begins to soften. */
  reach: 0.3,
  cushion: 0.7,
  /** Half the extent it can drift in: the slab is 26 units, its misty edge beyond 12. */
  bound: 11.6,
  /** The gaze: radians per pixel dragged, seconds of smoothing, pitch limits. */
  look: 0.0028,
  turn: 0.08,
  pitch: [-1.05, 0.95],
  /** A wheel or trackpad scroll: speed per unit of delta, and how fast it fades (s). */
  wheel: 0.004,
  wheelFade: 0.5,
}

/**
 * Smooth motion (`smooth: true`; the Habitat's study C, or `?motion=smooth`),
 * after the movement diagnosis in docs/14-habitat-c.md. The same speeds,
 * height and body; what changes is how they are reached:
 *   - speed is followed by a critically damped spring, so acceleration
 *     builds and fades instead of jumping at every start, stop and turn
 *   - height follows the ground a moment ahead along the way it is going,
 *     with a spring, so a bank lifts the eye before it arrives instead of
 *     after; the floor is a soft spring, the hard floor only a last guard
 *   - forms are met at the level of velocity, against the surface's smooth
 *     distance, instead of the position being pushed out
 */
export const SMOOTH = {
  /** Spring rates (rad/s) for speed: setting off, and coming to rest. */
  go: 4.4,
  rest: 5.2,
  /** Height: the spring rate, and how far ahead (s of travel) the ground is read. */
  rise: 6.5,
  ahead: [0.35, 0.8],
  /** The soft floor (above which it never presses) and its stiffness (rad/s); the hard floor below it. */
  soft: 0.32,
  softRate: 16,
  hard: 0.18,
  /** Pressed into a form, it is eased out at this speed per unit of overlap (1/s). */
  separate: 9,
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
const ease = (dt, tau) => 1 - Math.exp(-dt / tau)

/** The floor at (x, z): the displayed ground, or the water's surface (above its tide) where higher. */
export function floorAt(world, x, z) {
  return Math.max(world.groundY(...world.toUV(x, z)), world.waterY + 0.04)
}

/** The highest floor under its footprint: a slope or bank beside it counts. */
export function supportAt(world, x, z, r = PRESENCE.footprint) {
  let y = floorAt(world, x, z)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    y = Math.max(y, floorAt(world, x + Math.cos(a) * r, z + Math.sin(a) * r))
  }
  return y
}

/**
 * The forms as the presence meets them: the vertices of every surface that
 * stands above the ground (the membranes' films and the structure's strands
 * and films, as built), in a grid for nearby queries. Built once per world,
 * from geometry built the way the colony builds its own.
 */
export function formProxy(positions, { size = 26, cell = 0.5 } = {}) {
  const n = Math.ceil(size / cell)
  const half = size / 2
  const at = (v) => clamp(Math.floor((v + half) / cell), 0, n - 1)
  let total = 0
  for (const p of positions) total += p.length / 3
  const xyz = new Float32Array(total * 3)
  const key = new Int32Array(total)
  let k = 0
  for (const p of positions) {
    for (let i = 0; i < p.length; i += 3, k++) {
      xyz[k * 3] = p[i]
      xyz[k * 3 + 1] = p[i + 1]
      xyz[k * 3 + 2] = p[i + 2]
      key[k] = at(p[i + 2]) * n + at(p[i])
    }
  }
  // Points sorted by cell (counting sort), with each cell's start.
  const start = new Int32Array(n * n + 1)
  for (let i = 0; i < total; i++) start[key[i] + 1]++
  for (let c = 0; c < n * n; c++) start[c + 1] += start[c]
  const fill = start.slice(0, n * n)
  const order = new Int32Array(total)
  for (let i = 0; i < total; i++) order[fill[key[i]]++] = i
  const points = new Float32Array(total * 3)
  for (let i = 0; i < total; i++) {
    points[i * 3] = xyz[order[i] * 3]
    points[i * 3 + 1] = xyz[order[i] * 3 + 1]
    points[i * 3 + 2] = xyz[order[i] * 3 + 2]
  }

  /**
   * The nearest surface within `radius` of (x, y, z): its distance, and the
   * direction from it to the point (averaged over the points about as near,
   * so it turns smoothly along a surface). null if none is that near.
   */
  function nearest(x, y, z, radius, out = {}) {
    const r2 = radius * radius
    let best = r2
    const i0 = at(x - radius)
    const i1 = at(x + radius)
    const j0 = at(z - radius)
    const j1 = at(z + radius)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * n + i
        for (let p = start[c]; p < start[c + 1]; p++) {
          const dx = x - points[p * 3]
          const dy = y - points[p * 3 + 1]
          const dz = z - points[p * 3 + 2]
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < best) best = d2
        }
      }
    }
    if (best >= r2) return null
    const d = Math.sqrt(best)
    const near = d + 0.08
    let nx = 0
    let ny = 0
    let nz = 0
    // The near points' weighted centre, for the distance to the surface they
    // lie on (`plane`): smooth across the gaps between points, where the
    // nearest point's distance ripples.
    let cx = 0
    let cy = 0
    let cz = 0
    let cw = 0
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * n + i
        for (let p = start[c]; p < start[c + 1]; p++) {
          const dx = x - points[p * 3]
          const dy = y - points[p * 3 + 1]
          const dz = z - points[p * 3 + 2]
          const e = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (e > near || e < 1e-6) continue
          const w = (near - e) / e
          nx += dx * w
          ny += dy * w
          nz += dz * w
          const wc = near - e
          cx += points[p * 3] * wc
          cy += points[p * 3 + 1] * wc
          cz += points[p * 3 + 2] * wc
          cw += wc
        }
      }
    }
    const len = Math.hypot(nx, ny, nz)
    out.d = d
    if (len < 1e-6) {
      out.nx = 0
      out.ny = 1
      out.nz = 0
    } else {
      out.nx = nx / len
      out.ny = ny / len
      out.nz = nz / len
    }
    out.plane = cw > 0 ? (x - cx / cw) * out.nx + (y - cy / cw) * out.ny + (z - cz / cw) * out.nz : d
    return out
  }

  return { count: total, nearest }
}

/** The gaze's direction for a heading (yaw, about up; 0 looks along −z) and pitch. */
export function gaze(yaw, pitch) {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]
}

/**
 * Where to arrive at a colony: a place in front of its anchor membrane, far
 * enough back to see it whole, clear of every form, with a clear way in
 * behind it (the flight arrives along the gaze) and an open view. Above all
 * it looks the way the overview was looking (`view`, a horizontal
 * direction), so the flight drifts forward into the world rather than
 * turning round in it; then, where it can, it stands on the side the
 * membrane leans toward (where its crests curl), a little across it. Returns
 * { p: [x, y, z], look: [x, y, z] } (the eye, and the point it looks at), or
 * null.
 */
export function chooseEntry(world, proxy, colony, anchor, view = null) {
  const H = anchor.height
  const [ax, , az] = anchor.p
  const lean = [Math.cos(anchor.lean), Math.sin(anchor.lean)]
  const focus = [ax + lean[0] * 0.15 * H, floorAt(world, ax, az) + 0.35 * H, az + lean[1] * 0.15 * H]
  const hit = {}
  let best = null
  for (const back of [0.95, 1.15, 1.4, 1.7]) {
    const dist = back * H + 0.6
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2
      const x = ax + Math.cos(a) * dist
      const z = az + Math.sin(a) * dist
      if (Math.abs(x) > PRESENCE.bound - 0.4 || Math.abs(z) > PRESENCE.bound - 0.4) continue
      const y = supportAt(world, x, z) + PRESENCE.eye
      if (proxy.nearest(x, y, z, 0.9, hit)) continue
      // The way in: the flight's last few units, behind the eye along its gaze.
      const ux = (focus[0] - x) / dist
      const uz = (focus[2] - z) / dist
      let clear = true
      for (let s = 0.5; s <= 2 && clear; s += 0.25) {
        const bx = x - ux * s
        const bz = z - uz * s
        const by = Math.max(y, supportAt(world, bx, bz) + PRESENCE.eye) + 0.3 * (s / 2)
        if (Math.abs(bx) > PRESENCE.bound || Math.abs(bz) > PRESENCE.bound || proxy.nearest(bx, by, bz, 0.6, hit)) clear = false
      }
      if (!clear) continue
      // What stands between it and the anchor (the last stretch is the anchor itself).
      let blocked = 0
      const len = Math.hypot(focus[0] - x, focus[1] - y, focus[2] - z)
      for (let s = 0.3; s < len - 1.1; s += 0.15) {
        const f = s / len
        if (proxy.nearest(x + (focus[0] - x) * f, y + (focus[1] - y) * f, z + (focus[2] - z) * f, 0.12, hit)) blocked++
      }
      // Along the overview's own gaze.
      const along = view ? ux * view[0] + uz * view[1] : 0
      // On the side it leans toward if it can, three-quarters on rather than square on.
      const face = -(ux * lean[0] + uz * lean[1])
      // Looking in over the land rather than out past the slab's edge.
      const r = Math.hypot(x, z)
      const inward = r > 1e-6 ? (ux * -x + uz * -z) / r : 0
      const ground = world.groundY(...world.toUV(x, z)) > world.waterY + 0.05 ? 1 : 0
      const score = 2 * along + 0.6 * smoothstep(-0.2, 0.6, face) - 0.4 * smoothstep(0.85, 1, face) + 0.45 * inward + 0.25 * ground - 0.35 * blocked - 0.5 * back
      if (!best || score > best.score) best = { score, p: [x, y, z], look: focus }
    }
  }
  return best
}

/**
 * The presence itself. Each step: the gaze eases toward where it was turned;
 * the body eases toward the speed asked of it (or glides to rest), is carried
 * a little by the air, follows the ground's height at the height it chose,
 * softens and stops before a form, and stays over the slab and above the
 * floor.
 */
export class Presence {
  /**
   * `contacts`: membranes that yield rather than stop (lib/encounter.js,
   * the Habitat's encounter). Their surfaces are left out of `proxy`; each
   * step they take part of a press into them as their own movement.
   */
  constructor({ world, proxy, colonies = null, blooms = null, contacts = [], smooth = false, bound = PRESENCE.bound, nearAir = false }) {
    this.world = world
    this.proxy = proxy
    this.contacts = contacts
    /** Half the extent it can drift in (a wider world passes its own: the Habitat's D). */
    this.bound = bound
    /** Smooth motion (SMOOTH): off unless asked for, so every other view moves as before. */
    this.smooth = smooth
    this.acc = [0, 0]
    this.colonyAir = colonyAirData(colonies, blooms, nearAir ? { all: true } : undefined)
    this.floorProbe = { at: (x, z) => floorAt(world, x, z) }
    this.p = [0, 0, 0]
    this.v = [0, 0, 0]
    this.carriedBy = [0, 0]
    this.yaw = 0
    this.pitch = 0
    this.aim = { yaw: 0, pitch: 0 }
    this.hover = PRESENCE.eye
    this.thrust = 0
    this.t = 0
    this.near = null
    this.hit = {}
  }

  /** Put it somewhere, looking along (yaw, pitch), at rest. */
  place(p, yaw, pitch) {
    const support = supportAt(this.world, p[0], p[2])
    this.p = [p[0], Math.max(p[1], support + PRESENCE.floor), p[2]]
    this.hover = clamp(this.p[1] - support, PRESENCE.low, PRESENCE.high)
    this.v = [0, 0, 0]
    this.acc = [0, 0]
    this.carriedBy = [0, 0]
    this.yaw = this.aim.yaw = yaw
    this.pitch = this.aim.pitch = clamp(pitch, PRESENCE.pitch[0], PRESENCE.pitch[1])
    this.thrust = 0
  }

  /**
   * One step of dt seconds. `input`: forward and strafe (−1..1), rise
   * (−1..1), fast (bool), turn [dx, dy] (pixels the world was dragged),
   * wheel (scroll delta); `air`: { drift, curl, colony }, the air's
   * settings; `t` the air's clock (s).
   */
  step(dt, input, air, t) {
    const P = PRESENCE
    this.t = t
    // The gaze. The world is dragged, as in the overview or a panorama: it follows the hand.
    const [tx, ty] = input.turn ?? [0, 0]
    this.aim.yaw += tx * P.look
    this.aim.pitch = clamp(this.aim.pitch + ty * P.look, P.pitch[0], P.pitch[1])
    const k = ease(dt, P.turn)
    this.yaw += (this.aim.yaw - this.yaw) * k
    this.pitch += (this.aim.pitch - this.pitch) * k

    // The speed asked of it, in the plane: along its heading and across it.
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    let wf = input.forward ?? 0
    let ws = input.strafe ?? 0
    const m = Math.hypot(wf, ws)
    if (m > 1) {
      wf /= m
      ws /= m
    }
    const speed = input.fast ? P.fast : P.speed
    this.thrust = this.thrust * Math.exp(-dt / P.wheelFade) - (input.wheel ?? 0) * P.wheel
    this.thrust = clamp(this.thrust, -P.speed, P.speed)
    const want = [(fx * wf - fz * ws) * speed + fx * this.thrust, (fz * wf + fx * ws) * speed + fz * this.thrust]
    const asked = Math.hypot(want[0], want[1]) > 1e-4
    if (this.smooth) {
      this.moveSmooth(dt, want, asked, input, air, t)
      return
    }
    const kv = ease(dt, asked ? P.ease : P.glide)
    this.v[0] += (want[0] - this.v[0]) * kv
    this.v[2] += (want[1] - this.v[2]) * kv

    // Carried by the air, as the dust and films are: horizontally, gently.
    const [x, y, z] = this.p
    const w = airVelocity(this.p, this.hover, t, air, this.floorProbe, { strength: air.colony ?? 0, obstacles: this.colonyAir.obstacles })
    const kc = ease(dt, P.carry)
    this.carriedBy[0] += (w[0] * P.carried - this.carriedBy[0]) * kc
    this.carriedBy[1] += (w[2] * P.carried - this.carriedBy[1]) * kc

    // Its height: the one it chose, over whatever floor is beneath.
    this.hover = clamp(this.hover + (input.rise ?? 0) * P.climb * dt, P.low, P.high)
    const support = supportAt(this.world, x, z)
    const vyWant = (support + this.hover - y) / P.settle
    this.v[1] += (vyWant - this.v[1]) * ease(dt, 0.25)

    let nx = x + (this.v[0] + this.carriedBy[0]) * dt
    let ny = y + this.v[1] * dt
    let nz = z + (this.v[2] + this.carriedBy[1]) * dt

    // Forms: approach softens inside the cushion and stops at its body.
    this.near = null
    for (let pass = 0; pass < 2; pass++) {
      const h = this.proxy.nearest(nx, ny, nz, P.cushion, this.hit)
      if (!h) break
      if (pass === 0) this.near = h.d
      const into = -(this.v[0] * h.nx + this.v[1] * h.ny + this.v[2] * h.nz)
      if (into > 0) {
        const s = smoothstep(P.cushion, P.reach, h.d)
        this.v[0] += h.nx * into * s
        this.v[1] += h.ny * into * s
        this.v[2] += h.nz * into * s
      }
      const carriedInto = -(this.carriedBy[0] * h.nx + this.carriedBy[1] * h.nz)
      if (carriedInto > 0) {
        const s = smoothstep(P.cushion, P.reach, h.d)
        this.carriedBy[0] += h.nx * carriedInto * s
        this.carriedBy[1] += h.nz * carriedInto * s
      }
      if (h.d >= P.reach) break
      const push = P.reach - h.d
      nx += h.nx * push
      ny += h.ny * push
      nz += h.nz * push
    }

    // Membranes that yield: each takes its share of a press and holds the rest.
    for (const membrane of this.contacts) {
      const q = [nx, ny, nz]
      membrane.meet(q, this.v, dt)
      ;[nx, ny, nz] = q
    }

    // The slab: eased back from its edge, never past it.
    for (const [i, v] of [[0, nx], [2, nz]]) {
      const over = Math.abs(v) - (this.bound - 0.8)
      if (over > 0 && Math.sign(this.v[i]) === Math.sign(v)) this.v[i] *= 1 - smoothstep(0, 0.8, over)
    }
    nx = clamp(nx, -this.bound, this.bound)
    nz = clamp(nz, -this.bound, this.bound)

    // The floor: whatever else happens, never into the ground or the water.
    const below = supportAt(this.world, nx, nz) + P.floor
    if (ny < below) {
      ny = below
      if (this.v[1] < 0) this.v[1] = 0
    }
    this.p = [nx, ny, nz]
  }

  /** One step of smooth motion (SMOOTH): the same rules as `step`, reached by springs. */
  moveSmooth(dt, want, asked, input, air, t) {
    const P = PRESENCE
    const M = SMOOTH
    const [x, y, z] = this.p

    // Speed: a critically damped spring toward the speed asked (or rest).
    const w = asked ? M.go : M.rest
    for (const [i, k] of [[0, 0], [2, 1]]) {
      this.acc[k] += (w * w * (want[k] - this.v[i]) - 2 * w * this.acc[k]) * dt
      this.v[i] += this.acc[k] * dt
    }

    // Carried by the air, as before.
    const wa = airVelocity(this.p, this.hover, t, air, this.floorProbe, { strength: air.colony ?? 0, obstacles: this.colonyAir.obstacles })
    const kc = ease(dt, P.carry)
    this.carriedBy[0] += (wa[0] * P.carried - this.carriedBy[0]) * kc
    this.carriedBy[1] += (wa[2] * P.carried - this.carriedBy[1]) * kc

    // Height: the chosen height over the ground here and a moment ahead
    // (whichever is higher, so a rise is met before it arrives and a
    // descent is followed, not anticipated).
    this.hover = clamp(this.hover + (input.rise ?? 0) * P.climb * dt, P.low, P.high)
    const vx = this.v[0] + this.carriedBy[0]
    const vz = this.v[2] + this.carriedBy[1]
    const support = supportAt(this.world, x, z)
    let base = support
    for (const s of M.ahead) base = Math.max(base, supportAt(this.world, x + vx * s, z + vz * s) - 0.04 * s)
    const target = base + this.hover
    let ay = M.rise * M.rise * (target - y) - 2 * M.rise * this.v[1]
    // The soft floor: pressed up, never snapped.
    const above = y - support
    if (above < M.soft) ay += M.softRate * M.softRate * (M.soft - above) - 2 * M.softRate * Math.min(0, this.v[1])
    this.v[1] += ay * dt

    // Forms: eased on approach, and held at the body by velocity alone.
    for (let pass = 0; pass < 2; pass++) {
      const px = x + (this.v[0] + this.carriedBy[0]) * dt
      const py = y + this.v[1] * dt
      const pz = z + (this.v[2] + this.carriedBy[1]) * dt
      const h = this.proxy.nearest(px, py, pz, P.cushion, this.hit)
      if (!h) {
        if (pass === 0) this.near = null
        break
      }
      if (pass === 0) this.near = h.d
      // The surface's distance, smoothed across its points, never more than
      // a little nearer than the nearest point (so nothing is met past an edge).
      const d = clamp(h.plane, h.d - 0.03, h.d)
      const n = [h.nx, h.ny, h.nz]
      const into = -(this.v[0] * n[0] + this.v[1] * n[1] + this.v[2] * n[2])
      if (into > 0) {
        const s = smoothstep(P.cushion, P.reach, d)
        for (let i = 0; i < 3; i++) this.v[i] += n[i] * into * s
      }
      const carriedInto = -(this.carriedBy[0] * n[0] + this.carriedBy[1] * n[2])
      if (carriedInto > 0) {
        const s = smoothstep(P.cushion, P.reach, d)
        this.carriedBy[0] += n[0] * carriedInto * s
        this.carriedBy[1] += n[2] * carriedInto * s
      }
      if (d < P.reach) {
        const out = (P.reach - d) * M.separate
        const now = this.v[0] * n[0] + this.v[1] * n[1] + this.v[2] * n[2]
        if (now < out) for (let i = 0; i < 3; i++) this.v[i] += n[i] * (out - now)
      }
    }

    let nx = x + (this.v[0] + this.carriedBy[0]) * dt
    let ny = y + this.v[1] * dt
    let nz = z + (this.v[2] + this.carriedBy[1]) * dt

    // A last guard: pressed well inside a form, pushed out at once.
    const deep = this.proxy.nearest(nx, ny, nz, P.reach * 0.6, this.hit)
    if (deep) {
      const push = P.reach * 0.6 - deep.d
      nx += deep.nx * push
      ny += deep.ny * push
      nz += deep.nz * push
    }

    // Membranes that yield (the encounter), as before.
    for (const membrane of this.contacts) {
      const q = [nx, ny, nz]
      membrane.meet(q, this.v, dt)
      ;[nx, ny, nz] = q
    }

    // The slab, as before.
    for (const [i, v] of [[0, nx], [2, nz]]) {
      const over = Math.abs(v) - (this.bound - 0.8)
      if (over > 0 && Math.sign(this.v[i]) === Math.sign(v)) this.v[i] *= 1 - smoothstep(0, 0.8, over)
    }
    nx = clamp(nx, -this.bound, this.bound)
    nz = clamp(nz, -this.bound, this.bound)

    // The hard floor: a last guard only, below the soft one.
    const hard = supportAt(this.world, nx, nz) + M.hard
    if (ny < hard) {
      ny = hard
      if (this.v[1] < 0) this.v[1] = 0
    }
    this.p = [nx, ny, nz]
  }

  /** The gaze's direction now. */
  get direction() {
    return gaze(this.yaw, this.pitch)
  }
}
