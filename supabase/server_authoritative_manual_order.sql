-- ============================================================================
-- Migration: Server-Authoritative Manual Order Creation (create_manual_order RPC)
-- Project: AbuKhater Restaurant Control Center (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Objectives:
--   1. Secure server-side order creation for POS, Cashier, Talabat & Trips.
--   2. Enforces staff authentication and role verification (Admin, Cashier, Driver).
--   3. Calculates authoritative totals, links menu items, and populates order_items.
--   4. Single atomic transaction preventing orphaned orders.
--   5. Full idempotency and safe offline retry support.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_manual_order(
  p_receipt_no          text DEFAULT NULL,
  p_order_type          text DEFAULT 'delivery',
  p_source              text DEFAULT 'manual',
  p_customer_name       text DEFAULT 'عميل مطعم',
  p_customer_phone      text DEFAULT NULL,
  p_customer_phone_2    text DEFAULT NULL,
  p_delivery_address    text DEFAULT NULL,
  p_payment_method      text DEFAULT 'Cash',
  p_delivery_fee        numeric DEFAULT 0.0,
  p_service_fee         numeric DEFAULT 0.0,
  p_paid_now            numeric DEFAULT NULL,
  p_latitude            double precision DEFAULT NULL,
  p_longitude           double precision DEFAULT NULL,
  p_items               jsonb DEFAULT '[]'::jsonb,
  p_shift_id            uuid DEFAULT NULL,
  p_idempotency_key     uuid DEFAULT NULL,
  p_raw_payload         jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role         text;
  v_cached              jsonb;
  v_active_shift_id     uuid;
  v_order_number        text;
  v_subtotal            numeric := 0.0;
  v_total_amount        numeric := 0.0;
  v_delivery_fee        numeric := COALESCE(p_delivery_fee, 0.0);
  v_service_fee         numeric := COALESCE(p_service_fee, 0.0);
  v_paid_now            numeric := 0.0;
  v_remaining_amount    numeric := 0.0;
  v_new_order_id        uuid;
  v_item_elem           jsonb;
  v_item_id_str         text;
  v_item_name           text;
  v_item_qty            integer;
  v_item_price          numeric;
  v_line_total          numeric;
  v_menu_item           public.menu_items%ROWTYPE;
  v_validated_items     jsonb := '[]'::jsonb;
  v_compact_payload     jsonb;
  v_result              jsonb;
  v_norm_payment        text;
  v_is_cash             boolean;
BEGIN
  -- 1. Verify Caller Role
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher', 'driver']);

  -- 2. Idempotency Check
  IF p_idempotency_key IS NOT NULL THEN
    v_cached := public._claim_mutation(p_idempotency_key, 'create_manual_order', 'order', NULL);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  -- 3. Shift Association
  IF p_shift_id IS NOT NULL THEN
    v_active_shift_id := p_shift_id;
  ELSE
    SELECT id INTO v_active_shift_id
    FROM public.shifts
    WHERE status = 'open'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- 4. Process & Validate Items
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item_elem IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_item_id_str := trim(COALESCE(v_item_elem->>'item_id', v_item_elem->>'id', ''));
      v_item_name   := trim(COALESCE(v_item_elem->>'name', v_item_elem->>'product_name', 'صنف'));
      v_item_qty    := COALESCE((v_item_elem->>'quantity')::int, (v_item_elem->>'count')::int, 1);
      
      IF v_item_qty <= 0 THEN
        v_item_qty := 1;
      END IF;

      -- Attempt lookup in menu_items
      SELECT * INTO v_menu_item
      FROM public.menu_items
      WHERE (
        (v_item_id_str ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND id = v_item_id_str::uuid)
        OR id::text = v_item_id_str
        OR name = v_item_name
      )
      LIMIT 1;

      IF FOUND THEN
        v_item_price := COALESCE(v_menu_item.price, 0.0);
        v_line_total := v_item_price * v_item_qty;
        v_subtotal   := v_subtotal + v_line_total;

        v_validated_items := v_validated_items || jsonb_build_object(
          'item_id', v_menu_item.id,
          'name', v_menu_item.name,
          'quantity', v_item_qty,
          'unit_price', v_item_price,
          'total_price', v_line_total
        );
      ELSE
        -- Manual custom item entry
        v_item_price := COALESCE((v_item_elem->>'price')::numeric, (v_item_elem->>'unit_price')::numeric, 0.0);
        v_line_total := v_item_price * v_item_qty;
        v_subtotal   := v_subtotal + v_line_total;

        v_validated_items := v_validated_items || jsonb_build_object(
          'item_id', NULL,
          'name', v_item_name,
          'quantity', v_item_qty,
          'unit_price', v_item_price,
          'total_price', v_line_total
        );
      END IF;
    END LOOP;
  END IF;

  -- 5. Calculate Totals
  v_total_amount := v_subtotal + v_delivery_fee + v_service_fee;
  v_norm_payment := lower(trim(COALESCE(p_payment_method, 'Cash')));
  v_is_cash      := (v_norm_payment IN ('cash', 'نقدي', 'كاش', 'عند الاستلام'));

  IF p_paid_now IS NOT NULL THEN
    v_paid_now := p_paid_now;
    v_remaining_amount := GREATEST(0.0, v_total_amount - v_paid_now);
  ELSIF v_is_cash THEN
    v_paid_now := 0.0;
    v_remaining_amount := v_total_amount;
  ELSE
    v_paid_now := v_total_amount;
    v_remaining_amount := 0.0;
  END IF;

  -- 6. Order Number Assignment
  IF p_receipt_no IS NOT NULL AND trim(p_receipt_no) <> '' THEN
    v_order_number := trim(p_receipt_no);
  ELSE
    v_order_number := '#' || nextval('public.order_number_seq')::text;
  END IF;

  -- 7. Construct Backup Payload
  v_compact_payload := COALESCE(p_raw_payload, jsonb_build_object(
    'order_id', v_order_number,
    'timestamp', now(),
    'order_type', p_order_type,
    'source', p_source,
    'customer', jsonb_build_object(
      'full_name', p_customer_name,
      'phone_1', p_customer_phone,
      'phone_2', p_customer_phone_2,
      'delivery_info', jsonb_build_object('address', p_delivery_address)
    ),
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'delivery_fee', v_delivery_fee,
      'service_fee', v_service_fee,
      'total', v_total_amount,
      'paid_now', v_paid_now,
      'remaining_amount', v_remaining_amount
    ),
    'items', v_validated_items
  ));

  -- 8. Atomic Insert: orders
  INSERT INTO public.orders (
    original_id,
    customer_name,
    customer_phone,
    customer_phone_2,
    order_type,
    total_amount,
    delivery_fee,
    service_fee,
    paid_now,
    remaining_amount,
    status,
    delivery_address,
    payment_method,
    payment_screenshot,
    latitude,
    longitude,
    shift_id,
    source,
    raw_payload,
    created_at
  ) VALUES (
    v_order_number,
    trim(COALESCE(p_customer_name, 'عميل مطعم')),
    p_customer_phone,
    p_customer_phone_2,
    COALESCE(p_order_type, 'delivery'),
    v_total_amount,
    v_delivery_fee,
    v_service_fee,
    v_paid_now,
    v_remaining_amount,
    'pending',
    p_delivery_address,
    p_payment_method,
    NULL,
    p_latitude,
    p_longitude,
    v_active_shift_id,
    COALESCE(p_source, 'manual'),
    v_compact_payload,
    now()
  )
  RETURNING id INTO v_new_order_id;

  -- 9. Atomic Insert: order_items
  IF jsonb_array_length(v_validated_items) > 0 THEN
    INSERT INTO public.order_items (
      order_id,
      item_id,
      product_name,
      quantity,
      unit_price,
      total_price
    )
    SELECT
      v_new_order_id,
      CASE 
        WHEN item->>'item_id' IS NOT NULL AND item->>'item_id' <> '' 
        THEN (item->>'item_id')::uuid 
        ELSE NULL 
      END,
      (item->>'name')::text,
      (item->>'quantity')::int,
      (item->>'unit_price')::numeric,
      (item->>'total_price')::numeric
    FROM jsonb_array_elements(v_validated_items) AS item;
  END IF;

  -- 10. Result Construction
  v_result := jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'order_type', p_order_type,
    'source', p_source,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery_fee,
    'service_fee', v_service_fee,
    'total_amount', v_total_amount,
    'paid_now', v_paid_now,
    'remaining_amount', v_remaining_amount,
    'items_count', jsonb_array_length(v_validated_items),
    'shift_id', v_active_shift_id,
    'created_at', now()
  );

  -- 11. Idempotency Finalization
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._finish_mutation(p_idempotency_key, 'create_manual_order', 'order', v_new_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- Permissions: Restricted to authenticated staff only
REVOKE EXECUTE ON FUNCTION public.create_manual_order FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_manual_order TO authenticated;
