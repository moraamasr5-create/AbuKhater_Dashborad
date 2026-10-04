# Phase 0 Baseline Report: System Reality Check & Safety Audit

**Date:** October 1, 2026  
**Projects Under Scope:**
1. `AbuKhater_Menu` (Customer Web App) — `C:\Users\mamdo\Documents\GitHub\AbuKhater_Menu`
2. `AbuKhater_Dashborad` / `AbuKhater_delivery` (Operations & Control Center) — `C:\Users\mamdo\Documents\GitHub\AbuKhater_delivery`

---

## 1. Current Git State

### A. `AbuKhater_delivery`
- **Current Branch:** `cursor/fix-cancelled-orders-inbox`
- **Remote Sync:** Ahead of `origin/cursor/fix-cancelled-orders-inbox` by 6 commits.
- **Working Tree Status:** 5 modified uncommitted files:
  - `src/context/AppContext.jsx`
  - `src/services/supabaseService.js`
  - `src/utils/pilotCalculations.js`
  - `src/utils/shiftLogic.js`
  - `supabase/pilot_sync_and_lifecycle.sql`
- **Branch Inventory:** 11 local branches (`main`, `done`, `new`, `backup-before-rollback`, `cursor/*`), 16 remote branches.

### B. `AbuKhater_Menu`
- **Current Branch:** `main`
- **Remote Sync:** Up to date with `origin/main`.
- **Working Tree Status:** Clean (nothing to commit).
- **Branch Inventory:** 3 local branches (`main`, `cursor`, `cleanup/architecture-fix`), 5 remote tracking branches.

---

## 2. Database Reality Check & Uncertainty

Both applications are configured with the **same Supabase production instance**:
- **Project URL:** `https://htpnxizfqmnnkhemvmdz.supabase.co`
- **Auth Key:** Public Anonymous JWT (`anon`).

### Provable vs Unprovable from Repository Code:
| Entity / Capability | Provable from Git Code | Requires Direct Supabase Access | Status / Reality |
|---|---|---|---|
| Database Tables (`orders`, `order_items`, `menu_items`, `categories`, `reservations`, `feedback`, `shifts`, `delivery`, `app_config`, `restaurant_settings`, `applied_mutations`) | ✅ Yes | ❓ Live Schema Confirmation | Read/Written by client code and defined in SQL files. |
| Missing Table `menu_availability` | ✅ Yes (Proved Missing) | ❓ Confirmation | Referenced in `supabaseService.js`, but no SQL migration creates it. |
| Stored Procedures (RPCs) | ✅ Yes (in SQL files) | ❓ Deployed Status in DB | Multiple versions in SQL files; exact deployed version in production cannot be 100% verified without DB query. |
| Telegram Bot Edge Function (`telegram-order-alert`) | ✅ Yes (in `supabase/functions`) | ❓ Deployed Status | Stub entrypoint exists; no verified live webhook trigger. |
| Active RLS Policies | ✅ Yes (in SQL files) | ❓ Live DB Enforcement | All SQL migrations grant full access to `anon`; live policy enforcement unconfirmed. |

---

## 3. Migration & Schema Inventory & Conflicts

### Conflict Resolution Matrix:
| Resource / Identifier | Classification | Current State in Repository | Action / Recommendation |
|---|---|---|---|
| `close_shift` RPC | **ACTIVE** (with legacy duplicates) | 3 versions in Git: `close_shift_rpc.sql` (Legacy 2-arg), `shift_governance.sql` (Superseded), `fix_close_shift_orphan_orders.sql` (Active 3-arg with orphan bounds). | Keep all files. Active runtime expects 3 arguments (`p_shift_id`, `p_stats`, `p_force_close`). |
| `v_shift_close` | **UNKNOWN / NON-EXISTENT** | Not found in any SQL, JS, or documentation file. | No action. |
| `shift_close` | **LEGACY / STRING LITERAL** | Appears only as log/audit message literals in `AppContext.jsx`. | Preserved as audit text. |
| `menu_availability` | **LEGACY / DEAD CODE** | Exists in `supabaseService.js` (`fetchMenuAvailability`, `updateMenuAvailability`), but table does not exist in DB migrations and is never called from any UI component. | Do NOT delete. Flagged as dead client code. |
| `app_config` | **ACTIVE** | Defined in `shift_governance.sql` for shift operating hours (`shift_open_time`, `shift_close_time`). Fetched/updated in `AppContext.jsx`. | Source of truth for shift schedule. |
| `restaurant_settings` | **ACTIVE (Partial)** | Defined in `restaurant_settings_rls.sql` for delivery rules, fees, and InstaPay accounts. Managed in `SettingsView.jsx`. Ignored by `AbuKhater_Menu`. | Active in Dashboard, not yet consumed by Menu. |
| `applied_mutations` | **ACTIVE** | Defined in `pilot_sync_and_lifecycle.sql` and `per_order_trip_start.sql`. Used for offline mutation idempotency in `supabaseService.js`. | Active client & DB deduplication mechanism. |
| `order_items.item_id` | **ACTIVE (DB Schema)** | Added in `alter_order_items.sql` as `uuid REFERENCES menu_items(id)`. Read in `supabaseService.js:320`. | Expected DB foreign key column. |
| `order_items.product_id` | **ACTIVE (Menu App)** | Written by `AbuKhater_Menu/orderService.js:113` as text product ID. | Client write path in Menu app. |

