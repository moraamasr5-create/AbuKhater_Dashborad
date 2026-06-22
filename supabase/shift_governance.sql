-- ============================================================================
-- Shift Schedule Governance (Database Controlled)
-- ----------------------------------------------------------------------------
-- قاعدة البيانات هي المصدر الوحيد للحقيقة في أوقات تشغيل الورديات.
-- This migration:
--   1. Creates a generic key/value settings table (app_config).
--   2. Seeds the editable shift window settings (shift_open_time / shift_close_time).
--   3. Adds a single backend governance function (is_shift_operation_allowed)
--      that mirrors the frontend helper isShiftOperationAllowed().
--   4. Adds an open_shift() RPC that validates the opening window server-side.
--   5. Upgrades close_shift() to read the close time from app_config, validate
--      it against Africa/Cairo time, and support an admin force_close bypass.
--
-- All time calculations use the 'Africa/Cairo' timezone so DST is handled
-- automatically (no hard-coded UTC offset).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Settings table (single source of truth)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the shift window settings (idempotent: keep existing values on re-run).
INSERT INTO public.app_config (key, value, description) VALUES
  ('shift_open_time',  '06:00', 'وقت بدء اليوم التشغيلي (HH:MM, Africa/Cairo)'),
  ('shift_close_time', '04:00', 'وقت انتهاء اليوم التشغيلي (HH:MM, Africa/Cairo) - قد يمتد بعد منتصف الليل')
ON CONFLICT (key) DO NOTHING;

-- RLS: allow reads and writes through the anon key used by the app.
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_config_select ON public.app_config;
CREATE POLICY app_config_select ON public.app_config FOR SELECT USING (true);

