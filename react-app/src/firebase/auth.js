/** Google sign-in. One provider, popup flow, nothing else. */

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from './app'

const provider = new GoogleAuthProvider()

export function subscribeToAuth(callback) {
  if (!isFirebaseConfigured) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, callback)
}

export function signInWithGoogle() {
  return signInWithPopup(auth, provider)
}

export function signOutOfGoogle() {
  return signOut(auth)
}