---

## 4. Security Exposure Inventory

1. **Tracked `.env` in Git History**:
   - `AbuKhater_delivery/.env` was committed in commit `1bcb77b` and is currently tracked by Git.
   - `AbuKhater_delivery/.gitignore` does **not** ignore `.env` (only lists `*.local`).
2. **Hardcoded PINs & Passwords**:
   - Default PIN `'8080'` is hardcoded as fallback and check in multiple Dashboard components (`Login.jsx`, `Sidebar.jsx`, `ReportsView.jsx`, `AppContext.jsx`).
   - Role enforcement (`admin`, `casher`, `driver`) is purely client-side via `sessionStorage` and `safeGetItem`.
3. **Legacy n8n References**:
   - `AbuKhater_Menu/.env.example` contains dummy n8n webhook URL `VITE_N8N_BASE_URL`.
   - `AbuKhater_Menu/src/pages/MenuPage.jsx` and `PaymentPage.jsx` have legacy comments/badges referencing n8n, though all active network requests go to Supabase.
4. **Anonymous Role Elevation Risk**:
   - Both frontends execute mutations and queries under `anon` public key without authenticated user tokens.

---

## 5. Production vs. Staging Uncertainty

- **Staging Environment Status:** **NON-EXISTENT**.
- Both `AbuKhater_Menu` and `AbuKhater_delivery` are directly connected to the live production database (`htpnxizfqmnnkhemvmdz`).
- **Safety Requirement:** No production schema destructive operations (`DROP TABLE`, `ALTER COLUMN TYPE DROP`) can be run without dry-run scripts and explicit backup checkpoints.

---

## 6. Baseline Tests & Build Status

### A. `AbuKhater_delivery`
- **Lint Check (`npm run lint`):**
  - **47 Problems (42 errors, 5 warnings)**.
  - Critical lint error: `AppContext.jsx:1241` references undefined variables `finishedOrders` and `failedOrders`.
  - Multiple unused imports and React Hooks dependency warnings.
- **Build Check (`npm run build`):**
  - **PASSED** (Vite v7.3.1 built production bundle in 6.35s, bundle size: 783 kB).

### B. `AbuKhater_Menu`
- **Lint Check (`npm run lint`):**
  - **12 Problems (10 errors, 2 warnings)**.
  - SetState-in-effect warnings and lexical declaration in case blocks in `ReservationModal.jsx` and `FeedbackModal.jsx`.
- **Build Check (`npm run build`):**
  - **PASSED** (Vite v7.3.1 built production bundle in 16.79s, bundle size: 599 kB).

---

## 7. Exact Blockers Before Phase 1

1. **Uncommitted Working Tree in `AbuKhater_delivery`**: Must not be overwritten or discarded without user guidance.
2. **Lack of Isolated Staging DB**: All future database migrations must be purely additive and backward-compatible to avoid disrupting production traffic.
3. **Schema Field Drift (`order_items.product_id` vs `item_id`)**: Must be bridged gracefully in the schema before introducing strict foreign key constraints.
4. **Client-Side Role & Settings Dependency**: `AbuKhater_Menu` reliance on hardcoded pricing/InstaPay constants must be prepared for dynamic migration without breaking existing cart flows.
