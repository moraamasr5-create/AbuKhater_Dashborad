# Project Instructions: Online and Offline Delivery Management System

## Purpose

This project is a production restaurant order management platform for:

- Online orders
- Offline/manual cashier orders
- Call center orders
- Delivery drivers, referred to in the UI as pilots
- Shift management
- Real-time order assignment
- Supabase-backed synchronization

The system must remain stable during long operating shifts, including shifts that run for up to 20 hours. Every architecture and implementation decision should favor operational reliability, recoverability, and data integrity over short-lived frontend convenience.

## Ownership

- Project owner: D. Amr Mamdouh
- Owner contact details should be kept in private operational channels, not committed to source control.

## Core Architecture Rules

### Supabase is the source of truth

Supabase is the authoritative system of record for all important business data.

Required behavior:

- Persist orders, pilots, shifts, audit events, and sync state to Supabase.
- Treat frontend state as a temporary UI/cache layer only.
- Do not implement business workflows that can succeed only in local React state.
- Prefer service-layer abstractions for every Supabase read or write.
- Validate data before writing to Supabase.
- Preserve existing Supabase relationships, foreign keys, indexes, realtime behavior, and RLS assumptions.

### Offline-first operation

The application must continue operating during internet outages.

Required behavior:

- Save important local operations immediately.
- Queue pending sync tasks durably.
- Retry synchronization automatically when connectivity returns.
- Make queued writes idempotent so retrying cannot create duplicate orders or reservations.
- Clearly distinguish "offline/unavailable" from "empty result" in user-facing flows.
- Prevent order loss during refreshes, browser restarts, and long shifts.

### Real-time operations

The system must support live operations across multiple devices.

Required behavior:

- Use Supabase Realtime subscriptions for live order, pilot, and shift updates.
- Keep a fallback polling path for WebSocket failures.
- Avoid full-table refetches for every event when a targeted delta update is safe.
- Ensure critical realtime tables are included in the Supabase realtime publication.
- Handle reconnects and subscription cleanup explicitly.

## Order Management

### Valid order lifecycle

Every order must move through the validated lifecycle below:

```text
pending_timer
pending
waiting_driver
driver_assigned
active
delivered
```

`active` means the driver has left with the order.

Allowed exception states:

- `cancelled`
- `failed_delivery`

Rules:

- Do not bypass lifecycle states without explicit validation.
- Do not store unbounded free-text statuses as the canonical status.
- Keep cancellation and failed-delivery reasons in dedicated fields or audit events, not embedded in the status value.
- Translate statuses for the UI from a single canonical map.
- Record status changes in an audit trail when possible.

### Order sources

Supported sources:

- `manual`
- `online`
- `talabat`
- `external`
- `trips`

Rules:

- Restaurant sales and external/private trips must remain clearly separated in business logic, reporting, and financial calculations.
- Source-specific behavior should be explicit and tested.
- External trips must not distort restaurant sales metrics.

## Pilot Management

### Pilot states

Pilots can be in one of these states:

- `available`
- `busy`
- `on_delivery`
- `off`

Rules:

- Only `available` pilots can receive new orders.
- Assignment must be validated against current Supabase state, not only local UI state.
- Prefer transactional database operations for assignment so order and pilot updates cannot diverge.

### FIFO assignment

Dispatch ordering must use:

1. Oldest `lastReturnTime` first
2. Lowest completed order count second

This logic should be centralized so cashier screens, call center flows, and any automated assignment paths use the same ordering.

### Delivery completion

When a pilot completes a delivery:

- Return the pilot to the available queue.
- Update `lastReturnTime`.
- Increase the completed order count.
- Mark the order delivered through the validated lifecycle.
- Synchronize the full state transition with Supabase.
- Record financial and audit data needed for shift close.

## Shift Management

### Shift requirements

- A shift must be open before accepting orders.
- Shift state must persist in Supabase.
- The frontend must support session recovery after refresh.
- Long shifts must remain stable without relying on in-memory timers alone.
- Automatic shift-closing logic must be safe and must not attach unrelated orders to a shift.

### Shift close report

Closing a shift must produce a complete report that includes:

- Total orders
- Pilot performance
- Earnings
- Delivery fees
- Attendance calculations
- Archived orders
- Audit logs

Rules:

- Report data should be reproducible from persisted Supabase records.
- Client-side calculations may format or preview values, but authoritative report inputs must be persisted.
- Closing logic must reject active or unresolved work unless a manager explicitly follows a validated exception path.

## Database Safety

When changing schema or queries, always consider:

- UUID primary keys where appropriate
- Stable timestamp semantics
- Foreign keys
- Indexes for hot filters
- RLS policies
- Supabase Realtime compatibility
- Existing production relationships

Rules:

- Never break existing Supabase relationships.
- Prefer version-controlled migrations for schema changes.
- Run Supabase advisors after security-sensitive or performance-sensitive database work.
- Keep RLS enabled on exposed schemas and write policies that match the actual role model.
- Do not expose service role keys, admin secrets, or passwords in frontend code.

## Security and Roles

Supported application roles:

- `admin`
- `manager`
- `cashier`

Rules:

- Validate permissions according to role.
- Do not trust role values stored only in frontend state.
- Use Supabase Auth and persisted profiles/roles for production authorization.
- Never use user-editable metadata for authorization decisions.
- Keep privileged operations on trusted server or database paths.

## React and Service-Layer Guidelines

React code should:

- Use clean hook patterns.
- Avoid unnecessary rerenders.
- Keep business logic separated from UI components.
- Preserve the Context/API service architecture unless a focused refactor is required.
- Avoid optimistic state changes that cannot be reconciled safely with Supabase.

Supabase service code should:

- Centralize reads and writes.
- Handle errors explicitly.
- Support retry and offline queue mechanisms.
- Validate state transitions before writes.
- Prefer transactional RPCs for multi-row business operations such as pilot assignment and shift close.

## Development Checklist

Before modifying code:

1. Understand the current architecture and data flow.
2. Check dependencies and service-layer patterns.
3. Identify possible side effects on orders, pilots, shifts, realtime, and offline sync.
4. Choose the safest implementation that preserves existing operational behavior.

When debugging:

1. Find the root cause.
2. Explain why it happened.
3. Provide the exact fix.
4. Verify the fix with tests, a build, or a focused runtime check.

When adding features:

- Think like a restaurant operations engineer.
- Protect against lost orders, duplicate sync, double driver assignment, and inconsistent shift reports.
- Prefer explicit state machines and persisted audit data over implicit UI state.

## Primary Goal

Build and maintain a stable 24/7 restaurant delivery system with:

- Zero lost orders
- Accurate pilot assignment
- Reliable synchronization
- Production-grade operational stability
