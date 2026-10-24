import { useEffect, useRef, useState } from 'react'
import { CONDUIT } from '../lib/conduit'

/**
 * Study 10's inspector, shown only with `?lifecycle=1`: what each resident is
 * doing, the last few events, where the matter is (the ledger), and a small
 * map of the live residual around the colony (lilac), with standing
 * residents (pearl dots), old contours (rings) and films (small dots).
 * Pause, speed, reset and the warm accent's variant are for development.
 * Not part of Explore.
 */

/** World units shown either side of the colony's centre (wider with the shared conduit). */
const SPAN = 4.8
const SPAN_CONDUIT = 6.8
const SIZE = 140
const STAGE = { forming: 'forming', holding: 'holding', receding: 'lying down', releasing: 'releasing', ended: 'contour' }
/** The warm accent's variants (LifecycleLayer's WARM), a development A/B. */
const WARM_NAMES = ['off', '1 edge', '2 uptake', '3 deposit', 'A absorb', 'B growth']

function draw(canvas, life) {
  if (!canvas || !life?.active) return
  const ctx = canvas.getContext('2d')
  const { world } = life
  const span = life.conduit ? SPAN_CONDUIT : SPAN
  // With the shared tissue, centred on the colonies it joins.
  const cs = life.conduit?.colonies
  const colony = cs ? { x: cs.reduce((s, c) => s + c.x, 0) / cs.length, z: cs.reduce((s, c) => s + c.z, 0) / cs.length } : life.colony
  const img = ctx.createImageData(SIZE, SIZE)
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = colony.x + (px / SIZE - 0.5) * 2 * span
      const z = colony.z + (py / SIZE - 0.5) * 2 * span
      const [u, v] = world.toUV(x, z)
      const r = life.residualAt(u, v)
      const wet = world.groundY(u, v) < world.waterY
      const a = Math.min(1, r / 0.02)
      const k = (py * SIZE + px) * 4
      const base = wet ? [24, 26, 58] : [40, 38, 70]
      img.data[k] = base[0] + (210 - base[0]) * a
      img.data[k + 1] = base[1] + (196 - base[1]) * a
      img.data[k + 2] = base[2] + (240 - base[2]) * a
      img.data[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const toPx = (x, z) => [((x - colony.x) / (2 * span) + 0.5) * SIZE, ((z - colony.z) / (2 * span) + 0.5) * SIZE]
  if (life.conduit) {
    // The tissue: its edges, as thick as they are used, warm as much as matter they hold.
    const C = life.conduit
    for (let e = 0; e < C.edgeCount; e++) {
      const a = C.a[e]
      const b = C.b[e]
      const m = (life.tissue[a] + life.tissue[b]) / 2
      const [ax, az] = toPx(C.x[a], C.z[a])
      const [bx, bz] = toPx(C.x[b], C.z[b])
      ctx.strokeStyle = m > 2e-4 ? `rgba(235, 219, 182, ${Math.min(1, 0.3 + m / 0.004)})` : 'rgba(164, 157, 204, 0.45)'
      ctx.lineWidth = 0.6 + 0.5 * C.g[e]
      ctx.beginPath()
      ctx.moveTo(ax, az)
      ctx.lineTo(bx, bz)
      ctx.stroke()
    }
    if (life.fold) {
      // The fold study's stretch, outlined.
      ctx.strokeStyle = 'rgba(240, 236, 252, 0.55)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      life.fold.nodes.forEach((n, k) => {
        const [x, z] = toPx(C.x[n], C.z[n])
        if (k) ctx.lineTo(x, z + 4)
        else ctx.moveTo(x, z + 4)
      })
      ctx.stroke()
      ctx.setLineDash([])
    }
    for (const site of life.sites) {
      const [hx, hz] = toPx(site.colony.x, site.colony.z)
      ctx.fillStyle = 'rgba(235, 219, 182, 0.85)'
      ctx.font = '9px system-ui'
      ctx.fillText(`c${site.colony.index} ${site.pocket.matter.toFixed(3)}`, hx - 14, hz + 14)
    }
  }
  for (const f of life.films) {
    if (f.state !== 'flight') continue
    const [fx, fz] = toPx(f.p[0], f.p[2])
    ctx.fillStyle = 'rgba(236, 230, 250, 0.9)'
    ctx.fillRect(fx - 1, fz - 1, 2, 2)
  }
  for (const r of life.residents) {
    const [rx, rz] = toPx(r.desc.p[0], r.desc.p[2])
    ctx.beginPath()
    ctx.arc(rx, rz, 3, 0, Math.PI * 2)
    if (r.stage === 'ended') {
      ctx.strokeStyle = 'rgba(243, 238, 242, 0.5)'
      ctx.stroke()
    } else {
      ctx.fillStyle = r.stage === 'forming' ? '#E2BCE6' : '#F3EEF2'
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(243, 238, 242, 0.75)'
    ctx.font = '9px system-ui'
    ctx.fillText(String(r.id), rx + 4, rz - 3)
  }
}

