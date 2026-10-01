-- ============================================================================
-- Phase 8: Customer Recent Orders & Enhanced Order Tracking RPCs
-- ============================================================================

-- 1. get_customer_recent_orders: Fetch up to N (default 3) recent orders for customer phone
CREATE OR REPLACE FUNCTION public.get_customer_recent_orders(
  p_customer_phone    text DEFAULT NULL,
  p_order_number      text DEFAULT NULL,
  p_limit             integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_phone       text;
  v_orders_json       jsonb := '[]'::jsonb;
  v_active_id         uuid := NULL;
  v_rec               record;
  v_status_ar         text;
  v_pstatus_ar        text;
  v_items_count       integer;
  v_is_active         boolean;
  v_is_closed         boolean;
  v_limit             integer;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 10);

  IF p_customer_phone IS NOT NULL AND trim(p_customer_phone) <> '' THEN
    v_clean_phone := regexp_replace(trim(p_customer_phone), '[^0-9]', '', 'g');
    -- Strip leading country codes if any
    IF v_clean_phone ~ '^0020' THEN
      v_clean_phone := substr(v_clean_phone, 5);
    ELSIF v_clean_phone ~ '^20' AND length(v_clean_phone) = 12 THEN
      v_clean_phone := substr(v_clean_phone, 3);
    END IF;
    IF length(v_clean_phone) = 10 AND v_clean_phone ~ '^[1][0125]' THEN
      v_clean_phone := '0' || v_clean_phone;
    END IF;
  END IF;

  IF (v_clean_phone IS NULL OR v_clean_phone = '') AND (p_order_number IS NULL OR trim(p_order_number) = '') THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'يرجى إدخال رقم الهاتف أو رقم الطلب للاستعلام.',
      'orders', '[]'::jsonb,
      'count', 0
    );
  END IF;

  FOR v_rec IN
    SELECT *
    FROM public.orders
    WHERE
      CASE
        WHEN p_order_number IS NOT NULL AND trim(p_order_number) <> '' THEN
          (original_id = trim(p_order_number) OR order_number::text = trim(p_order_number) OR id::text = trim(p_order_number))
          AND (v_clean_phone IS NULL OR customer_phone = v_clean_phone OR customer_phone LIKE '%' || v_clean_phone || '%')
        ELSE
          (customer_phone = v_clean_phone OR customer_phone LIKE '%' || v_clean_phone || '%')
      END
    ORDER BY created_at DESC
    LIMIT v_limit
  LOOP
    -- Active / Closed classification
    v_is_active := v_rec.status IN ('pending', 'pending_timer', 'preparing', 'ready', 'driver_assigned', 'out_for_delivery');
    v_is_closed := v_rec.status IN ('delivered', 'completed', 'cancelled', 'failed_delivery');

    IF v_active_id IS NULL AND v_is_active THEN
      v_active_id := v_rec.id;
    END IF;

    -- Arabic Status Label Mapping
    v_status_ar := CASE v_rec.status
      WHEN 'pending' THEN 'تم استلام الطلب'
      WHEN 'pending_timer' THEN 'تم استلام الطلب'
      WHEN 'preparing' THEN 'جاري تحضير الوجبات'
      WHEN 'ready' THEN 'الطلب جاهز للتسليم'
      WHEN 'driver_assigned' THEN 'تم إسناد الطلب للمندوب'
      WHEN 'out_for_delivery' THEN 'الطلب في الطريق إليك 🛵'
      WHEN 'delivered' THEN 'تم التسليم بنجاح ✨'
      WHEN 'completed' THEN 'تم التسليم بنجاح ✨'
      WHEN 'failed_delivery' THEN 'تعذر توصيل الطلب'
      WHEN 'cancelled' THEN 'تم إلغاء الطلب'
      ELSE 'قيد المعالجة'
    END;

    -- Arabic Payment Status Label Mapping
    v_pstatus_ar := CASE v_rec.payment_status
      WHEN 'cash_on_delivery' THEN 'الدفع عند الاستلام'
      WHEN 'pending_payment' THEN 'بانتظار إتمام الدفع'
      WHEN 'pending_verification' THEN 'جاري مراجعة إيصال التحويل'
      WHEN 'verified' THEN 'تم التحقق من الدفع'
      WHEN 'rejected' THEN 'إيصال التحويل غير صالح'
      WHEN 'refunded' THEN 'تم استرجاع المبلغ'
      ELSE 'غير محدد'
    END;

    SELECT count(*) INTO v_items_count FROM public.order_items WHERE order_id = v_rec.id;
    IF v_items_count = 0 AND v_rec.raw_payload IS NOT NULL THEN
      v_items_count := COALESCE(jsonb_array_length(v_rec.raw_payload->'items'), 0);
    END IF;

    v_orders_json := v_orders_json || jsonb_build_array(jsonb_build_object(
      'order_id', v_rec.id,
      'order_number', COALESCE(v_rec.original_id, '#' || v_rec.order_number::text),
      'order_type', v_rec.order_type,
      'status', v_rec.status,
      'status_label_ar', v_status_ar,
      'is_active', v_is_active,
      'is_closed', v_is_closed,
      'payment_status', v_rec.payment_status,
      'payment_status_label_ar', v_pstatus_ar,
      'payment_method', v_rec.payment_method,
      'total_amount', v_rec.total_amount,
      'delivery_fee', v_rec.delivery_fee,
      'service_fee', v_rec.service_fee,
      'paid_now', v_rec.paid_now,
      'remaining_amount', v_rec.remaining_amount,
      'items_count', v_items_count,
      'pilot_name', CASE WHEN v_rec.status IN ('out_for_delivery', 'delivered') THEN v_rec.pilot_name ELSE NULL END,
      'created_at', v_rec.created_at,
      'delivery_address', v_rec.delivery_address,
      'cancellation_reason', v_rec.cancellation_reason
    ));
  END LOOP;

  IF jsonb_array_length(v_orders_json) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'found', false,
      'message', 'لم يتم العثور على أي طلبات مسجلة بهذا الرقم.',
      'orders', '[]'::jsonb,
      'count', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'found', true,
    'count', jsonb_array_length(v_orders_json),
    'active_order_id', v_active_id,
    'orders', v_orders_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_recent_orders(text, text, integer) TO anon, authenticated, service_role;

