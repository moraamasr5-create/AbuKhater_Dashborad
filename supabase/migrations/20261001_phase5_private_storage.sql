-- =========================================================
-- Phase 5: Private Storage Migration & Signed URLs
-- Bucket: payment-screenshots
-- =========================================================

-- 1. Ensure bucket is private
UPDATE storage.buckets
SET public = false
WHERE name = 'payment-screenshots';

-- 2. Drop existing public read policy
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public upload" ON storage.objects;
DROP POLICY IF EXISTS "storage_receipts_read_staff" ON storage.objects;
DROP POLICY IF EXISTS "storage_receipts_insert_public" ON storage.objects;
DROP POLICY IF EXISTS "storage_receipts_staff_all" ON storage.objects;

-- 3. Policy: Public (anon and authenticated) can upload payment screenshots
CREATE POLICY "storage_receipts_insert_public"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'payment-screenshots'
);

-- 4. Policy: Only authenticated staff (admin, casher, driver) can SELECT / read receipt objects
CREATE POLICY "storage_receipts_read_staff"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-screenshots'
  AND (
    public.has_role('admin')
    OR public.has_role('casher')
    OR public.has_role('driver')
  )
);

-- 5. Policy: Authenticated staff can update/delete receipt objects if needed
CREATE POLICY "storage_receipts_staff_all"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'payment-screenshots'
  AND (
    public.has_role('admin')
    OR public.has_role('casher')
    OR public.has_role('driver')
  )
)
WITH CHECK (
  bucket_id = 'payment-screenshots'
  AND (
    public.has_role('admin')
    OR public.has_role('casher')
    OR public.has_role('driver')
  )
);

-- 6. Update submit_reservation RPC to support relative storage paths as well as URLs
CREATE OR REPLACE FUNCTION public.submit_reservation(
  p_customer_name     text,
  p_customer_phone    text,
  p_reservation_date  date,
  p_reservation_time  text,
  p_guests_count      integer DEFAULT 2,
  p_location_type     text DEFAULT 'restaurant',
  p_notes             text DEFAULT NULL,
  p_payment_proof_url text DEFAULT NULL,
  p_idempotency_key   text DEFAULT NULL
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

  -- 2. Validate & Sanitize Customer Name
  v_clean_name := trim(COALESCE(p_customer_name, ''));
  IF length(v_clean_name) < 3 THEN
    RAISE EXCEPTION 'الاسم الكامل مطلوب ويجب أن يتكون من 3 أحرف على الأقل.'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'اسم العميل طويل جداً (الحد الأقصى 100 حرف).'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Validate & Normalize Phone Number
  v_clean_phone := public._validate_egyptian_phone(p_customer_phone);
  IF v_clean_phone IS NULL THEN
    RAISE EXCEPTION 'رقم الهاتف مطلوب لتأكيد الحجز.'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate Reservation Date
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

  -- 5. Validate & Parse Reservation Time
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

  -- 6. Validate Guests Count
  IF p_guests_count IS NULL OR p_guests_count < 1 THEN
    RAISE EXCEPTION 'عدد الضيوف يجب أن يكون فرداً واحداً على الأقل.'
      USING ERRCODE = '22023';
  END IF;
  IF p_guests_count > 50 THEN
    RAISE EXCEPTION 'الحد الأقصى لعدد الضيوف في الحجز المباشر هو 50 فرداً. للحفلات الأكبر يرجى التواصل مع إدارة المطعم مباشرة.'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Validate Location Type
  v_clean_loc_type := lower(trim(COALESCE(p_location_type, 'restaurant')));
  IF v_clean_loc_type IN ('restaurant', 'مطعم') THEN
    v_clean_loc_type := 'restaurant';
  ELSIF v_clean_loc_type IN ('cafe', 'كافيه') THEN
    v_clean_loc_type := 'cafe';
  ELSE
    v_clean_loc_type := 'restaurant';
  END IF;

  -- 8. Sanitize Notes
  v_clean_notes := trim(COALESCE(p_notes, ''));
  IF length(v_clean_notes) > 500 THEN
    v_clean_notes := substr(v_clean_notes, 1, 500);
  END IF;
  IF v_clean_notes = '' THEN
    v_clean_notes := NULL;
  END IF;

  -- 9. Validate Payment Proof URL / Path
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

  -- 10. Rate Limiting: Max 5 reservations per phone number in the last 1 hour
  SELECT count(*) INTO v_recent_res_count
  FROM public.reservations
  WHERE customer_phone = v_clean_phone
    AND created_at > (now() - INTERVAL '1 hour');

  IF v_recent_res_count >= 5 THEN
    RAISE EXCEPTION 'عفواً، لقد تجاوزت الحد الأقصى للحجوزات المسموح بها (5 حجوزات في الساعة). يرجى المحاولة لاحقاً.'
      USING ERRCODE = '42501';
  END IF;

  -- 11. Read Authoritative Deposit Amount from restaurant_settings
  SELECT value INTO v_setting_val
  FROM public.restaurant_settings
  WHERE key = 'reservation_deposit_amount'
  LIMIT 1;

  IF v_setting_val IS NOT NULL AND v_setting_val ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_deposit_amount := v_setting_val::numeric;
  END IF;

  -- 12. Generate Unique Reference Number
  v_ref_number := 'RES-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 9000 + 1000)::text, 4, '0');

  -- 13. Atomic Insert into reservations table
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

  -- 14. Build Response
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

  -- 15. Finalize Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._finish_mutation(p_idempotency_key, 'submit_reservation', 'reservation', v_new_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;
