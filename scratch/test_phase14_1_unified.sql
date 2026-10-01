DO $$
DECLARE
  testAdminUid text := 'a1111111-1111-1111-1111-111111111111';
  testOrderId1 uuid := gen_random_uuid();
  testOrderId2 uuid := gen_random_uuid();
  testShiftId  text := '99999999-8888-8888-8888-888888888888';
  v_out        text;
  v_log        public.telegram_logs%ROWTYPE;
  v_res        jsonb;
  v_res_id     text;
  v_fb         jsonb;
  v_fb_id      text;
  passed_count integer := 0;
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE '🧪 Phase 14.1 Telegram Foundation Unified SQL Verification Suite';
  RAISE NOTICE '================================================================';

  -- Clean any lingering artifacts
  DELETE FROM public.orders WHERE id IN ('99999999-1111-1111-1111-111111111111'::uuid, '99999999-2222-2222-2222-222222222222'::uuid);

  -- Setup
  INSERT INTO auth.users (id, email) VALUES (testAdminUid::uuid, 'admin@abukhater.com') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.staff_roles (user_id, email, role, display_name, is_active)
  VALUES (testAdminUid::uuid, 'admin@abukhater.com', 'admin', 'Admin Tester', true)
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_active = true;

  INSERT INTO public.shifts (id, date, start_time, status, total_orders, stats)
  VALUES (testShiftId, CURRENT_DATE, now(), 'open', 0, '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET status = 'open';

  -- TEST 1: HTML Escaping Helper
  v_out := public._escape_telegram_html('Special <tags> & "quotes" _markdown_');
  IF v_out = 'Special &lt;tags&gt; &amp; "quotes" _markdown_' THEN
    RAISE NOTICE '✅ TEST 1 PASSED: _escape_telegram_html correctly escaped HTML entities.';
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 1 FAILED: Expected escaped output, got: %', v_out;
  END IF;

  -- TEST 2: send_telegram_message Anon / Public execute denied
  BEGIN
    PERFORM set_config('role', 'anon', true);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SELECT public.send_telegram_message($1::text)' USING 'Anon spam attempt';
    RAISE EXCEPTION '❌ TEST 2 FAILED: Anon was able to execute send_telegram_message directly!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' OR SQLERRM LIKE '%permission denied%' THEN
      RAISE NOTICE '✅ TEST 2 PASSED: Direct anon execute on send_telegram_message strictly denied (42501).';
      passed_count := passed_count + 1;
    ELSE
      RAISE EXCEPTION '❌ TEST 2 FAILED with unexpected error: %', SQLERRM;
    END IF;
  END;

  -- Reset role to authenticated staff
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', ('{"sub":"' || testAdminUid || '","role":"authenticated"}'), true);

  -- TEST 3: Cash Order Creation Trigger & Logging
  INSERT INTO public.orders (
    id, original_id, customer_name, customer_phone, order_type,
    total_amount, delivery_fee, status, payment_method, shift_id, created_at
  ) VALUES (
    testOrderId1, '#10001', 'عميل كاش تجريبي', '01011112222', 'delivery',
    150.0, 25.0, 'pending', 'cash', testShiftId, now()
  );

  SELECT * INTO v_log
  FROM public.telegram_logs
  WHERE entity_id = testOrderId1::text AND event_type = 'order_created'
  ORDER BY created_at DESC LIMIT 1;

  IF v_log.id IS NOT NULL AND v_log.payload_preview LIKE '%طلب جديد #10001%' THEN
    RAISE NOTICE '✅ TEST 3 PASSED: Cash order created and logged in telegram_logs (status=%).', v_log.status;
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 3 FAILED: No valid telegram log found for cash order!';
  END IF;

  -- TEST 4: Electronic Order without Screenshot (Pending Screenshot)
  INSERT INTO public.orders (
    id, original_id, customer_name, customer_phone, order_type,
    total_amount, delivery_fee, status, payment_method, payment_screenshot, shift_id, created_at
  ) VALUES (
    testOrderId2, '#10002', 'عميل إنستاباي تجريبي', '01033334444', 'delivery',
    220.0, 30.0, 'pending', 'instapay', NULL, testShiftId, now()
  );

  SELECT * INTO v_log
  FROM public.telegram_logs
  WHERE entity_id = testOrderId2::text AND event_type = 'order_created'
  ORDER BY created_at DESC LIMIT 1;

  IF v_log.id IS NOT NULL AND v_log.payload_preview LIKE '%بانتظار إرفاق الإيصال%' THEN
    RAISE NOTICE '✅ TEST 4 PASSED: Electronic order without screenshot dispatched & logged (not dropped).';
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 4 FAILED: Electronic order without screenshot was dropped or not logged!';
  END IF;

  -- TEST 5: Payment Screenshot Uploaded Later
  UPDATE public.orders
  SET payment_screenshot = 'https://htpnxizfqmnnkhemvmdz.supabase.co/storage/v1/object/public/payment-screenshots/orders/proof.jpg'
  WHERE id = testOrderId2;

  SELECT * INTO v_log
  FROM public.telegram_logs
  WHERE entity_id = testOrderId2::text AND event_type = 'order_payment_attached'
  ORDER BY created_at DESC LIMIT 1;

  IF v_log.id IS NOT NULL AND v_log.payload_preview LIKE '%تم إرفاق إيصال الدفع%' THEN
    RAISE NOTICE '✅ TEST 5 PASSED: Payment screenshot update triggered order_payment_attached event.';
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 5 FAILED: Payment screenshot update did not trigger order_payment_attached!';
  END IF;

  -- TEST 6: Order Cancellation with cancellation_reason
  UPDATE public.orders
  SET
    status = 'cancelled',
    cancellation_reason = 'العميل قام بإلغاء الطلب لتغيير العنوان'
  WHERE id = testOrderId1;

  SELECT * INTO v_log
  FROM public.telegram_logs
  WHERE entity_id = testOrderId1::text AND event_type = 'order_cancelled'
  ORDER BY created_at DESC LIMIT 1;

  IF v_log.id IS NOT NULL AND v_log.payload_preview LIKE '%العميل قام بإلغاء الطلب لتغيير العنوان%' THEN
    RAISE NOTICE '✅ TEST 6 PASSED: Order cancellation correctly read cancellation_reason and logged event.';
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 6 FAILED: cancellation_reason missing from preview! got: %', v_log.payload_preview;
  END IF;

  -- TEST 7: Order Failed Delivery with cancellation_reason
  UPDATE public.orders
  SET
    status = 'failed_delivery',
    cancellation_reason = 'العميل لا يجيب على الهاتف عند باب العقار'
  WHERE id = testOrderId2;

  SELECT * INTO v_log
  FROM public.telegram_logs
  WHERE entity_id = testOrderId2::text AND event_type = 'order_failed_delivery'
  ORDER BY created_at DESC LIMIT 1;

  IF v_log.id IS NOT NULL AND v_log.payload_preview LIKE '%العميل لا يجيب على الهاتف عند باب العقار%' THEN
    RAISE NOTICE '✅ TEST 7 PASSED: Failed delivery correctly recognized and logged with reason.';
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 7 FAILED: failed delivery reason missing! got: %', v_log.payload_preview;
  END IF;

  -- TEST 8: Reservation Creation via submit_reservation
  v_res := public.submit_reservation(
    p_customer_name := 'عميل حجز تجريبي'::text,
    p_customer_phone := '01055556666'::text,
    p_reservation_date := (CURRENT_DATE + 1)::date,
    p_reservation_time := '20:00:00'::text,
    p_guests_count := 4::integer,
    p_location_type := 'restaurant'::text,
    p_notes := 'طاولة مميزة بجوار النافذة'::text,
    p_payment_proof_url := NULL::text,
    p_idempotency_key := NULL::uuid,
    p_turnstile_token := '1x00000000000000000000AA'::text
  );

  v_res_id := v_res->>'reservation_id';

  SELECT * INTO v_log
  FROM public.telegram_logs
  WHERE entity_id = v_res_id AND event_type = 'reservation_created'
  ORDER BY created_at DESC LIMIT 1;

  IF v_log.id IS NOT NULL AND v_log.payload_preview LIKE '%حجز طاولة جديد%' THEN
    RAISE NOTICE '✅ TEST 8 PASSED: Reservation created via submit_reservation and logged in telegram_logs.';
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 8 FAILED: Reservation telegram event not logged!';
  END IF;

  -- TEST 9: Feedback Creation via submit_feedback
  v_fb := public.submit_feedback(
    p_full_name := 'عميل يقدم مقترح'::text,
    p_phone := '01077778888'::text,
    p_type := 'اقتراح'::text,
    p_message := 'نرجو إضافة المزيد من الحلويات والمشروبات'::text,
    p_idempotency_key := NULL::uuid,
    p_turnstile_token := '1x00000000000000000000AA'::text
  );

  v_fb_id := v_fb->>'feedback_id';

  SELECT * INTO v_log
  FROM public.telegram_logs
  WHERE entity_id = v_fb_id AND event_type = 'feedback_created'
  ORDER BY created_at DESC LIMIT 1;

  IF v_log.id IS NOT NULL AND v_log.payload_preview LIKE '%اقتراح / رأي%' THEN
    RAISE NOTICE '✅ TEST 9 PASSED: Feedback created via submit_feedback and logged in telegram_logs.';
    passed_count := passed_count + 1;
  ELSE
    RAISE EXCEPTION '❌ TEST 9 FAILED: Feedback telegram event not logged!';
  END IF;

  -- Cleanup
  DELETE FROM public.telegram_logs WHERE entity_id IN (testOrderId1::text, testOrderId2::text, v_res_id, v_fb_id);
  DELETE FROM public.orders WHERE id IN (testOrderId1, testOrderId2);
  DELETE FROM public.reservations WHERE id = v_res_id::bigint;
  DELETE FROM public.feedback WHERE id = v_fb_id::bigint;
  DELETE FROM public.shifts WHERE id = testShiftId;

  RAISE NOTICE '================================================================';
  RAISE NOTICE '🎉 ALL 9 VERIFICATION TESTS PASSED SUCCESSFULLY! (9/9)';
  RAISE NOTICE '================================================================';
END;
$$;
