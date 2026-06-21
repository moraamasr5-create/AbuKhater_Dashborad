-- SQL Migration script to create/update the close_shift function and RLS policies

-- Create or replace the close_shift RPC function
CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id uuid,
  p_stats jsonb DEFAULT NULL,
  p_force_close boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamp with time zone;
  v_current_time time;
  v_close_time time;
  v_open_time time;
  v_close_str text;
  v_open_str text;
BEGIN
  -- 1. Get configurations from app_config table
  SELECT (value->>0) INTO v_close_str FROM public.app_config WHERE key = 'shift_close_time';
  IF v_close_str IS NULL THEN
    v_close_str := '04:00';
  END IF;
  v_close_time := CAST(v_close_str AS time);

  SELECT (value->>0) INTO v_open_str FROM public.app_config WHERE key = 'shift_open_time';
  IF v_open_str IS NULL THEN
    v_open_str := '06:00';
  END IF;
  v_open_time := CAST(v_open_str AS time);

  -- 2. Time Validation (Cairo timezone)
  v_now := now() AT TIME ZONE 'Africa/Cairo';
  v_current_time := CAST(v_now AS time);

  -- If not forced, validate time
  IF NOT p_force_close THEN
    -- Check if current time is inside the closed window [v_close_time, v_open_time)
    IF v_close_time < v_open_time THEN
      IF NOT (v_current_time >= v_close_time AND v_current_time < v_open_time) THEN
        RAISE EXCEPTION 'Too early to close shift';
      END IF;
    ELSE
      IF NOT (v_current_time >= v_close_time OR v_current_time < v_open_time) THEN
        RAISE EXCEPTION 'Too early to close shift';
      END IF;
    END IF;
  END IF;

  -- 3. Active Orders Validation
  -- Prevent closing if there are any active orders for this shift
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE shift_id = p_shift_id
      AND status IN (
        'active', 'pending', 'waiting_driver', 'confirmed',
        'في التحضير', 'تم الإسناد للطيار', 'في الطريق للتسليم',
        'out_for_delivery', 'driver_assigned', 'pending_timer'
      )
  ) THEN
    RAISE EXCEPTION 'Active orders exist';
  END IF;

  -- 4. Orders Association
  -- Link any unassociated orders (where shift_id IS NULL) to this shift
  UPDATE public.orders
  SET shift_id = p_shift_id
  WHERE shift_id IS NULL;

  -- 5. Shift Closing Logic
  -- Update shifts status to closed and record end_time
  UPDATE public.shifts
  SET 
    status = 'closed',
    end_time = now(),
    stats = COALESCE(p_stats, stats)
  WHERE id = p_shift_id;

  -- 6. Delivery Logs (Safe Update)
  -- Close any open logs in delivery_shift_logs if the table exists
  BEGIN
    EXECUTE 'UPDATE public.delivery_shift_logs 
             SET status = ''closed'', 
                 end_time = now() 
             WHERE shift_id = $1 AND status = ''open'''
    USING p_shift_id;
  EXCEPTION WHEN undefined_table THEN
    -- Ignore error if table does not exist
    NULL;
  END;

END;
$$;

-- 7. RLS Security Model on shifts table
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Allow SELECT for all users
DROP POLICY IF EXISTS shifts_select ON public.shifts;
CREATE POLICY shifts_select ON public.shifts 
  FOR SELECT 
  USING (true);

-- Allow INSERT for all users (to open a shift)
DROP POLICY IF EXISTS shifts_insert ON public.shifts;
CREATE POLICY shifts_insert ON public.shifts 
  FOR INSERT 
  WITH CHECK (true);

-- Deny UPDATE for all users (direct modification prevented, must use close_shift RPC)
DROP POLICY IF EXISTS shifts_update ON public.shifts;
CREATE POLICY shifts_update ON public.shifts 
  FOR UPDATE 
  USING (false);
