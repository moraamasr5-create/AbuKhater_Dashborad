-- ============================================================================
-- Phase 10: Feedback Schema & RPC Fix
-- 1. Add status column to feedback table if not exists
-- 2. Correct submit_feedback RPC types (id as bigint) and payload matching
-- ============================================================================

-- 1. Add status column with default 'new' for future-proofing and consistency
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS status text DEFAULT 'new';

-- 2. Re-create submit_feedback RPC matching actual table structure & Turnstile validation
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
  IF v_clean_type NOT IN ('suggestion', 'complaint', 'inquiry', 'compliment', 'other', 'مقترح', 'شكوى') THEN
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

  -- 8. Atomic Insert into feedback table
  INSERT INTO public.feedback (
    full_name,
    phone,
    type,
    message,
    status,
    created_at
  ) VALUES (
    v_clean_name,
    v_clean_phone,
    v_clean_type,
    v_clean_message,
    'new',
    now()
  )
  RETURNING id INTO v_new_id;

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
