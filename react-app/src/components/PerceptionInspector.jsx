import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { perceive, READINGS } from '../lib/perception'

/**
 * Study 23's development inspector (the Habitat's `?perceive=1`): what one
 * resident could read where it stands (lib/perception.js), over time. It
 * follows the resident nearest the visitor; P pins it. A survey reads every
 * standing resident at once, to see which readings differ across the world
 * (a reading that is the same everywhere could not tell residents apart).
 * Reads only: nothing in the world reads it or is changed by it.
 */

/** Samples kept per reading (every 0.5 s: about 90 s), and how often it samples (s). */
const KEEP = 180
const EVERY = 0.5

export function createPerceptionStore() {
  return { sel: null, pinned: null, history: {}, now: null, version: 0, survey: null, wantSurvey: false, where: null }
}

const standing = (r) => r.stage !== 'ended'

/** Inside the scene: samples the chosen resident, and runs a survey when asked. */
export function PerceptionProbe({ store, lifecycles, accumulation, encounter }) {
  const camera = useThree((s) => s.camera)
  const since = useRef(EVERY)
  useFrame((_, delta) => {
    since.current += delta
    if (since.current < EVERY && !store.wantSurvey) return
    since.current = 0
    const p = camera.position
    const visitor = [p.x, p.y, p.z]
    const ctx = { lifecycles, accumulation, visitor, encounter }

    let sel = store.pinned
    if (!sel) {
      let best = Infinity
      for (const life of lifecycles) {
        for (const r of life.residents) {
          if (!standing(r)) continue
          const d = Math.hypot(r.desc.p[0] - p.x, r.desc.p[2] - p.z)
          if (d < best) {
            best = d
            sel = { life, r }
          }
        }
      }
    }
    if (sel) {
      if (!store.sel || store.sel.r !== sel.r) store.history = {}
      store.sel = sel
      const now = perceive(sel.life, sel.r, ctx)
      store.now = now
      for (const k in now) {
        const h = (store.history[k] ??= [])
        h.push(now[k])
        if (h.length > KEEP) h.shift()
      }
      // Where it is from the visitor: distance, and how far off the gaze (degrees, + right).
      const dx = sel.r.desc.p[0] - p.x
      const dz = sel.r.desc.p[2] - p.z
      const fwd = camera.getWorldDirection(camera.position.clone())
      const ang = Math.atan2(fwd.x * dz - fwd.z * dx, fwd.x * dx + fwd.z * dz)
      store.where = { d: Math.hypot(dx, dz), deg: Math.round((ang * 180) / Math.PI) }
    }

    if (store.wantSurvey) {
      store.wantSurvey = false
      const rows = []
      for (const life of lifecycles) for (const r of life.residents) if (standing(r)) rows.push(perceive(life, r, ctx))
      const stats = {}
      for (const { key } of READINGS) {
        const vals = rows.map((q) => q[key]).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b)
        if (!vals.length) continue
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
        stats[key] = { n: vals.length, min: vals[0], median: vals[Math.floor(vals.length / 2)], max: vals[vals.length - 1], spread: mean !== 0 ? sd / Math.abs(mean) : 0 }
      }
      store.survey = { at: lifecycles[0]?.t ?? 0, count: rows.length, stats }
    }
    store.version++
  })
  return null
}

const fmt = (v) => {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (a >= 100) return v.toFixed(0)
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.001) return v.toFixed(3)
  return v.toExponential(1)
}

const KIND = {
  functional: { title: 'Functional', note: 'a lifecycle rule reads it now', color: '#E6DEFA' },
  available: { title: 'Available', note: 'derivable from existing state; no rule reads it', color: '#B7B0D6' },
  rendered: { title: 'Rendered or not yet in the world', note: 'drawn, physical, or proposed', color: '#8F89B4' },
}

function Spark({ values, color }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')
    g.clearRect(0, 0, c.width, c.height)
    const vals = (values ?? []).filter((v) => v !== null && v !== undefined)
    if (vals.length < 2) return
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (hi - lo < 1e-9) {
      hi += 1e-9
      lo -= 1e-9
    }
    g.strokeStyle = color
    g.lineWidth = 1
    g.beginPath()
    vals.forEach((v, i) => {
      const px = (i / (KEEP - 1)) * c.width
      const py = c.height - 1 - ((v - lo) / (hi - lo)) * (c.height - 2)
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    })
    g.stroke()
  })
  return <canvas ref={ref} width={96} height={16} style={{ display: 'block' }} />
}

