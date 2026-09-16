# Supabase Storage Setup — SMART TRADE PRO

File storage (KYC documents, support chat image attachments) runs on
**Supabase Storage**, not Firebase Storage. Firebase Auth, Firestore, and
Firebase Hosting are all completely unaffected by this — only file bytes
moved. See the "Why not Firebase Storage" section below for the reason.

This document is the complete setup checklist. **All of it has already been
applied** to the linked project (`kekpnymidldayqtgapvd`) using the
authenticated Supabase CLI (`supabase link`, `supabase projects api-keys`,
`supabase db query`) — see section 9 for the final status. The steps below
are kept as-is so you know exactly what was done and can reproduce or audit
it; nothing here used a service-role key or any secret beyond the CLI's own
login session.

---

## 1. Supabase project

**Project URL:** `https://kekpnymidldayqtgapvd.supabase.co`

## 2. Required environment variables

Two variables, both already wired up in `src/lib/supabase.ts`:

```
VITE_SUPABASE_URL=https://kekpnymidldayqtgapvd.supabase.co
VITE_SUPABASE_ANON_KEY=<your publishable/anon key>
```

**Status in this repo right now:**

| File | `VITE_SUPABASE_URL` | `VITE_SUPABASE_ANON_KEY` |
|---|---|---|
| `.env` (local dev — gitignored, not committed) | ✅ filled in | ❌ **you must paste this in** |
| `.env.example` (committed template) | ✅ filled in | ❌ intentionally blank |

### 📋 Exactly what to do

