-- ============================================================================
-- Migration: Server-Authoritative Order Creation (create_order RPC) & Settings
-- Project: AbuKhater Restaurant Control Center (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Objectives:
--   1. Single source of truth: all pricing, fees, rounding, item prices,
--      availability, and shift rules are validated and calculated SERVER-SIDE.
--   2. Atomic order creation: inserts order and order_items in a single transaction.
--   3. Database sequence for collision-free, concurrent order numbers.
--   4. Fully configurable business rules stored in restaurant_settings table.
--   5. Idempotent submission support via client mutation keys.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Order Number Sequence
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE public.order_number_seq TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Delivery Zones Table (Dynamic Zone Management)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  zone_number integer NOT NULL DEFAULT 1,
  fee         numeric(10,2) NOT NULL DEFAULT 20.0,
  latitude    double precision,
  longitude   double precision,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_zones_select_all ON public.delivery_zones;
CREATE POLICY delivery_zones_select_all ON public.delivery_zones
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS delivery_zones_modify_staff ON public.delivery_zones;
CREATE POLICY delivery_zones_modify_staff ON public.delivery_zones
  FOR ALL
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

GRANT SELECT ON public.delivery_zones TO anon, authenticated;
GRANT ALL ON public.delivery_zones TO authenticated;

-- Seed default delivery zones (idempotent)
INSERT INTO public.delivery_zones (id, name, zone_number, fee, latitude, longitude) VALUES
  ('zone-matareya-main', 'المطرية الرئيسي', 1, 20.00, 30.126, 31.298),
  ('zone-masalla',       'المسلة',           1, 20.00, 30.132, 31.302),
  ('zone-mostorod',      'مسطرد',           1, 25.00, 30.141, 31.295),
  ('zone-new-street',    'الشارع الجديد',   1, 25.00, 30.148, 31.292),
  ('zone-ain-shams',     'عين شمس',         2, 30.00, 30.121, 31.332),
  ('zone-naam',          'النعام',           2, 35.00, 30.115, 31.318),
  ('zone-zeitoun',       'حلمية الزيتون',   2, 35.00, 30.111, 31.305),
  ('zone-amereya',       'الأميرية',         2, 30.00, 30.105, 31.292),
  ('zone-sawah',         'السواح',           2, 35.00, 30.101, 31.288),
  ('zone-khosoos',       'الخصوص',          3, 45.00, 30.165, 31.312),
  ('zone-marg',          'المرج',           3, 50.00, 30.155, 31.345),
  ('zone-gesr-suez',     'جسر السويس',       3, 55.00, 30.115, 31.365),
  ('zone-heliopolis',    'مصر الجديدة',     3, 60.00, 30.091, 31.334),
  ('zone-nasr-city',     'مدينة نصر',        4, 75.00, 30.061, 31.335),
  ('zone-qalag',         'القلج',           4, 70.00, 30.185, 31.368),
  ('zone-khankah',       'الخانكة',          4, 80.00, 30.215, 31.378)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Seed Authoritative Restaurant Settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restaurant_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.restaurant_settings ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read restaurant_settings" ON public.restaurant_settings;
CREATE POLICY "Allow anon read restaurant_settings" ON public.restaurant_settings
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow dashboard modify restaurant_settings" ON public.restaurant_settings;
CREATE POLICY "Allow dashboard modify restaurant_settings" ON public.restaurant_settings
  FOR ALL TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

INSERT INTO public.restaurant_settings (key, value, description) VALUES
  ('is_restaurant_open',               'true',                  'حالة فتح/إغلاق المطعم لاستقبال الطلبات'),
  ('delivery_enabled',                 'true',                  'مفتاح تفعيل أو تعطيل خدمة التوصيل'),
  ('delivery_base_fee',                '25',                    'سعر التوصيل الأساسي (ج.م)'),
  ('delivery_base_distance_km',        '0.5',                   'المسافة الأساسية المشمولة بالسعر الأساسي (كم)'),
  ('delivery_per_km_rate',             '12.5',                  'سعر الكيلومتر الإضافي بعد المسافة الأساسية (ج.م/كم)'),
  ('max_delivery_distance_km',         '10',                    'الحد الأقصى المسموح لمسافة التوصيل (كم)'),
  ('delivery_rounding_step',           '5',                     'خطوة تقريب سعر التوصيل (5 لأقرب 5 ج، 1 لرقم صحيح)'),
  ('restaurant_lat',                   '30.126131',             'إحداثيات المطعم - خط العرض (Latitude)'),
  ('restaurant_lng',                   '31.298350',             'إحداثيات المطعم - خط الطول (Longitude)'),
  ('payment_service_fee_enabled',      'true',                  'تفعيل رسوم الخدمة للدفع الإلكتروني'),
  ('payment_service_fee_chunk',        '500',                   'قيمة الشريحة لحساب رسوم الخدمة (ج.م)'),
  ('payment_service_fee_per_chunk',    '10',                    'رسوم كل شريحة 500 ج.م إلكترونية (ج.م)'),
  ('payment_service_fee_methods',      '["instapay","vodafone_cash","wallet","online","card"]', 'طرق الدفع الخاضعة لرسوم الخدمة'),
  ('reservation_deposit_amount',       '100',                   'مبلغ عربون الحجز الأساسي (ج.م)'),
  ('reservation_service_fee',          '5',                     'رسوم خدمة الحجز الإلكتروني (ج.م)'),
  ('require_active_shift_for_orders',  'true',                  'إلزامية وجود وردية مفتوحة لإنشاء الطلبات'),
  ('shift_open_time',                  '06:00',                 'وقت فتح الوردية التشغيلي (HH:MM بتوقيت القاهرة)'),
  ('shift_close_time',                 '04:00',                 'وقت إغلاق الوردية التشغيلي (HH:MM بتوقيت القاهرة)'),
  ('payment_instapay_ipa',             'abu_khatar@instapay',   'عنوان حساب إنستاباي للمطعم'),
  ('payment_wallet_number',            '01144423700',           'رقم محفظة فودافون كاش للمطعم'),
  ('payment_account_name',             'مطعم أبو خاطر',          'اسم صاحب الحساب التجاري')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

-- ----------------------------------------------------------------------------
-- 4. Mathematical and Setting Helpers
-- ----------------------------------------------------------------------------

-- 4.1 Haversine Distance Calculation (km)
CREATE OR REPLACE FUNCTION public._haversine_distance_km(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  R CONSTANT double precision := 6371.0; -- Earth radius in km
  dlat double precision;
  dlon double precision;
  a double precision;
  c double precision;
BEGIN
  IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
    RETURN 0.0;
  END IF;
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  a := sin(dlat / 2.0)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2.0)^2;
  c := 2.0 * asin(sqrt(a));
  RETURN R * c;
END;
$$;

-- 4.2 Helper: Get Setting Text with Default
CREATE OR REPLACE FUNCTION public._get_setting(p_key text, p_default text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_val text;
BEGIN
  SELECT value INTO v_val FROM public.restaurant_settings WHERE key = p_key;
  IF v_val IS NOT NULL THEN
    RETURN v_val;
  END IF;

  SELECT value INTO v_val FROM public.app_config WHERE key = p_key;
  IF v_val IS NOT NULL THEN
    RETURN v_val;
  END IF;

  RETURN p_default;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Authoritative create_order RPC
-- ----------------------------------------------------------------------------
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
  p_source              text DEFAULT 'online'
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

  -- 2. Basic Input Validations
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

  -- 3. Load Authoritative Restaurant Settings
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

  -- 4. Shift Validation & Association
  SELECT * INTO v_active_shift
  FROM public.shifts
  WHERE status = 'open'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_require_shift AND v_active_shift.id IS NULL THEN
    RAISE EXCEPTION 'لا توجد وردية عمل مفتوحة حالياً بالمطعم لاستقبال الطلبات.' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Delivery Validation
  IF p_order_type = 'delivery' THEN
    IF NOT v_delivery_enabled THEN
      RAISE EXCEPTION 'خدمة التوصيل غير مفعلة حالياً.' USING ERRCODE = 'P0001';
    END IF;

    IF p_delivery_address IS NULL OR trim(p_delivery_address) = '' THEN
      RAISE EXCEPTION 'عنوان التوصيل مطلوب لإتمام طلب التوصيل.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 6. Item Lookup, Availability & Subtotal Calculation
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

  -- 7. Delivery Fee Calculation (Server-Side)
  IF p_order_type = 'delivery' THEN
    -- A) Fixed Zone Lookup
    IF p_area_id IS NOT NULL AND p_area_id <> '' THEN
      SELECT * INTO v_zone_record
      FROM public.delivery_zones
      WHERE id = p_area_id OR name = p_area_id
      LIMIT 1;

      IF FOUND AND v_zone_record.is_active THEN
        v_delivery_fee := v_zone_record.fee;
      END IF;
    END IF;

    -- B) Distance GPS Calculation
    IF v_delivery_fee = 0.0 AND p_latitude IS NOT NULL AND p_longitude IS NOT NULL AND (p_latitude <> 0 OR p_longitude <> 0) THEN
      v_distance_km := public._haversine_distance_km(v_rest_lat, v_rest_lng, p_latitude, p_longitude);

      IF v_distance_km > v_max_distance_km THEN
        RAISE EXCEPTION 'موقع التوصيل المحدد (%.1f كم) خارج نطاق التوصيل المتاح (الحد الأقصى % كم).', v_distance_km, v_max_distance_km USING ERRCODE = 'P0001';
      END IF;

      IF v_distance_km <= v_base_distance_km THEN
        v_raw_delivery_fee := v_base_fee;
      ELSE
        -- 100-meter steps
        v_raw_delivery_fee := v_base_fee + ceil((v_distance_km - v_base_distance_km) * 10.0) * (v_per_km_rate / 10.0);
      END IF;

      -- Apply rounding step
      IF v_rounding_step > 1 THEN
        v_delivery_fee := round(v_raw_delivery_fee / v_rounding_step) * v_rounding_step;
      ELSE
        v_delivery_fee := ceil(v_raw_delivery_fee);
      END IF;
    END IF;

    -- C) Fallback to base fee if neither matched
    IF v_delivery_fee = 0.0 THEN
      v_delivery_fee := v_base_fee;
    END IF;
  ELSE
    v_delivery_fee := 0.0;
  END IF;

  -- 8. Payment Service Fee & Totals Calculation
  v_norm_payment := lower(trim(COALESCE(p_payment_method, 'cash')));
  v_is_cash      := (v_norm_payment IN ('cash', 'نقدي', 'كاش', 'عند الاستلام'));

  IF NOT v_is_cash AND v_service_fee_enabled THEN
    v_service_fee := ceil((v_subtotal + v_delivery_fee) / v_service_fee_chunk) * v_service_fee_per_chunk;
  ELSE
    v_service_fee := 0.0;
  END IF;

  v_total_amount := v_subtotal + v_delivery_fee + v_service_fee;

  IF v_is_cash THEN
    v_paid_now := 0.0;
    v_remaining_amount := v_total_amount;
  ELSE
    v_paid_now := v_total_amount;
    v_remaining_amount := 0.0;
  END IF;

  -- 9. Atomic Order Number Generation
  v_order_seq    := nextval('public.order_number_seq');
  v_order_number := '#' || v_order_seq::text;

  -- 10. Construct Compact Backup Payload
  v_compact_payload := jsonb_build_object(
    'order_id', v_order_number,
    'timestamp', now(),
    'order_type', p_order_type,
    'customer', jsonb_build_object(
      'full_name', p_customer_name,
      'phone_1', p_customer_phone,
      'phone_2', p_customer_phone_2,
      'payment_method', p_payment_method,
      'delivery_info', jsonb_build_object(
        'address', p_delivery_address,
        'method', p_location_method,
        'area_id', p_area_id,
        'coordinates', jsonb_build_object('lat', p_latitude, 'lon', p_longitude),
        'distance_km', round(v_distance_km::numeric, 2),
        'delivery_fee', v_delivery_fee
      )
    ),
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'delivery_fee', v_delivery_fee,
      'service_fee', v_service_fee,
      'total', v_total_amount,
      'paid_now', v_paid_now,
      'remaining', v_remaining_amount
    ),
    'items', v_validated_items
  );

  -- 11. Atomic Insert: orders
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
    trim(p_customer_name),
    trim(p_customer_phone),
    NULLIF(trim(COALESCE(p_customer_phone_2, '')), ''),
    p_order_type,
    v_total_amount,
    v_delivery_fee,
    v_service_fee,
    v_paid_now,
    v_remaining_amount,
    'pending',
    p_delivery_address,
    p_payment_method,
    p_payment_screenshot,
    p_latitude,
    p_longitude,
    v_active_shift.id,
    COALESCE(p_source, 'online'),
    v_compact_payload,
    now()
  )
  RETURNING id INTO v_new_order_id;

  -- 12. Atomic Insert: order_items
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
    (item->>'item_id')::uuid,
    (item->>'name')::text,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric,
    (item->>'total_price')::numeric
  FROM jsonb_array_elements(v_validated_items) AS item;

  -- 13. Result Construction
  v_result := jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'order_type', p_order_type,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery_fee,
    'service_fee', v_service_fee,
    'total_amount', v_total_amount,
    'paid_now', v_paid_now,
    'remaining_amount', v_remaining_amount,
    'items_count', jsonb_array_length(v_validated_items),
    'distance_km', round(v_distance_km::numeric, 2),
    'shift_id', v_active_shift.id,
    'created_at', now()
  );

  -- 14. Idempotency Finalization
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._finish_mutation(p_idempotency_key, 'create_order', 'order', v_new_order_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Permissions & Grants
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.create_order(
  text, text, text, text, text, text, text, text, text, double precision, double precision, jsonb, uuid, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public._haversine_distance_km(
  double precision, double precision, double precision, double precision
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public._get_setting(text, text) TO anon, authenticated, service_role;
