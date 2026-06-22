# Abu Khater Delivery — Data-Layer Migration Plan

> Companion to `docs/SUPABASE_ARCHITECTURE_AUDIT.md`.
> Goal: migrate the app's data layer onto the **existing normalized schema** (no rewrite), in 4 phases, with a full backup, version-controlled migrations, backward compatibility, and advisor re-checks after each phase.
>
> **Status: PLAN ONLY — no application or database changes have been made yet** (this document + the schema backup snapshot are the only artifacts). Implementation begins after sign-off, starting with Phase 0.

---

## 0. Pre-flight (done in this step)

1. **Schema backup captured** → `supabase/backup/2026-06-22_prod_schema_snapshot.sql` (reconstructed from live catalog introspection).
   - ⚠️ Before running migrations, also take an authoritative dump:
     `supabase db dump --db-url "$PROD_DB_URL" -f supabase/backup/2026-06-22_pg_dump.sql`
     (and/or a Dashboard PITR/manual backup).
2. **Migration tooling**: adopt the Supabase CLI. Generate a baseline from prod so migrations start from reality:
   - `supabase link --project-ref htpnxizfqmnnkhemvmdz`
   - `supabase db pull`  → creates `supabase/migrations/0000_baseline_remote_schema.sql`
   - All subsequent changes are new timestamped files in `supabase/migrations/`.
3. The legacy ad-hoc files `supabase/shift_governance.sql` and `supabase/close_shift_rpc.sql` are **superseded** (and were never deployed — see below). They will be folded into proper migrations and then removed.

### Critical facts that shape this plan (verified live)

