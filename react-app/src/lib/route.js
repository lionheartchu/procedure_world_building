import { useSyncExternalStore } from 'react'

/**
 * The app's one bit of routing: which part is open, by the URL's path.
 * `/atlas` and below open the Atlas; `/habitat` and below the Habitat; everything else is Explore and the
 * Studies, which keep their own state as before. Browser back and forward
 * work, and every Atlas page can be opened directly (Firebase Hosting and
 * Vite both serve index.html for any path).
 */

const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())

if (typeof window !== 'undefined') window.addEventListener('popstate', notify)

/** Go to a path, as a new history entry (or replacing the current one). */
export function navigate(path, { state = null, replace = false } = {}) {
  if (replace) window.history.replaceState(state, '', path)
  else window.history.pushState(state, '', path)
  notify()
}

/** The current path, kept up to date. */
export function usePath() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => window.location.pathname,
  )
}

/** Whether a path is the Habitat: `/habitat` (the featured one, FEATURED in lib/habitat.js), and each space at `/habitat/<key>` (v0, a … m3s). */
export const isHabitat = (path) => path === '/habitat' || path.startsWith('/habitat/')

/** The Habitat's own route, where the site's navigation leads: it opens the featured space. */
export const HABITAT_PATH = '/habitat'

/**
 * A link's click, made soft (no page load) unless it asks for a new tab or
 * window; `to` is a path, or a function that navigates itself.
 */
export function softLink(to) {
  return (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (typeof to === 'function') to()
    else navigate(to)
  }
}

/** Whether a path belongs to the Atlas. */
export const isAtlas = (path) => path === '/atlas' || path.startsWith('/atlas/')
