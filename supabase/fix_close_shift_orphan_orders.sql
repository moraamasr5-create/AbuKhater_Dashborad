-- ============================================================================
-- HOTFIX: close_shift orphan order linking
-- ----------------------------------------------------------------------------
-- Problem: close_shift was doing
--   UPDATE orders SET shift_id = p_shift_id WHERE shift_id IS NULL
-- which attached ALL historical orphan orders to the closing shift, corrupting
-- sales reports.
--
-- Fix: only link orphan orders whose created_at falls within THIS shift's
-- operational window (Africa/Cairo + app_config open/close times), bounded by
-- the shift's actual start_time and the current close moment.
--
-- Also adds assign_shift_to_order trigger (BEFORE INSERT) so manual/online
-- orders get shift_id at insert time when an open shift exists.
-- ============================================================================

-- Re-use / create bounds helper (idempotent).
CREATE OR REPLACE FUNCTION public._shift_operational_bounds(p_shift_date date)
RETURNS TABLE (start_at timestamptz, end_at timestamptz)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_open_txt  text;
  v_close_txt text;
  v_open_h    integer;
  v_open_m    integer;
  v_close_h   integer;
  v_close_m   integer;
  v_open_min  integer;
  v_close_min integer;
  v_overnight boolean;
BEGIN
  SELECT value INTO v_open_txt  FROM public.app_config WHERE key = 'shift_open_time';
  SELECT value INTO v_close_txt FROM public.app_config WHERE key = 'shift_close_time';

  v_open_txt  := COALESCE(v_open_txt,  '06:00');
  v_close_txt := COALESCE(v_close_txt, '04:00');

  v_open_h  := COALESCE(NULLIF(split_part(v_open_txt, ':', 1), '')::int, 6);
  v_open_m  := COALESCE(NULLIF(split_part(v_open_txt, ':', 2), '')::int, 0);
  v_close_h := COALESCE(NULLIF(split_part(v_close_txt, ':', 1), '')::int, 4);
  v_close_m := COALESCE(NULLIF(split_part(v_close_txt, ':', 2), '')::int, 0);

  v_open_min  := (v_open_h * 60) + v_open_m;
  v_close_min := (v_close_h * 60) + v_close_m;
  v_overnight := v_close_min <= v_open_min;

  start_at := (
    p_shift_date::text || ' ' ||
    lpad(v_open_h::text, 2, '0') || ':' ||
    lpad(v_open_m::text, 2, '0') || ':00'
  )::timestamp AT TIME ZONE 'Africa/Cairo';

  IF v_overnight THEN
    end_at := (
      (p_shift_date + 1)::text || ' ' ||
      lpad(v_close_h::text, 2, '0') || ':' ||
      lpad(v_close_m::text, 2, '0') || ':00'
    )::timestamp AT TIME ZONE 'Africa/Cairo';
  ELSE
    end_at := (
      p_shift_date::text || ' ' ||
      lpad(v_close_h::text, 2, '0') || ':' ||
      lpad(v_close_m::text, 2, '0') || ':00'
    )::timestamp AT TIME ZONE 'Africa/Cairo';
  END IF;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id    uuid,
  p_stats       jsonb DEFAULT NULL,
  p_force_close boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
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

  UPDATE public.orders
  SET shift_id = p_shift_id
  WHERE shift_id IS NULL
    AND created_at >= v_assoc_from
    AND created_at <= v_assoc_to;

  UPDATE public.shifts
  SET
    status = 'closed',
    end_time = now(),
    stats = COALESCE(p_stats, stats)
  WHERE id = p_shift_id;

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

CREATE OR REPLACE FUNCTION public.assign_shift_to_order_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_shift_id uuid;
BEGIN
  IF NEW.shift_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.id INTO v_shift_id
  FROM public.shifts s
  CROSS JOIN LATERAL public._shift_operational_bounds(s.date) b
  WHERE s.status = 'open'
    AND NEW.created_at >= GREATEST(s.start_time, b.start_at)
    AND NEW.created_at < b.end_at
  ORDER BY s.start_time DESC
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    NEW.shift_id := v_shift_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_assign_shift_to_order ON public.orders;
CREATE TRIGGER trigger_assign_shift_to_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_shift_to_order_trigger();
