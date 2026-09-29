import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/** Longest edge of the saved thumbnail, in pixels. */
const THUMBNAIL_WIDTH = 320

/**
 * Lives inside a Canvas and hands the outside world a function that grabs the
 * current frame as a small JPEG data URL.
 *
 * Both scenes set `preserveDrawingBuffer: true` so the buffer is still readable
 * when this runs; the frame is re-rendered first anyway, which makes the capture
 * independent of where it happens in the frame loop.
 */
export default function CanvasCapture({ onReady }) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  useEffect(() => {
    onReady(() => {
      gl.render(scene, camera)
      const source = gl.domElement
      if (!source.width || !source.height) return null

      const scale = THUMBNAIL_WIDTH / source.width
      const target = document.createElement('canvas')
      target.width = THUMBNAIL_WIDTH
      target.height = Math.max(1, Math.round(source.height * scale))
      const context = target.getContext('2d')
      if (!context) return null
      context.drawImage(source, 0, 0, target.width, target.height)
      return target.toDataURL('image/jpeg', 0.72)
    })

    return () => onReady(null)
  }, [gl, scene, camera, onReady])

  return null
}
