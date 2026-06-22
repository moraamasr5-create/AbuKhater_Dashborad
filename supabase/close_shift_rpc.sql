-- ⚠️ SUPERSEDED: This original close_shift definition is replaced by
-- `supabase/shift_governance.sql`, which reads the close time from the
-- app_config table (Africa/Cairo) and adds the p_force_close parameter.
-- Apply shift_governance.sql instead. This file is kept for historical context.

-- SQL Migration script to create the close_shift function and RLS policies

-- Create or replace the close_shift RPC function
CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id uuid,
  p_stats jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hour integer;
BEGIN
  -- 1. Time Validation (SERVER SIDE ONLY)
  -- Egypt/Cairo timezone is UTC+3 in summer. Checking if the hour is before 04:00 AM Cairo Time.
  v_hour := EXTRACT(HOUR FROM (now() AT TIME ZONE 'UTC' + INTERVAL '3 hours'));
  
  IF v_hour >= 0 AND v_hour < 4 THEN
    RAISE EXCEPTION 'Too early to close shift';
  END IF;

  -- 2. Active Orders Validation
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

  -- 3. Orders Association
  -- Link any unassociated orders (where shift_id IS NULL) to this shift
  UPDATE public.orders
  SET shift_id = p_shift_id
  WHERE shift_id IS NULL;

  -- 4. Shift Closing Logic
  -- Update shifts status to closed and record end_time
  UPDATE public.shifts
  SET 
    status = 'closed',
    end_time = now(),
    stats = COALESCE(p_stats, stats)
  WHERE id = p_shift_id;

  -- 5. Delivery Logs (Safe Update)
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

-- 6. RLS Security Model on shifts table
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