-- 2. Update get_customer_order_tracking to support phone-only query & is_active / is_closed flags
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
    IF v_clean_phone ~ '^0020' THEN
      v_clean_phone := substr(v_clean_phone, 5);
    ELSIF v_clean_phone ~ '^20' AND length(v_clean_phone) = 12 THEN
      v_clean_phone := substr(v_clean_phone, 3);
    END IF;
    IF length(v_clean_phone) = 10 AND v_clean_phone ~ '^[1][0125]' THEN
      v_clean_phone := '0' || v_clean_phone;
    END IF;
  END IF;

  -- Lookup order
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id LIMIT 1;
  ELSIF p_order_number IS NOT NULL AND trim(p_order_number) <> '' THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE (original_id = trim(p_order_number) OR order_number::text = trim(p_order_number) OR id::text = trim(p_order_number))
      AND (v_clean_phone IS NULL OR customer_phone = v_clean_phone OR customer_phone LIKE '%' || v_clean_phone || '%')
    ORDER BY created_at DESC
    LIMIT 1;
  ELSIF v_clean_phone IS NOT NULL AND v_clean_phone <> '' THEN
    -- Fallback: fetch most recent order for this phone
    SELECT * INTO v_order
    FROM public.orders
    WHERE (customer_phone = v_clean_phone OR customer_phone LIKE '%' || v_clean_phone || '%')
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'يجب تحديد رقم الهاتف أو رقم الطلب للاستعلام.' USING ERRCODE = '22023';
  END IF;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'message', 'لم يتم العثور على طلب مطابق للبيانات المدخلة.'
    );
  END IF;

  -- Arabic Status Label Mapping
  v_status_ar := CASE v_order.status
    WHEN 'pending' THEN 'تم استلام الطلب'
    WHEN 'pending_timer' THEN 'تم استلام الطلب'
    WHEN 'preparing' THEN 'جاري تحضير الوجبات'
    WHEN 'ready' THEN 'الطلب جاهز للتسليم'
    WHEN 'driver_assigned' THEN 'تم إسناد الطلب للمندوب'
    WHEN 'out_for_delivery' THEN 'الطلب في الطريق إليك 🛵'
    WHEN 'delivered' THEN 'تم التسليم بنجاح ✨'
    WHEN 'completed' THEN 'تم التسليم بنجاح ✨'
    WHEN 'failed_delivery' THEN 'تعذر توصيل الطلب'
    WHEN 'cancelled' THEN 'تم إلغاء الطلب'
    ELSE 'قيد المعالجة'
  END;

  -- Arabic Payment Status Label Mapping
  v_pstatus_ar := CASE v_order.payment_status
    WHEN 'cash_on_delivery' THEN 'الدفع عند الاستلام'
    WHEN 'pending_payment' THEN 'بانتظار إتمام الدفع'
    WHEN 'pending_verification' THEN 'جاري مراجعة إيصال التحويل'
    WHEN 'verified' THEN 'تم التحقق من الدفع'
    WHEN 'rejected' THEN 'إيصال التحويل غير صالح'
    WHEN 'refunded' THEN 'تم استرجاع المبلغ'
    ELSE 'غير محدد'
  END;

  SELECT count(*) INTO v_items_count FROM public.order_items WHERE order_id = v_order.id;
  IF v_items_count = 0 AND v_order.raw_payload IS NOT NULL THEN
    v_items_count := COALESCE(jsonb_array_length(v_order.raw_payload->'items'), 0);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'order_id', v_order.id,
    'order_number', COALESCE(v_order.original_id, '#' || v_order.order_number::text),
    'order_type', v_order.order_type,
    'status', v_order.status,
    'status_label_ar', v_status_ar,
    'is_active', v_order.status IN ('pending', 'pending_timer', 'preparing', 'ready', 'driver_assigned', 'out_for_delivery'),
    'is_closed', v_order.status IN ('delivered', 'completed', 'cancelled', 'failed_delivery'),
    'payment_status', v_order.payment_status,
    'payment_status_label_ar', v_pstatus_ar,
    'payment_method', v_order.payment_method,
    'total_amount', v_order.total_amount,
    'delivery_fee', v_order.delivery_fee,
    'service_fee', v_order.service_fee,
    'paid_now', v_order.paid_now,
    'remaining_amount', v_order.remaining_amount,
    'items_count', v_items_count,
    'pilot_name', CASE WHEN v_order.status IN ('out_for_delivery', 'delivered') THEN v_order.pilot_name ELSE NULL END,
    'created_at', v_order.created_at,
    'delivery_address', v_order.delivery_address,
    'cancellation_reason', v_order.cancellation_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_order_tracking(uuid, text, text) TO anon, authenticated, service_role;

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
