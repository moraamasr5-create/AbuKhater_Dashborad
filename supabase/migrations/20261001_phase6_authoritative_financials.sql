-- ====================================================================
-- Phase 6: Authoritative Server-Side Financials & Shift Closure Engine
-- Database/SQL is the authoritative Single Source of Truth
-- ====================================================================

-- 1. Helper function to compute authoritative shift financial statistics
CREATE OR REPLACE FUNCTION public.calculate_shift_stats(p_shift_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift           record;
  v_bounds          record;
  v_assoc_from      timestamptz;
  v_assoc_to        timestamptz;
  
  -- Orders aggregations
  v_total_orders    int := 0;
  v_completed_count int := 0;
  v_cancelled_count int := 0;
  v_failed_count    int := 0;
  v_manual_count    int := 0;
  v_online_count    int := 0;
  v_talabat_count   int := 0;
  v_trips_count     int := 0;
  
  v_gross_sales     numeric := 0.0;
  v_cash_total      numeric := 0.0;
  v_electronic_total numeric := 0.0;
  v_other_total     numeric := 0.0;
  v_delivery_fees   numeric := 0.0;
  v_service_fees    numeric := 0.0;
  
  -- Pilots aggregations
  v_pilot_stats     jsonb := '[]'::jsonb;
  v_tot_att_pay     numeric := 0.0;
  v_tot_pilot_fees  numeric := 0.0;
  v_tot_pilot_dues  numeric := 0.0;
  
  -- Reservations aggregations
  v_res_deposits    numeric := 0.0;
  v_res_count       int := 0;
  v_res_confirmed   int := 0;
  v_res_pending     int := 0;
  
  -- Final result
  v_result          jsonb;
BEGIN
  -- 1. Lookup shift
  SELECT id, date, start_time, end_time, status
  INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found: %', p_shift_id USING ERRCODE = 'P0001';
  END IF;

  -- 2. Determine time bounds
  SELECT * INTO v_bounds FROM public._shift_operational_bounds(v_shift.date);
  v_assoc_from := GREATEST(v_shift.start_time, v_bounds.start_at);
  v_assoc_to   := LEAST(COALESCE(v_shift.end_time, now()), v_bounds.end_at);

  -- 3. Orders aggregation from database records
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE o.status IN ('completed', 'delivered')),
    COUNT(*) FILTER (WHERE o.status = 'cancelled'),
    COUNT(*) FILTER (WHERE o.status = 'failed_delivery'),
    COUNT(*) FILTER (WHERE o.source = 'manual' OR (o.source IS NULL AND (o.order_type = 'restaurant' OR o.order_type = 'takeaway' OR o.order_type = 'delivery'))),
    COUNT(*) FILTER (WHERE o.source = 'online'),
    COUNT(*) FILTER (WHERE o.source = 'talabat'),
    COUNT(*) FILTER (WHERE o.order_type = 'trip' OR o.source = 'external'),
    COALESCE(SUM(o.total_amount) FILTER (WHERE o.status IN ('completed', 'delivered')), 0),
    COALESCE(SUM(o.total_amount) FILTER (
      WHERE o.status IN ('completed', 'delivered')
        AND (o.payment_method ILIKE '%cash%' OR o.payment_method = 'كاش' OR o.payment_method = 'نقدي')
        AND o.payment_method NOT ILIKE '%vodafone%'
        AND o.payment_method NOT ILIKE '%v-cash%'
    ), 0),
    COALESCE(SUM(o.total_amount) FILTER (
      WHERE o.status IN ('completed', 'delivered')
        AND (
          o.payment_method ILIKE '%vodafone%'
          OR o.payment_method ILIKE '%v-cash%'
          OR o.payment_method ILIKE '%فودافون%'
          OR o.payment_method ILIKE '%instapay%'
          OR o.payment_method ILIKE '%انستاباي%'
          OR o.payment_method ILIKE '%online%'
          OR o.payment_method ILIKE '%card%'
          OR o.payment_method ILIKE '%wallet%'
          OR o.payment_method ILIKE '%محفظة%'
        )
    ), 0),
    COALESCE(SUM(o.delivery_fee) FILTER (WHERE o.status IN ('completed', 'delivered')), 0),
    COALESCE(SUM(o.service_fee) FILTER (WHERE o.status IN ('completed', 'delivered')), 0)
  INTO
    v_total_orders,
    v_completed_count,
    v_cancelled_count,
    v_failed_count,
    v_manual_count,
    v_online_count,
    v_talabat_count,
    v_trips_count,
    v_gross_sales,
    v_cash_total,
    v_electronic_total,
    v_delivery_fees,
    v_service_fees
  FROM public.orders o
  WHERE (o.shift_id = p_shift_id)
     OR (
       o.shift_id IS NULL
       AND o.created_at >= v_assoc_from
       AND o.created_at <= v_assoc_to
     );

  v_other_total := GREATEST(0, v_gross_sales - v_cash_total - v_electronic_total);

  -- 4. Pilot Performance & Dues from database records
  WITH pilot_orders AS (
    SELECT
      COALESCE(o.delivery_id, (NULLIF(o.pilot_id, '')::bigint)) AS pilot_id,
      COUNT(*) FILTER (WHERE o.status IN ('completed', 'delivered') AND (o.order_type <> 'trip' AND COALESCE(o.source, '') <> 'external')) AS orders_count,
      COUNT(*) FILTER (WHERE o.status IN ('completed', 'delivered') AND (o.order_type = 'trip' OR COALESCE(o.source, '') = 'external')) AS trips_count,
      COUNT(*) FILTER (WHERE o.status IN ('completed', 'delivered') AND (o.source = 'manual' OR (o.source IS NULL AND (o.order_type = 'restaurant' OR o.order_type = 'takeaway' OR o.order_type = 'delivery')))) AS restaurant_orders_count,
      COUNT(*) FILTER (WHERE o.status IN ('completed', 'delivered') AND o.source = 'online') AS online_orders_count,
      COUNT(*) FILTER (WHERE o.status IN ('completed', 'delivered') AND o.source = 'talabat') AS talabat_orders_count,
      COUNT(*) FILTER (WHERE o.status = 'failed_delivery') AS failed_count,
      
      -- Pilot Delivery Fee Shares:
      -- Trips (type=trip or source=external): 100% of delivery fee
      -- Regular delivery orders: 50% of delivery fee
      COALESCE(SUM(
        CASE
          WHEN o.status NOT IN ('completed', 'delivered') THEN 0
          WHEN o.order_type = 'trip' OR COALESCE(o.source, '') = 'external' THEN COALESCE(o.delivery_fee, 0)
          ELSE COALESCE(o.delivery_fee, 0) / 2.0
        END
      ), 0) AS fee_earnings,
      
      COALESCE(SUM(
        CASE
          WHEN o.status IN ('completed', 'delivered') AND (o.order_type = 'trip' OR COALESCE(o.source, '') = 'external') THEN COALESCE(o.delivery_fee, 0)
          ELSE 0
        END
      ), 0) AS trip_earnings,
      
      COALESCE(SUM(
        CASE
          WHEN o.status IN ('completed', 'delivered') AND (o.source = 'manual' OR (o.source IS NULL AND (o.order_type = 'restaurant' OR o.order_type = 'takeaway' OR o.order_type = 'delivery'))) THEN COALESCE(o.delivery_fee, 0) / 2.0
          ELSE 0
        END
      ), 0) AS restaurant_earnings,
      
      COALESCE(SUM(
        CASE
          WHEN o.status IN ('completed', 'delivered') AND o.source = 'online' THEN COALESCE(o.delivery_fee, 0) / 2.0
          ELSE 0
        END
      ), 0) AS online_earnings,
      
      COALESCE(SUM(
        CASE
          WHEN o.status IN ('completed', 'delivered') AND o.source = 'talabat' THEN COALESCE(o.delivery_fee, 0) / 2.0
          ELSE 0
        END
      ), 0) AS talabat_earnings
    FROM public.orders o
    WHERE (o.shift_id = p_shift_id OR (o.shift_id IS NULL AND o.created_at >= v_assoc_from AND o.created_at <= v_assoc_to))
      AND (o.delivery_id IS NOT NULL OR (o.pilot_id IS NOT NULL AND o.pilot_id <> ''))
    GROUP BY COALESCE(o.delivery_id, (NULLIF(o.pilot_id, '')::bigint))
  ),
  pilot_logs AS (
    SELECT
      dsl.delivery_id,
      COALESCE(SUM(dsl.total_minutes), 0) AS log_minutes
    FROM public.delivery_shift_logs dsl
    WHERE dsl.shift_id = p_shift_id
       OR (dsl.shift_started_at >= v_assoc_from AND dsl.shift_started_at <= v_assoc_to)
    GROUP BY dsl.delivery_id
  ),
  pilot_calc AS (
    SELECT
      d.id,
      d.name,
      d.phone,
      COALESCE(po.orders_count, 0) AS orders_count,
      COALESCE(po.trips_count, 0) AS trips_count,
      COALESCE(po.restaurant_orders_count, 0) AS restaurant_orders_count,
      COALESCE(po.online_orders_count, 0) AS online_orders_count,
      COALESCE(po.talabat_orders_count, 0) AS talabat_orders_count,
      COALESCE(po.failed_count, 0) AS failed_count,
      LEAST(
        CASE
          WHEN pl.log_minutes IS NOT NULL THEN pl.log_minutes
          WHEN d.shift_started_at >= v_assoc_from AND d.shift_started_at <= v_assoc_to THEN COALESCE(d.total_minutes, 0)
          ELSE 0
        END,
        600
      ) AS total_minutes,
      COALESCE(po.fee_earnings, 0) AS fee_earnings,
      COALESCE(po.trip_earnings, 0) AS trip_earnings,
      COALESCE(po.restaurant_earnings, 0) AS restaurant_earnings,
      COALESCE(po.online_earnings, 0) AS online_earnings,
      COALESCE(po.talabat_earnings, 0) AS talabat_earnings,
      -- Attendance pay: 15 EGP per 35 minutes capped at 600 mins (10 hrs)
      FLOOR(
        LEAST(
          CASE
            WHEN pl.log_minutes IS NOT NULL THEN pl.log_minutes
            WHEN d.shift_started_at >= v_assoc_from AND d.shift_started_at <= v_assoc_to THEN COALESCE(d.total_minutes, 0)
            ELSE 0
          END,
          600
        ) / 35.0
      ) * 15.0 AS attendance_pay,
      (
        COALESCE(po.fee_earnings, 0) + 
        (
          FLOOR(
            LEAST(
              CASE
                WHEN pl.log_minutes IS NOT NULL THEN pl.log_minutes
                WHEN d.shift_started_at >= v_assoc_from AND d.shift_started_at <= v_assoc_to THEN COALESCE(d.total_minutes, 0)
                ELSE 0
              END,
              600
            ) / 35.0
          ) * 15.0
        )
      ) AS total_earnings
    FROM public.delivery d
    LEFT JOIN pilot_orders po ON d.id = po.pilot_id
    LEFT JOIN pilot_logs pl ON d.id = pl.delivery_id
    WHERE po.pilot_id IS NOT NULL 
       OR pl.delivery_id IS NOT NULL 
       OR (d.shift_used = true AND d.shift_started_at >= v_assoc_from AND d.shift_started_at <= v_assoc_to)
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', pc.id,
        'name', pc.name,
        'phone', pc.phone,
        'ordersCount', pc.orders_count,
        'tripsCount', pc.trips_count,
        'restaurantOrdersCount', pc.restaurant_orders_count,
        'onlineOrdersCount', pc.online_orders_count,
        'talabatOrdersCount', pc.talabat_orders_count,
        'failedCount', pc.failed_count,
        'totalMinutes', pc.total_minutes,
        'feeEarnings', pc.fee_earnings,
        'tripEarnings', pc.trip_earnings,
        'restaurantEarnings', pc.restaurant_earnings,
        'onlineEarnings', pc.online_earnings,
        'talabatEarnings', pc.talabat_earnings,
        'attendancePay', pc.attendance_pay,
        'totalEarnings', pc.total_earnings
      )
    ), '[]'::jsonb),
    COALESCE(SUM(pc.attendance_pay), 0),
    COALESCE(SUM(pc.fee_earnings), 0),
    COALESCE(SUM(pc.total_earnings), 0)
  INTO
    v_pilot_stats,
    v_tot_att_pay,
    v_tot_pilot_fees,
    v_tot_pilot_dues
  FROM pilot_calc pc;

  -- 5. Reservations aggregation for this shift date
  SELECT
    COALESCE(SUM(deposit_amount) FILTER (WHERE status = 'confirmed'), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'confirmed'),
    COUNT(*) FILTER (WHERE status = 'pending')
  INTO
    v_res_deposits,
    v_res_count,
    v_res_confirmed,
    v_res_pending
  FROM public.reservations
  WHERE reservation_date = v_shift.date
     OR (created_at >= v_assoc_from AND created_at <= v_assoc_to);

  -- 6. Construct authoritative JSON response
  v_result := jsonb_build_object(
    'shiftId', v_shift.id,
    'date', v_shift.date,
    'startTime', v_shift.start_time,
    'endTime', v_assoc_to,
    'ordersCount', (v_completed_count + v_failed_count),
    'completedOrders', v_completed_count,
    'failedOrders', v_failed_count,
    'cancelledOrders', v_cancelled_count,
    'totalDeliveryFees', v_tot_pilot_fees,
    'totalAttendancePay', v_tot_att_pay,
    'totalPilotDues', v_tot_pilot_dues,
    'pilotStats', v_pilot_stats,
    'pilotPerformance', v_pilot_stats,
    'financials', jsonb_build_object(
      'grossSales', v_gross_sales,
      'cashTotal', v_cash_total,
      'electronicTotal', v_electronic_total,
      'otherPaymentTotal', v_other_total,
      'deliveryFeesCollected', v_delivery_fees,
      'serviceFeesCollected', v_service_fees,
      'reservationDeposits', v_res_deposits,
      'pilotDues', v_tot_pilot_dues,
      'netCashInDrawer', (v_cash_total + v_res_deposits) - v_tot_pilot_dues
    ),
    'sourceBreakdown', jsonb_build_object(
      'manual', jsonb_build_object('count', v_manual_count),
      'online', jsonb_build_object('count', v_online_count),
      'talabat', jsonb_build_object('count', v_talabat_count),
      'trips', jsonb_build_object('count', v_trips_count)
    ),
    'reservationStats', jsonb_build_object(
      'totalDeposits', v_res_deposits,
      'count', v_res_count,
      'confirmedCount', v_res_confirmed,
      'pendingCount', v_res_pending
    )
  );

  RETURN v_result;
