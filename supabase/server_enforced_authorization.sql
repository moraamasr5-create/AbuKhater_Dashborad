-- ============================================================================
-- Phase 1B Migration: Server-Enforced Authorization & Role-Based Security
-- Project: AbuKhater Restaurant Control Center (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Objectives:
--   1. Revoke operational RPC execution from anonymous callers (anon).
--   2. Grant RPC execution strictly to authenticated staff with role checks.
--   3. Enforce strict Row Level Security (RLS) policies across all tables.
--   4. Preserve public customer order/reservation/feedback creation for Menu app.
--   5. Maintain Realtime publications for authenticated Dashboard clients.
-- ============================================================================

-- ============================================================================
-- SECTION 1: RPC Authorization Upgrades & Grants
-- ============================================================================

-- 1.1 Helper: Validate active staff member
CREATE OR REPLACE FUNCTION public._require_staff_role(p_allowed_roles text[])
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required: no active session found.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role
  FROM public.staff_roles
  WHERE user_id = auth.uid()
    AND is_active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User is not an active staff member.' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_role = ANY(p_allowed_roles)) THEN
    RAISE EXCEPTION 'Forbidden: Role % is not authorized for this operation.', v_role USING ERRCODE = '42501';
  END IF;

  RETURN v_role;
END;
$$;

-- 1.2 open_shift: Only Admin and Cashier can open shifts
CREATE OR REPLACE FUNCTION public.open_shift(
  p_id         uuid,
  p_date       date,
  p_start_time timestamptz DEFAULT now()
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check record;
  v_row   public.shifts;
BEGIN
  -- Require admin or casher role
  PERFORM public._require_staff_role(ARRAY['admin', 'casher']);

  -- If a shift for this operational day is already open, resume it
  SELECT * INTO v_row
  FROM public.shifts
  WHERE date = p_date AND status = 'open'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Governance: enforce the opening window from app_config (Africa/Cairo)
  SELECT * INTO v_check FROM public.is_shift_operation_allowed('open', false);
  IF NOT v_check.allowed THEN
    RAISE EXCEPTION '%', v_check.reason USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.shifts (id, date, start_time, status, total_orders, stats)
  VALUES (p_id, p_date, p_start_time, 'open', 0, '{}'::jsonb)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 1.3 close_shift: Admin and Cashier (force_close requires Admin)
CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id    uuid,
  p_stats       jsonb DEFAULT NULL,
  p_force_close boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_check       record;
  v_shift       record;
  v_bounds      record;
  v_assoc_from  timestamptz;
  v_assoc_to    timestamptz;
  v_active_statuses text[] := ARRAY[
    'active', 'pending', 'waiting_driver', 'confirmed',
    'في التحضير', 'تم الإسناد للطيار', 'في الطريق للتسليم',
    'out_for_delivery', 'driver_assigned', 'pending_timer'
  ];
BEGIN
  -- Verify caller role
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher']);

  -- Force close is restricted strictly to Admins
  IF p_force_close AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Only Administrators can force close a shift.' USING ERRCODE = '42501';
  END IF;

  -- 1. Time Validation (SERVER SIDE) driven by app_config + Africa/Cairo
  SELECT * INTO v_check FROM public.is_shift_operation_allowed('close', p_force_close);
  IF NOT v_check.allowed THEN
    RAISE EXCEPTION '%', v_check.reason USING ERRCODE = 'P0001';
  END IF;

  SELECT id, date, start_time INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_bounds FROM public._shift_operational_bounds(v_shift.date);

  v_assoc_from := GREATEST(v_shift.start_time, v_bounds.start_at);
  v_assoc_to   := LEAST(now(), v_bounds.end_at);

  -- 2. Active Orders Validation
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.status = ANY(v_active_statuses)
      AND (
        o.shift_id = p_shift_id
        OR (
          o.shift_id IS NULL
          AND o.created_at >= v_assoc_from
          AND o.created_at < v_bounds.end_at
        )
      )
  ) THEN
    RAISE EXCEPTION 'Active orders exist' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Orders Association (Scoped to window)
  UPDATE public.orders
  SET shift_id = p_shift_id
  WHERE shift_id IS NULL
    AND created_at >= v_assoc_from
    AND created_at <= v_assoc_to;

  -- 4. Shift Closing Logic
  UPDATE public.shifts
  SET
    status = 'closed',
    end_time = now(),
    stats = COALESCE(p_stats, stats)
  WHERE id = p_shift_id;

  -- 5. Delivery Logs (Safe Update)
  BEGIN
    EXECUTE 'UPDATE public.delivery_shift_logs
             SET status = ''closed'',
                 end_time = now()
             WHERE shift_id = $1 AND status = ''open'''
    USING p_shift_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
END;
$$;

-- 1.4 toggle_pilot_shift: Staff verification
CREATE OR REPLACE FUNCTION public.toggle_pilot_shift(
  p_pilot_id       bigint,
  p_force_reopen   boolean DEFAULT false,
  p_mutation_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_pilot       public.delivery%ROWTYPE;
  v_is_open     boolean;
  v_session_min integer;
  v_result      jsonb;
  v_cached      jsonb;
BEGIN
  -- Verify caller role
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  -- Force reopen is restricted to Admins
  IF p_force_reopen AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Admin authorization required to force reopen pilot shift.' USING ERRCODE = '42501';
  END IF;

  v_cached := public._claim_mutation(p_mutation_id, 'toggle_pilot_shift', 'delivery', p_pilot_id::text);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_pilot FROM public.delivery WHERE id = p_pilot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pilot not found: %', p_pilot_id USING ERRCODE = 'P0001';
  END IF;

  v_is_open := public._pilot_shift_is_open(v_pilot);

  -- CLOSE
  IF v_is_open THEN
    v_session_min := public._session_minutes(v_pilot.shift_started_at, now());

    UPDATE public.delivery
    SET
      shift_ended_at  = now(),
      state           = 'off',
      shift_used      = true,
      total_minutes   = LEAST(600, COALESCE(total_minutes, 0) + v_session_min)
    WHERE id = p_pilot_id;

    BEGIN
      INSERT INTO public.delivery_shift_logs (
        delivery_id, shift_started_at, shift_ended_at, total_minutes, orders_count
      ) VALUES (
        p_pilot_id, v_pilot.shift_started_at, now(), v_session_min, COALESCE(v_pilot.orders_count, 0)
      );
    EXCEPTION WHEN undefined_table OR foreign_key_violation THEN
      NULL;
    END;

    v_result := jsonb_build_object(
      'pilot_id', p_pilot_id,
      'shift_status', 'closed',
      'shift_started_at', v_pilot.shift_started_at,
      'shift_ended_at', now(),
      'session_minutes', v_session_min,
      'total_minutes', LEAST(600, COALESCE(v_pilot.total_minutes, 0) + v_session_min),
      'state', 'off'
    );

    PERFORM public._finish_mutation(p_mutation_id, 'toggle_pilot_shift', 'delivery', p_pilot_id::text, v_result);
    RETURN v_result;
  END IF;

  -- OPEN
  IF COALESCE(v_pilot.shift_used, false) AND NOT p_force_reopen THEN
    RAISE EXCEPTION 'Pilot already used shift today. Admin force reopen required.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.delivery
  SET
    shift_started_at = now(),
    shift_ended_at   = NULL,
    state            = 'available',
    last_return_time = now()
  WHERE id = p_pilot_id;

  v_result := jsonb_build_object(
    'pilot_id', p_pilot_id,
    'shift_status', 'open',
    'shift_started_at', now(),
    'shift_ended_at', NULL,
    'state', 'available'
  );

  PERFORM public._finish_mutation(p_mutation_id, 'toggle_pilot_shift', 'delivery', p_pilot_id::text, v_result);
  RETURN v_result;
END;
$$;

-- 1.5 assign_order_to_pilot: Admin and Cashier only
CREATE OR REPLACE FUNCTION public.assign_order_to_pilot(
  p_order_id    uuid,
  p_pilot_id    bigint,
  p_pilot_name  text,
  p_mutation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order       public.orders%ROWTYPE;
  v_pilot       public.delivery%ROWTYPE;
  v_load        integer;
  v_cached      jsonb;
  v_result      jsonb;
  v_status_assigned text := 'تم الإسناد للطيار';
BEGIN
  -- Require admin or casher
  PERFORM public._require_staff_role(ARRAY['admin', 'casher']);

  v_cached := public._claim_mutation(p_mutation_id, 'assign_order_to_pilot', 'order', p_order_id::text);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_pilot FROM public.delivery WHERE id = p_pilot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pilot not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public._pilot_shift_is_open(v_pilot) THEN
    RAISE EXCEPTION 'Pilot shift is not open' USING ERRCODE = 'P0001';
  END IF;

  IF public._normalize_pilot_state(v_pilot.state) <> 'available' THEN
    RAISE EXCEPTION 'Pilot is not available (state=%)', v_pilot.state USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_load
  FROM public.orders o
  WHERE o.delivery_id = p_pilot_id
    AND o.status = ANY (public._assigned_order_statuses() || public._active_delivery_statuses());

  IF v_load >= 7 THEN
    RAISE EXCEPTION 'Pilot already has 7 assigned/active orders' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
  SET
    pilot_id    = p_pilot_id::text,
    pilot_name  = p_pilot_name,
    delivery_id = p_pilot_id,
    status      = v_status_assigned
  WHERE id = p_order_id;

  UPDATE public.delivery
  SET state = 'available'
  WHERE id = p_pilot_id;

  PERFORM public._log_order_status(p_order_id, v_order.status, v_status_assigned, 'assign_order_to_pilot');

  BEGIN
    INSERT INTO public.order_assignments (order_id, delivery_id, assigned_by, notes)
    VALUES (p_order_id, p_pilot_id, auth.uid()::text, 'assign_order_to_pilot');
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  v_result := jsonb_build_object(
    'order_id', p_order_id,
    'pilot_id', p_pilot_id,
    'status', v_status_assigned
  );

  PERFORM public._finish_mutation(p_mutation_id, 'assign_order_to_pilot', 'order', p_order_id::text, v_result);
  RETURN v_result;
END;
$$;

-- 1.6 start_pilot_trip: Admin, Cashier, or Driver
CREATE OR REPLACE FUNCTION public.start_pilot_trip(
  p_order_id    uuid,
  p_mutation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order         public.orders%ROWTYPE;
  v_pilot_id      bigint;
  v_cached        jsonb;
  v_result        jsonb;
  v_status_active text := 'في الطريق للتسليم';
BEGIN
  PERFORM public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  v_cached := public._claim_mutation(p_mutation_id, 'start_pilot_trip', 'order', p_order_id::text);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (v_order.status = ANY (public._assigned_order_statuses())) THEN
    RAISE EXCEPTION 'Order is not assigned to a pilot (status=%)', v_order.status USING ERRCODE = 'P0001';
  END IF;

  v_pilot_id := v_order.delivery_id;
  IF v_pilot_id IS NULL THEN
    RAISE EXCEPTION 'Order has no delivery_id' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.delivery WHERE id = v_pilot_id FOR UPDATE;

  UPDATE public.orders SET status = v_status_active WHERE id = p_order_id;
  PERFORM public._log_order_status(p_order_id, v_order.status, v_status_active, 'start_pilot_trip');

  UPDATE public.delivery
  SET state = 'on_delivery'
  WHERE id = v_pilot_id;

  v_result := jsonb_build_object(
    'order_id', p_order_id,
    'pilot_id', v_pilot_id,
    'state', 'on_delivery'
  );

  PERFORM public._finish_mutation(p_mutation_id, 'start_pilot_trip', 'order', p_order_id::text, v_result);
  RETURN v_result;
END;
$$;

-- 1.7 complete_order_delivery: Admin, Cashier, or Driver
CREATE OR REPLACE FUNCTION public.complete_order_delivery(
  p_order_id    uuid,
  p_mutation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      public.orders%ROWTYPE;
  v_pilot_id   bigint;
  v_other      integer;
  v_cached     jsonb;
  v_result     jsonb;
  v_status_done text := 'تم التوصيل';
BEGIN
  PERFORM public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  v_cached := public._claim_mutation(p_mutation_id, 'complete_order_delivery', 'order', p_order_id::text);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0001';
  END IF;

  v_pilot_id := v_order.delivery_id;

  UPDATE public.orders SET status = v_status_done WHERE id = p_order_id;
  PERFORM public._log_order_status(p_order_id, v_order.status, v_status_done, 'complete_order_delivery');

  IF v_pilot_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_other
    FROM public.orders
    WHERE delivery_id = v_pilot_id
      AND id <> p_order_id
      AND status = ANY (public._assigned_order_statuses() || public._active_delivery_statuses());

    IF v_other = 0 THEN
      UPDATE public.delivery
      SET
        state            = 'available',
        last_return_time = now(),
        orders_count     = COALESCE(orders_count, 0) + 1
      WHERE id = v_pilot_id;
    ELSE
      UPDATE public.delivery SET state = 'on_delivery' WHERE id = v_pilot_id;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'order_id', p_order_id,
    'status', v_status_done,
    'pilot_id', v_pilot_id,
    'pilot_state', CASE WHEN v_other = 0 THEN 'available' ELSE 'on_delivery' END
  );

  PERFORM public._finish_mutation(p_mutation_id, 'complete_order_delivery', 'order', p_order_id::text, v_result);
  RETURN v_result;
END;
$$;

-- 1.8 fail_order_delivery: Admin, Cashier, or Driver
CREATE OR REPLACE FUNCTION public.fail_order_delivery(
  p_order_id    uuid,
  p_reason      text DEFAULT NULL,
  p_mutation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      public.orders%ROWTYPE;
  v_pilot_id   bigint;
  v_other      integer;
  v_cached     jsonb;
  v_result     jsonb;
  v_status_fail text;
BEGIN
  PERFORM public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  v_cached := public._claim_mutation(p_mutation_id, 'fail_order_delivery', 'order', p_order_id::text);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  v_status_fail := CASE
    WHEN p_reason IS NOT NULL AND p_reason <> '' THEN 'فشل التوصيل (' || p_reason || ')'
    ELSE 'فشل التوصيل'
  END;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0001';
  END IF;

  v_pilot_id := v_order.delivery_id;

  UPDATE public.orders SET status = v_status_fail WHERE id = p_order_id;
  PERFORM public._log_order_status(p_order_id, v_order.status, v_status_fail, 'fail_order_delivery', p_reason);

  IF v_pilot_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_other
    FROM public.orders
    WHERE delivery_id = v_pilot_id
      AND id <> p_order_id
      AND status = ANY (public._assigned_order_statuses() || public._active_delivery_statuses());

    IF v_other = 0 THEN
      UPDATE public.delivery
      SET state = 'available', last_return_time = now()
      WHERE id = v_pilot_id;
    ELSE
      UPDATE public.delivery SET state = 'on_delivery' WHERE id = v_pilot_id;
    END IF;
  END IF;

  v_result := jsonb_build_object('order_id', p_order_id, 'status', v_status_fail);
  PERFORM public._finish_mutation(p_mutation_id, 'fail_order_delivery', 'order', p_order_id::text, v_result);
  RETURN v_result;
END;
$$;

-- 1.9 REVOKE from anon & GRANT to authenticated for all operational RPCs
REVOKE EXECUTE ON FUNCTION public.open_shift(uuid, date, timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.open_shift(uuid, date, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.close_shift(uuid, jsonb, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, jsonb, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.toggle_pilot_shift(bigint, boolean, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.toggle_pilot_shift(bigint, boolean, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.assign_order_to_pilot(uuid, bigint, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.assign_order_to_pilot(uuid, bigint, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.start_pilot_trip(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.start_pilot_trip(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_order_delivery(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_order_delivery(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fail_order_delivery(uuid, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fail_order_delivery(uuid, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.start_driver_shift(bigint) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.start_driver_shift(bigint) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.end_driver_shift(bigint) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.end_driver_shift(bigint) TO authenticated;


-- ============================================================================
-- SECTION 2: Row Level Security (RLS) Policies on Operational Tables
-- ============================================================================

-- 2.1 Table: shifts
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_select_staff ON public.shifts;
CREATE POLICY shifts_select_staff ON public.shifts
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'));

DROP POLICY IF EXISTS shifts_insert_staff ON public.shifts;
CREATE POLICY shifts_insert_staff ON public.shifts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

DROP POLICY IF EXISTS shifts_update_admin ON public.shifts;
CREATE POLICY shifts_update_admin ON public.shifts
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS shifts_delete_admin ON public.shifts;
CREATE POLICY shifts_delete_admin ON public.shifts
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 2.2 Table: shift_expenses
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'shift_expenses') THEN
    ALTER TABLE public.shift_expenses ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS shift_expenses_select ON public.shift_expenses;
    CREATE POLICY shift_expenses_select ON public.shift_expenses
      FOR SELECT
      TO authenticated
      USING (public.has_role('admin') OR public.has_role('casher'));

    DROP POLICY IF EXISTS shift_expenses_insert ON public.shift_expenses;
    CREATE POLICY shift_expenses_insert ON public.shift_expenses
      FOR INSERT
      TO authenticated
      WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

    DROP POLICY IF EXISTS shift_expenses_delete ON public.shift_expenses;
    CREATE POLICY shift_expenses_delete ON public.shift_expenses
      FOR DELETE
      TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- 2.3 Table: delivery (pilots)
ALTER TABLE public.delivery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_select_staff ON public.delivery;
CREATE POLICY delivery_select_staff ON public.delivery
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'));

DROP POLICY IF EXISTS delivery_insert_admin ON public.delivery;
CREATE POLICY delivery_insert_admin ON public.delivery
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS delivery_update_staff ON public.delivery;
CREATE POLICY delivery_update_staff ON public.delivery
  FOR UPDATE
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

DROP POLICY IF EXISTS delivery_delete_admin ON public.delivery;
CREATE POLICY delivery_delete_admin ON public.delivery
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 2.4 Table: app_config
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_config_select_all ON public.app_config;
CREATE POLICY app_config_select_all ON public.app_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS app_config_insert_admin ON public.app_config;
CREATE POLICY app_config_insert_admin ON public.app_config
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS app_config_update_admin ON public.app_config;
CREATE POLICY app_config_update_admin ON public.app_config
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS app_config_delete_admin ON public.app_config;
CREATE POLICY app_config_delete_admin ON public.app_config
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 2.5 Table: restaurant_settings
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_settings_select_all ON public.restaurant_settings;
CREATE POLICY restaurant_settings_select_all ON public.restaurant_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS restaurant_settings_insert_admin ON public.restaurant_settings;
CREATE POLICY restaurant_settings_insert_admin ON public.restaurant_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS restaurant_settings_update_admin ON public.restaurant_settings;
CREATE POLICY restaurant_settings_update_admin ON public.restaurant_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS restaurant_settings_delete_admin ON public.restaurant_settings;
CREATE POLICY restaurant_settings_delete_admin ON public.restaurant_settings
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 2.6 Table: feedback
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Preserve customer insert from Menu
DROP POLICY IF EXISTS feedback_insert_public ON public.feedback;
CREATE POLICY feedback_insert_public ON public.feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Feedback read/delete restricted strictly to Admin
DROP POLICY IF EXISTS feedback_select_admin ON public.feedback;
CREATE POLICY feedback_select_admin ON public.feedback
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS feedback_delete_admin ON public.feedback;
CREATE POLICY feedback_delete_admin ON public.feedback
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 2.7 Table: reservations
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Preserve customer insert from Menu
DROP POLICY IF EXISTS reservations_insert_public ON public.reservations;
CREATE POLICY reservations_insert_public ON public.reservations
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Staff read and update
DROP POLICY IF EXISTS reservations_select_staff ON public.reservations;
CREATE POLICY reservations_select_staff ON public.reservations
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'));

DROP POLICY IF EXISTS reservations_update_staff ON public.reservations;
CREATE POLICY reservations_update_staff ON public.reservations
  FOR UPDATE
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

DROP POLICY IF EXISTS reservations_delete_admin ON public.reservations;
CREATE POLICY reservations_delete_admin ON public.reservations
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 2.8 Table: orders & order_items
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Preserve customer order insert from Menu
DROP POLICY IF EXISTS orders_insert_public ON public.orders;
CREATE POLICY orders_insert_public ON public.orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS order_items_insert_public ON public.order_items;
CREATE POLICY order_items_insert_public ON public.order_items
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Staff read all orders
DROP POLICY IF EXISTS orders_select_staff ON public.orders;
CREATE POLICY orders_select_staff ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'));

DROP POLICY IF EXISTS order_items_select_staff ON public.order_items;
CREATE POLICY order_items_select_staff ON public.order_items
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'));

-- Staff update orders (confirm, cancel, edit)
DROP POLICY IF EXISTS orders_update_staff ON public.orders;
CREATE POLICY orders_update_staff ON public.orders
  FOR UPDATE
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'));

-- Only admin can delete orders
DROP POLICY IF EXISTS orders_delete_admin ON public.orders;
CREATE POLICY orders_delete_admin ON public.orders
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS order_items_delete_admin ON public.order_items;
CREATE POLICY order_items_delete_admin ON public.order_items
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 2.9 Table: applied_mutations
ALTER TABLE public.applied_mutations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS applied_mutations_select_staff ON public.applied_mutations;
CREATE POLICY applied_mutations_select_staff ON public.applied_mutations
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'));

DROP POLICY IF EXISTS applied_mutations_insert_staff ON public.applied_mutations;
CREATE POLICY applied_mutations_insert_staff ON public.applied_mutations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role('admin') OR public.has_role('casher') OR public.has_role('driver'));

-- ============================================================================
-- SECTION 3: Realtime Publications
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- Make sure all tables are published
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_roles; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
