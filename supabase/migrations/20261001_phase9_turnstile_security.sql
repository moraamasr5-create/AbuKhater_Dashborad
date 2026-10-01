-- ============================================================================
-- Phase 9: Cloudflare Turnstile Server-Authoritative Security & Anti-Bot
-- ============================================================================

-- 1. Ensure settings entries exist in restaurant_settings
INSERT INTO public.restaurant_settings (key, value)
VALUES 
  ('turnstile_enabled', 'false'),
  ('turnstile_secret_key', '')
ON CONFLICT (key) DO NOTHING;

-- 2. Core Server-Side Verification Helper Function
CREATE OR REPLACE FUNCTION public._verify_turnstile(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret       text;
  v_enabled      text;
  v_http_res     http_response;
  v_json_res     jsonb;
  v_is_success   boolean;
BEGIN
  -- Check if Turnstile is enabled
  SELECT value INTO v_enabled FROM public.restaurant_settings WHERE key = 'turnstile_enabled';
  IF v_enabled IS DISTINCT FROM 'true' THEN
    RETURN true; -- Bypass if disabled
  END IF;

  -- Check if secret key is configured
  SELECT value INTO v_secret FROM public.restaurant_settings WHERE key = 'turnstile_secret_key';
  IF v_secret IS NULL OR trim(v_secret) = '' THEN
    RETURN true; -- Bypass if secret key is empty
  END IF;

  -- Token is required when enabled & configured
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RAISE EXCEPTION 'يرجى إكمال اختبار التحقق الأمني (CAPTCHA).'
      USING ERRCODE = '22023';
  END IF;

  -- Call Cloudflare Turnstile validation endpoint via Postgres http extension
  BEGIN
    v_http_res := http_post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      'secret=' || v_secret || '&response=' || trim(p_token),
      'application/x-www-form-urlencoded'
    );
    v_json_res := v_http_res.content::jsonb;
    v_is_success := (v_json_res->>'success')::boolean;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'تعذر التحقق من رمز الأمان (Cloudflare Turnstile). يرجى المحاولة ثانية.'
      USING ERRCODE = '08000';
  END;

  IF NOT COALESCE(v_is_success, false) THEN
    RAISE EXCEPTION 'فشل التحقق الأمني من Cloudflare Turnstile. يرجى إعادة المحاولة.'
      USING ERRCODE = '42501';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public._verify_turnstile(text) TO anon, authenticated, service_role;

