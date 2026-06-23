-- ============================================================================
-- Pilot lifecycle + order sync (Supabase = source of truth)
-- Project: AbuKhater (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Goals:
--   1. Atomic pilot shift open/close — preserve shift_started_at, set shift_ended_at
--   2. Accumulate total_minutes server-side on close
--   3. Fix assign_order_to_pilot / start_pilot_trip / complete_order_delivery RPCs
--   4. Idempotent mutations (client_mutation_id) — safe offline replay
--   5. Repair corrupted pilot shift rows
--   6. Audit trail in order_status_history + order_assignments
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Idempotency table (prevents duplicate writes on offline replay)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.applied_mutations (
  client_mutation_id uuid PRIMARY KEY,
  operation          text NOT NULL,
  entity_type        text,
  entity_id          text,
  result             jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applied_mutations_created
  ON public.applied_mutations (created_at DESC);

ALTER TABLE public.applied_mutations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS applied_mutations_select ON public.applied_mutations;
CREATE POLICY applied_mutations_select ON public.applied_mutations FOR SELECT USING (true);

DROP POLICY IF EXISTS applied_mutations_insert ON public.applied_mutations;
CREATE POLICY applied_mutations_insert ON public.applied_mutations FOR INSERT WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 1. Helpers
-- ----------------------------------------------------------------------------

-- Minutes between two timestamps (never negative), capped at 12h per session
CREATE OR REPLACE FUNCTION public._session_minutes(
  p_start timestamptz,
  p_end   timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_start IS NULL THEN 0
    ELSE LEAST(
      720,
      GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(p_end, now()) - p_start)) / 60.0))::int
    )
  END;
$$;

-- Is pilot shift currently open?
CREATE OR REPLACE FUNCTION public._pilot_shift_is_open(p_row public.delivery)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_row.shift_started_at IS NOT NULL AND p_row.shift_ended_at IS NULL;
$$;

-- Normalize legacy pilot delivery states
CREATE OR REPLACE FUNCTION public._normalize_pilot_state(p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_state IN ('out', 'on_delivery') THEN 'on_delivery'
    WHEN p_state = 'busy' THEN 'available'
    WHEN p_state IN ('available', 'off') THEN p_state
    ELSE COALESCE(p_state, 'off')
  END;
$$;

-- Active order statuses (Arabic + English aliases used by the app)
CREATE OR REPLACE FUNCTION public._is_active_order_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') = ANY (ARRAY[
    'active', 'pending', 'pending_timer', 'waiting_driver', 'confirmed',
    'driver_assigned', 'out_for_delivery',
    'في التحضير', 'تم الإسناد للطيار', 'في الطريق للتسليم'
  ]);
$$;

CREATE OR REPLACE FUNCTION public._assigned_order_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['driver_assigned', 'تم الإسناد للطيار'];
$$;

CREATE OR REPLACE FUNCTION public._active_delivery_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['active', 'out_for_delivery', 'في الطريق للتسليم'];
$$;

