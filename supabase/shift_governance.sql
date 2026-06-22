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
  v_check record;
BEGIN
  -- 1. Time Validation (SERVER SIDE) driven by app_config + Africa/Cairo.
  SELECT * INTO v_check FROM public.is_shift_operation_allowed('close', p_force_close);
  IF NOT v_check.allowed THEN
    RAISE EXCEPTION '%', v_check.reason USING ERRCODE = 'P0001';
  END IF;

  -- 2. Active Orders Validation
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE shift_id = p_shift_id
      AND status IN (
        'active', 'pending', 'waiting_driver', 'confirmed',
        'في التحضير', 'تم الإسناد للطيار', 'في الطريق للتسليم',
        'out_for_delivery', 'driver_assigned', 'pending_timer'
      )
  ) THEN
    RAISE EXCEPTION 'Active orders exist' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Orders Association
  UPDATE public.orders
  SET shift_id = p_shift_id
  WHERE shift_id IS NULL;

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
-- 5. Realtime: make sure app_config changes broadcast to every client so that
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
