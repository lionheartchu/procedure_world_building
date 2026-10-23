import { flushSync } from 'react-dom'
import { navigate } from '../lib/route'

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Moving within the Atlas: where the browser can, the old page dissolves
 * into the new one, and a portal fragment opens into its chapter's image
 * (they share a view-transition name). Without it, or with reduced motion,
 * the page simply changes.
 */
export function atlasNavigate(path) {
  if (!document.startViewTransition || reducedMotion()) {
    navigate(path)
    return
  }
  const root = document.documentElement
  root.dataset.atlasTransition = ''
  const transition = document.startViewTransition(() => flushSync(() => navigate(path)))
  transition.finished.finally(() => delete root.dataset.atlasTransition)
}

/** Leave the Atlas for Explore (optionally with the Studies menu open). */
export function leaveFor(studies = false) {
  navigate('/', { state: studies ? { studies: true } : null })
}
