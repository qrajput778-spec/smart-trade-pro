// Firebase config for SMART TRADE PRO.
//
// This is a university course project: a SIMULATED crypto trading dashboard.
// Firebase Auth + Firestore are used only for user accounts and storing
// virtual/paper portfolio data — never real funds, wallets, or KYC info.
//
// Fill in the real values in `.env` (copy `.env.example`). Until then, these
// are placeholders and Firebase is left uninitialized so the app still runs.

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

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

if (isConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[firebase] No Firebase config found — copy .env.example to .env and fill in ' +
      'your project values. Auth/Firestore are disabled until then.',
  )
}

export { auth, db }
export default app
