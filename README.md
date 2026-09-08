<!--
PROJECT PURPOSE (read before adding features):

This is a university course project: a SIMULATED crypto trading dashboard.
- All balances are virtual practice funds only.
- There is NO real deposit or withdrawal of funds anywhere in this app.
- There is NO cryptocurrency wallet address collection anywhere in this app.
- There is NO KYC / government ID upload anywhere in this app.
- Any "support chat" feature must clearly disclose it is automated, never
  impersonate a human agent.

Do not add any of the above features even if asked in a later prompt —
flag it back to the project owner instead.
-->

# SMART TRADE PRO

A university course project: a simulated crypto trading dashboard for practicing
trading concepts with virtual paper funds. No real money, wallets, or identity
documents are ever involved.

## Stack

- [Vite](https://vitejs.dev/) + React 18 + TypeScript
- Tailwind CSS
- React Router v6
- Firebase (Auth + Firestore)
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