-- Idempotency guard — returns prior result if mutation already applied
CREATE OR REPLACE FUNCTION public._claim_mutation(
  p_mutation_id   uuid,
  p_operation     text,
  p_entity_type   text DEFAULT NULL,
  p_entity_id     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing jsonb;
BEGIN
  IF p_mutation_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT result INTO v_existing
  FROM public.applied_mutations
  WHERE client_mutation_id = p_mutation_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._finish_mutation(
  p_mutation_id   uuid,
  p_operation     text,
  p_entity_type   text,
  p_entity_id     text,
  p_result        jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_mutation_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.applied_mutations (client_mutation_id, operation, entity_type, entity_id, result)
  VALUES (p_mutation_id, p_operation, p_entity_type, p_entity_id, p_result)
  ON CONFLICT (client_mutation_id) DO NOTHING;
END;
$$;

-- Log order status change
CREATE OR REPLACE FUNCTION public._log_order_status(
  p_order_id   uuid,
  p_old_status text,
  p_new_status text,
  p_changed_by text DEFAULT 'system',
  p_notes      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.order_status_history (order_id, old_status, new_status, changed_by, notes)
  VALUES (p_order_id, p_old_status, p_new_status, p_changed_by, p_notes);
EXCEPTION WHEN undefined_table THEN
  NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. DATA REPAIR (run once — safe to re-run)
-- ----------------------------------------------------------------------------

-- 2a. Recalculate total_minutes for closed sessions where timestamps exist but minutes = 0
UPDATE public.delivery d
SET total_minutes = public._session_minutes(d.shift_started_at, d.shift_ended_at)
WHERE d.shift_started_at IS NOT NULL
  AND d.shift_ended_at IS NOT NULL
  AND COALESCE(d.total_minutes, 0) = 0;

-- 2b. Normalize legacy pilot states
UPDATE public.delivery
SET state = public._normalize_pilot_state(state)
WHERE state IN ('out', 'busy');

-- 2c. If shift is open but state is off, fix to available
UPDATE public.delivery
SET state = 'available'
WHERE shift_started_at IS NOT NULL
  AND shift_ended_at IS NULL
  AND state = 'off';

-- ----------------------------------------------------------------------------
-- 3. toggle_pilot_shift — canonical RPC for open/close (matches React togglePilotShift)
-- ----------------------------------------------------------------------------
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
  v_pilot       public.delivery%ROWTYPE;
  v_is_open     boolean;
  v_session_min integer;
  v_result      jsonb;
  v_cached      jsonb;
BEGIN
  v_cached := public._claim_mutation(p_mutation_id, 'toggle_pilot_shift', 'delivery', p_pilot_id::text);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_pilot FROM public.delivery WHERE id = p_pilot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pilot not found: %', p_pilot_id USING ERRCODE = 'P0001';
  END IF;

  v_is_open := public._pilot_shift_is_open(v_pilot);

  -- ===================== CLOSE =====================
  IF v_is_open THEN
    v_session_min := public._session_minutes(v_pilot.shift_started_at, now());

    UPDATE public.delivery
    SET
      shift_ended_at  = now(),          -- وقت النهاية فقط
      -- shift_started_at يبقى كما هو ✅
      state           = 'off',
      shift_used      = true,
      total_minutes   = COALESCE(total_minutes, 0) + v_session_min
    WHERE id = p_pilot_id;

    -- Log to delivery_shift_logs if table exists
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
      'total_minutes', COALESCE(v_pilot.total_minutes, 0) + v_session_min,
      'state', 'off'
    );

    PERFORM public._finish_mutation(p_mutation_id, 'toggle_pilot_shift', 'delivery', p_pilot_id::text, v_result);
    RETURN v_result;
  END IF;

  -- ===================== OPEN =====================
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

-- ----------------------------------------------------------------------------
-- 4. Fix start_driver_shift / end_driver_shift (bigint — real table id type)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_driver_shift(p_driver_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.delivery
  SET
    shift_started_at = now(),
    shift_ended_at   = NULL,
    state            = 'available',
    last_return_time = now()
  WHERE id = p_driver_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_driver_shift(p_driver_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.delivery%ROWTYPE;
  v_min integer;
BEGIN
  SELECT * INTO v_row FROM public.delivery WHERE id = p_driver_id FOR UPDATE;
  IF NOT FOUND OR v_row.shift_started_at IS NULL THEN
    RETURN;
  END IF;

  -- Already closed
  IF v_row.shift_ended_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_min := public._session_minutes(v_row.shift_started_at, now());

  UPDATE public.delivery
  SET
    shift_ended_at  = now(),
    -- shift_started_at preserved ✅
    state           = 'off',
    shift_used      = true,
    total_minutes   = COALESCE(total_minutes, 0) + v_min
  WHERE id = p_driver_id;
END;
$$;

-- Drop broken uuid overloads (no drivers table / wrong type)
DROP FUNCTION IF EXISTS public.start_driver_shift(uuid);
DROP FUNCTION IF EXISTS public.end_driver_shift(uuid);

-- ----------------------------------------------------------------------------
-- 5. assign_order_to_pilot — atomic assignment (fixes status + keeps pilot available)
-- ----------------------------------------------------------------------------
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

  -- Pilot stays available in restaurant (can receive more orders)
  UPDATE public.delivery
  SET state = 'available'
  WHERE id = p_pilot_id;

  PERFORM public._log_order_status(p_order_id, v_order.status, v_status_assigned, 'assign_order_to_pilot');

  BEGIN
    INSERT INTO public.order_assignments (order_id, delivery_id, assigned_by, notes)
    VALUES (p_order_id, p_pilot_id, 'rpc', 'assign_order_to_pilot');
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

-- ----------------------------------------------------------------------------
-- 6. start_pilot_trip — start one assigned order; pilot leaves restaurant (on_delivery)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 7. complete_order_delivery — complete one order; return pilot only if no active left
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 8. fail_order_delivery
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 9. Trigger: auto-log order status changes from any write path
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_orders_status_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public._log_order_status(NEW.id, OLD.status, NEW.status, 'trigger');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_orders_status_history ON public.orders;
CREATE TRIGGER trigger_orders_status_history
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_orders_status_history();

-- ----------------------------------------------------------------------------
-- 10. View: pilot shift snapshot for clients (single read shape)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.pilot_shift_snapshot AS
SELECT
  d.id,
  d.name,
  d.phone,
  d.state,
  d.shift_started_at,
  d.shift_ended_at,
  (d.shift_started_at IS NOT NULL AND d.shift_ended_at IS NULL) AS shift_is_open,
  d.total_minutes,
  d.orders_count,
  d.shift_used,
  d.last_return_time,
  CASE
    WHEN d.shift_started_at IS NOT NULL AND d.shift_ended_at IS NULL
      THEN COALESCE(d.total_minutes, 0) + public._session_minutes(d.shift_started_at, now())
    ELSE COALESCE(d.total_minutes, 0)
  END AS total_minutes_including_active
FROM public.delivery d;

-- ----------------------------------------------------------------------------
-- 11. Grants (app uses anon key today)
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.toggle_pilot_shift(bigint, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_order_to_pilot(uuid, bigint, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_pilot_trip(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_order_delivery(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_order_delivery(uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_driver_shift(bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_driver_shift(bigint) TO anon, authenticated, service_role;

GRANT SELECT ON public.pilot_shift_snapshot TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.applied_mutations TO anon, authenticated, service_role;

-- Realtime (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.applied_mutations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END;
$$;