DROP POLICY IF EXISTS app_config_insert ON public.app_config;
CREATE POLICY app_config_insert ON public.app_config FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS app_config_update ON public.app_config;
CREATE POLICY app_config_update ON public.app_config FOR UPDATE USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Helper: parse 'HH:MM' (or 'HH:MM:SS') into minutes-of-day.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._parse_time_minutes(p_time text, p_default integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_h integer;
  v_m integer;
BEGIN
  IF p_time IS NULL OR p_time = '' THEN
    RETURN p_default;
  END IF;
  v_h := COALESCE(NULLIF(split_part(p_time, ':', 1), '')::int, 0);
  v_m := COALESCE(NULLIF(split_part(p_time, ':', 2), '')::int, 0);
  RETURN (v_h * 60) + v_m;
EXCEPTION WHEN others THEN
  RETURN p_default;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Central backend governance function.
--    Returns the same shape as the frontend helper: (allowed, reason, code).
--    operation: 'open' | 'close'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_shift_operation_allowed(
  p_operation   text,
  p_force_close boolean DEFAULT false
)
RETURNS TABLE (allowed boolean, reason text, code text)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_open_txt   text;
  v_close_txt  text;
  v_open_min   integer;
  v_close_min  integer;
  v_cur_min    integer;
  v_now_cairo  timestamp;
  v_overnight  boolean;
  v_in_window  boolean;
  v_too_early  boolean;
BEGIN
  SELECT value INTO v_open_txt  FROM public.app_config WHERE key = 'shift_open_time';
  SELECT value INTO v_close_txt FROM public.app_config WHERE key = 'shift_close_time';

  v_open_min  := public._parse_time_minutes(v_open_txt,  6 * 60);  -- default 06:00
  v_close_min := public._parse_time_minutes(v_close_txt, 4 * 60);  -- default 04:00
  v_open_txt  := COALESCE(v_open_txt,  '06:00');
  v_close_txt := COALESCE(v_close_txt, '04:00');

  v_now_cairo := now() AT TIME ZONE 'Africa/Cairo';
  v_cur_min   := (EXTRACT(HOUR FROM v_now_cairo)::int * 60) + EXTRACT(MINUTE FROM v_now_cairo)::int;

  -- close <= open  =>  the operating window crosses midnight (overnight day)
  v_overnight := v_close_min <= v_open_min;

  IF p_operation = 'open' THEN
    IF v_overnight THEN
      v_in_window := (v_cur_min >= v_open_min) OR (v_cur_min < v_close_min);
    ELSE
      v_in_window := (v_cur_min >= v_open_min) AND (v_cur_min < v_close_min);
    END IF;

    IF v_in_window THEN
      RETURN QUERY SELECT true, 'مسموح بفتح الوردية'::text, 'OPEN_ALLOWED'::text;
    ELSE
      RETURN QUERY SELECT false,
        format('لا يمكن فتح وردية الآن. مواعيد التشغيل من %s إلى %s (بتوقيت القاهرة).', v_open_txt, v_close_txt)::text,
        'OPEN_OUTSIDE_HOURS'::text;
    END IF;
    RETURN;
  END IF;

  IF p_operation = 'close' THEN
    -- Too early to close while still inside the active operational stretch that
    -- precedes the configured close time (i.e. the after-midnight tail for an
    -- overnight day). Mirrors the legacy "before 04:00" rule.
    v_too_early := v_cur_min < v_close_min;

    IF NOT v_too_early THEN
      RETURN QUERY SELECT true, 'مسموح بإغلاق الوردية'::text, 'CLOSE_ALLOWED'::text;
    ELSIF p_force_close THEN
      RETURN QUERY SELECT true, 'إغلاق إجباري (Force Close)'::text, 'CLOSE_FORCED'::text;
    ELSE
      RETURN QUERY SELECT false,
        format('لا يمكن إغلاق الوردية قبل موعد الإغلاق (%s بتوقيت القاهرة).', v_close_txt)::text,
        'CLOSE_TOO_EARLY'::text;
    END IF;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'عملية غير معروفة'::text, 'UNKNOWN_OPERATION'::text;
END;
$$;

-- ----------------------------------------------------------------------------
-- Helper: operational time bounds for a logical shift day (Africa/Cairo).
-- Example: date=2026-06-22, open=06:00, close=04:00 =>
--   start_at = 2026-06-22 06:00 Cairo, end_at = 2026-06-23 04:00 Cairo
-- Used by close_shift (orphan linking) and assign_shift_to_order trigger.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3. open_shift RPC: server-side validation of the opening window + insert.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_shift(
  p_id         uuid,
  p_date       date,
  p_start_time timestamptz DEFAULT now()
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_check  record;
  v_row    public.shifts;
BEGIN
  -- If a shift for this operational day is already open, just return it (resume).
  SELECT * INTO v_row
  FROM public.shifts
  WHERE date = p_date AND status = 'open'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Governance: enforce the opening window from app_config (Africa/Cairo).
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

-- ----------------------------------------------------------------------------
-- 4. close_shift RPC (upgraded): reads close time from app_config, validates
--    against Africa/Cairo time, supports admin force_close bypass.
--    Drop the legacy 2-argument overload first to avoid an ambiguous-function
--    error when the app calls close_shift with the force flag.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.close_shift(uuid, jsonb);

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
  -- 1. Time Validation (SERVER SIDE) driven by app_config + Africa/Cairo.
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

  -- نافذة ربط الطلبات اليتيمة: من بداية الوردية الفعلية (أو بداية اليوم التشغيلي)
  -- حتى أقلّ من (الآن، نهاية اليوم التشغيلي) — لا تُلصق طلبات قديمة بلا shift_id.
  v_assoc_from := GREATEST(v_shift.start_time, v_bounds.start_at);
  v_assoc_to   := LEAST(now(), v_bounds.end_at);

  -- 2. Active Orders Validation (مرتبطة بالوردية أو يتيمة داخل نفس النافذة الزمنية)
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

  -- 3. Orders Association — فقط الطلبات اليتيمة داخل نافذة هذه الوردية
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

-- ----------------------------------------------------------------------------
-- 5. Trigger: assign shift_id on INSERT for orders that missed client-side linking.
--    Uses the same operational bounds as close_shift (Africa/Cairo + app_config).
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 6. Realtime: make sure app_config changes broadcast to every client so that
--    editing the shift window applies immediately without any code change.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END;
$$;
