import { useEffect, useRef } from 'react'
import { SED_DISPLAY } from '../lib/sediment'
import { simulationColor } from '../lib/palette'

const REDRAW_INTERVAL = 1000 / 20

/**
 * SIMULATION FIELD — where sediment is currently sitting and moving.
 *
 * Reads the simulation arrays directly on its own animation frame loop, so it
 * stays in step with the 3D scene without either one owning the other. It
 * redraws only when the simulation has actually advanced.
 */
export default function SimulationMap({ sim }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const res = sim.res
    canvas.width = res
    canvas.height = res

    const ctx = canvas.getContext('2d')
    const image = ctx.createImageData(res, res)
    let frame = 0
    let lastVersion = -1
    let lastDraw = 0

    const draw = (now) => {
      frame = requestAnimationFrame(draw)
      if (sim.version === lastVersion) return
      if (now - lastDraw < REDRAW_INTERVAL) return

      lastVersion = sim.version
      lastDraw = now

      const { sediment, activity } = sim
      for (let i = 0; i < sediment.length; i++) {
        const [r, g, b] = simulationColor(sediment[i] / SED_DISPLAY, activity[i])
        const p = i * 4
        image.data[p] = Math.min(255, r * 255 + 6)
        image.data[p + 1] = Math.min(255, g * 255 + 6)
        image.data[p + 2] = Math.min(255, b * 255 + 10)
        image.data[p + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [sim])

  return (
    <figure className="map-panel">
      <figcaption className="map-label">
        <span>Sediment</span>
        <span className="map-meta">
          {sim.res}×{sim.res}
        </span>
      </figcaption>
      <canvas ref={canvasRef} className="map-canvas" />
    </figure>
  )
}