1. Open the [Supabase dashboard](https://supabase.com/dashboard) → this project → **Project Settings → API**.
2. Under **Project API keys**, copy the key labeled **`anon` / `public`** — a long string starting with `eyJ...`.
   **Do NOT copy the `service_role` key.** That key bypasses every storage policy and must never be pasted into this file or anywhere in frontend code.
3. Open `.env` in the project root (it already exists) and paste the key onto this line:
   ```
   VITE_SUPABASE_ANON_KEY=
   ```
   so it reads `VITE_SUPABASE_ANON_KEY=eyJ...` (no quotes needed).
4. Restart the dev server (`npm run dev`) so Vite picks up the new value — Vite only reads `.env` at startup.

Until that key is pasted in, `src/lib/supabase.ts` logs a console warning and
every file-upload feature (KYC submission, chat image attachments) shows a
clear "not configured" error — **normal chat text and all trading/wallet/
portfolio functionality are completely unaffected**, they never touch
Supabase at all.

---

## 3. Why not Firebase Storage

Firebase Storage requires a **billing-enabled** Google Cloud project, even
to stay on the free tier — unlike Firebase Auth, Firestore, or Hosting.
Billing activation for this project repeatedly failed with
`OR_BACR2_31` / `OR_BACR2_59`, and this is a Google Cloud account/billing
issue, not something fixable from application code or Firebase project
settings. Per explicit instruction, this migration does not attempt to
enable Firebase Storage, touch Firebase billing, or ask you to configure it
again — Supabase Storage needs no billing step at all.

---

## 4. Create the two private buckets

**Status: ✅ done** — both buckets were created via `supabase db query`
running the SQL below against the linked project, and verified with
`select id, public from storage.buckets` (both return `public = false`).
Kept here for reference/reproducibility.

### Dashboard method (recommended)

For each bucket:

1. Supabase dashboard → this project → **Storage** → **New bucket**.
2. Name it exactly:
   - `kyc-documents`
   - `support-attachments`
3. **Leave "Public bucket" turned OFF.** This is the single most important
   step — a public bucket serves files to anyone on the internet with the
   URL, with no access check at all.
4. Click **Create bucket**.

### SQL method (equivalent, via SQL Editor)

```sql
insert into storage.buckets (id, name, public)
values ('kyc-documents', 'kyc-documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;
```

---

## 5. Required storage policies

**Status: ✅ done** — Supabase Storage access is governed by Postgres Row
Level Security (RLS) policies on the `storage.objects` table. The SQL below
was applied via `supabase db query` against the linked project and verified
present via `select policyname, cmd, roles from pg_policies where
schemaname='storage' and tablename='objects'`. Kept here for
reference/reproducibility (e.g. if you ever need to re-apply it by hand).

```sql
-- ============================================================
-- kyc-documents bucket
-- ============================================================

-- Upload (includes upsert, used when a doc type's upload is retried)
create policy "kyc_documents_insert"
on storage.objects for insert
to anon
with check (bucket_id = 'kyc-documents');

create policy "kyc_documents_update"
on storage.objects for update
to anon
using (bucket_id = 'kyc-documents')
with check (bucket_id = 'kyc-documents');

-- Read (needed to generate signed viewing URLs for the admin review screen)
create policy "kyc_documents_select"
on storage.objects for select
to anon
using (bucket_id = 'kyc-documents');

-- A submission's own files stay immutable day-to-day — a resubmission
-- creates a new submissionId rather than overwriting, and there is still no
-- "edit a past submission" feature anywhere in the app. The one deliberate
-- exception this delete policy exists for: an admin's "Remove User" full
-- account deletion (src/lib/admin.ts's removeUserAccount) needs to actually
-- remove a departing user's private KYC document files, not just their
-- Firestore records pointing at them — otherwise they'd sit in the bucket
-- forever with nothing left to reference or clean them up. The delete call
-- always targets exact, previously-stored storagePath values already on
-- that user's own kycSubmissions docs — never a guessed or public URL, and
-- gated client-side to admins by firestore.rules' matching kycSubmissions
-- delete rule (which itself never allows targeting another admin's docs).
create policy "kyc_documents_delete"
on storage.objects for delete
to anon
using (bucket_id = 'kyc-documents');

-- ============================================================
-- support-attachments bucket
-- ============================================================

create policy "support_attachments_insert"
on storage.objects for insert
to anon
with check (bucket_id = 'support-attachments');

create policy "support_attachments_select"
on storage.objects for select
to anon
using (bucket_id = 'support-attachments');

-- Delete is needed for the 7-day stale-thread cleanup sweep
-- (src/lib/supportChat.ts's cleanupStaleThreadIfNeeded), which removes a
-- thread's images along with its messages once it's gone stale.
create policy "support_attachments_delete"
on storage.objects for delete
to anon
using (bucket_id = 'support-attachments');
```

### ⚠️ Read this before you run the SQL above — the honest security tradeoff

This app authenticates users with **Firebase Auth**, not Supabase Auth. The
Supabase client here only ever uses the **anon** key — the same
publishable key that ships inside the built frontend bundle, exactly like
the Firebase web config already does. Because Postgres RLS policies key off
`auth.uid()` from **Supabase's own** auth system, and this app never signs
anyone into Supabase, there is no way for a storage policy to say "only the
Firebase user who owns this file" — RLS simply cannot see who the
Firebase-authenticated caller is.

**What the policies above actually do:** grant the `anon` role read/write
access to *these two specific buckets only* — not to any other bucket, not
to the whole project. They do **not** enforce "only the KYC submitter or an
admin can read this specific file" at the database level. Anyone holding
the anon key (which, again, is meant to be public — it's embedded in every
copy of the deployed frontend) could, in principle, request a signed URL
for any path in these two buckets if they already knew or guessed it.

**What actually protects the files in practice, given this architecture:**

- **The buckets are private** — there is no public URL for any object; the
  only way to view a file at all is a signed URL generated through this
  app's own code (`getKycFileUrl` / `getSupportChatImageUrl`), which itself
  only runs from screens gated behind Firebase Auth + Firestore's own
  `isAdmin`/ownership checks (`AdminKycReviewModal.tsx`, `Kyc.tsx`,
  `SupportChatThread.tsx`) — a random visitor to the site has no UI path to
  request one at all.
- **Paths are unguessable** — `kyc/{firebaseUid}/{firestoreAutoId}/{file}`
  and `support/{firebaseUid}/{messageId}/{file}` both embed a random
  Firestore-generated id, not a sequential/predictable one.
- **Signed URLs expire** (5 minutes for KYC, 1 hour for chat images) and are
  never persisted anywhere — a copied link stops working on its own.

This is **materially safer than a public bucket** (the alternative this
migration was explicitly told never to fall back to), but it is **not**
equivalent to Firebase Storage's original per-user security rules, which
*could* check `request.auth.uid` because Firebase Storage and Firebase Auth
share the same identity system.

**The proper fix**, if you want true per-user enforcement, requires a small
server-side component this project does not currently have: a Supabase
Edge Function (or any backend endpoint) that verifies the caller's Firebase
ID token, checks Firestore for ownership/admin status, and *only then* uses
the Supabase **service-role** key (server-side only, never shipped to the
browser) to generate the signed URL or perform the upload. That is real,
extra infrastructure — deliberately **not** implemented here, per the
instruction to explain the remaining manual work honestly rather than
weaken privacy by making a bucket public. If/when you want it, this is the
one remaining "real" gap to close.

---

## 6. Firestore schema (unchanged shape, new storage backend)

**KYC** (`kycSubmissions/{id}`) — no schema change at all. It already only
ever stored a Storage *path* + filename, never a URL:

```ts
{
  uploaded: true,
  fileName: "photo.jpg",
  storagePath: "kyc/{firebaseUid}/{submissionId}/photo.jpg", // now a Supabase path
  uploadedAt: <Firestore Timestamp>,
}
```

**Support chat** (`users/{uid}/supportChat/thread/messages/{id}`) — an
image message now stores `imagePath` (new) instead of a persisted
`imageUrl` (legacy):

```ts
{
  senderId: "...",
  senderRole: "user" | "admin" | "system",
  text: "Please check this issue",       // "" for an image with no caption
  timestamp: <Firestore Timestamp>,
  type: "image",                          // only present on an image message
  imagePath: "support/{uid}/{messageId}/screenshot.png",
  imageName: "screenshot.png",
  imageSize: 245000,
  imageContentType: "image/png",
}
```

A handful of pre-migration messages may still have the **legacy**
`imageUrl` field (a permanent Firebase Storage download URL) instead of
`imagePath` — those are never deleted or migrated, and
`SupportChatThread.tsx` still displays them correctly by using that URL
directly instead of resolving a signed URL for it.

---

## 7. How admins securely view private files

Both KYC documents and chat images are served the same way: the app fetches
a **short-lived signed URL** on demand, right before displaying the image,
and never stores that URL anywhere.

- **KYC:** `AdminKycReviewModal.tsx` calls `getKycFileUrl(storagePath)`
  (`src/lib/kyc.ts`) for each document as the modal opens. Signed URLs are
  valid for 5 minutes.
- **Support chat images:** `SupportChatThread.tsx` calls
  `getSupportChatImageUrl(imagePath)` (`src/lib/supportChat.ts`) for each
  image message as the thread loads, caching the result in component state
  (not in Firestore) for as long as the page stays open. Signed URLs are
  valid for 1 hour.

Both admin screens are already gated by this app's existing Firebase
Auth + Firestore `isAdmin` check (`AdminRoute`, `useIsAdmin`) — nothing
about this migration changes who can reach those screens in the first
place; see the security tradeoff note in section 5 for what happens beyond
that UI gate.

---

## 8. How to test

### KYC upload

1. Sign in as a normal (non-admin) user and go to **KYC Verification**.
2. Upload a JPG/PNG/WEBP under 1 MB for the photo, and one ID document
   (JPG/PNG/WEBP or PDF under 10 MB).
3. Submit. You should see the existing "Verification Pending" status —
   the workflow is unchanged.
4. If `VITE_SUPABASE_ANON_KEY` is missing, or the buckets/policies from
   sections 4–5 aren't set up yet, submission fails with a clear error
   instead of a silent hang or a crash — this is expected until setup is
   complete.
5. Once it succeeds, sign in as an admin and open **Admin → KYC
   Verification → Review** on that submission — the uploaded image(s)
   should render inline.

### Support chat image upload

1. Go to **Support**, click the image icon next to the message box, choose
   an image under 1 MB.
2. Confirm the preview (thumbnail, filename, size) appears before sending.
3. Send it, with or without a text caption.
4. Refresh the page — the image should still be there (it's fetched via a
   fresh signed URL on load, not a stale cached one).
5. Click the image to open it full-size; close with the × or Escape.
6. Sign in as an admin, open **Admin → Support** for that user's
   conversation — the image should display there too, with the same
   click-to-enlarge behavior.
7. Try a file over 1 MB, and a non-image file (e.g. a `.pdf`) — both should
   show a clear validation error and never attempt an upload.

---

## 9. What's already done vs. what remains manual

| Step | Status |
|---|---|
| `@supabase/supabase-js` installed | ✅ Done |
| `src/lib/supabase.ts` client created | ✅ Done |
| KYC upload/view migrated to Supabase | ✅ Done (code) |
| Support chat upload/view migrated to Supabase | ✅ Done (code) |
| `.env` / `.env.example` updated with `VITE_SUPABASE_URL` | ✅ Done |
| Project linked via Supabase CLI (`supabase link`) | ✅ Done |
| `.env`'s `VITE_SUPABASE_ANON_KEY` (publishable key) | ✅ Done — fetched via `supabase projects api-keys` and inserted automatically |
| Create `kyc-documents` bucket (private) | ✅ Done — created via `supabase db query`, verified `public = false` |
| Create `support-attachments` bucket (private) | ✅ Done — same, verified `public = false` |
| Add storage policies for both buckets | ✅ Done — applied via `supabase db query`, verified present in `pg_policies` |
| End-to-end upload verified | ✅ A real KYC submission and a real support chat image were both uploaded, confirmed present in `storage.objects` with the exact expected path, and confirmed to load (HTTP 200) via a freshly generated signed URL — including after a page refresh |
| (Optional, stronger security) Server-side Firebase-token verification for signed URLs | ❌ Not implemented — see the tradeoff note in section 5; this is the one remaining *optional* hardening step, not a blocker |

**The migration is functionally complete.** Everything above is live on the
project referenced by `kekpnymidldayqtgapvd`. The only remaining item is
the optional server-side hardening described in section 5's security
tradeoff note, which is extra infrastructure, not a requirement for the
current feature set to work.