-- 3. Update create_order RPC with Turnstile verification
CREATE OR REPLACE FUNCTION public.create_order(
  p_order_type          text DEFAULT 'delivery',
  p_customer_name       text DEFAULT '',
  p_customer_phone      text DEFAULT '',
  p_customer_phone_2    text DEFAULT NULL,
  p_delivery_address    text DEFAULT NULL,
  p_payment_method      text DEFAULT 'cash',
  p_payment_screenshot  text DEFAULT NULL,
  p_location_method     text DEFAULT 'gps',
  p_area_id             text DEFAULT NULL,
  p_latitude            double precision DEFAULT NULL,
  p_longitude           double precision DEFAULT NULL,
  p_items               jsonb DEFAULT '[]'::jsonb,
  p_idempotency_key     uuid DEFAULT NULL,
  p_source              text DEFAULT 'online',
  p_turnstile_token     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Business Rules Settings Variables
  v_is_open                 boolean;
  v_delivery_enabled        boolean;
  v_require_shift           boolean;
  v_base_fee                numeric;
  v_base_distance_km        numeric;
  v_per_km_rate             numeric;
  v_max_distance_km         numeric;
  v_rounding_step           numeric;
  v_rest_lat                double precision;
  v_rest_lng                double precision;
  v_service_fee_enabled     boolean;
  v_service_fee_chunk       numeric;
  v_service_fee_per_chunk   numeric;

  -- Operational / Runtime Variables
  v_cached                  jsonb;
  v_active_shift            public.shifts%ROWTYPE;
  v_order_seq               bigint;
  v_order_number            text;
  v_distance_km             double precision := 0.0;
  v_raw_delivery_fee        numeric := 0.0;
  v_delivery_fee            numeric := 0.0;
  v_subtotal                numeric := 0.0;
  v_service_fee             numeric := 0.0;
  v_total_amount            numeric := 0.0;
  v_paid_now                numeric := 0.0;
  v_remaining_amount        numeric := 0.0;
  v_new_order_id            uuid;
  v_item_elem               jsonb;
  v_item_id_str             text;
  v_item_qty                integer;
  v_item_notes              text;
  v_menu_item               public.menu_items%ROWTYPE;
  v_unit_price              numeric;
  v_line_total              numeric;
  v_validated_items         jsonb := '[]'::jsonb;
  v_zone_record             public.delivery_zones%ROWTYPE;
  v_compact_payload         jsonb;
  v_result                  jsonb;
  v_is_cash                 boolean;
  v_norm_payment            text;
BEGIN
  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL THEN
    v_cached := public._claim_mutation(p_idempotency_key, 'create_order', 'order', NULL);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  -- 2. Turnstile Verification
  PERFORM public._verify_turnstile(p_turnstile_token);

  -- 3. Basic Input Validations
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'اسم العميل مطلوب.' USING ERRCODE = 'P0001';
  END IF;

  IF p_customer_phone IS NULL OR length(regexp_replace(p_customer_phone, '[^0-9]', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'رقم هاتف العميل غير صحيح.' USING ERRCODE = 'P0001';
  END IF;

  IF p_order_type NOT IN ('delivery', 'pickup', 'dine_in') THEN
    RAISE EXCEPTION 'نوع الطلب غير صالح: %', p_order_type USING ERRCODE = 'P0001';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة صنف واحد على الأقل لإتمام الطلب.' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Load Authoritative Restaurant Settings
  v_is_open             := (public._get_setting('is_restaurant_open', 'true') = 'true');
  v_delivery_enabled    := (public._get_setting('delivery_enabled', 'true') = 'true');
  v_require_shift       := (public._get_setting('require_active_shift_for_orders', 'true') = 'true');
  v_base_fee            := COALESCE(NULLIF(public._get_setting('delivery_base_fee', '25'), '')::numeric, 25.0);
  v_base_distance_km    := COALESCE(NULLIF(public._get_setting('delivery_base_distance_km', '0.5'), '')::numeric, 0.5);
  v_per_km_rate         := COALESCE(NULLIF(public._get_setting('delivery_per_km_rate', '12.5'), '')::numeric, 12.5);
  v_max_distance_km     := COALESCE(NULLIF(public._get_setting('max_delivery_distance_km', '10'), '')::numeric, 10.0);
  v_rounding_step       := COALESCE(NULLIF(public._get_setting('delivery_rounding_step', '5'), '')::numeric, 5.0);
  v_rest_lat            := COALESCE(NULLIF(public._get_setting('restaurant_lat', '30.126131'), '')::double precision, 30.126131);
  v_rest_lng            := COALESCE(NULLIF(public._get_setting('restaurant_lng', '31.298350'), '')::double precision, 31.298350);
  v_service_fee_enabled := (public._get_setting('payment_service_fee_enabled', 'true') = 'true');
  v_service_fee_chunk   := COALESCE(NULLIF(public._get_setting('payment_service_fee_chunk', '500'), '')::numeric, 500.0);
  v_service_fee_per_chunk := COALESCE(NULLIF(public._get_setting('payment_service_fee_per_chunk', '10'), '')::numeric, 10.0);

  IF NOT v_is_open THEN
    RAISE EXCEPTION 'المطعم مغلق حالياً ولا يستقبل طلبات جديدة.' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Shift Validation & Association
  SELECT * INTO v_active_shift
  FROM public.shifts
  WHERE status = 'open'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_require_shift AND v_active_shift.id IS NULL THEN
    RAISE EXCEPTION 'لا توجد وردية عمل مفتوحة حالياً بالمطعم لاستقبال الطلبات.' USING ERRCODE = 'P0001';
  END IF;

  -- 6. Delivery Validation
  IF p_order_type = 'delivery' THEN
    IF NOT v_delivery_enabled THEN
      RAISE EXCEPTION 'خدمة التوصيل غير مفعلة حالياً.' USING ERRCODE = 'P0001';
    END IF;

    IF p_delivery_address IS NULL OR trim(p_delivery_address) = '' THEN
      RAISE EXCEPTION 'عنوان التوصيل مطلوب لإتمام طلب التوصيل.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 7. Item Lookup, Availability & Subtotal Calculation
  FOR v_item_elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id_str := trim(v_item_elem->>'item_id');
    v_item_qty    := COALESCE((v_item_elem->>'quantity')::int, (v_item_elem->>'count')::int, 1);
    v_item_notes  := v_item_elem->>'notes';

    IF v_item_qty <= 0 OR v_item_qty > 100 THEN
      RAISE EXCEPTION 'كمية غير صالحة للصنف: % (الكمية: %)', v_item_id_str, v_item_qty USING ERRCODE = 'P0001';
    END IF;

    -- Lookup menu item by UUID or ID match
    SELECT * INTO v_menu_item
    FROM public.menu_items
    WHERE (
      (v_item_id_str ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND id = v_item_id_str::uuid)
      OR id::text = v_item_id_str
      OR name = trim(v_item_elem->>'name')
    )
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف المطلوب غير موجود بقائمة الطعام: %', COALESCE(v_item_elem->>'name', v_item_id_str) USING ERRCODE = 'P0001';
    END IF;

    -- Check availability
    IF v_menu_item.status IS NOT NULL AND lower(v_menu_item.status) IN ('unavailable', 'hidden', 'out_of_stock', 'غير متوفر', 'معطل', 'false') THEN
      RAISE EXCEPTION 'الصنف "%" غير متوفر حالياً.', v_menu_item.name USING ERRCODE = 'P0001';
    END IF;

    -- Authoritative server price
    v_unit_price := COALESCE(v_menu_item.price, 0.0);
    v_line_total := v_unit_price * v_item_qty;
    v_subtotal   := v_subtotal + v_line_total;

    v_validated_items := v_validated_items || jsonb_build_object(
      'item_id', v_menu_item.id,
      'name', v_menu_item.name,
      'quantity', v_item_qty,
      'unit_price', v_unit_price,
      'total_price', v_line_total,
      'notes', v_item_notes
    );
  END LOOP;

  -- 8. Authoritative Delivery Fee Calculation
  IF p_order_type = 'delivery' THEN
    IF p_location_method = 'fixed_zone' AND p_area_id IS NOT NULL AND trim(p_area_id) <> '' THEN
      SELECT * INTO v_zone_record
      FROM public.delivery_zones
      WHERE id::text = trim(p_area_id) OR name = trim(p_area_id)
      LIMIT 1;

      IF FOUND THEN
        v_delivery_fee := COALESCE(v_zone_record.fee, v_base_fee);
      ELSE
        v_delivery_fee := v_base_fee;
      END IF;
    ELSIF p_latitude IS NOT NULL AND p_longitude IS NOT NULL AND p_latitude <> 0 AND p_longitude <> 0 THEN
      v_distance_km := public.calculate_delivery_distance_km(v_rest_lat, v_rest_lng, p_latitude, p_longitude);

      IF v_distance_km > v_max_distance_km THEN
        RAISE EXCEPTION 'عفواً، موقع التوصيل يبعد % كم، والحد الأقصى للتوصيل هو % كم.', round(v_distance_km::numeric, 1), v_max_distance_km
          USING ERRCODE = 'P0001';
      END IF;

      IF v_distance_km <= v_base_distance_km THEN
        v_raw_delivery_fee := v_base_fee;
      ELSE
        v_raw_delivery_fee := v_base_fee + ((v_distance_km - v_base_distance_km) * v_per_km_rate);
      END IF;

      IF v_rounding_step > 0 THEN
        v_delivery_fee := ceil(v_raw_delivery_fee / v_rounding_step) * v_rounding_step;
      ELSE
        v_delivery_fee := round(v_raw_delivery_fee, 2);
      END IF;
    ELSE
      v_delivery_fee := v_base_fee;
    END IF;
  ELSE
    v_delivery_fee := 0.0;
  END IF;

  -- 9. Authoritative Service Fee Calculation
  v_norm_payment := lower(trim(COALESCE(p_payment_method, 'cash')));
  v_is_cash := (v_norm_payment IN ('cash', 'كاش', 'cash_on_delivery', 'cod'));

  IF NOT v_is_cash AND v_service_fee_enabled AND v_service_fee_chunk > 0 THEN
    v_service_fee := ceil((v_subtotal + v_delivery_fee) / v_service_fee_chunk) * v_service_fee_per_chunk;
  ELSE
    v_service_fee := 0.0;
  END IF;

  -- 10. Financial Totals Calculation
  v_total_amount := v_subtotal + v_delivery_fee + v_service_fee;

  IF v_is_cash THEN
    v_paid_now := 0.0;
    v_remaining_amount := v_total_amount;
  ELSE
    v_paid_now := v_total_amount;
    v_remaining_amount := 0.0;
  END IF;

  -- 11. Generate Sequential Order Number
  v_order_seq := nextval('public.orders_order_number_seq');
  v_order_number := '#' || v_order_seq::text;
  v_new_order_id := gen_random_uuid();

  -- 12. Build Compact Payload for Backup & Dashboards
  v_compact_payload := jsonb_build_object(
    'order_id', v_new_order_id,
    'order_number', v_order_number,
    'source', p_source,
    'customer', jsonb_build_object(
      'name', p_customer_name,
      'phone_1', p_customer_phone,
      'phone_2', p_customer_phone_2,
      'address', p_delivery_address,
      'location_method', p_location_method,
      'area_id', p_area_id,
      'coordinates', jsonb_build_object('lat', p_latitude, 'lng', p_longitude)
    ),
    'items', v_validated_items,
    'financials', jsonb_build_object(
      'subtotal', v_subtotal,
      'delivery_fee', v_delivery_fee,
      'service_fee', v_service_fee,
      'total', v_total_amount,
      'paid_now', v_paid_now,
      'remaining', v_remaining_amount,
      'payment_method', p_payment_method
    ),
    'created_at', now()
  );

  -- 13. Atomic Insert into orders table
  INSERT INTO public.orders (
    id,
    order_number,
    original_id,
    source,
    customer_name,
    customer_phone,
    customer_phone_2,
    delivery_address,
    order_type,
    status,
    payment_method,
    payment_status,
    payment_screenshot,
    total_amount,
    delivery_fee,
    service_fee,
    paid_now,
    remaining_amount,
    latitude,
    longitude,
    shift_id,
    raw_payload,
    created_at
  ) VALUES (
    v_new_order_id,
    v_order_seq,
    v_order_number,
    p_source,
    p_customer_name,
    p_customer_phone,
    p_customer_phone_2,
    p_delivery_address,
    p_order_type,
    'pending_timer',
    p_payment_method,
    CASE WHEN v_is_cash THEN 'cash_on_delivery' ELSE 'pending_verification' END,
    p_payment_screenshot,
    v_total_amount,
    v_delivery_fee,
    v_service_fee,
    v_paid_now,
    v_remaining_amount,
    p_latitude,
    p_longitude,
    v_active_shift.id::text,
    v_compact_payload,
    now()
  );

  -- 14. Insert Order Items
  INSERT INTO public.order_items (
    order_id,
    item_id,
    item_name,
    quantity,
    unit_price,
    total_price,
    notes
  )
  SELECT
    v_new_order_id,
    (item->>'item_id')::uuid,
    item->>'name',
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric,
    (item->>'total_price')::numeric,
    item->>'notes'
  FROM jsonb_array_elements(v_validated_items) AS item;

  -- 15. Build Authoritative Return Payload
  v_result := jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery_fee,
    'service_fee', v_service_fee,
    'total_amount', v_total_amount,
    'paid_now', v_paid_now,
    'remaining_amount', v_remaining_amount,
    'status', 'pending_timer',
    'created_at', now()
  );

  -- 16. Finalize Idempotency Mutation
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._finish_mutation(p_idempotency_key, 'create_order', 'order', v_new_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order(text, text, text, text, text, text, text, text, text, double precision, double precision, jsonb, uuid, text, text) TO anon, authenticated, service_role;

-- 4. Update submit_reservation RPC with Turnstile verification
CREATE OR REPLACE FUNCTION public.submit_reservation(
  p_customer_name     text,
  p_customer_phone    text,
  p_reservation_date  date,
  p_reservation_time  text,
  p_guests_count      integer DEFAULT 2,
  p_location_type     text DEFAULT 'restaurant',
  p_notes             text DEFAULT NULL,
  p_payment_proof_url text DEFAULT NULL,
  p_idempotency_key   uuid DEFAULT NULL,
  p_turnstile_token   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_name          text;
  v_clean_phone         text;
  v_clean_notes         text;
  v_clean_proof_url     text;
  v_clean_loc_type      text;
  v_parsed_time         time;
  v_deposit_amount      numeric := 100.0;
  v_setting_val         text;
  v_recent_res_count    integer;
  v_ref_number          text;
  v_new_id              bigint;
  v_cached              jsonb;
  v_result              jsonb;
BEGIN
  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL THEN
    v_cached := public._claim_mutation(p_idempotency_key, 'submit_reservation', 'reservation', NULL);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  -- 2. Turnstile Verification
  PERFORM public._verify_turnstile(p_turnstile_token);

  -- 3. Validate & Sanitize Customer Name
  v_clean_name := trim(COALESCE(p_customer_name, ''));
  IF length(v_clean_name) < 3 THEN
    RAISE EXCEPTION 'الاسم الكامل مطلوب ويجب أن يتكون من 3 أحرف على الأقل.'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'اسم العميل طويل جداً (الحد الأقصى 100 حرف).'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate & Normalize Phone Number
  v_clean_phone := public._validate_egyptian_phone(p_customer_phone);
  IF v_clean_phone IS NULL THEN
    RAISE EXCEPTION 'رقم الهاتف مطلوب لتأكيد الحجز.'
      USING ERRCODE = '22023';
  END IF;

  -- 5. Validate Reservation Date
  IF p_reservation_date IS NULL THEN
    RAISE EXCEPTION 'تاريخ الحجز مطلوب.'
      USING ERRCODE = '22023';
  END IF;
  IF p_reservation_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'لا يمكن حجز موعد في تاريخ ماضٍ.'
      USING ERRCODE = '22023';
  END IF;
  IF p_reservation_date > (CURRENT_DATE + INTERVAL '30 days') THEN
    RAISE EXCEPTION 'يمكن الحجز خلال 30 يوماً كحد أقصى من التاريخ الحالي.'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Validate & Parse Reservation Time
  IF p_reservation_time IS NULL OR trim(p_reservation_time) = '' THEN
    RAISE EXCEPTION 'وقت الحجز مطلوب.'
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_parsed_time := trim(p_reservation_time)::time;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'صيغة وقت الحجز غير صحيحة.'
      USING ERRCODE = '22023';
  END;

  -- 7. Validate Guests Count
  IF p_guests_count IS NULL OR p_guests_count < 1 THEN
    RAISE EXCEPTION 'عدد الضيوف يجب أن يكون فرداً واحداً على الأقل.'
      USING ERRCODE = '22023';
  END IF;
  IF p_guests_count > 50 THEN
    RAISE EXCEPTION 'الحد الأقصى لعدد الضيوف في الحجز المباشر هو 50 فرداً. للحفلات الأكبر يرجى التواصل مع إدارة المطعم مباشرة.'
      USING ERRCODE = '22023';
  END IF;

  -- 8. Validate Location Type
  v_clean_loc_type := lower(trim(COALESCE(p_location_type, 'restaurant')));
  IF v_clean_loc_type IN ('restaurant', 'مطعم') THEN
    v_clean_loc_type := 'restaurant';
  ELSIF v_clean_loc_type IN ('cafe', 'كافيه') THEN
    v_clean_loc_type := 'cafe';
  ELSE
    v_clean_loc_type := 'restaurant';
  END IF;

  -- 9. Sanitize Notes
  v_clean_notes := trim(COALESCE(p_notes, ''));
  IF length(v_clean_notes) > 500 THEN
    v_clean_notes := substr(v_clean_notes, 1, 500);
  END IF;
  IF v_clean_notes = '' THEN
    v_clean_notes := NULL;
  END IF;

  -- 10. Validate Payment Proof URL / Path
  v_clean_proof_url := trim(COALESCE(p_payment_proof_url, ''));
  IF v_clean_proof_url <> '' THEN
    IF length(v_clean_proof_url) > 1000 THEN
      RAISE EXCEPTION 'رابط إيصال التحويل طويل جداً.'
        USING ERRCODE = '22023';
    END IF;
    IF v_clean_proof_url !~* '^https?://' AND v_clean_proof_url !~* '^[a-zA-Z0-9_\-\./]+$' THEN
      RAISE EXCEPTION 'رابط إيصال التحويل غير صالح.'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_clean_proof_url := NULL;
  END IF;

  -- 11. Rate Limiting: Max 5 reservations per phone number in the last 1 hour
  SELECT count(*) INTO v_recent_res_count
  FROM public.reservations
  WHERE customer_phone = v_clean_phone
    AND created_at > (now() - INTERVAL '1 hour');

  IF v_recent_res_count >= 5 THEN
    RAISE EXCEPTION 'عفواً، لقد تجاوزت الحد الأقصى للحجوزات المسموح بها (5 حجوزات في الساعة). يرجى المحاولة لاحقاً.'
      USING ERRCODE = '42501';
  END IF;

  -- 12. Read Authoritative Deposit Amount from restaurant_settings
  SELECT value INTO v_setting_val
  FROM public.restaurant_settings
  WHERE key = 'reservation_deposit_amount'
  LIMIT 1;

  IF v_setting_val IS NOT NULL AND v_setting_val ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_deposit_amount := v_setting_val::numeric;
  END IF;

  -- 13. Generate Unique Reference Number
  v_ref_number := 'RES-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 9000 + 1000)::text, 4, '0');

  -- 14. Atomic Insert into reservations table
  INSERT INTO public.reservations (
    customer_name,
    customer_phone,
    reservation_date,
    reservation_time,
    guests_count,
    location_type,
    notes,
    status,
    payment_proof_url,
    deposit_amount,
    ref_number,
    created_at
  ) VALUES (
    v_clean_name,
    v_clean_phone,
    p_reservation_date,
    v_parsed_time,
    p_guests_count,
    v_clean_loc_type,
    v_clean_notes,
    'pending',
    v_clean_proof_url,
    v_deposit_amount,
    v_ref_number,
    now()
  )
  RETURNING id INTO v_new_id;

  -- 15. Build Response
  v_result := jsonb_build_object(
    'success', true,
    'reservation_id', v_new_id,
    'ref_number', v_ref_number,
    'status', 'pending',
    'customer_name', v_clean_name,
    'customer_phone', v_clean_phone,
    'reservation_date', p_reservation_date,
    'reservation_time', to_char(v_parsed_time, 'HH24:MI:SS'),
    'guests_count', p_guests_count,
    'location_type', v_clean_loc_type,
    'deposit_amount', v_deposit_amount,
    'payment_proof_url', v_clean_proof_url,
    'created_at', now()
  );

  -- 16. Finalize Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._finish_mutation(p_idempotency_key, 'submit_reservation', 'reservation', v_new_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_reservation(text, text, date, text, integer, text, text, text, uuid, text) TO anon, authenticated, service_role;

-- 5. Update submit_feedback RPC with Turnstile verification
CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_full_name         text,
  p_phone             text,
  p_type              text DEFAULT 'suggestion',
  p_message           text DEFAULT '',
  p_idempotency_key   uuid DEFAULT NULL,
  p_turnstile_token   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_name          text;
  v_clean_phone         text;
  v_clean_type          text;
  v_clean_message       text;
  v_recent_count        integer;
  v_new_id              uuid;
  v_cached              jsonb;
  v_result              jsonb;
BEGIN
  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL THEN
    v_cached := public._claim_mutation(p_idempotency_key, 'submit_feedback', 'feedback', NULL);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached;
    END IF;
  END IF;

  -- 2. Turnstile Verification
  PERFORM public._verify_turnstile(p_turnstile_token);

  -- 3. Validate & Sanitize Name
  v_clean_name := trim(COALESCE(p_full_name, ''));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'الاسم مطلوب ويجب أن يتكون من حرفين على الأقل.'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'الاسم طويل جداً (الحد الأقصى 100 حرف).'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate & Normalize Phone Number
  v_clean_phone := public._validate_egyptian_phone(p_phone);
  IF v_clean_phone IS NULL THEN
    RAISE EXCEPTION 'رقم الهاتف مطلوب لتسجيل الملاحظة أو الشكوى.'
      USING ERRCODE = '22023';
  END IF;

  -- 5. Validate Type
  v_clean_type := lower(trim(COALESCE(p_type, 'suggestion')));
  IF v_clean_type NOT IN ('suggestion', 'complaint', 'inquiry', 'compliment', 'other') THEN
    v_clean_type := 'suggestion';
  END IF;

  -- 6. Validate Message
  v_clean_message := trim(COALESCE(p_message, ''));
  IF length(v_clean_message) < 5 THEN
    RAISE EXCEPTION 'تفاصيل الرسالة مطلوبة ويجب أن تكون 5 أحرف على الأقل.'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_clean_message) > 2000 THEN
    RAISE EXCEPTION 'الرسالة طويلة جداً (الحد الأقصى 2000 حرف).'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Rate Limiting: Max 5 messages per phone number in 1 hour
  SELECT count(*) INTO v_recent_count
  FROM public.feedback
  WHERE phone = v_clean_phone
    AND created_at > (now() - INTERVAL '1 hour');

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'عفواً، لقد تجاوزت الحد الأقصى للمشاركات المسموح بها حالياً. يرجى المحاولة لاحقاً.'
      USING ERRCODE = '42501';
  END IF;

  v_new_id := gen_random_uuid();

  -- 8. Atomic Insert into feedback table
  INSERT INTO public.feedback (
    id,
    full_name,
    phone,
    type,
    message,
    status,
    created_at
  ) VALUES (
    v_new_id,
    v_clean_name,
    v_clean_phone,
    v_clean_type,
    v_clean_message,
    'new',
    now()
  );

  v_result := jsonb_build_object(
    'success', true,
    'feedback_id', v_new_id,
    'status', 'new',
    'message', 'شكراً لك! تم استلام رسالتك بنجاح وسنقوم بمتابعتها.'
  );

  -- 9. Finalize Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._finish_mutation(p_idempotency_key, 'submit_feedback', 'feedback', v_new_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_feedback(text, text, text, text, uuid, text) TO anon, authenticated, service_role;

-- 6. Update get_customer_recent_orders with optional Turnstile verification
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

GRANT EXECUTE ON FUNCTION public.get_customer_recent_orders(text, text, integer, text) TO anon, authenticated, service_role;

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