const STAGE = { forming: 'forming', holding: 'holding', receding: 'lying down', releasing: 'releasing', ended: 'contour' }

/** The panel (outside the scene). */
export default function PerceptionInspector({ store }) {
  const [, setTick] = useState(0)
  const panel = useRef(null)
  // The presence camera listens for the wheel on the Habitat's root (and
  // keeps it from scrolling); stop it at the panel, natively, so the panel
  // scrolls to its survey.
  useEffect(() => {
    const el = panel.current
    const stop = (e) => e.stopPropagation()
    el?.addEventListener('wheel', stop, { passive: true })
    return () => el?.removeEventListener('wheel', stop)
  }, [])
  useEffect(() => {
    let seen = -1
    const id = setInterval(() => {
      if (store.version !== seen) {
        seen = store.version
        setTick((t) => t + 1)
      }
    }, 250)
    const onKey = (e) => {
      if (e.code === 'KeyP' && !e.metaKey && !e.ctrlKey) store.pinned = store.pinned ? null : store.sel
    }
    window.addEventListener('keydown', onKey)
    // For scripted checks, like the Habitat's own diagnostics (`window.__habitat`).
    window.__perception = store
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onKey)
      delete window.__perception
    }
  }, [store])

  const sel = store.sel
  const now = store.now ?? {}
  const box = {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 5,
    width: 330,
    maxHeight: 'calc(100vh - 24px)',
    overflowY: 'auto',
    padding: '10px 12px',
    background: 'rgba(22, 20, 44, 0.78)',
    color: '#E6DEFA',
    font: '11px/1.35 ui-monospace, Menlo, monospace',
    borderRadius: 4,
    pointerEvents: 'auto',
    cursor: 'auto',
  }
  return (
    <div ref={panel} style={box} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>Perception (study 23, development)</div>
      {sel ? (
        <div style={{ marginBottom: 6, color: '#CFC7EE' }}>
          colony {sel.life.colony.index} · resident #{sel.r.id} · {STAGE[sel.r.stage]} {sel.r.stageTime.toFixed(0)} s
          <br />
          {store.where && `${store.where.d.toFixed(1)} from you, ${Math.abs(store.where.deg)}° ${store.where.deg >= 0 ? 'right' : 'left'}`} ·{' '}
          {store.pinned ? 'pinned (P to follow nearest)' : 'nearest (P to pin)'} · its colony's clock {sel.life.t.toFixed(0)} s
        </div>
      ) : (
        <div style={{ marginBottom: 6 }}>No resident standing nearby.</div>
      )}
      {Object.entries(KIND).map(([kind, K]) => (
        <div key={kind} style={{ marginTop: 6 }}>
          <div style={{ color: K.color, fontWeight: 600 }}>
            {K.title} <span style={{ fontWeight: 400, opacity: 0.7 }}>· {K.note}</span>
          </div>
          {READINGS.filter((q) => q.kind === kind).map((q) => (
            <div key={q.key} title={q.reads} style={{ display: 'grid', gridTemplateColumns: '1fr 62px 96px', alignItems: 'center', columnGap: 6, color: K.color }}>
              <span>
                {q.label}
                <span style={{ opacity: 0.55 }}> {q.unit}</span>
              </span>
              <span style={{ textAlign: 'right' }}>{fmt(now[q.key])}</span>
              <Spark values={store.history[q.key]} color={K.color} />
            </div>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => (store.pinned = store.pinned ? null : store.sel)}>{store.pinned ? 'Unpin' : 'Pin'}</button>
        <button type="button" onClick={() => (store.wantSurvey = true)}>Survey all standing residents</button>
      </div>
      {store.survey && (
        <div style={{ marginTop: 6 }}>
          <div style={{ opacity: 0.8 }}>
            Survey at t {store.survey.at.toFixed(0)} s, {store.survey.count} standing: min · median · max · spread (sd / mean)
          </div>
          {READINGS.filter((q) => store.survey.stats[q.key]).map((q) => {
            const s = store.survey.stats[q.key]
            return (
              <div key={q.key} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 40px', columnGap: 6, color: KIND[q.kind].color }}>
                <span>{q.label}</span>
                <span style={{ textAlign: 'right' }}>
                  {fmt(s.min)} · {fmt(s.median)} · {fmt(s.max)}
                </span>
                <span style={{ textAlign: 'right' }}>{s.spread.toFixed(2)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
