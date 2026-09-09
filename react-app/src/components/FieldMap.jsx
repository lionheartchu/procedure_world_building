import { useEffect, useMemo, useRef } from 'react'
import { buildHeightGrid } from '../lib/field'
import { sedimentColor } from '../lib/palette'

/**
 * BASE FIELD — a top-down read of the static height field.
 *
 * Drawn at exactly the terrain's grid resolution and coloured with the same
 * ramp as the terrain shader, so the map is the mesh seen from above rather
 * than a separate visualisation.
 */
export default function FieldMap({ field, resolution, waterLevel }) {
  const canvasRef = useRef(null)
  const grid = useMemo(() => buildHeightGrid(field, resolution), [field, resolution])
  const size = resolution + 1

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')
    const image = ctx.createImageData(size, size)

    for (let i = 0; i < grid.length; i++) {
      const [r, g, b] = sedimentColor(grid[i], waterLevel)
      const p = i * 4
      image.data[p] = Math.min(255, r * 255 + 6)
      image.data[p + 1] = Math.min(255, g * 255 + 6)
      image.data[p + 2] = Math.min(255, b * 255 + 10)
      image.data[p + 3] = 255
    }

    ctx.putImageData(image, 0, 0)
  }, [grid, size, waterLevel])

  return (
    <figure className="map-panel">
      <figcaption className="map-label">
        <span>Base field</span>
        <span className="map-meta">
          {size}×{size}
        </span>
      </figcaption>
      <canvas ref={canvasRef} className="map-canvas" />
    </figure>
  )
}
