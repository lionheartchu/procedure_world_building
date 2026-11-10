import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildScatterGeometry } from '../lib/traceForms'
import { chooseEntry, formProxy, Presence, PRESENCE, supportAt } from '../lib/presence'

/**
 * Study 11, first-person exploration (phase A), behind `?presence=1`: the
 * visitor inside Explore's own world, through Explore's own camera. Nothing
 * new is drawn and the world is not touched; this only moves the camera.
 *
 *   - entering: the orbit controls let go, and the camera drifts down out
 *     of the overview to a place in front of a colony's anchor membrane
 *     (the most established colony near where the overview looks), arriving
 *     along its gaze
 *   - inside: the camera is the presence (lib/presence.js): dragging turns
 *     the gaze, keys and the wheel drift it, and the air carries it a little
 *   - leaving (the control, or Escape): it rises and drifts back to the
 *     overview it left, and the orbit controls take over from there
 *
 * The forms it meets are the colony's own geometry, built the way
 * ScatterLayers builds it, once per world, on entering. With the lifecycle
 * (study 10) on, its residents change shape, so they are left out of it.
 */

/** The view inside (vertical field of view), and how long a flight takes: by distance, within limits (s). */
const FLIGHT = { fov: 56, min: 3.4, max: 5.6, perUnit: 0.12 }

/** Keys by physical position (`code`), so they stay where they are on any layout. */
const KEYS = {
  KeyW: ['forward', 1],
  ArrowUp: ['forward', 1],
  KeyS: ['forward', -1],
  ArrowDown: ['forward', -1],
  KeyA: ['strafe', -1],
  ArrowLeft: ['strafe', -1],
  KeyD: ['strafe', 1],
  ArrowRight: ['strafe', 1],
  KeyE: ['rise', 1],
  KeyQ: ['rise', -1],
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoother = (s) => s * s * s * (s * (s * 6 - 15) + 10)
const typing = (el) => el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))

/** A camera at p looking at q, as heading and pitch (the presence's own terms; never any roll). */
function looking(p, q) {
  const d = q.clone().sub(p)
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }
}

/** The camera's heading and pitch now. */
function facing(camera) {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  return { yaw: e.y, pitch: e.x }
}

/** The shortest turn from heading a to heading b. */
const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/** A point on the cubic from a through b and c to d. */
function bezier(a, b, c, d, s, out) {
  const u = 1 - s
  return out
    .copy(a)
    .multiplyScalar(u * u * u)
    .addScaledVector(b, 3 * u * u * s)
    .addScaledVector(c, 3 * u * s * s)
    .addScaledVector(d, s * s * s)
}

/** The most established colony near where the overview looks, its anchor, and a place to arrive. */
function arrival(world, proxy, scatter, target, view) {
  const anchors = scatter.layers.bloom.instances.filter((b) => b.role === 'anchor')
  const ranked = scatter.colonies
    .map((c) => ({ c, s: c.maturity / (1 + Math.hypot(c.x - target.x, c.z - target.z) / 6) }))
    .sort((a, b) => b.s - a.s)
  for (const { c } of ranked) {
    const anchor = anchors.find((a) => a.colony === c.index)
    const entry = anchor && chooseEntry(world, proxy, c, anchor, view)
    if (entry) return { ...entry, colony: c.index }
  }
  // No clear place in front of any anchor: above the first colony, looking down into it.
  const c = scatter.colonies[0]
  const y = supportAt(world, c.x, c.z)
  return { p: [c.x, y + 2.4, c.z + 2.6], look: [c.x, y + 0.4, c.z], colony: c.index }
}

/**
 * The forms the presence meets, from the colony's own geometry (geometry
 * discarded after). Membranes drawn elsewhere (`withhold`: the Habitat's
 * residents and its encounter) are left out; `contacts` yield instead.
 */
