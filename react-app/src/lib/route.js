import { useSyncExternalStore } from 'react'

/**
 * The app's one bit of routing: which part is open, by the URL's path.
 * `/atlas` and below open the Atlas; `/habitat` the Habitat; everything else is Explore and the
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

/** Whether a path is the Habitat (docs/12-habitat-v0.md): `/habitat`, and its spatial studies `/habitat/a`, `/habitat/b`. */
export const isHabitat = (path) => path === '/habitat' || path.startsWith('/habitat/')

/** Whether a path belongs to the Atlas. */
export const isAtlas = (path) => path === '/atlas' || path.startsWith('/atlas/')
