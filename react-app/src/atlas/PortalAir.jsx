import { useEffect, useRef } from 'react'
import { reducedMotion } from './navigation'

/**
 * Residue in moving air, carried into the portal: a small 2D echo of the
 * World's wisps (study 07, phase 2.5, lib/wisps.js and AirWisps.jsx), drawn
 * on one canvas in the lower space, behind the specimens. It imports none of
 * the World's code; it follows the same rules:
 *
 *   - the air is the curl of a stream function made of a few slow plane
 *     waves, plus a gentle drift (as lib/air.js): divergence-free, so the
 *     residue never piles up, and it changes slowly, so what the residue
 *     traces are streak lines, never one clean path
 *   - a few loose regions drift across, each holding invisible release
 *     points that let residue out in puffs, with gaps
 *   - a grain is invisible near where it is released and fades in only once
 *     it has travelled; it wanders more as it ages, so a trace frays
 *   - about an eighth of it is broad, faint mist that grows as it ages
 *   - a visibility field travels with the air, so whole sections come and go
 *   - colour is a stain of the air: mostly silver-lilac, here and there a
 *     deeper lilac; the broad mist low over the plane is pearl, so it shows
 *     as light on the lavender, as the World's haze lies low in its basins
 *   - dense places are capped, so nothing ever glows or darkens into a blob
 *
 * Lower grains are nearer: a little wider and faster. Drawn at reduced
 * resolution (soft by construction) and about 30 frames a second. With
 * reduced motion, one still moment is drawn and nothing moves.
 */

/** Plane waves of the stream function: [kx, ky, phase, drift per second, amplitude]. Mostly across, so the air moves in layers. */
const WAVES = [
  [6, 26, 0.4, 0.11, 1.0],
  [-9, 34, 2.1, 0.09, 0.8],
  [14, -22, 4.4, 0.13, 0.7],
  [21, 41, 1.3, 0.16, 0.45],
  [-17, 52, 5.2, 0.14, 0.4],
].map(([kx, ky, ph, w, a]) => ({ kx, ky, ph, w, a, n: a / Math.hypot(kx, ky) }))

const AIR = {
  /** Canvas widths per second: the drift, and the swirl. */
  drift: 0.013,
  curl: 0.011,
  /** Regions drifting across, release points in each, grains in all. */
  regions: 4,
  sources: 5,
  grains: 2000,
  mist: 0.2,
  /** Where the horizon falls in the canvas (a share of its height). */
  horizon: 0.33,
  /** Seconds simulated before the first frame, so the air opens already moving. */
  warmup: 36,
  /** Canvas pixels per CSS pixel: low, so the residue is soft by construction. */
  resolution: 0.45,
}