const describe = (e) => {
  if (e.kind === 'release') return `#${e.resident} released ${e.matter}`
  if (e.kind === 'settle') return `film from #${e.from} settled${e.underwater ? ' (shallows)' : ''}${e.recorded ? '' : ' · not recorded'}`
  if (e.kind === 'wait') return `waiting: ${e.matter} lain ${e.lain} s`
  if (e.kind === 'form' && e.viaTissue) return `#${e.resident} forms at colony ${e.colony} on ${Object.entries(e.viaTissue).map(([k, v]) => `${k} ${v}`).join(', ')} via the tissue`
  if (e.kind === 'form') return `#${e.resident} forms on ${Object.entries(e.on).map(([k, v]) => `${k} ${v}`).join(', ')}, lean ${e.lean}°`
  if (e.kind === 'seep') return `${e.matter} sank into the tissue`
  if (e.kind === 'arrive') return `colony ${e.colony}'s pocket holds ${e.matter}`
  if (e.kind === 'begin') return `tissue begins under #${e.resident}`
  if (e.kind === 'reach') return `tissue from colony ${e.from} reaches colony ${e.colony}`
  if (e.kind === 'lost') return `film lost past the field`
  return e.kind
}

/** The fold study's stretch (`&fold=1`): where it is, and how used and how full it is now. */
function foldLine(life) {
  if (!life.foldStudy) return null
  const f = life.fold
  if (!f) return 'fold study: no stretch has carried enough yet'
  const C = life.conduit
  const U = CONDUIT.use
  let g = 0
  for (const e of f.edges) g += C.g[e]
  g /= f.edges.length
  let held = 0
  for (const n of f.nodes) held += life.tissue[n]
  const use = (g - U.floor) / (U.cap - U.floor)
  const state = use > 0.45 ? 'in use' : use > 0.1 ? 'thinning' : 'near dormant'
  return `fold study: colony ${f.colony}, ${f.length.toFixed(1)} units from its hub (chosen at ${f.at.toFixed(0)} s) · ${state}, thickness ${g.toFixed(1)} of ${U.cap} · in it ${held.toFixed(4)}`
}

