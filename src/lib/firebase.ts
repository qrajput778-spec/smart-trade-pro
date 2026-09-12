// Firebase config for SMART TRADE PRO.
//
// This is a university course project: a SIMULATED crypto trading dashboard.
// Firebase Auth + Firestore are used only for user accounts and storing
// virtual/paper portfolio data — never real funds or wallets. Firebase
// Storage holds KYC document uploads (src/pages/Kyc.tsx) for a simulated
// identity-verification workflow — real files, but never real government ID
// documents; see README.md's top-of-file notice for the full policy.
//
// Fill in the real values in `.env` (copy `.env.example`). Until then, these
// are placeholders and Firebase is left uninitialized so the app still runs.

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let storage: FirebaseStorage | null = null

if (isConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  storage = getStorage(app)
  // The SDK's own defaults (multiple minutes) mean a genuine failure — e.g.
  // Storage not yet enabled on this project, or a bad network — leaves the
  // KYC upload UI stuck on "Submitting…" far longer than any human will
  // wait before assuming something's broken. Fail fast enough that
  // src/lib/kyc.ts's error handling actually gets to show something.
  storage.maxUploadRetryTime = 15000
  storage.maxOperationRetryTime = 15000
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[firebase] No Firebase config found — copy .env.example to .env and fill in ' +
      'your project values. Auth/Firestore/Storage are disabled until then.',
  )
}

export { auth, db, storage }
export default app