END;
$$;

-- 2. Drop legacy close_shift variants and create Authoritative close_shift RPC
DROP FUNCTION IF EXISTS public.close_shift(uuid, jsonb);
DROP FUNCTION IF EXISTS public.close_shift(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.close_shift(text, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.close_shift(
  p_shift_id     text,
  p_stats        jsonb DEFAULT NULL,
  p_force_close  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role         text;
  v_check               record;
  v_shift               record;
  v_bounds              record;
  v_assoc_from          timestamptz;
  v_assoc_to            timestamptz;
  v_authoritative_stats jsonb;
  v_active_statuses     text[] := ARRAY[
    'active', 'pending', 'waiting_driver', 'confirmed',
    'في التحضير', 'تم الإسناد للطيار', 'في الطريق للتسليم',
    'out_for_delivery', 'driver_assigned', 'pending_timer'
  ];
BEGIN
  -- 1. Security Check: Require admin or casher role
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher']);

  -- Force close is strictly restricted to Admins
  IF p_force_close AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Only Administrators can force close a shift.' USING ERRCODE = '42501';
  END IF;

  -- 2. Operational Window Check (Africa/Cairo)
  SELECT * INTO v_check FROM public.is_shift_operation_allowed('close', p_force_close);
  IF NOT v_check.allowed THEN
    RAISE EXCEPTION '%', v_check.reason USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lookup Shift Record
  SELECT id, date, start_time, end_time, status, stats
  INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found: %', p_shift_id USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency check: If shift is already closed, return existing stats
  IF v_shift.status = 'closed' THEN
    RETURN COALESCE(v_shift.stats, jsonb_build_object('status', 'already_closed', 'shiftId', p_shift_id));
  END IF;

  SELECT * INTO v_bounds FROM public._shift_operational_bounds(v_shift.date);
  v_assoc_from := GREATEST(v_shift.start_time, v_bounds.start_at);
  v_assoc_to   := LEAST(now(), v_bounds.end_at);

  -- 4. Active Orders Validation
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

  -- 5. Open Pilot Shifts Validation (Unless force_close is true)
  IF NOT p_force_close THEN
    IF EXISTS (
      SELECT 1 FROM public.delivery d
      WHERE (d.shift_started_at IS NOT NULL AND d.shift_ended_at IS NULL)
         OR d.state = 'busy'
    ) THEN
      RAISE EXCEPTION '⚠️ لا يمكن إغلاق الوردية! يوجد طيارين لم يغلقوا شفتاتهم بعد.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 6. Associate unassigned orders in the operational window to this shift
  UPDATE public.orders
  SET shift_id = p_shift_id
  WHERE shift_id IS NULL
    AND created_at >= v_assoc_from
    AND created_at <= v_assoc_to;

  -- 7. Authoritative Server-Side Calculation (Ignoring client untrusted calculations)
  v_authoritative_stats := public.calculate_shift_stats(p_shift_id);

  -- 8. Atomic Shift Closure with Authoritative Statistics
  UPDATE public.shifts
  SET
    status = 'closed',
    end_time = now(),
    total_orders = COALESCE((v_authoritative_stats->>'ordersCount')::int, 0),
    stats = v_authoritative_stats
  WHERE id = p_shift_id;

  -- 9. Automatically Close any open delivery shift logs
  BEGIN
    UPDATE public.delivery_shift_logs
    SET status = 'closed',
        shift_ended_at = now()
    WHERE shift_id = p_shift_id AND shift_ended_at IS NULL;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  -- 10. Reset Pilots delivery state atomically
  UPDATE public.delivery
  SET
    state = 'available',
    shift_ended_at = COALESCE(shift_ended_at, now()),
    shift_used = false
  WHERE shift_started_at IS NOT NULL AND shift_ended_at IS NULL;

  RETURN v_authoritative_stats;
END;
$$;

-- 3. Grants & Security
REVOKE EXECUTE ON FUNCTION public.calculate_shift_stats(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.calculate_shift_stats(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.close_shift(text, jsonb, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.close_shift(text, jsonb, boolean) TO authenticated;