function buildBody(world, scatter, lifecycle, colonies, withhold = [], contacts = [], forms = [], smooth = false, bound = PRESENCE.bound, nearAir = false, unstick = false) {
  const residents = [...(lifecycle?.active ? lifecycle.first : []), ...withhold]
  const bloom = scatter.layers.bloom
  const placed = residents.length
    ? { ...scatter, layers: { ...scatter.layers, bloom: { ...bloom, instances: bloom.instances.filter((i) => !residents.includes(i)) } } }
    : scatter
  const geometry = buildScatterGeometry(placed, world)
  const positions = []
  for (const part of [geometry.bridgework.solid, geometry.bridgework.film, geometry.bloom.film, geometry.bloom.solid]) {
    if (part?.attributes?.position) positions.push(part.attributes.position.array)
  }
  const proxy = formProxy([...positions, ...forms], { size: world.size })
  for (const layer of Object.values(geometry)) for (const part of Object.values(layer ?? {})) part?.dispose?.()
  return new Presence({ world, proxy, colonies, blooms: bloom.instances, contacts, smooth, bound, nearAir, unstick })
}

/** Nothing withheld, no contacts (stable defaults). */
const NONE = []

/**
 * The Habitat passes `arrival` (a fixed place to arrive at, { p, look }),
 * `withhold` and `contacts` (see buildBody), `forms` (more surfaces to meet,
 * as vertex arrays: the spatial studies' vessels), `smooth` (the presence's
 * smooth motion, and a step aligned to the display's frames), and no `onLeave`: Escape then
 * does nothing, as there is no overview to return to.
 */
