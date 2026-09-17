# SMART TRADE PRO — Cloud Functions

The rest of this project is frontend + Firebase Auth/Firestore + Supabase
Storage, with no backend at all. This `functions/` directory exists for
exactly one reason: **deleting a *different* user's Firebase Authentication
account**, which requires the Admin SDK running on a trusted server — a
signed-in browser client, even an admin's, can never do this itself. See
`src/index.ts` for the full reasoning and `../src/lib/admin.ts`'s
`removeUserAccount` for how the frontend calls it.

No service-account JSON, private key, or Admin SDK credential lives here or
anywhere in this repo. `admin.initializeApp()` (no arguments) uses
Application Default Credentials, which Cloud Functions' own managed runtime
provides automatically at deploy time — nothing to configure, and nothing
that could ever leak into the Vite frontend bundle, since this is a
completely separate Node project that only ever runs on Google's servers.

## One-time setup

**This project must be on the Blaze (pay-as-you-go) plan.** Cloud Functions
— even a single small one, even within the free monthly quota it would
never exceed for an admin-only tool like this — requires Artifact Registry
and Cloud Build, both of which Firebase refuses to enable on the free Spark
plan. Upgrade here first (no functions will deploy until this is done):

```
https://console.firebase.google.com/project/smart-trade-pro-98243/usage/details
```

This is the same class of billing-plan wall documented in
`../SUPABASE_STORAGE_SETUP.md` for why this project uses Supabase Storage
instead of Firebase Storage — Auth, Firestore, and Hosting all work on the
free plan; Functions and Storage both require the paid one.

## Install and build

```bash
cd functions
npm install
npm run build
```

## Deploy

From the **project root** (not this directory):

```bash
firebase deploy --only functions
```

This runs `npm run build` here automatically first (see the root
`firebase.json`'s `functions.predeploy`), so a plain `firebase deploy
--only functions` from the root is always enough — no separate build step
required first.

## Verify it deployed

```bash
firebase functions:list
```

should show `deleteUserAuthAccount` (v2, callable, HTTPS). `firebase functions:list` printing
**"No functions found"** means exactly what it says — nothing is deployed, regardless of what's
sitting in this directory.

## Symptom if this was never deployed: "internal [0]"

If Admin → Users → Remove shows the raw text **"internal [0]"**, that is the
`@firebase/functions` client SDK's own generic message for "the browser's request never got
*any* HTTP response back" (see its `_errorForResponse`/`codeForHTTPStatus`: HTTP status `0` maps
to code `internal`, and with no response body to read a real message from, the SDK falls back to
literally `${code} [${httpStatus}]`). In this project that has one cause: **no Cloud Function is
deployed at this project/region**, so the callable request has nowhere to land — confirmed by
`firebase functions:list` returning "No functions found." It is not a rejection from this
function's own code (a real `HttpsError` thrown here arrives with its actual message intact, not
this synthesized `"code [status]"` shape) — nothing is broken in `src/index.ts` or
`src/lib/admin.ts`; the backend simply isn't live yet. Complete the Blaze upgrade above, then
`firebase deploy --only functions` — that error can't happen once a real deployment exists to
answer the request.

## What it does NOT do

This function only deletes the target's Firebase Auth credentials. It never
touches Firestore or Supabase Storage — that cleanup stays entirely in the
frontend (`src/lib/admin.ts`'s `removeUserAccount`), which already has
exactly the permissions it needs for its own admin's writes under
`firestore.rules`. Keeping the two separate means this function's blast
radius, and the amount of code that ever runs with elevated Admin SDK
privileges, stays as small as possible.
