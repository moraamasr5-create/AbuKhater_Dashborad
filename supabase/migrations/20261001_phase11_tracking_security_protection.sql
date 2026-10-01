-- ==============================================================================
-- Migration: 20261001_phase11_tracking_security_protection.sql
-- Purpose:
--   1. Add server-side rate limiting and anti-enumeration defense for order tracking.
--   2. Standardize non-revealing generic responses ('لم نتمكن من العثور على طلبات مطابقة للبيانات المدخلة.').
--   3. Restrict sensitive customer data leakage during public search.
-- ==============================================================================

-- 1. Create a lightweight audit / rate limit table for tracking searches
CREATE TABLE IF NOT EXISTS public.customer_search_logs (
  id          bigserial PRIMARY KEY,
  query_phone text,
  query_num   text,
  ip_address  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_search_logs_phone_time 
  ON public.customer_search_logs (query_phone, created_at);

-- 2. Update get_customer_recent_orders with server-side protection
CREATE OR REPLACE FUNCTION public.get_customer_recent_orders(
  p_customer_phone    text DEFAULT NULL,
  p_order_number      text DEFAULT NULL,
  p_limit             integer DEFAULT 3,
  p_turnstile_token   text DEFAULT NULL
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
  v_recent_queries    integer := 0;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 10);

  -- Clean & normalize phone
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

  IF (v_clean_phone IS NULL OR v_clean_phone = '') AND (p_order_number IS NULL OR trim(p_order_number) = '') THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'لم نتمكن من العثور على طلبات مطابقة للبيانات المدخلة.',
      'orders', '[]'::jsonb,
      'count', 0
    );
  END IF;

  -- Optional Turnstile verification if provided
  IF p_turnstile_token IS NOT NULL AND trim(p_turnstile_token) <> '' THEN
    BEGIN
      PERFORM public._verify_turnstile(p_turnstile_token);
    EXCEPTION WHEN OTHERS THEN
      -- Log and proceed or warn
      NULL;
    END;
  END IF;

  -- Server-Side Rate Limiting: Max 20 search queries per phone within 10 minutes
  IF v_clean_phone IS NOT NULL AND v_clean_phone <> '' THEN
    INSERT INTO public.customer_search_logs (query_phone, query_num)
    VALUES (v_clean_phone, p_order_number);

    SELECT count(*) INTO v_recent_queries
    FROM public.customer_search_logs
    WHERE query_phone = v_clean_phone
      AND created_at > (now() - INTERVAL '10 minutes');

    IF v_recent_queries > 20 THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'تم تجاوز الحد المسموح به لعمليات البحث مؤقتاً لحماية البيانات. يرجى المحاولة بعد قليل.',
        'orders', '[]'::jsonb,
        'count', 0
      );
    END IF;
  END IF;

  -- Query Orders
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
    v_is_active := v_rec.status IN ('pending', 'pending_timer', 'preparing', 'ready', 'driver_assigned', 'out_for_delivery');
    v_is_closed := v_rec.status IN ('delivered', 'completed', 'cancelled', 'failed_delivery');

    IF v_active_id IS NULL AND v_is_active THEN
      v_active_id := v_rec.id;
    END IF;

    -- Arabic Status Mapping
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

    -- Arabic Payment Status Mapping
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

    v_orders_json := v_orders_json || jsonb_build_array(
      jsonb_build_object(
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
      )
    );
  END LOOP;

  IF jsonb_array_length(v_orders_json) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'لم نتمكن من العثور على طلبات مطابقة للبيانات المدخلة.',
      'orders', '[]'::jsonb,
      'count', 0,
      'active_order_id', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'orders', v_orders_json,
    'count', jsonb_array_length(v_orders_json),
    'active_order_id', v_active_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_recent_orders(text, text, integer, text) TO anon, authenticated, service_role;

-- 3. Update get_customer_order_tracking with anti-enumeration response
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
    SELECT * INTO v_order
    FROM public.orders
    WHERE (customer_phone = v_clean_phone OR customer_phone LIKE '%' || v_clean_phone || '%')
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    RETURN jsonb_build_object(
      'found', false,
      'message', 'لم نتمكن من العثور على طلبات مطابقة للبيانات المدخلة.'
    );
  END IF;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'message', 'لم نتمكن من العثور على طلبات مطابقة للبيانات المدخلة.'
    );
  END IF;

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

-- 4. Reload schema
NOTIFY pgrst, 'reload schema';
