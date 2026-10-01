BEGIN;
  -- 1. Anonymous test
  SET LOCAL ROLE anon;
  SELECT count(*) AS anon_accessible_count FROM storage.objects WHERE bucket_id = 'payment-screenshots';

  -- 2. Staff user test (admin)
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  SELECT count(*) AS staff_accessible_count FROM storage.objects WHERE bucket_id = 'payment-screenshots';

  -- 3. Non-staff user test
  SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}', true);
  SELECT count(*) AS non_staff_accessible_count FROM storage.objects WHERE bucket_id = 'payment-screenshots';
ROLLBACK;
