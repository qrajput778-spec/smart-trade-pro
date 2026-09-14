// Supabase client for SMART TRADE PRO — file storage ONLY.
//
// Firebase Storage's Google Cloud billing could not be activated for this
// project (repeated OR_BACR2_31 / OR_BACR2_59 errors), so file storage was
// migrated to Supabase Storage instead. Everything else is unchanged:
// Firebase Auth still owns sign-in/sign-up, Firestore still owns every
// document (users, trades, KYC submissions, support messages, ...), and
// Firebase Hosting still serves the built app. This client is used from
// exactly two places — src/lib/kyc.ts and src/lib/supportChat.ts — to
// upload/download files and nothing else; it is never used for auth or
// data storage of its own.
//
// Only ever the PUBLISHABLE ("anon") key belongs here. That key is meant to
// be public — it ships inside the built frontend bundle the same way the
// Firebase web config already does — and it can only do what the bucket's
// storage policies (see SUPABASE_STORAGE_SETUP.md) explicitly allow. The
// secret/service-role key must NEVER be used in this file, or anywhere in
// frontend code: it bypasses every storage policy entirely.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True only when both env vars are actually present and non-empty. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

let supabase: SupabaseClient | null = null

if (isSupabaseConfigured) {
  supabase = createClient(supabaseUrl, supabaseAnonKey)
} else {
  // Mirrors src/lib/firebase.ts's own "not configured yet" console warning —
  // fails gracefully rather than throwing at import time, so the rest of the
  // app (trading, wallet, portfolio — everything that isn't a file upload)
  // keeps working even before this is set up. See SUPABASE_STORAGE_SETUP.md.
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY — file uploads ' +
      '(KYC documents, support chat images) are disabled until these are set in .env. ' +
      'See SUPABASE_STORAGE_SETUP.md.',
  )
}

export { supabase }

/** Bucket names — kept in one place so kyc.ts/supportChat.ts never hardcode a string literal twice. */
export const KYC_DOCUMENTS_BUCKET = 'kyc-documents'
export const SUPPORT_ATTACHMENTS_BUCKET = 'support-attachments'
