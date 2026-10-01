DO $$
DECLARE
  v_anon_count int;
  v_staff_count int;
  v_non_staff_count int;
BEGIN
  -- 1. Test Anon
  PERFORM set_config('role', 'anon', true);
  SELECT count(*) INTO v_anon_count FROM storage.objects WHERE bucket_id = 'payment-screenshots';
  
  -- 2. Test Staff (admin user a1111111-1111-1111-1111-111111111111)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  SELECT count(*) INTO v_staff_count FROM storage.objects WHERE bucket_id = 'payment-screenshots';

  -- 3. Test Non-Staff (random user)
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}', true);
  SELECT count(*) INTO v_non_staff_count FROM storage.objects WHERE bucket_id = 'payment-screenshots';

  RAISE NOTICE 'RLS Test Results: Anon=%, Staff=%, NonStaff=%', v_anon_count, v_staff_count, v_non_staff_count;
  
  IF v_anon_count <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAIL: Anon could read % objects', v_anon_count;
  END IF;
  
  IF v_staff_count = 0 THEN
    RAISE EXCEPTION 'SECURITY FAIL: Staff could not read objects';
  END IF;

  IF v_non_staff_count <> 0 THEN
    RAISE EXCEPTION 'SECURITY FAIL: Non-staff could read % objects', v_non_staff_count;
  END IF;
END;
$$;
