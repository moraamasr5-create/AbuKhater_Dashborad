# Phase 2 Report: Server-Authoritative Order Creation (`create_order`) & Dynamic Business Rules

**Project**: AbuKhater Restaurant Control Center & Customer Menu (`htpnxizfqmnnkhemvmdz`)  
**Status**: Completed & Verified  
**Date**: 2026-10-01  

---

## 1. Executive Summary

In Phase 2, the order creation lifecycle has been completely transitioned from **client-side calculation and loose direct database inserts** to a **single, server-authoritative, atomic PostgreSQL RPC (`create_order`)**.

All business rules (delivery fees, GPS Haversine distance pricing, rounding, service fees, operating hours, active shift association, item availability, and prices) are now loaded dynamically from `public.restaurant_settings` and `public.delivery_zones` on the database server.

---

## 2. Key Architecture Components

### A. Server-Side RPC: `public.create_order(...)`
The RPC is defined in `supabase/server_authoritative_create_order.sql` with `SECURITY DEFINER` and `SET search_path = public`.

```
Client (Menu / POS)
   │
   ├── Sends: customer data, order type, payment method, GPS coords or zone ID, item IDs & quantities
   │   (NO client total, NO client delivery fee, NO client service fee, NO unit prices)
   ▼
`create_order` RPC (PostgreSQL Server)
   │
   ├── 1. Idempotency Check (`public._claim_mutation`)
   ├── 2. Input Validation (name, phone length, order type, non-empty items)
   ├── 3. Load Authoritative Settings (`public.restaurant_settings`)
   ├── 4. Active Shift Association & Verification (`shifts.status = 'open'`)
   ├── 5. Delivery Enablement & Range Check (`_haversine_distance_km <= max_delivery_distance_km`)
   ├── 6. Item Lookup, Availability & Price Summation (`menu_items.id`, `base_price`)
   ├── 7. Authoritative Delivery Fee & Rounding (`delivery_rounding_step`)
   ├── 8. Electronic Payment Service Fee Calculation
   ├── 9. Atomic Order Number Generation (`nextval('order_number_seq')`)
   ├── 10. Atomic Insert into `orders`
   ├── 11. Atomic Insert into `order_items`
   ├── 12. Idempotency Finalization (`public._finish_mutation`)
   ▼
Returns authoritative JSON response (order_id, order_number, subtotal, delivery_fee, service_fee, total_amount)
```

---

## 3. Dynamic Business Rules Managed in Database

No business rules are hardcoded inside the RPC. All rules are read from `public.restaurant_settings`:

| Setting Key | Default Value | Description |
| :--- | :--- | :--- |
| `is_restaurant_open` | `'true'` | Enables or disables ordering across the platform |
| `delivery_enabled` | `'true'` | Toggles delivery orders (pickup/dine-in remain active) |
| `delivery_base_fee` | `'25'` | Base delivery price in EGP |
| `delivery_base_distance_km` | `'0.5'` | Base distance covered by base fee (km) |
| `delivery_per_km_rate` | `'12.5'` | Rate per km beyond base distance (1.25 EGP/100m) |
| `max_delivery_distance_km` | `'10'` | Maximum delivery radius in km |
| `delivery_rounding_step` | `'5'` | Rounding step (5 for nearest 5 EGP, 1 for exact integer) |
| `restaurant_lat` | `'30.126131'` | Matareya branch latitude |
| `restaurant_lng` | `'31.298350'` | Matareya branch longitude |
| `payment_service_fee_enabled`| `'true'` | Enables service fee surcharge for electronic payments |
| `payment_service_fee_chunk` | `'500'` | Surcharge chunk tier (EGP) |
| `payment_service_fee_per_chunk`| `'10'` | Surcharge per 500 EGP chunk |
| `reservation_deposit_amount`| `'100'` | Reservation deposit in EGP |
| `reservation_service_fee` | `'5'` | Reservation service fee in EGP |
| `require_active_shift_for_orders` | `'true'` | Enforces an active open shift to accept orders |
| `shift_open_time` | `'06:00'` | Operational shift start window (Cairo time) |
| `shift_close_time` | `'04:00'` | Operational shift close window (Cairo time) |

---

## 4. Fixes & Security Enhancements

1. **Fixed Item Identifiers (`order_items.item_id`)**:
   - Eliminated the legacy bug where frontend sent fake `#1, #2` index identifiers.
   - Now passes genuine `menu_items.id` (UUID), linking `order_items` foreign key properly.
2. **Fixed Order Sequence Collision**:
   - Replaced fragile `localStorage` counters with PostgreSQL sequence `order_number_seq`.
   - Guaranteed unique, monotonic, concurrent sequence across all client devices.
3. **Price Manipulation Elimination**:
   - Client totals, unit prices, delivery fees, and service fees in request payloads are completely ignored.
   - Server fetches live item prices from `menu_items` and applies authoritative equations.
4. **Shift Governance Enforcement**:
   - Orders are automatically linked to the active open shift on insert.
   - Rejects order creation if the store is closed or no shift is active when `require_active_shift_for_orders` is enabled.
5. **Idempotency Protection**:
   - Multiple clicks or retransmissions with the same `idempotency_key` return the existing order safely without duplicate billing or insertion.

---

## 5. Verification & Build Results

- `AbuKhater_Menu`: Vite production build passed with 0 errors (`built in 5.92s`).
- `AbuKhater_delivery`: Vite production build passed with 0 errors (`built in 5.60s`).
- Backward Compatibility: Existing POS and Menu flows preserved.