export default function PresenceCamera({ world, scatter, lifecycle, air, inside, onLeave, arrival: fixed = null, withhold = NONE, contacts = NONE, forms = NONE, smooth = false, bound = PRESENCE.bound, nearAir = false, unstick = false }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const element = useThree((s) => s.events.connected)

  // overview | entering | inside | leaving
  const phase = useRef('overview')
  const body = useRef(null)
  const saved = useRef(null)
  const flight = useRef(null)
  const clock = useRef(0)
  const input = useRef({ keys: new Set(), fast: false, turn: [0, 0], wheel: 0, drag: null })
  const settings = useRef(air)
  const leave = useRef(onLeave)
  useEffect(() => {
    settings.current = air
    leave.current = onLeave
  }, [air, onLeave])

  // The body belongs to one world: begun again when the world or its colonies change.
  const ensureBody = () => {
    const key = [world, scatter, lifecycle?.active ? lifecycle : null, withhold, contacts, forms, smooth, bound, nearAir, unstick]
    const b = body.current
    if (b && b.key.every((k, i) => k === key[i])) return b
    const next = buildBody(world, scatter, lifecycle, scatter.colonies, withhold, contacts, forms, smooth, bound, nearAir, unstick)
    next.key = key
    if (b) next.place(b.p, b.yaw, b.pitch)
    body.current = next
    return next
  }

  const fly = (to, { rise = 0, approach = null }) => {
    const from = { p: camera.position.clone(), ...facing(camera), fov: camera.fov }
    const dist = from.p.distanceTo(to.p)
    const c1 = from.p.clone().lerp(to.p, 0.4)
    c1.y = Math.max(from.p.y, to.p.y) + rise
    const c2 = to.p.clone()
    if (approach) c2.addScaledVector(approach, -2).add(new THREE.Vector3(0, 0.8, 0))
    else c2.lerp(from.p, 0.35).add(new THREE.Vector3(0, 0.8, 0))
    flight.current = { from, to, c1, c2, t: 0, D: clamp(FLIGHT.min + dist * FLIGHT.perUnit, FLIGHT.min, FLIGHT.max) }
  }

  // Entering and leaving follow the control (App's state), answered in the frame loop.
  const wanted = useRef(inside)
  useEffect(() => {
    wanted.current = inside
  }, [inside])

  const enter = () => {
    // A control left focused in the panel would still take keys once it is hidden.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    if (phase.current === 'overview') {
      saved.current = {
        p: camera.position.clone(),
        target: controls ? controls.target.clone() : new THREE.Vector3(0, -0.8, 0),
        fov: camera.fov,
      }
    }
    if (controls) controls.enabled = false
    const b = ensureBody()
    const view = saved.current.target.clone().sub(saved.current.p).setY(0).normalize()
    const entry = fixed ?? arrival(world, b.proxy, scatter, saved.current.target, [view.x, view.z])
    const p = new THREE.Vector3(...entry.p)
    const look = new THREE.Vector3(...entry.look)
    const along = look.clone().sub(p).setY(0).normalize()
    fly({ p, ...looking(p, look), fov: FLIGHT.fov }, { rise: 0.5, approach: along })
    phase.current = 'entering'
  }

  const leaveNow = () => {
    const s = saved.current
    fly({ p: s.p.clone(), ...looking(s.p, s.target), fov: s.fov }, { rise: 0.8 })
    phase.current = 'leaving'
  }

  // Quiet while inside: the panel and the title step back (PresenceControl.css).
  useEffect(() => {
    element?.classList.toggle('presence-inside', inside)
  }, [element, inside])

  // Input, while not in the overview: keys (taken before Explore's own
  // shortcuts see them), dragging to look, the wheel to drift.
  useEffect(() => {
    if (!element) return undefined
    const state = input.current
    const active = () => phase.current !== 'overview'
    const onKeyDown = (event) => {
      if (!active() || typing(event.target)) return
      if (event.code === 'Escape') {
        leave.current?.()
        return
      }
      if (event.key === 'Shift') state.fast = true
      if (event.metaKey || event.ctrlKey || event.altKey || !KEYS[event.code]) return
      state.keys.add(event.code)
      event.preventDefault()
      event.stopPropagation()
    }
    const onKeyUp = (event) => {
      if (event.key === 'Shift') state.fast = false
      if (!state.keys.delete(event.code)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const release = () => {
      state.keys.clear()
      state.fast = false
      state.drag = null
      element.classList.remove('presence-looking')
    }
    const onDown = (event) => {
      // Only on the world itself, never on a control over it.
      if (phase.current !== 'inside' || event.button !== 0 || event.target !== element) return
      state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
      element.setPointerCapture?.(event.pointerId)
      element.classList.add('presence-looking')
    }
    const onMove = (event) => {
      const d = state.drag
      if (!d || event.pointerId !== d.id) return
      state.turn[0] += event.clientX - d.x
      state.turn[1] += event.clientY - d.y
      d.x = event.clientX
      d.y = event.clientY
    }
    const onUp = (event) => {
      if (!state.drag || event.pointerId !== state.drag.id) return
      state.drag = null
      element.classList.remove('presence-looking')
    }
    const onWheel = (event) => {
      if (phase.current !== 'inside') return
      event.preventDefault()
      state.wheel += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', release)
    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', release)
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
      element.removeEventListener('wheel', onWheel)
      release()
    }
  }, [element])

  // Leaving Explore (or the flag) mid-visit: straight back to the overview it left.
  useEffect(
    () => () => {
      element?.classList.remove('presence-inside', 'presence-looking')
      if (phase.current === 'overview' || !saved.current) return
      const s = saved.current
      camera.position.copy(s.p)
      camera.fov = s.fov
      camera.updateProjectionMatrix()
      if (controls) {
        controls.target.copy(s.target)
        controls.enabled = true
        controls.update()
      } else camera.lookAt(s.target)
      phase.current = 'overview'
    },
    [camera, controls, element],
  )

  // Scripted checks (the flag only, like the lifecycle's).
  useEffect(() => {
    window.__presence = {
      get phase() {
        return phase.current
      },
      get body() {
        return body.current
      },
    }
    return () => {
      delete window.__presence
    }
  }, [])

  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const point = useRef(new THREE.Vector3())
  // The display's frame interval, learnt from the frames themselves (smooth only).
  const frame = useRef(1 / 60)
  useFrame((_, delta) => {
    let dt = Math.min(delta, 0.05)
    if (smooth) {
      // R3F's delta is the time between callbacks, which wander around the
      // display's frames by a few percent. Moving by it makes each frame's
      // step a little uneven at an even frame rate. Here the step is a whole
      // number of display frames: as even as the frames themselves, and a
      // dropped frame still counts as two.
      // A faster display than assumed (or than before): learn it at once.
      if (delta > 0.003 && delta < frame.current * 0.7) frame.current = delta
      const f = frame.current
      const n = Math.max(1, Math.round(delta / f))
      if (n === 1 && delta > 0.003) frame.current += (delta - f) * 0.05
      dt = Math.min(n * frame.current, 0.05)
    }
    clock.current += dt
    const now = phase.current
    if (wanted.current && (now === 'overview' || now === 'leaving')) enter()
    else if (!wanted.current && (now === 'entering' || now === 'inside')) leaveNow()
    const f = flight.current
    if ((phase.current === 'entering' || phase.current === 'leaving') && f) {
      f.t += dt
      const s = clamp(f.t / f.D, 0, 1)
      const e = smoother(s)
      const p = bezier(f.from.p, f.c1, f.c2, f.to.p, e, point.current)
      // Never through the ground or a form on the way.
      const b = body.current
      if (b) {
        const near = b.proxy.nearest(p.x, p.y, p.z, PRESENCE.reach)
        if (near) p.addScaledVector(new THREE.Vector3(near.nx, near.ny, near.nz), PRESENCE.reach - near.d)
      }
      p.y = Math.max(p.y, supportAt(world, p.x, p.z) + PRESENCE.floor + 0.1)
      camera.position.copy(p)
      // The gaze turns a little later than the body moves and settles a
      // little sooner; by heading and pitch, so it never sweeps over the top.
      // It keeps looking down at the world while high: going in, it lifts
      // only as it arrives; coming out, it lowers early.
      const g = smoother(clamp((s - 0.08) / 0.82, 0, 1))
      const gp = phase.current === 'entering' ? smoother(clamp((s - 0.3) / 0.65, 0, 1)) : smoother(clamp(s / 0.55, 0, 1))
      const yaw = f.from.yaw + turn(f.from.yaw, f.to.yaw) * g
      const pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * gp
      camera.quaternion.setFromEuler(euler.current.set(pitch, yaw, 0, 'YXZ'))
      camera.fov = f.from.fov + (f.to.fov - f.from.fov) * e
      camera.updateProjectionMatrix()
      if (s < 1) return
      flight.current = null
      if (phase.current === 'entering') {
        body.current.place(camera.position.toArray(), f.to.yaw, f.to.pitch)
        phase.current = 'inside'
      } else {
        phase.current = 'overview'
        if (controls) {
          controls.target.copy(saved.current.target)
          controls.enabled = true
          controls.update()
        }
      }
      return
    }
    if (phase.current !== 'inside' || !body.current) return

    const b = ensureBody()
    const state = input.current
    const move = { forward: 0, strafe: 0, rise: 0 }
    for (const code of state.keys) {
      const [axis, sign] = KEYS[code]
      move[axis] += sign
    }
    b.step(
      dt,
      {
        forward: clamp(move.forward, -1, 1),
        strafe: clamp(move.strafe, -1, 1),
        rise: clamp(move.rise, -1, 1),
        fast: state.fast,
        turn: state.turn,
        wheel: state.wheel,
      },
      settings.current,
      clock.current,
    )
    state.turn = [0, 0]
    state.wheel = 0
    camera.position.set(b.p[0], b.p[1], b.p[2])
    camera.quaternion.setFromEuler(euler.current.set(b.pitch, b.yaw, 0, 'YXZ'))
  })

  return null
}
