/**
 * Firebase initialisation.
 *
 * The app is expected to run without Firebase: if `.env` is missing or
 * incomplete, `isFirebaseConfigured` is false, the exports stay null, and the
 * Library panel explains what to do. Nothing else in the app touches Firebase.
 */

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Object.values(config).every(
  (value) => typeof value === 'string' && value.length > 0,
)

let auth = null
let db = null
let storage = null

if (isFirebaseConfigured) {
  const app = initializeApp(config)
  auth = getAuth(app)
  db = getFirestore(app)
  storage = getStorage(app)
  // The SDK retries a failed upload for ten minutes by default. A project
  // without a Storage bucket (the free plan has none) would make a save appear
  // to hang for that whole time, so fail fast and let the caller fall back.
  storage.maxUploadRetryTime = 8000
  storage.maxOperationRetryTime = 8000
}

export { auth, db, storage }
