-- ============================================================================
-- Phase 3 Migration: Public-Facing Inputs Protection, Rate Limiting & RLS Hardening
-- Project: AbuKhater Restaurant Control Center & Menu App (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Purpose:
--   1. Protect public reservations via server-authoritative `submit_reservation` RPC.
--   2. Protect public feedback/complaints via server-authoritative `submit_feedback` RPC.
--   3. Enforce strict server-side validation (field lengths, formats, enums, dates, guests).
--   4. Implement native PostgreSQL rate limiting to prevent spam and abuse.
--   5. Support idempotency and duplicate prevention.
--   6. Purge insecure legacy RLS policies on `reservations` and `feedback`.
--   7. Restrict storage bucket `payment-screenshots` with size and MIME type limits.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper function for Egyptian phone normalization and validation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._validate_egyptian_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cleaned text;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN NULL;
  END IF;

  -- Remove all non-digits
  v_cleaned := regexp_replace(trim(p_phone), '[^0-9]', '', 'g');

  -- Handle international prefix (+20 or 0020 or 20)
  IF v_cleaned ~ '^0020' THEN
    v_cleaned := substr(v_cleaned, 5);
  ELSIF v_cleaned ~ '^20' AND length(v_cleaned) = 12 THEN
    v_cleaned := substr(v_cleaned, 3);
  END IF;

  -- Ensure leading 0 for 10-digit formats (e.g. 1012345678 -> 01012345678)
  IF length(v_cleaned) = 10 AND v_cleaned ~ '^[1][0125]' THEN
    v_cleaned := '0' || v_cleaned;
  END IF;

  -- Validate final 11-digit Egyptian mobile number
  IF v_cleaned !~ '^01[0125][0-9]{8}$' THEN
    RAISE EXCEPTION 'رقم الهاتف غير صحيح. يرجى إدخال رقم هاتف مصري صحيح (11 رقماً يبدأ بـ 01).'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_cleaned;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Server-Authoritative RPC: submit_reservation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_reservation(
  p_customer_name       text,
  p_customer_phone      text,
  p_reservation_date    date,
  p_reservation_time    text,
  p_guests_count        integer DEFAULT 2,
  p_location_type       text DEFAULT 'restaurant',
  p_notes               text DEFAULT NULL,
  p_payment_proof_url   text DEFAULT NULL,
  p_idempotency_key     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- 9. Validate Payment Proof URL
  v_clean_proof_url := trim(COALESCE(p_payment_proof_url, ''));
  IF v_clean_proof_url <> '' THEN
    IF length(v_clean_proof_url) > 1000 THEN
      RAISE EXCEPTION 'رابط إيصال التحويل طويل جداً.'
        USING ERRCODE = '22023';
    END IF;
    IF v_clean_proof_url !~* '^https?://' THEN
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

-- ----------------------------------------------------------------------------
-- 3. Server-Authoritative RPC: submit_feedback
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_full_name       text,
  p_phone           text,
  p_type            text DEFAULT 'suggestion',
  p_message         text DEFAULT '',
  p_idempotency_key uuid DEFAULT NULL
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
  v_new_id              bigint;
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

  -- 2. Validate & Sanitize Full Name
  v_clean_name := trim(COALESCE(p_full_name, ''));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'الاسم مطلوب ويجب أن يتكون من حرفين على الأقل.'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'الاسم طويل جداً (الحد الأقصى 100 حرف).'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Validate & Normalize Phone Number
  v_clean_phone := public._validate_egyptian_phone(p_phone);
  IF v_clean_phone IS NULL THEN
    RAISE EXCEPTION 'رقم الهاتف مطلوب لمتابعة الشكوى أو الاقتراح.'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate & Normalize Type
  v_clean_type := lower(trim(COALESCE(p_type, 'suggestion')));
  IF v_clean_type IN ('complaint', 'شكوى', 'شكوي') THEN
    v_clean_type := 'complaint';
  ELSIF v_clean_type IN ('suggestion', 'اقتراح', 'مقترح') THEN
    v_clean_type := 'suggestion';
  ELSIF v_clean_type IN ('inquiry', 'استفسار') THEN
    v_clean_type := 'inquiry';
  ELSE
    v_clean_type := 'suggestion';
  END IF;

  -- 5. Validate & Sanitize Message
  v_clean_message := trim(COALESCE(p_message, ''));
  IF length(v_clean_message) < 10 THEN
    RAISE EXCEPTION 'نص الرسالة قصير جداً (10 أحرف على الأقل مطلوب).'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_clean_message) > 1000 THEN
    RAISE EXCEPTION 'نص الرسالة طويل جداً (الحد الأقصى 1000 حرف).'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Rate Limiting: Max 3 feedbacks per phone number in the last 10 minutes
  SELECT count(*) INTO v_recent_count
  FROM public.feedback
  WHERE phone = v_clean_phone
    AND created_at > (now() - INTERVAL '10 minutes');

  IF v_recent_count >= 3 THEN
    RAISE EXCEPTION 'عفواً، لقد قمت بإرسال عدة رسائل مؤخراً. يرجى الانتظار 10 دقائق قبل إرسال رسالة جديدة.'
      USING ERRCODE = '42501';
  END IF;

  -- 7. Atomic Insert into feedback table
  INSERT INTO public.feedback (
    full_name,
    phone,
    type,
    message,
    created_at
  ) VALUES (
    v_clean_name,
    v_clean_phone,
    v_clean_type,
    v_clean_message,
    now()
  )
  RETURNING id INTO v_new_id;

  -- 8. Build Response
  v_result := jsonb_build_object(
    'success', true,
    'feedback_id', v_new_id,
    'full_name', v_clean_name,
    'phone', v_clean_phone,
    'type', v_clean_type,
    'message', v_clean_message,
    'created_at', now()
  );

  -- 9. Finalize Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._finish_mutation(p_idempotency_key, 'submit_feedback', 'feedback', v_new_id::text, v_result);
  END IF;

  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Permissions: Grant execution to anon and authenticated
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public._validate_egyptian_phone(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reservation(text, text, date, text, integer, text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_feedback(text, text, text, text, uuid) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Hardening RLS Policies on `reservations` and `feedback`
-- ----------------------------------------------------------------------------

-- A. reservations table
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Drop all legacy permissive policies
DROP POLICY IF EXISTS "Public can only insert reservations" ON public.reservations;
DROP POLICY IF EXISTS "Allow public insert for reservations" ON public.reservations;
DROP POLICY IF EXISTS "Enable insert for anon on reservations" ON public.reservations;
DROP POLICY IF EXISTS "Enable read for anon on reservations" ON public.reservations;
DROP POLICY IF EXISTS "Enable update for anon on reservations" ON public.reservations;
DROP POLICY IF EXISTS "reservations_insert_public" ON public.reservations;
DROP POLICY IF EXISTS "reservations_select_staff" ON public.reservations;
DROP POLICY IF EXISTS "reservations_update_staff" ON public.reservations;
DROP POLICY IF EXISTS "reservations_delete_admin" ON public.reservations;

-- Define strict staff policies for reservations
CREATE POLICY reservations_select_staff ON public.reservations
  FOR SELECT TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'));

CREATE POLICY reservations_update_staff ON public.reservations
  FOR UPDATE TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

CREATE POLICY reservations_delete_admin ON public.reservations
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Revoke direct table manipulation from anon
REVOKE ALL ON TABLE public.reservations FROM anon;
GRANT SELECT, UPDATE, DELETE ON TABLE public.reservations TO authenticated;

-- B. feedback table
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Drop all legacy permissive policies
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.feedback;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.feedback;
DROP POLICY IF EXISTS "Enable insert for anonymous users" ON public.feedback;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.feedback;
DROP POLICY IF EXISTS "feedback_insert_public" ON public.feedback;
DROP POLICY IF EXISTS "feedback_select_admin" ON public.feedback;
DROP POLICY IF EXISTS "feedback_delete_admin" ON public.feedback;

-- Define strict admin policies for feedback
CREATE POLICY feedback_select_admin ON public.feedback
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY feedback_delete_admin ON public.feedback
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Revoke direct table manipulation from anon
REVOKE ALL ON TABLE public.feedback FROM anon;
GRANT SELECT, DELETE ON TABLE public.feedback TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Storage Bucket Security Limits
-- ----------------------------------------------------------------------------
UPDATE storage.buckets
SET
  file_size_limit = 5242880, -- 5 MB limit
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/jpg']::text[]
WHERE name = 'payment-screenshots';
