-- Per-order trip start: first start marks pilot on_delivery; other assigned orders stay until started individually.

DROP FUNCTION IF EXISTS public.start_pilot_trip(bigint, uuid);

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

-- Pilot stays on_delivery while any assigned or active orders remain
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

GRANT EXECUTE ON FUNCTION public.start_pilot_trip(uuid, uuid) TO anon, authenticated, service_role;