export default function LifecycleInspector({ lifecycle, onReset }) {
  const [status, setStatus] = useState(null)
  const canvas = useRef(null)

  useEffect(() => {
    if (!lifecycle?.active) return undefined
    const tick = () => {
      setStatus({ ...lifecycle.status(), fold: foldLine(lifecycle) })
      draw(canvas.current, lifecycle)
    }
    tick()
    const id = setInterval(tick, 400)
    return () => clearInterval(id)
  }, [lifecycle])

  const style = {
    position: 'fixed',
    left: 'clamp(1rem, 2.5vw, 1.75rem)',
    bottom: 'calc(clamp(1rem, 2.5vw, 1.75rem) + env(safe-area-inset-bottom, 0px))',
    zIndex: 5,
    width: '18.5rem',
    padding: '0.75rem 0.85rem',
    background: 'rgba(14, 16, 38, 0.84)',
    border: '1px solid rgba(141, 134, 184, 0.25)',
    font: '0.62rem/1.45 var(--body, system-ui)',
    letterSpacing: '0.02em',
    color: 'rgba(198, 191, 228, 0.88)',
  }
  const button = {
    font: 'inherit',
    color: 'inherit',
    background: 'transparent',
    border: '1px solid rgba(141, 134, 184, 0.35)',
    padding: '0.1rem 0.45rem',
    marginRight: '0.3rem',
    cursor: 'pointer',
  }
  if (!lifecycle?.active) return <aside style={style}>Lifecycle (study 10, dev): no residents in this world</aside>
  const s = status
  const g = s?.ledger
  const set = (fn) => () => {
    fn()
    setStatus(lifecycle.status())
  }
  return (
    <aside style={style} aria-label="Lifecycle inspector">
      <div style={{ textTransform: 'uppercase', letterSpacing: '0.16em', opacity: 0.7 }}>Lifecycle · study 10 · dev</div>
      <div style={{ margin: '0.35rem 0' }}>
        <button type="button" style={button} onClick={set(() => lifecycle.setPaused(!lifecycle.paused))}>
          {s?.paused ? 'resume' : 'pause'}
        </button>
        {[1, 4, 8].map((k) => (
          <button key={k} type="button" style={{ ...button, opacity: s?.speed === k ? 1 : 0.55 }} onClick={set(() => lifecycle.setSpeed(k))}>
            ×{k}
          </button>
        ))}
        <button type="button" style={button} onClick={onReset}>
          reset
        </button>
      </div>
      <div style={{ margin: '0 0 0.35rem' }}>
        warm accent{' '}
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <button key={k} type="button" style={{ ...button, opacity: s?.warm === k ? 1 : 0.55 }} onClick={set(() => lifecycle.setWarm(k))}>
            {WARM_NAMES[k]}
          </button>
        ))}
      </div>
      {s && (
        <>
          <div>
            t {s.t.toFixed(0)} s · feedback {s.feedback ? 'on' : 'off'} · films {s.films.flight} in the air
          </div>
          {s.residents.map((r) => (
            <div key={r.id}>
              #{r.id} {r.origin === 'formed' ? 'new' : 'first'} · {STAGE[r.stage]}
              {r.stage === 'ended' ? ` · contour ${r.contour.toFixed(3)}` : ` · body ${r.body.toFixed(3)} · unfold ${r.unfold.toFixed(2)}`}
            </div>
          ))}
          <div style={{ marginTop: '0.3rem', opacity: 0.8 }}>
            matter: bodies {g.bodies.toFixed(3)} · air {g.flight.toFixed(3)} · residue {g.residual.toFixed(3)} · contours {g.contours.toFixed(3)}
            {g.tissue !== undefined ? ` · in the tissue ${g.tissue.toFixed(3)} · grown into it ${g.structure.toFixed(3)} · pockets ${g.pockets.toFixed(3)}` : ''}
            {s.tissue ? ` · tissue: ${s.tissue.nodes} nodes, ${s.tissue.growing} tips growing, ${s.tissue.dormant} dormant, ${s.tissue.fusions} fusions` : ''}
            {s.fold ? ` · ${s.fold}` : ''}
            {g.out > 0 ? ` · out ${g.out.toFixed(3)}` : ''} · total {g.total.toFixed(4)} (began {s.initial.toFixed(4)})
          </div>
          <div style={{ marginTop: '0.3rem' }}>
            {s.events.map((e, k) => (
              <div key={k} style={{ opacity: 0.6 + 0.08 * k }}>
                {e.t.toFixed(0)} s · {describe(e)}
              </div>
            ))}
          </div>
        </>
      )}
      <canvas ref={canvas} width={SIZE} height={SIZE} style={{ display: 'block', marginTop: '0.45rem', width: SIZE, height: SIZE }} />
    </aside>
  )
}
