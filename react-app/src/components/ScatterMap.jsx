import { useEffect, useMemo, useRef } from 'react'
import { suitabilityGrid } from '../lib/scatter'

/** Drawn at twice the data resolution so the marks stay crisp. */
const SCALE = 2

/**
 * PLAN — the world from above, following the view selector.
 *
 * The colonies are always drawn, as faint rings around their sites. With the
 * whole colony selected it is otherwise a plain plan, land and water, with
 * every placed form marked. With one language soloed it becomes that
 * language's *suitability* — the product of its rules, where it is allowed
 * to appear — with only its own forms marked, so you can compare where a
 * form may go with where it actually went. The bottom edge is the side the
 * camera starts on.
 */
export default function ScatterMap({ world, scatter, streams, view, accumulation }) {
  const canvasRef = useRef(null)
  const layer = view === 'all' ? null : view

  const values = useMemo(
    () => (world && layer ? suitabilityGrid(world, layer, { shardAccumulation: accumulation }) : null),
    [world, layer, accumulation],
  )

  const coverage = useMemo(() => {
    if (!values) return null
    let n = 0
    for (const v of values) if (v > 0.5) n++
    return n / values.length
  }, [values])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !world) return
    const { res, channels, size } = world
    const W = res * SCALE
    canvas.width = W
    canvas.height = W
    const ctx = canvas.getContext('2d')

    const field = document.createElement('canvas')
    field.width = res
    field.height = res
    const fctx = field.getContext('2d')
    const image = fctx.createImageData(res, res)
    for (let i = 0; i < res * res; i++) {
      const wet = channels.depth[i] < 0
      // Water darker and cooler than land, so the shoreline always reads.
      const base = wet ? [16, 19, 44] : [40, 38, 70]
      const k = values
        ? Math.pow(values[i], 0.8)
        : 0
      const p = i * 4
      image.data[p] = base[0] + (212 - base[0]) * k
      image.data[p + 1] = base[1] + (206 - base[1]) * k
      image.data[p + 2] = base[2] + (240 - base[2]) * k
      image.data[p + 3] = 255
    }
    fctx.putImageData(image, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(field, 0, 0, W, W)

    if (!scatter) return
    const px = (x) => (x / size + 0.5) * W
    const show = (id) => !layer || layer === id
    const { layers, colonies } = scatter

    // Water veins: part of the world, so drawn under everything, quietly.
    if (streams?.lines) {
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(176, 186, 236, 0.75)'
      for (const sp of streams.lines) {
        for (let k = 1; k < sp.points.length; k++) {
          const a = sp.points[k - 1]
          const b = sp.points[k]
          ctx.lineWidth = Math.max(1, ((2 * sp.width[k]) / size) * W)
          ctx.beginPath()
          ctx.moveTo(px(a.x), px(a.z))
          ctx.lineTo(px(b.x), px(b.z))
          ctx.stroke()
        }
      }
    }

    ctx.strokeStyle = 'rgba(185, 178, 218, 0.45)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    for (const c of colonies) {
      ctx.beginPath()
      ctx.arc(px(c.x), px(c.z), (c.radius / size) * W, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.setLineDash([])

    if (!layer) {
      ctx.fillStyle = '#9FE8C8'
      for (const trail of layers.bead.instances) {
        for (const b of trail.beads) ctx.fillRect(px(b.x) - 0.75, px(b.z) - 0.75, 1.5, 1.5)
      }
    }

    if (show('shard')) {
      ctx.fillStyle = '#E8E4F8'
      for (const deposit of layers.shard.instances) {
        for (const p of deposit.plates) ctx.fillRect(px(p.x) - 1, px(p.z) - 1, 2, 2)
      }
    }

    if (show('bloom')) {
      ctx.strokeStyle = '#F4F2FF'
      ctx.lineWidth = 1.2
      for (const bloom of layers.bloom.instances) {
        ctx.beginPath()
        ctx.arc(px(bloom.p[0]), px(bloom.p[2]), 1.5 + bloom.height * 3, 0, Math.PI * 2)
        if (bloom.role === 'anchor') {
          ctx.fillStyle = '#F4F2FF'
          ctx.fill()
        } else ctx.stroke()
      }
    }

    if (show('bridgework')) {
      ctx.strokeStyle = '#FFFFFF'
      ctx.fillStyle = '#FFFFFF'
      ctx.lineWidth = 1.6
      for (const bridge of layers.bridgework.instances) {
        // A strand that stops short is drawn as far as it reaches, dashed.
        const end = bridge.end ?? 1
        const ex = bridge.a[0] + (bridge.b[0] - bridge.a[0]) * end
        const ez = bridge.a[2] + (bridge.b[2] - bridge.a[2]) * end
        ctx.lineWidth = bridge.type === 'span' ? 1.6 : 1
        ctx.setLineDash(end < 1 ? [3, 3] : [])
        ctx.beginPath()
        ctx.moveTo(px(bridge.a[0]), px(bridge.a[2]))
        ctx.lineTo(px(ex), px(ez))
        ctx.stroke()
        if (bridge.type === 'span') {
          ctx.fillRect(px(bridge.a[0]) - 2, px(bridge.a[2]) - 2, 4, 4)
          ctx.fillRect(px(bridge.b[0]) - 2, px(bridge.b[2]) - 2, 4, 4)
        }
      }
      ctx.setLineDash([])
    }

  }, [world, scatter, streams, values, layer])

  return (
    <figure className="map-panel">
      <figcaption className="map-label">
        <span>Plan</span>
        <span className="map-meta">
          {coverage !== null
            ? `${Math.round(coverage * 100)}% suitable`
            : `${scatter?.colonies.length ?? 0} colonies`}
        </span>
      </figcaption>
      <canvas ref={canvasRef} className="map-canvas" />
    </figure>
  )
}