- **`open_shift` / `close_shift` / `is_shift_operation_allowed` / `_parse_time_minutes` do NOT exist in production.** The repo's shift-governance SQL was never deployed; `shifts` is empty; the app's `rpc('open_shift')` / `rpc('close_shift')` calls currently fail and are swallowed by the offline wrapper (shift state lives only in `localStorage`).
- **`app_config` stores SECRETS** (`telegram_bot_token`, `telegram_chat_id`) and currently has RLS enabled with **no policy** (so anon can't read it — correct). It does **not** hold the shift window. → The RLS rebuild must **never** add a permissive policy to `app_config`; shift-window settings will live in `restaurant_settings` (non-secret) instead.
- **The normalized schema is already complete and well-indexed** (`customers`, `order_items`, `order_status_history`, `order_assignments`, `order_events`, `driver_transactions`, `delivery_shift_logs`, `sync_queue`, `profiles` all exist with FKs + indexes). Phase 1/2 is mostly *use what's there* + a few additive columns.
- **`profiles` is ready for Auth**: `auth_user_id uuid UNIQUE`, `role text default 'staff'`, `is_active bool`. Only the FK to `auth.users` and a signup trigger are missing.

---

## 1. Backward-compatibility strategy (expand → migrate → contract)

We never break the running app. Every schema change is **additive first**:

1. **Expand**: add new columns/tables/RPCs/policies alongside the old ones.
2. **Dual-write / dual-read**: the app writes both old and new shapes during the transition (e.g. write `order_items` *and* keep `raw_payload`; keep `delivery_id` as source of truth while still populating `pilot_id` via a DB trigger).
3. **Backfill**: one-off data migration for existing rows.
4. **Cutover**: switch reads to the new shape.
5. **Contract**: only after the new path is proven, drop the legacy columns/policies/functions in a final migration.

### Deployment ordering for Phase 0 (availability-safe)

The app today talks to Postgres **anonymously** (no Supabase session). Locking RLS before the app can authenticate would take the system down. Therefore Phase 0 ships in this order:

1. **Ship the Auth-capable app first** (login via Supabase Auth) **while RLS is still open**. Users begin getting real JWT sessions; nothing breaks.
2. **Seed `profiles`** (one per staff auth user) with correct roles.
3. **Switch order-ingestion integrations (n8n) to the `service_role` key** so they bypass RLS (decision point — see Risks).
4. **Apply the RLS rebuild migration** (deny-by-default + role-scoped). The JWT-bearing app keeps working; anonymous public access is removed.
5. Make storage private + harden functions.

A feature flag (`VITE_REQUIRE_AUTH`) gates the new login screen so we can roll forward/back the client independently of the DB.

---

## 2. Migrations to be created (under `supabase/migrations/`)

Timestamps will be assigned at creation; ordering shown by sequence number.

### Phase 0 — Critical Security
| File | Purpose | Compat notes |
|---|---|---|
| `0000_baseline_remote_schema.sql` | `db pull` baseline of current prod | reference only |
| `0001_auth_profiles_rbac.sql` | FK `profiles.auth_user_id → auth.users` (on delete cascade); `handle_new_user()` trigger to auto-create a profile on signup; `role` CHECK in (`admin`,`casher`,`driver`,`staff`); helper fns `current_profile_role()` / `is_staff()` / `is_admin()` (SECURITY DEFINER, `search_path` pinned, `STABLE`) | additive |
| `0002_rls_rebuild.sql` | Drop all `USING(true)` write policies + duplicates; add deny-by-default + role-scoped policies on every business table keyed on `(select auth.uid())` and role helpers; drivers limited to their own assigned orders | **ship after app auth is live** |
| `0003_rls_missing_tables.sql` | Add explicit scoped policies to the 12 RLS-on/no-policy tables the app will use (`customers`, `order_items`, `order_status_history`, `order_assignments`, `order_events`, `driver_transactions`, `delivery_shift_logs`, `sync_queue`, `notifications`, `restaurant_settings`); leave `app_config` deny-all | additive |
| `0004_functions_hardening.sql` | `ALTER FUNCTION ... SET search_path = ''` (schema-qualify bodies) on all flagged functions; `REVOKE EXECUTE` on `send_telegram_message` & `rls_auto_enable` from `anon`/`authenticated`; move `http` ext to a dedicated `extensions` schema | careful (search_path) |
| `0005_storage_private.sql` | `update storage.buckets set public=false where id='payment-screenshots'`; drop public read/upload policies; add authenticated-staff read/insert policies (app moves to signed URLs) | ship with storage app changes |
| `0006_app_config_secrets.sql` | Move `telegram_bot_token`/`telegram_chat_id` into Supabase **Vault**; update telegram functions to read from Vault; (optionally) repurpose `app_config` for non-secret authenticated config only | additive then contract |

### Phase 1 — Core Data Model
| File | Purpose | Compat notes |
|---|---|---|
| `0007_order_status_enum.sql` | `CREATE TYPE order_status`; add `orders.order_state order_status`; backfill from existing AR/EN `status` text; add `orders.cancel_reason text`, `orders.fail_reason text`; keep legacy `status` in sync via trigger during transition | expand + dual-write |
| `0008_orders_customer_link.sql` | Add `orders.customer_id uuid → customers(id)`; backfill `customers` (dedupe by phone) from existing orders + set `customer_id` | additive + backfill |
| `0009_orders_driver_canonical.sql` | Make `delivery_id` the single driver relationship; add trigger to mirror `delivery_id → pilot_id/pilot_name` during compat window (so legacy readers still work); plan to drop `pilot_id`/`pilot_name` in the contract migration | compat trigger |
| `0010_shift_governance_deploy.sql` | Deploy **corrected** `open_shift`/`close_shift`/`is_shift_operation_allowed`/`_parse_time_minutes`; reconcile `shifts.id` typing (keep `text`, fix RPC param types); **read shift window from `restaurant_settings`, not `app_config`**; **remove the blanket `UPDATE orders SET shift_id WHERE shift_id IS NULL`** (scope to the shift) | replaces never-deployed repo SQL |
| `0011_repair_broken_rpcs.sql` | Drop/rewrite `start_driver_shift(uuid)`/`end_driver_shift(uuid)` to target `delivery` (`bigint`) or remove; fix `calculate_shift_minutes` (it references a non-existent boolean `delivery.status`) to use `state`/`shift_started_at`; rewrite `assign_order_to_pilot` to emit canonical status | behavior-preserving |
| `0012_menu_availability_compat.sql` | Create updatable `menu_availability` **view** over `menu_items(name, is_available := status='available')` with INSTEAD-OF triggers, so current app code keeps working immediately; app later switches to `menu_items` directly | compat shim |
| `0013_order_status_history_trigger.sql` | Trigger to auto-insert `order_status_history` on `orders` status change (captures `changed_by` from JWT claims) | additive |

### Phase 2 — Transactional RPCs (server-authoritative writes)
| File | Purpose |
|---|---|
| `0014_rpc_create_order.sql` | `create_order_with_items(...)`: upsert `customers`, insert `orders`, insert `order_items`, seed `order_events`; returns order id (idempotency-key aware) |
| `0015_rpc_assign_driver.sql` | `assign_driver(p_order_id, p_delivery_id)`: `SELECT ... FOR UPDATE` availability lock, update order + driver atomically, write `order_assignments` + `order_status_history` + `order_events` (supersedes `assign_order_to_pilot`) |
| `0016_rpc_close_shift_financials.sql` | Extend `close_shift` to compute `driver_transactions` (fees/attendance) and `delivery_shift_logs` server-side from `now()` instead of client-side math |

### Phase 3 — Realtime / Sync / Performance
| File | Purpose |
|---|---|
| `0017_indexes.sql` | Add composite/missing indexes surfaced by the performance advisor (e.g. `orders(shift_id, order_state)`, `sync_queue(status, created_at)`, `order_assignments(order_id, unassigned_at)`); wrap `auth.uid()` in RLS as `(select auth.uid())` |
| `0018_sync_queue_rpc.sql` | `enqueue_sync(...)` / `claim_sync_batch(...)` RPCs + idempotency unique key; realtime publication for `sync_queue` |
| `0019_contract_legacy.sql` | **Final contract**: drop `orders.pilot_id`/`pilot_name`, drop legacy `status` text (rename `order_state`→`status`), drop compat triggers/duplicate policies, drop dead functions | only after full cutover |

---

## 3. Application files to be modified (complete list)

### Phase 0 (Auth + security)
| File | Change |
|---|---|
| `src/services/supabase/supabaseClient.js` | Configure auth (persistSession, autoRefreshToken, storageKey); read keys from `VITE_*` only |
| `src/services/authService.js` **(new)** | `signIn`, `signOut`, `getSession`, `onAuthStateChange`, `getProfile()` (role/is_active) |
| `src/components/auth/Login.jsx` | Replace PIN pad with Supabase Auth login (email/password or phone OTP); remove hardcoded `8080`/PIN logic; behind `VITE_REQUIRE_AUTH` flag |
| `src/context/AppContext.jsx` | Source `userRole` from `profiles.role` via session; remove `sessionStorage` role + default-password seeding; add session lifecycle + sign-out |
| `src/App.jsx` | Gate by real session + `profiles.role`; remove `prompt('8080')` flows in `SecurityModal`/`handleEditOrder`/`PilotManagement`; route unauth → Login |
| `src/components/layout/Sidebar.jsx` | Add sign-out; role-based nav from profile |
| `src/services/storageService.js` | Upload to private bucket; return storage path; add `getSignedUrl()` |
| `src/components/orders/OrderInbox.jsx` | Render payment screenshots via signed URLs (replace public URL/`getPublicUrl`) |
| `src/App.jsx` (`processImageUpload`) / reservation flow | Use signed URLs for reservation proof display |
| `.gitignore` | Add `.env` (and `.env.*` except `.env.example`) |
| `.env` | `git rm --cached .env`; rotate keys; keep only `VITE_*` |
| `.env.example` **(new)** | Document required vars without secrets |
| `supabase/config.toml` | Auth settings (site URL, providers) |

### Phase 1 (data model)
| File | Change |
|---|---|
| `src/utils/orderStatus.js` **(new)** | Canonical `order_status` enum + AR display map (single source of truth) |
| `src/services/supabaseService.js` | Use enum values for status writes/reads; write `cancel_reason`/`fail_reason` instead of embedding in status; stop writing `pilot_id`/`pilot_name` (use `delivery_id`); repoint `menu_availability` (or use compat view) |
| `src/context/AppContext.jsx` | Use enum statuses; remove pilot_id/pilot_name usage; resolve driver via `delivery_id` join |
| `src/components/orders/OrderInbox.jsx` | Status badges from `orderStatus.js`; driver name via join |
| `src/services/printerService.js` | Resolve pilot/driver name from joined `delivery`, not `pilot_name` |
| `src/utils/safeOrderParser.js` | Align item shape with `order_items` (product_name/quantity/unit_price/total_price) |

### Phase 2 (relational writes via RPC)
| File | Change |
|---|---|
| `src/services/supabaseService.js` | `createManualOrder` → `rpc('create_order_with_items')` (writes `order_items` + `customers`); `assignPilot` → `rpc('assign_driver')`; `saveShiftReport` → `rpc('close_shift')` with server-side financials; read `order_items`/`order_assignments`/`order_status_history`/`driver_transactions` |
| `src/context/AppContext.jsx` | Move assignment/complete/fail/close-shift to RPC calls; drop client-side earnings math in `activeStats`/`closeShift` (read `driver_transactions`) |
| `src/components/reports/ReportsView.jsx` | Source financials from `driver_transactions`/`delivery_shift_logs` |
| `src/components/orders/OrderInbox.jsx` | Assignment button → RPC; show status history if needed |

### Phase 3 (realtime / sync / perf)
| File | Change |
|---|---|
| `src/services/supabaseService.js` | Realtime handlers apply `payload.new`/`payload.old` deltas instead of full refetch; add idempotency-key generation; migrate offline queue toward `sync_queue` RPCs |
| `src/context/AppContext.jsx` | Reducer-style delta application for orders/drivers/reservations; longer safety poll |
| `src/utils/shiftLogic.js` | `generateUUID()` → `crypto.randomUUID()`; idempotency-key helper |

### Cleanup / removal
- Delete `supabase/shift_governance.sql`, `supabase/close_shift_rpc.sql`, `supabase/alter_order_items.sql` once folded into migrations.
- Remove dead `menu_availability` service code after the app uses `menu_items` directly (post-compat).

---

## 4. Per-phase verification gate

After **each** phase:
1. `get_advisors(security)` and `get_advisors(performance)` — confirm the targeted findings drop to zero and no regressions appear.
2. Smoke test the happy path against a **staging branch** (`supabase branches`) before prod: create order → confirm → assign driver → start → deliver → close shift; reservations; feedback.
3. Verify RLS with three JWTs (admin / casher / driver) + anon: each role can do only what it should; anon is denied on business tables.
4. `npm run lint` and a manual UI pass.
5. Tag a git checkpoint and update this plan's checklist.

---

## 5. Risks & decisions needed before Phase 0 coding

1. **Auth method**: email/password vs phone OTP for staff? (Affects `Login.jsx` + `config.toml`.) Default assumption: **email/password**.
2. **Order ingestion (n8n)**: do the n8n webhooks insert into `orders` directly with the anon key? If yes, they must move to the **`service_role`** key (server-side) before `0002_rls_rebuild` removes anon INSERT, or we keep a narrow anon INSERT policy on `orders`. **Needs confirmation.**
3. **Existing data**: prod has only 2 orders / 2 drivers / 3 reservations — backfills are trivial and low-risk, but run them in `0007`/`0008` regardless for correctness.
4. **`shifts.id` type**: keep `text` (least disruptive; matches existing FKs) and fix RPC signatures accordingly, rather than converting to `uuid`.
5. **Telegram secrets**: confirm we can use Supabase **Vault** (recommended) for `telegram_bot_token`; otherwise keep in `app_config` with deny-all RLS + a `SECURITY DEFINER` getter.
6. **Staging first**: all migrations validated on a Supabase **preview branch** before prod apply.

---

## 6. Proposed execution checklist

- [ ] Authoritative `pg_dump` + Dashboard backup taken
- [ ] `supabase link` + `db pull` baseline committed
- [ ] Decisions in §5 confirmed
- [ ] **Phase 0**: app auth shipped → profiles seeded → n8n→service_role → RLS rebuild → storage private → functions hardened → `.env` removed → advisors green
- [ ] **Phase 1**: status enum + reasons, customer link, driver canonical, shift governance deployed, broken RPCs repaired, menu_availability fixed → advisors green
- [ ] **Phase 2**: transactional RPCs wired into `supabaseService`/context → advisors green
- [ ] **Phase 3**: realtime deltas, idempotency, sync_queue, indexes → advisors green
- [ ] **Contract**: drop legacy columns/policies/functions → final advisors green

---

*Next step after sign-off: implement Phase 0 — starting with `0001_auth_profiles_rbac.sql` and the Auth-capable client (`authService.js`, `Login.jsx`, `supabaseClient.js`), with RLS rebuild applied only once auth is live.*
