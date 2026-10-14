/**
 * Saved configurations (the Library): what is stored, and how a stored state
 * is read back.
 *
 * Pure, so old saves can be checked without the app. A state saved by any
 * earlier build is a plain object with some of { view, params, simParams,
 * volumeParams, scatterParams } (shaderParams only from the Explore build
 * on). Reading it back merges each part over the current defaults, so a save
 * that predates a control cannot leave it undefined, and ignores a view this
 * build does not know.
 */

/** Every view this build can show: Explore, then the studies. */
export const VIEWS = ['explore', 'field', 'volume', 'shaders', 'scatter']

const PARTS = ['params', 'simParams', 'volumeParams', 'shaderParams', 'scatterParams']

/** The state the Library stores for the current screen. */
export function captureState({ view, params, simParams, volumeParams, shaderParams, scatterParams }) {
  return { view, params, simParams, volumeParams, shaderParams, scatterParams }
}

/**
 * Read a stored state back. Returns only what the config carries: `view` if
 * it is one this build knows, and each part merged over its defaults.
 *
 * @param config    the stored object
 * @param defaults  { params, simParams, volumeParams, shaderParams, scatterParams }
 */
export function restoreState(config, defaults) {
  const out = {}
  if (config && VIEWS.includes(config.view)) out.view = config.view
  for (const part of PARTS) {
    if (config && config[part]) out[part] = { ...defaults[part], ...config[part] }
  }
  return out
}