const hash = (n) => {
  const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453
  return s - Math.floor(s)
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The air's velocity at (x, y) (canvas widths), time t. */
function air(x, y, t) {
  let vx = 0
  let vy = 0
  for (const w of WAVES) {
    const c = Math.cos(w.kx * x + w.ky * y + w.ph + w.w * t) * w.n
    vx += w.ky * c
    vy -= w.kx * c
  }
  // A slow current, mostly to the right, turning a little over minutes.
  const heading = 0.08 * Math.sin(t * 0.011) - 0.03
  return [vx * AIR.curl + Math.cos(heading) * AIR.drift, vy * AIR.curl * 0.55 + Math.sin(heading) * AIR.drift]
}

/** Release point s at time t: where (x across, y as a share of the canvas height), whether it is letting residue out, and how widely. */
function source(s, t) {
  const r = Math.floor(s / AIR.sources)
  const k = s % AIR.sources
  // Regions spaced across the width, so two or three are in view at once.
  const x0 = (r + 0.35 * hash(r * 7.13 + 1.3)) / AIR.regions
  const cx = -0.04 + ((x0 + 0.0036 * t) % 1.1)
  const cy = 0.24 + 0.42 * hash(r * 3.7 + 0.9) + 0.05 * Math.sin(0.013 * t + r * 2.1)
  // Upwind of the region's centre, spread across its height, each with its own slow wander.
  const x = cx - 0.09 * hash(s * 5.31) + 0.01 * Math.sin(0.05 * t + s)
  const y = cy + 0.18 * (hash(s * 9.13) - 0.5) + 0.03 * Math.sin(0.07 * t + s * 1.7)
  const on = Math.sin(0.33 * t * (0.7 + 0.6 * hash(s * 2.2)) + 6.28 * hash(s * 4.4)) > -0.15
  const spread = 0.006 + 0.012 * (0.5 + 0.5 * Math.sin(0.21 * t + s * 0.8))
  return { x, y, on, spread, k }
}

/** Whole sections of the air showing or not, travelling with it. */
function visible(x, y, t) {
  const u = x - AIR.drift * 0.9 * t
  const v = Math.sin(u * 9.1 + 1.3) * 0.5 + Math.sin(u * 4.3 + y * 21 + 0.031 * t) * 0.35 + Math.sin(y * 13 - 0.02 * t + u * 2) * 0.25
  return smooth(-0.15, 0.55, v)
}

/** The stain of the air at (x, y as a share of the height): 0 silver-lilac, 1 a deeper lilac. */
function stain(x, y, t) {
  return Math.sin(x * 5.3 + 0.017 * t) * 0.5 + Math.sin(y * 17 - x * 3.1 + 0.023 * t) * 0.5 > 0.55 ? 1 : 0
}

/** Whether a place is low over the plane, where mist shows as pearl. */
const low = (x, y, t) => y + 0.04 * Math.sin(x * 7 + 0.02 * t) > AIR.horizon + 0.12

function makeGrains() {
  const S = AIR.regions * AIR.sources
  return Array.from({ length: AIR.grains }, (_, i) => ({
    s: i % S,
    mist: hash(i * 3.71 + 0.5) < AIR.mist,
    life: 15 + 11 * hash(i * 1.37),
    offset: hash(i * 8.11) * 26,
    cycle: -1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lit: false,
    jx: hash(i * 6.1) - 0.5,
    jy: hash(i * 2.9) - 0.5,
  }))
}

/** Move every grain on by dt at time t (r: canvas height over width). */
function step(grains, t, dt, r) {
  for (const g of grains) {
    const cycle = Math.floor((t + g.offset) / g.life)
    if (cycle !== g.cycle) {
      // Released again: at its point, within the puff's spread; seen this time only if the point is letting residue out.
      g.cycle = cycle
      const src = source(g.s, t)
      g.x = src.x + g.jx * src.spread * 3
      g.y = (src.y + g.jy * src.spread * 6) * r
      g.lit = src.on
    }
    const age = (t + g.offset) % g.life
    const depth = Math.min(1, Math.max(0, g.y / r))
    const [vx, vy] = air(g.x, g.y, t)
    const pace = 0.75 + 0.5 * depth
    g.vx = vx * pace
    g.vy = vy * pace
    // Wandering more as it ages: a trace frays into scattered matter.
    const wander = (0.0012 + 0.004 * (age / g.life)) * Math.sqrt(dt)
    g.x += g.vx * dt + (Math.random() - 0.5) * wander
    g.y += g.vy * dt + (Math.random() - 0.5) * wander * 0.6
  }
}

/** A soft round sprite for the mist. */
function mistSprite(rgb) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, `rgba(${rgb}, 1)`)
  g.addColorStop(0.45, `rgba(${rgb}, 0.45)`)
  g.addColorStop(1, `rgba(${rgb}, 0)`)
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  return c
}

const TONES = ['130, 120, 190', '116, 96, 192']
const LEVELS = 6
/** The most residue a cell of the air may show (sum of grain strengths), and the cells. */
const CAP = 4
const CELLS = [36, 10]
/** Seconds of motion each grain is stretched over, as in a long exposure. */
const EXPOSURE = 3.2

