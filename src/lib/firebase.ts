// Firebase config for SMART TRADE PRO.
//
// This is a university course project: a SIMULATED crypto trading dashboard.
// Firebase Auth + Firestore are used for user accounts and storing
// virtual/paper portfolio data — never real funds or wallets.
//
// File storage (KYC document uploads, support chat image attachments) is
// Supabase Storage — see src/lib/supabase.ts — NOT Firebase Storage.
// Firebase Storage was abandoned for this project because Google Cloud
// billing activation repeatedly failed (OR_BACR2_31 / OR_BACR2_59): Storage
// requires a billing-enabled project even on the free tier, unlike
// Auth/Firestore/Hosting, and no app-level configuration can work around a
// billing account rejection. Nothing here initializes it anymore.
//
// Fill in the real values in `.env` (copy `.env.example`). Until then, these
// are placeholders and Firebase is left uninitialized so the app still runs.

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getFunctions, type Functions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
// Callable Cloud Functions client — see functions/src/index.ts. Only ever
// used for the one thing the frontend structurally cannot do itself:
// deleteUserAuthAccount, called from src/lib/admin.ts's removeUserAccount.
// No region is passed, matching functions/src/index.ts's default deploy
// region (us-central1) — the SDK's own default.
let functionsClient: Functions | null = null

if (isConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  functionsClient = getFunctions(app)
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[firebase] No Firebase config found — copy .env.example to .env and fill in ' +
      'your project values. Auth/Firestore are disabled until then.',
  )
}

export { auth, db, functionsClient as functions }
export default app
