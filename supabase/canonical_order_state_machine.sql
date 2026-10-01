-- ============================================================================
-- Phase 4 Migration: Canonical Order State Machine & Lifecycle Governance
-- Project: AbuKhater Restaurant Control Center & Menu App (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Purpose:
--   1. Create single canonical order status model (`order_status` & `payment_status`).
--   2. Separate cancellation/failure reasons into `cancellation_reason` column.
--   3. Migrate existing database rows with embedded reasons to clean canonical state.
--   4. Build authoritative transition state machine (`transition_order_status`, `cancel_order`, `verify_order_payment`).
--   5. Enforce strict role-based actor transition permissions (Admin, Cashier, Driver).
--   6. Public customer order tracking RPC (`get_customer_order_tracking`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Enhancements on public.orders
-- ----------------------------------------------------------------------------

-- Add cancellation_reason column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancellation_reason'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN cancellation_reason text DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN payment_status text DEFAULT 'cash_on_delivery';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'status_history'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN status_history jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_verified_at'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN payment_verified_at timestamptz DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_verified_by'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN payment_verified_by text DEFAULT NULL;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Data Migration: Clean up legacy status strings & extract reasons
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_rec RECORD;
  v_clean_status text;
  v_extracted_reason text;
BEGIN
  FOR v_rec IN SELECT id, status, payment_method, payment_screenshot FROM public.orders
  LOOP
    v_clean_status := trim(COALESCE(v_rec.status, 'pending'));
    v_extracted_reason := NULL;

    -- Extract reason from "ملغي (...)"
    IF v_clean_status ~* '^ملغي\s*\((.+)\)$' THEN
      v_extracted_reason := trim(substring(v_clean_status from '^ملغي\s*\((.+)\)$'));
      v_clean_status := 'cancelled';
    ELSIF v_clean_status = 'ملغي' THEN
      v_clean_status := 'cancelled';
    -- Extract reason from "فشل التوصيل (...)"
    ELSIF v_clean_status ~* '^فشل التوصيل\s*\((.+)\)$' THEN
      v_extracted_reason := trim(substring(v_clean_status from '^فشل التوصيل\s*\((.+)\)$'));
      v_clean_status := 'failed_delivery';
    ELSIF v_clean_status = 'فشل التوصيل' THEN
      v_clean_status := 'failed_delivery';
    ELSIF v_clean_status IN ('تم التوصيل', 'completed', 'delivered') THEN
      v_clean_status := 'delivered';
    ELSIF v_clean_status IN ('في التحضير', 'confirmed', 'waiting_driver') THEN
      v_clean_status := 'preparing';
    ELSIF v_clean_status IN ('تم الإسناد للطيار', 'driver_assigned') THEN
      v_clean_status := 'driver_assigned';
    ELSIF v_clean_status IN ('في الطريق للتسليم', 'out_for_delivery', 'active') THEN
      v_clean_status := 'out_for_delivery';
    ELSIF v_clean_status IN ('pending', 'pending_timer') THEN
      v_clean_status := 'pending';
    END IF;

    -- Compute initial payment_status
    UPDATE public.orders
    SET
      status = v_clean_status,
      cancellation_reason = COALESCE(cancellation_reason, v_extracted_reason),
      payment_status = CASE
        WHEN lower(COALESCE(payment_method, '')) IN ('cash', 'نقدي', 'كاش', 'عند الاستلام') THEN 'cash_on_delivery'
        WHEN payment_screenshot IS NOT NULL AND payment_screenshot <> '' THEN 'pending_verification'
        ELSE 'pending_payment'
      END
    WHERE id = v_rec.id;
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Canonical Status Normalization & Validation Functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._canonical_order_status(p_status text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw text := trim(COALESCE(p_status, 'pending'));
BEGIN
  IF v_raw IN ('pending', 'pending_timer', 'جديد') THEN
    RETURN 'pending';
  ELSIF v_raw IN ('preparing', 'confirmed', 'waiting_driver', 'في التحضير', 'مؤكد') THEN
    RETURN 'preparing';
  ELSIF v_raw IN ('ready', 'جاهز', 'جاهز للتسليم') THEN
    RETURN 'ready';
  ELSIF v_raw IN ('driver_assigned', 'تم الإسناد للطيار', 'مسند') THEN
    RETURN 'driver_assigned';
  ELSIF v_raw IN ('out_for_delivery', 'active', 'في الطريق للتسليم', 'في الطريق') THEN
    RETURN 'out_for_delivery';
  ELSIF v_raw IN ('delivered', 'completed', 'تم التوصيل', 'مكتمل') THEN
    RETURN 'delivered';
  ELSIF v_raw ~* '^فشل التوصيل' OR v_raw IN ('failed_delivery', 'فشل') THEN
    RETURN 'failed_delivery';
  ELSIF v_raw ~* '^ملغي' OR v_raw IN ('cancelled', 'canceled') THEN
    RETURN 'cancelled';
  ELSE
    RETURN 'pending';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._canonical_payment_status(p_status text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw text := lower(trim(COALESCE(p_status, 'cash_on_delivery')));
BEGIN
  IF v_raw IN ('cash_on_delivery', 'cash', 'نقدي', 'كاش') THEN
    RETURN 'cash_on_delivery';
  ELSIF v_raw IN ('pending_payment', 'unpaid', 'غير مدفوع') THEN
    RETURN 'pending_payment';
  ELSIF v_raw IN ('pending_verification', 'قيد المراجعة', 'بانتظار التأكيد') THEN
    RETURN 'pending_verification';
  ELSIF v_raw IN ('verified', 'paid', 'مؤكد', 'تم التحقق') THEN
    RETURN 'verified';
  ELSIF v_raw IN ('rejected', 'مرفوض') THEN
    RETURN 'rejected';
  ELSIF v_raw IN ('refunded', 'مسترجع') THEN
    RETURN 'refunded';
  ELSE
    RETURN 'cash_on_delivery';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Authoritative Order State Machine: transition_order_status
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.transition_order_status(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id          uuid,
  p_target_status     text,
  p_reason            text DEFAULT NULL,
  p_mutation_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role       text;
  v_caller_uid        uuid;
  v_cached            jsonb;
  v_order             public.orders%ROWTYPE;
  v_current_status    text;
  v_next_status       text;
  v_clean_reason      text;
  v_history_entry     jsonb;
  v_result            jsonb;
BEGIN
  -- 1. Verify Caller Authentication & Role
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher', 'driver']);
  v_caller_uid  := auth.uid();

  -- 2. Idempotency Check
  IF p_mutation_id IS NOT NULL THEN
    v_cached := public._claim_mutation(p_mutation_id, 'transition_order_status', 'order', p_order_id::text);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  -- 3. Lock and Fetch Order
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود (ID: %)' , p_order_id USING ERRCODE = 'P0001';
  END IF;

  v_current_status := public._canonical_order_status(v_order.status);
  v_next_status    := public._canonical_order_status(p_target_status);
  v_clean_reason   := trim(COALESCE(p_reason, ''));

  -- If already in target status, return success
  IF v_current_status = v_next_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', p_order_id,
      'status', v_next_status,
      'previous_status', v_current_status,
      'unchanged', true
    );
  END IF;

  -- 4. State Transition Authorization & Rules
  -- Terminal states cannot transition to anything
  IF v_current_status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل حالة طلب مكتمل أو ملغي (الحالة الحالية: %).' , v_current_status
      USING ERRCODE = '42501';
  END IF;

  -- Role-specific transition rules
  IF v_caller_role = 'driver' THEN
    -- Driver can only move between: driver_assigned -> out_for_delivery -> delivered / failed_delivery
    IF v_current_status = 'driver_assigned' AND v_next_status = 'out_for_delivery' THEN
      -- Allowed
      NULL;
    ELSIF v_current_status = 'out_for_delivery' AND v_next_status IN ('delivered', 'failed_delivery') THEN
      -- Allowed
      NULL;
    ELSE
      RAISE EXCEPTION 'غير مصرح للطيار بتنفيذ هذا الانتقال من % إلى %.' , v_current_status, v_next_status
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Cashier / Admin transitions
    IF v_current_status = 'pending' AND v_next_status IN ('preparing', 'cancelled') THEN
      -- Allowed
      NULL;
    ELSIF v_current_status = 'preparing' AND v_next_status IN ('ready', 'driver_assigned', 'delivered', 'cancelled') THEN
      -- Allowed (delivered allowed for pickup/dine-in orders)
      NULL;
    ELSIF v_current_status = 'ready' AND v_next_status IN ('driver_assigned', 'delivered', 'cancelled') THEN
      -- Allowed
      NULL;
    ELSIF v_current_status = 'driver_assigned' AND v_next_status IN ('preparing', 'ready', 'out_for_delivery', 'cancelled') THEN
      -- Allowed
      NULL;
    ELSIF v_current_status = 'out_for_delivery' AND v_next_status IN ('delivered', 'failed_delivery', 'driver_assigned') THEN
      -- Allowed
      NULL;
    ELSIF v_current_status = 'failed_delivery' AND v_next_status IN ('preparing', 'ready', 'cancelled') THEN
      -- Allowed (retry or cancel)
      NULL;
    ELSE
      RAISE EXCEPTION 'انتقال غير صالح لحالة الطلب من % إلى %.' , v_current_status, v_next_status
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Cancellation or Failure requires reason
  IF v_next_status IN ('cancelled', 'failed_delivery') AND v_clean_reason = '' THEN
    RAISE EXCEPTION 'يجب تحديد سبب الإلغاء أو فشل التوصيل.' USING ERRCODE = '22023';
  END IF;

  -- 5. Construct History Entry
  v_history_entry := jsonb_build_object(
    'from_status', v_current_status,
    'to_status', v_next_status,
    'changed_at', now(),
    'changed_by_role', v_caller_role,
    'changed_by_user_id', v_caller_uid,
    'reason', CASE WHEN v_clean_reason <> '' THEN v_clean_reason ELSE NULL END
  );

  -- 6. Apply Status Update
  UPDATE public.orders
  SET
    status = v_next_status,
    cancellation_reason = CASE
      WHEN v_next_status IN ('cancelled', 'failed_delivery') THEN v_clean_reason
      ELSE cancellation_reason
    END,
    status_history = COALESCE(status_history, '[]'::jsonb) || jsonb_build_array(v_history_entry)
  WHERE id = p_order_id;

  -- 7. Build Response
  v_result := jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'previous_status', v_current_status,
    'status', v_next_status,
    'reason', v_clean_reason,
    'updated_at', now()
  );

  -- 8. Finalize Idempotency
  IF p_mutation_id IS NOT NULL THEN
    PERFORM public._finish_mutation(p_mutation_id, 'transition_order_status', 'order', p_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Helper RPCs for Standard Lifecycle Transitions
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.cancel_order(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id      uuid,
  p_reason        text,
  p_mutation_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.transition_order_status(p_order_id, 'cancelled', p_reason, p_mutation_id);
END;
$$;

-- Payment Verification RPC
DROP FUNCTION IF EXISTS public.verify_order_payment(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.verify_order_payment(
  p_order_id          uuid,
  p_payment_status    text,
  p_notes             text DEFAULT NULL,
  p_mutation_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role       text;
  v_caller_uid        uuid;
  v_canonical_pstatus text;
  v_order             public.orders%ROWTYPE;
  v_cached            jsonb;
  v_result            jsonb;
BEGIN
  -- 1. Verify Staff Role (Admin or Casher only)
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher']);
  v_caller_uid  := auth.uid();

  -- 2. Idempotency Check
  IF p_mutation_id IS NOT NULL THEN
    v_cached := public._claim_mutation(p_mutation_id, 'verify_order_payment', 'order', p_order_id::text);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  -- 3. Validate Target Status
  v_canonical_pstatus := public._canonical_payment_status(p_payment_status);
  IF v_canonical_pstatus NOT IN ('verified', 'rejected', 'refunded') THEN
    RAISE EXCEPTION 'حالة الدفع غير صالحة للتحقق (يجب أن تكون verified أو rejected أو refunded).'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Lock & Update
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
  SET
    payment_status = v_canonical_pstatus,
    payment_verified_at = CASE WHEN v_canonical_pstatus = 'verified' THEN now() ELSE payment_verified_at END,
    payment_verified_by = v_caller_uid::text,
    paid_now = CASE WHEN v_canonical_pstatus = 'verified' THEN total_amount ELSE paid_now END,
    remaining_amount = CASE WHEN v_canonical_pstatus = 'verified' THEN 0.0 ELSE remaining_amount END
  WHERE id = p_order_id;

  v_result := jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'payment_status', v_canonical_pstatus,
    'verified_at', now(),
    'verified_by', v_caller_uid
  );

  IF p_mutation_id IS NOT NULL THEN
    PERFORM public._finish_mutation(p_mutation_id, 'verify_order_payment', 'order', p_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Updated Pilot Trip RPCs using Canonical Statuses
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.start_pilot_trip(uuid, uuid);

CREATE OR REPLACE FUNCTION public.start_pilot_trip(
  p_order_id      uuid,
  p_mutation_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role   text;
  v_order         public.orders%ROWTYPE;
  v_pilot_id      bigint;
  v_cached        jsonb;
  v_result        jsonb;
BEGIN
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  IF p_mutation_id IS NOT NULL THEN
    v_cached := public._claim_mutation(p_mutation_id, 'start_pilot_trip', 'order', p_order_id::text);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.' USING ERRCODE = 'P0001';
  END IF;

  v_pilot_id := v_order.delivery_id;
  IF v_pilot_id IS NULL THEN
    RAISE EXCEPTION 'الطلب غير مسند لأي طيار.' USING ERRCODE = 'P0001';
  END IF;

  -- Transition order to out_for_delivery
  UPDATE public.orders
  SET status = 'out_for_delivery'
  WHERE id = p_order_id;

  -- Pilot state becomes on_delivery
  UPDATE public.delivery
  SET state = 'out'
  WHERE id = v_pilot_id;

  v_result := jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', 'out_for_delivery',
    'pilot_id', v_pilot_id
  );

  IF p_mutation_id IS NOT NULL THEN
    PERFORM public._finish_mutation(p_mutation_id, 'start_pilot_trip', 'order', p_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.complete_order_delivery(uuid, uuid);

CREATE OR REPLACE FUNCTION public.complete_order_delivery(
  p_order_id      uuid,
  p_mutation_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role   text;
  v_order         public.orders%ROWTYPE;
  v_pilot_id      bigint;
  v_other_active  int;
  v_now           timestamptz := now();
  v_cached        jsonb;
  v_result        jsonb;
BEGIN
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  IF p_mutation_id IS NOT NULL THEN
    v_cached := public._claim_mutation(p_mutation_id, 'complete_order_delivery', 'order', p_order_id::text);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.' USING ERRCODE = 'P0001';
  END IF;

  v_pilot_id := v_order.delivery_id;

  -- Mark order delivered and verify payment if COD
  UPDATE public.orders
  SET
    status = 'delivered',
    payment_status = CASE
      WHEN payment_status = 'cash_on_delivery' THEN 'verified'
      ELSE payment_status
    END,
    paid_now = total_amount,
    remaining_amount = 0.0
  WHERE id = p_order_id;

  -- If pilot has no more active orders, set pilot to available & update return time
  IF v_pilot_id IS NOT NULL THEN
    SELECT count(*) INTO v_other_active
    FROM public.orders
    WHERE delivery_id = v_pilot_id
      AND id <> p_order_id
      AND status IN ('driver_assigned', 'out_for_delivery');

    IF v_other_active = 0 THEN
      UPDATE public.delivery
      SET
        state = 'available',
        last_return_time = v_now,
        orders_count = COALESCE(orders_count, 0) + 1
      WHERE id = v_pilot_id;
    ELSE
      UPDATE public.delivery
      SET orders_count = COALESCE(orders_count, 0) + 1
      WHERE id = v_pilot_id;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', 'delivered',
    'delivered_at', v_now
  );

  IF p_mutation_id IS NOT NULL THEN
    PERFORM public._finish_mutation(p_mutation_id, 'complete_order_delivery', 'order', p_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.fail_order_delivery(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.fail_order_delivery(uuid, uuid);

CREATE OR REPLACE FUNCTION public.fail_order_delivery(
  p_order_id      uuid,
  p_reason        text DEFAULT 'فشل التسليم',
  p_mutation_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role   text;
  v_order         public.orders%ROWTYPE;
  v_pilot_id      bigint;
  v_other_active  int;
  v_clean_reason  text := trim(COALESCE(p_reason, 'فشل التسليم'));
  v_now           timestamptz := now();
  v_cached        jsonb;
  v_result        jsonb;
BEGIN
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  IF p_mutation_id IS NOT NULL THEN
    v_cached := public._claim_mutation(p_mutation_id, 'fail_order_delivery', 'order', p_order_id::text);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.' USING ERRCODE = 'P0001';
  END IF;

  v_pilot_id := v_order.delivery_id;

  UPDATE public.orders
  SET
    status = 'failed_delivery',
    cancellation_reason = v_clean_reason
  WHERE id = p_order_id;

  IF v_pilot_id IS NOT NULL THEN
    SELECT count(*) INTO v_other_active
    FROM public.orders
    WHERE delivery_id = v_pilot_id
      AND id <> p_order_id
      AND status IN ('driver_assigned', 'out_for_delivery');

    IF v_other_active = 0 THEN
      UPDATE public.delivery
      SET
        state = 'available',
        last_return_time = v_now
      WHERE id = v_pilot_id;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', 'failed_delivery',
    'reason', v_clean_reason
  );

  IF p_mutation_id IS NOT NULL THEN
    PERFORM public._finish_mutation(p_mutation_id, 'fail_order_delivery', 'order', p_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Public Customer Order Tracking RPC
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_customer_order_tracking(uuid, text, text);

CREATE OR REPLACE FUNCTION public.get_customer_order_tracking(
  p_order_id          uuid DEFAULT NULL,
  p_order_number      text DEFAULT NULL,
  p_customer_phone    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order             public.orders%ROWTYPE;
  v_clean_phone       text;
  v_status_ar         text;
  v_pstatus_ar        text;
  v_items_count       integer;
BEGIN
  IF p_customer_phone IS NOT NULL AND trim(p_customer_phone) <> '' THEN
    v_clean_phone := regexp_replace(trim(p_customer_phone), '[^0-9]', '', 'g');
  END IF;

  -- Lookup order
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id LIMIT 1;
  ELSIF p_order_number IS NOT NULL AND trim(p_order_number) <> '' THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE (original_id = trim(p_order_number) OR order_number::text = trim(p_order_number))
      AND (v_clean_phone IS NULL OR customer_phone = v_clean_phone OR customer_phone ~ v_clean_phone)
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'يجب تحديد معرف الطلب أو رقم البون للاستعلام.' USING ERRCODE = '22023';
  END IF;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'message', 'لم يتم العثور على طلب مطابق للبيانات المدخلة.'
    );
  END IF;

  -- Arabic Status Label Mapping
  v_status_ar := CASE v_order.status
    WHEN 'pending' THEN 'قيد المراجعة والاستلام'
    WHEN 'preparing' THEN 'جاري تحضير الطلب في المطبخ'
    WHEN 'ready' THEN 'الطلب جاهز للتسليم'
    WHEN 'driver_assigned' THEN 'تم إسناد الطلب لمندوب التوصيل'
    WHEN 'out_for_delivery' THEN 'الطلب في الطريق إليك الآن 🚚'
    WHEN 'delivered' THEN 'تم توصيل الطلب بنجاح'
    WHEN 'failed_delivery' THEN 'تعذر توصيل الطلب'
    WHEN 'cancelled' THEN 'تم إلغاء الطلب'
    ELSE 'قيد المعالجة'
  END;

  -- Arabic Payment Status Label Mapping
  v_pstatus_ar := CASE v_order.payment_status
    WHEN 'cash_on_delivery' THEN 'الدفع نقداً عند الاستلام'
    WHEN 'pending_payment' THEN 'بانتظار إتمام الدفع'
    WHEN 'pending_verification' THEN 'جاري مراجعة إيصال التحويل'
    WHEN 'verified' THEN 'تم التحقق من الدفع بنجاح'
    WHEN 'rejected' THEN 'إيصال التحويل غير صالح'
    WHEN 'refunded' THEN 'تم استرجاع المبلغ'
    ELSE 'غير محدد'
  END;

  SELECT count(*) INTO v_items_count FROM public.order_items WHERE order_id = v_order.id;

  RETURN jsonb_build_object(
    'found', true,
    'order_id', v_order.id,
    'order_number', COALESCE(v_order.original_id, '#' || v_order.order_number::text),
    'order_type', v_order.order_type,
    'status', v_order.status,
    'status_label_ar', v_status_ar,
    'payment_status', v_order.payment_status,
    'payment_status_label_ar', v_pstatus_ar,
    'payment_method', v_order.payment_method,
    'total_amount', v_order.total_amount,
    'paid_now', v_order.paid_now,
    'remaining_amount', v_order.remaining_amount,
    'items_count', v_items_count,
    'pilot_name', CASE WHEN v_order.status = 'out_for_delivery' THEN v_order.pilot_name ELSE NULL END,
    'created_at', v_order.created_at,
    'delivery_address', v_order.delivery_address
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Permissions Configuration
-- ----------------------------------------------------------------------------

-- Public Customer Tracking: accessible to anon & authenticated
GRANT EXECUTE ON FUNCTION public.get_customer_order_tracking(uuid, text, text) TO anon, authenticated;

-- Staff Transition RPCs: authenticated staff only
REVOKE EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_order_payment(uuid, text, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_order_payment(uuid, text, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.start_pilot_trip(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.start_pilot_trip(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_order_delivery(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_order_delivery(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fail_order_delivery(uuid, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fail_order_delivery(uuid, text, uuid) TO authenticated;
