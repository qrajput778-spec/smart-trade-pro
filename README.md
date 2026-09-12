<!--
PROJECT PURPOSE (read before adding features):

This is a university course project: a SIMULATED crypto trading dashboard.
- All balances are virtual practice funds only.
- There is NO real deposit or withdrawal of funds anywhere in this app —
  deposit/withdrawal "requests" (src/lib/balanceRequests.ts) only ever move
  the virtual balance number, after admin approval; no real payment rail.
- There is NO cryptocurrency wallet address collection anywhere in this app
  (the Deposit modal's "demo address" is a fixed fake string shown for UI
  fidelity only — never a real generated address, never actually funded).
- There IS a KYC / identity-verification workflow (src/pages/Kyc.tsx,
  src/pages/admin/AdminKyc*.tsx) — but it exists to demonstrate a realistic
  admin-review workflow for a course assignment, not to perform real
  identity verification. Nothing it collects is checked against a real
  identity, government database, or KYC provider — an admin just eyeballs
  whatever was uploaded and clicks Approve/Reject. IMPORTANT: because the
  uploads still go to a real Firebase Storage bucket, treat this exactly
  like any other file-upload feature from a data-handling standpoint —
  never upload a real government ID/passport/driving license to it, even
  for testing. Use placeholder/dummy images only. See src/pages/Kyc.tsx's
  own on-page copy, which tells users the same thing.
- Any "support chat" feature must clearly disclose it is automated, never
  impersonate a human agent — unless it's explicitly built as a genuine
  human admin↔user chat instead (src/lib/supportChat.ts is the latter: a
  real person replies from /admin/support, never a bot).

This list reflects deliberate product decisions made WITH the project
owner, not a blanket ban — if a future request conflicts with a line
above, flag the specific conflict back to the project owner and get an
explicit go/no-go before proceeding, rather than silently building it or
silently refusing it.
-->

# SMART TRADE PRO

A university course project: a simulated crypto trading dashboard for practicing
trading concepts with virtual paper funds. No real money or wallets are ever
involved. It does include a simulated KYC identity-verification workflow (for
demonstrating an admin-review workflow) — see the notice above and in the KYC
page itself: never upload a real ID document to it, even for testing.

## Stack

- [Vite](https://vitejs.dev/) + React 18 + TypeScript
- Tailwind CSS
- React Router v6
- Firebase (Auth + Firestore + Storage)
- [lucide-react](https://lucide.dev/) for icons
- [recharts](https://recharts.org/) for charts

## Getting started

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your Firebase project's config values
(from the Firebase console: Project settings > General > Your apps > SDK setup
and configuration). The app will not connect to a real Firebase project until
these are filled in.

```bash
npm run dev
```

## Project structure

```
src/
  components/   shared UI: Button, Card, Badge, Navbar, Footer, Layout
  pages/        Landing, Login, Signup, Dashboard, Markets, Trade, Portfolio, Settings
  lib/          firebase.ts (Firebase config), api.ts (market data fetching)
  hooks/        shared React hooks
  context/      AuthContext (Firebase auth state)
  types/        shared TypeScript types
```

## Status

Scaffolding stage: routing, theme, and Firebase config are wired up with
placeholder pages. No feature UI has been built yet.