function draw(ctx, grains, t, W, H, sprites) {
  ctx.clearRect(0, 0, W, H)
  const r = H / W
  // How much of each grain shows, before the density cap.
  const counts = new Float32Array(CELLS[0] * CELLS[1])
  for (const g of grains) {
    g.a = 0
    if (!g.lit) continue
    const age = (t + g.offset) % g.life
    const life = smooth(2.5, 5.5, age) * (1 - smooth(0.68, 1, age / g.life))
    if (life <= 0) continue
    const a = life * visible(g.x, g.y / r, t)
    if (a < 0.02) continue
    g.a = a
    g.cell = Math.min(CELLS[0] - 1, Math.max(0, Math.floor(g.x * CELLS[0]))) + CELLS[0] * Math.min(CELLS[1] - 1, Math.max(0, Math.floor((g.y / r) * CELLS[1])))
    counts[g.cell] += a * (g.mist ? 0.3 : 1)
  }
  const unit = W / 1000
  // Mist: broad, very faint, growing as it ages.
  for (const g of grains) {
    if (!g.mist || g.a <= 0) continue
    const age = (t + g.offset) % g.life
    const cap = Math.min(1, CAP * 3 / Math.max(counts[g.cell], 1e-6))
    const size = (16 + 60 * (age / g.life)) * unit * (0.8 + 0.5 * (g.y / r))
    const pearl = low(g.x, g.y / r, t)
    ctx.globalAlpha = (pearl ? 0.24 : 0.07) * g.a * cap
    ctx.drawImage(sprites[pearl ? 0 : 1], g.x * W - size, g.y * W - size * 0.45, size * 2, size * 0.9)
  }
  ctx.globalAlpha = 1
  // Grains: short strokes along their own motion, batched by tone, strength and width.
  const paths = new Map()
  for (const g of grains) {
    if (g.mist || g.a <= 0) continue
    const cap = Math.min(1, CAP / Math.max(counts[g.cell], 1e-6))
    const level = Math.min(LEVELS - 1, Math.floor(g.a * cap * LEVELS))
    if (level < 0) continue
    const depth = Math.min(1, Math.max(0, g.y / r))
    const width = depth < 0.4 ? 0 : depth < 0.7 ? 1 : 2
    const tone = stain(g.x, g.y / r, t)
    const key = tone * 100 + level * 10 + width
    let p = paths.get(key)
    if (!p) paths.set(key, (p = []))
    // Stretched along its motion, as in a long exposure; one moving steeply
    // stays nearly round (no rain), as in the World.
    const steep = Math.abs(g.vy) / Math.max(1e-9, Math.hypot(g.vx, g.vy))
    const stretch = EXPOSURE * W * (1 - 0.85 * smooth(0.3, 0.7, steep))
    const dx = g.vx * stretch
    const dy = g.vy * stretch
    p.push(g.x * W - dx, g.y * W - dy, g.x * W, g.y * W)
  }
  ctx.lineCap = 'round'
  for (const [key, p] of paths) {
    const tone = Math.floor(key / 100)
    const level = Math.floor((key % 100) / 10)
    const width = key % 10
    ctx.strokeStyle = `rgba(${TONES[tone]}, ${(0.03 + 0.085 * ((level + 1) / LEVELS)).toFixed(3)})`
    ctx.lineWidth = (1.5 + 0.9 * width) * unit * 1.4
    ctx.beginPath()
    for (let i = 0; i < p.length; i += 4) {
      ctx.moveTo(p[i], p[i + 1])
      ctx.lineTo(p[i + 2], p[i + 3])
    }
    ctx.stroke()
  }
}

export default function PortalAir() {
  const canvas = useRef(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return undefined
    const ctx = el.getContext('2d')
    const grains = makeGrains()
    const sprites = [mistSprite('248, 246, 255'), mistSprite('206, 196, 238')]
    let W = 0
    let H = 0
    const size = () => {
      W = Math.round(el.clientWidth * AIR.resolution)
      H = Math.round(el.clientHeight * AIR.resolution)
      if (W > 0 && H > 0 && (el.width !== W || el.height !== H)) {
        el.width = W
        el.height = H
      }
    }
    size()
    const observer = new ResizeObserver(size)
    observer.observe(el)

    // The air opens already moving.
    let t = 0
    const r0 = H > 0 ? H / W : 0.25
    for (; t < AIR.warmup; t += 0.2) step(grains, t, 0.2, r0)

    if (reducedMotion()) {
      if (W > 0) draw(ctx, grains, t, W, H, sprites)
      return () => observer.disconnect()
    }

    let frame = 0
    let last = performance.now()
    let shown = 0
    const tick = (now) => {
      frame = requestAnimationFrame(tick)
      // (A frame's timestamp can precede the time taken at setup: never step backwards.)
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      if (W <= 0 || H <= 0) return
      t += dt
      step(grains, t, dt, H / W)
      // About 30 frames a second is enough for air this slow.
      shown += dt
      if (shown < 1 / 30) return
      shown = 0
      draw(ctx, grains, t, W, H, sprites)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvas} className="portal-residue" aria-hidden="true" />
}
