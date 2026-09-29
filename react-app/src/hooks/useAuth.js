import { useEffect, useState } from 'react'
import { subscribeToAuth } from '../firebase/auth'
import { isFirebaseConfigured } from '../firebase/app'

/** Current Firebase user, or null. `ready` is false until the first answer. */
export default function useAuth() {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(!isFirebaseConfigured)

  useEffect(() => {
    return subscribeToAuth((next) => {
      setUser(next)
      setReady(true)
    })
  }, [])

  return { user, ready, configured: isFirebaseConfigured }
}
