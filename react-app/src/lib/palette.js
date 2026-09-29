/**
 * Trace Habitat palette and the shared height ramp.
 *
 * The ramp below is mirrored in GLSL inside `Terrain.jsx` (`rampColor`), so the
 * 2D field map and the 3D terrain describe the same material. If you change a
 * stop here, change it there too.
 */

export const PALETTE = {
  deepIndigo: '#0B0E1E',
  haze: '#232849',
  greyViolet: '#3A3A5C',
  fadedLavender: '#8D86B8',
  paleLavender: '#C6BFE6',
  moonlitMint: '#9FE8C8',
}

/** Ramp stops, keyed on height *relative to the water level*. */
export const RAMP = {
  deepBasin: [0.078, 0.094, 0.2], // #141833
  submerged: [0.188, 0.212, 0.376], // #303660
  wetMargin: [0.643, 0.616, 0.8], // #A49DCC
  flats: [0.424, 0.404, 0.6], // #6C6799
  midLavender: [0.553, 0.525, 0.722], // #8D86B8
  crest: [0.776, 0.749, 0.902], // #C6BFE6
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/**
 * Colour for a height, relative to the current water level.
 * Kept in sync with `rampColor()` in the terrain shader.
 */
export function sedimentColor(height, waterLevel) {
  const d = height - waterLevel

  let c = RAMP.deepBasin
  c = mix(c, RAMP.submerged, smoothstep(-0.35, -0.06, d))
  c = mix(c, RAMP.wetMargin, smoothstep(-0.06, 0.0, d))
  c = mix(c, RAMP.flats, smoothstep(0.0, 0.12, d))
  c = mix(c, RAMP.midLavender, smoothstep(0.1, 0.34, d))
  c = mix(c, RAMP.crest, smoothstep(0.32, 0.6, d))
  return c
}

/**
 * Colour scale for the 2D simulation map.
 * Near-background where there is no sediment, lavender where it gathers, and a
 * touch of mint only where material is actively moving.
 */
export function simulationColor(sediment01, activity01) {
  const s = clamp01(sediment01)
  let c = [0.055, 0.062, 0.125] // quiet ground, close to the background
  // The first band is deliberately steep: the moment sediment arrives in a
  // cell it should separate from the background.
  c = mix(c, [0.28, 0.27, 0.47], smoothstep(0.0, 0.22, s))
  c = mix(c, RAMP.midLavender, smoothstep(0.2, 0.6, s))
  c = mix(c, [0.84, 0.82, 0.95], smoothstep(0.6, 1.0, s))

  const a = clamp01(activity01)
  if (a > 0) c = mix(c, [0.624, 0.91, 0.784], Math.pow(a, 1.4) * 0.6)
  return c
}

/**
 * Colour for a point inside the sediment volume.
 *
 * Reads as stratigraphy rather than as a data ramp: pale where the mass meets
 * the air, deepening with burial, with the deposition layers showing as a
 * faint banding wherever the mass has been opened.
 *
 * @param burial     0 at the bed surface, 1 deep inside
 * @param strata     signed layer phase, -1..1
 * @param channel    0..1, how close the point is to a carved channel wall
 * @param scaffold   0..1, how close the point is to a scaffold strut
 */
export function volumeColor(burial, strata, channel, scaffold = 0) {
  const b = clamp01(burial)

  let c = RAMP.crest
  c = mix(c, RAMP.midLavender, smoothstep(0.02, 0.2, b))
  c = mix(c, RAMP.submerged, smoothstep(0.18, 0.55, b))
  c = mix(c, RAMP.deepBasin, smoothstep(0.55, 0.95, b))

  // Deposition banding — small, so it reads as material rather than stripes.
  const band = 1 + strata * 0.09
  c = [c[0] * band, c[1] * band, c[2] * band]

  // Mint only on the walls of a channel: the one surface here that water made.
  const trace = clamp01(channel)
  if (trace > 0) c = mix(c, [0.624, 0.91, 0.784], trace * 0.3)

  // The scaffold: paler and denser-looking than the sediment it grew through,
  // with mint gathering along the struts. Struts are a small fraction of the
  // surface, so the accent stays scarce without a rule to keep it scarce.
  const strut = clamp01(scaffold)
  if (strut > 0) {
    c = mix(c, [0.87, 0.85, 0.96], smoothstep(0.1, 0.72, strut) * 0.62)
    c = mix(c, [0.624, 0.91, 0.784], strut * strut * 0.2)
  }

  return c
}
