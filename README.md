# Abu Khater Delivery System

Production restaurant delivery management system built with React, Vite, and Supabase.

The application supports online orders, offline/manual cashier orders, call center flows, pilot dispatching, long-running shifts, realtime updates, and offline-first synchronization.

## Engineering Principles

- Supabase is the source of truth for business data.
- Frontend state is a temporary UI/cache layer, not an authoritative workflow store.
- Order, pilot, and shift transitions must be validated and persisted.
- Offline work must be queued, retried, and protected from data loss or duplicate writes.
- Realtime subscriptions should be supported with fallback polling.
- Role-based permissions must be enforced through trusted persisted data, not only browser state.

See [Project Instructions](docs/PROJECT_INSTRUCTIONS.md) for the full operational rules.

## Architecture Notes

- Current Supabase architecture review: [Supabase Architecture Audit](docs/SUPABASE_ARCHITECTURE_AUDIT.md)
- Frontend framework: React 19 + Vite
- Data access: Supabase JavaScript client through service-layer abstractions
- Core operational areas: orders, pilots, shifts, reservations, feedback, offline sync

## Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Run lint checks:

```bash
npm run lint
```

Build for production:

```bash
npm run build
```

## Safety Expectations

Before changing production workflows, review the project instructions and the Supabase audit. Changes that affect orders, pilots, shifts, realtime subscriptions, offline sync, RLS, or database relationships should include focused verification.
