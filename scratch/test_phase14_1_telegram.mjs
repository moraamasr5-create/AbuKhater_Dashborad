import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_query_' + Date.now() + '_' + Math.random().toString(36).substring(7) + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function runPhase14Tests() {
  console.log('================================================================');
  console.log('🧪 Starting Phase 14.1 Telegram Foundation & Recovery Test Suite');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  const testAdminUid = 'a1111111-1111-1111-1111-111111111111';
  const testOrderId1 = '99999999-1111-1111-1111-111111111111';
  const testOrderId2 = '99999999-2222-2222-2222-222222222222';
  const testShiftId  = '99999999-8888-8888-8888-888888888888';

  console.log('1. Setting up test shift and test staff...');
  const setupSql = `
    INSERT INTO auth.users (id, email) VALUES ('${testAdminUid}', 'admin@abukhater.com') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.staff_roles (user_id, email, role, display_name, is_active)
    VALUES ('${testAdminUid}', 'admin@abukhater.com', 'admin', 'Admin Tester', true)
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_active = true;

    INSERT INTO public.shifts (id, date, start_time, status, total_orders, stats)
    VALUES ('${testShiftId}', CURRENT_DATE, now(), 'open', 0, '{}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET status = 'open';
  `;
  runSql(setupSql);
  console.log('  ✅ Setup complete.\n');

  // TEST 1: HTML Escaping Helper
  console.log('--- TEST 1: HTML Escaping Helper ---');
  const test1Sql = `
    DO $$
    DECLARE
      v_out text;
    BEGIN
      v_out := public._escape_telegram_html('Special <tags> & "quotes" _markdown_');
      IF v_out <> 'Special &lt;tags&gt; &amp; "quotes" _markdown_' THEN
        RAISE EXCEPTION 'Unexpected escaped output: %', v_out;
      END IF;
      RAISE NOTICE 'HTML escaping verified: %', v_out;
    END;
    $$;
  `;
  try {
    runSql(test1Sql);
    console.log('  ✅ PASS: _escape_telegram_html correctly escapes HTML tags & special characters');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 1 failed:', err.message);
    failed++;
  }

  // TEST 2: send_telegram_message Anon / Public execute denied
  console.log('\n--- TEST 2: Anonymous direct execution of send_telegram_message blocked ---');
  const test2Sql = `
    DO $$
    BEGIN
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

      BEGIN
        EXECUTE 'SELECT public.send_telegram_message($1::text)' USING 'Test message from anon';
        RAISE EXCEPTION 'SECURITY FAIL: Anon should not execute send_telegram_message!';
      EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '42501' OR SQLERRM LIKE '%permission denied%' THEN
          RAISE NOTICE 'send_telegram_message correctly denied to anon: %', SQLERRM;
        ELSE
          RAISE;
        END IF;
      END;
    END;
    $$;
  `;
  try {
    runSql(test2Sql);
    console.log('  ✅ PASS: send_telegram_message execution strictly revoked from anon/public');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 2 failed:', err.message);
    failed++;
  }

  // TEST 3: Cash Order Creation Trigger & Logging
  console.log('\n--- TEST 3: Cash Order Creation Trigger & Diagnostic Logging ---');
  const test3Sql = `
    DO $$
    DECLARE
      v_log public.telegram_logs%ROWTYPE;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      INSERT INTO public.orders (
        id, original_id, customer_name, customer_phone, order_type,
        total_amount, delivery_fee, status, payment_method, shift_id, created_at
      ) VALUES (
        '${testOrderId1}', '#10001', 'عميل كاش تجريبي', '01011112222', 'delivery',
        150.0, 25.0, 'pending', 'cash', '${testShiftId}', now()
      );

      SELECT * INTO v_log
      FROM public.telegram_logs
      WHERE entity_id = '${testOrderId1}' AND event_type = 'order_created'
      ORDER BY created_at DESC LIMIT 1;

      IF v_log.id IS NULL THEN
        RAISE EXCEPTION 'No telegram log generated for cash order!';
      END IF;

      RAISE NOTICE 'Cash order telegram event logged successfully: status=%', v_log.status;
    END;
    $$;
  `;
  try {
    runSql(test3Sql);
    console.log('  ✅ PASS: Cash order created and logged in telegram_logs without dropping');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 3 failed:', err.message);
    failed++;
  }

  // TEST 4: Electronic Order without Screenshot (Pending Screenshot)
  console.log('\n--- TEST 4: Electronic Order without Screenshot Trigger & Logging ---');
  const test4Sql = `
    DO $$
    DECLARE
      v_log public.telegram_logs%ROWTYPE;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      INSERT INTO public.orders (
        id, original_id, customer_name, customer_phone, order_type,
        total_amount, delivery_fee, status, payment_method, payment_screenshot, shift_id, created_at
      ) VALUES (
        '${testOrderId2}', '#10002', 'عميل إنستاباي تجريبي', '01033334444', 'delivery',
        220.0, 30.0, 'pending', 'instapay', NULL, '${testShiftId}', now()
      );

      SELECT * INTO v_log
      FROM public.telegram_logs
      WHERE entity_id = '${testOrderId2}' AND event_type = 'order_created'
      ORDER BY created_at DESC LIMIT 1;

      IF v_log.id IS NULL THEN
        RAISE EXCEPTION 'No telegram log generated for electronic order!';
      END IF;

      RAISE NOTICE 'Electronic order without screenshot logged successfully: status=%', v_log.status;
    END;
    $$;
  `;
  try {
    runSql(test4Sql);
    console.log('  ✅ PASS: Electronic order without screenshot dispatched & logged (not dropped)');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 4 failed:', err.message);
    failed++;
  }

  // TEST 5: Payment Screenshot Uploaded Later
  console.log('\n--- TEST 5: Payment Screenshot Uploaded Later Trigger & Logging ---');
  const test5Sql = `
    DO $$
    DECLARE
      v_log public.telegram_logs%ROWTYPE;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      UPDATE public.orders
      SET payment_screenshot = 'https://htpnxizfqmnnkhemvmdz.supabase.co/storage/v1/object/public/payment-screenshots/orders/proof.jpg'
      WHERE id = '${testOrderId2}';

      SELECT * INTO v_log
      FROM public.telegram_logs
      WHERE entity_id = '${testOrderId2}' AND event_type = 'order_payment_attached'
      ORDER BY created_at DESC LIMIT 1;

      IF v_log.id IS NULL THEN
        RAISE EXCEPTION 'No telegram log generated for payment screenshot upload!';
      END IF;

      RAISE NOTICE 'Payment screenshot upload event logged: status=%', v_log.status;
    END;
    $$;
  `;
  try {
    runSql(test5Sql);
    console.log('  ✅ PASS: Payment screenshot update triggered order_payment_attached event');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 5 failed:', err.message);
    failed++;
  }

  // TEST 6: Order Cancellation with cancellation_reason
  console.log('\n--- TEST 6: Order Cancellation with cancellation_reason ---');
  const test6Sql = `
    DO $$
    DECLARE
      v_log public.telegram_logs%ROWTYPE;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      UPDATE public.orders
      SET
        status = 'cancelled',
        cancellation_reason = 'العميل قام بإلغاء الطلب لتغيير العنوان'
      WHERE id = '${testOrderId1}';

      SELECT * INTO v_log
      FROM public.telegram_logs
      WHERE entity_id = '${testOrderId1}' AND event_type = 'order_cancelled'
      ORDER BY created_at DESC LIMIT 1;

      IF v_log.id IS NULL THEN
        RAISE EXCEPTION 'No telegram log generated for order cancellation!';
      END IF;

      IF v_log.payload_preview NOT LIKE '%العميل قام بإلغاء الطلب لتغيير العنوان%' THEN
        RAISE EXCEPTION 'cancellation_reason was not included in payload preview! got: %', v_log.payload_preview;
      END IF;

      RAISE NOTICE 'Order cancellation logged with reason: %', v_log.payload_preview;
    END;
    $$;
  `;
  try {
    runSql(test6Sql);
    console.log('  ✅ PASS: Order cancellation correctly read cancellation_reason and logged event');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 6 failed:', err.message);
    failed++;
  }

  // TEST 7: Order Failed Delivery
  console.log('\n--- TEST 7: Order Failed Delivery with cancellation_reason ---');
  const test7Sql = `
    DO $$
    DECLARE
      v_log public.telegram_logs%ROWTYPE;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      UPDATE public.orders
      SET
        status = 'failed_delivery',
        cancellation_reason = 'العميل لا يجيب على الهاتف عند باب العقار'
      WHERE id = '${testOrderId2}';

      SELECT * INTO v_log
      FROM public.telegram_logs
      WHERE entity_id = '${testOrderId2}' AND event_type = 'order_failed_delivery'
      ORDER BY created_at DESC LIMIT 1;

      IF v_log.id IS NULL THEN
        RAISE EXCEPTION 'No telegram log generated for failed delivery!';
      END IF;

      IF v_log.payload_preview NOT LIKE '%العميل لا يجيب على الهاتف عند باب العقار%' THEN
        RAISE EXCEPTION 'cancellation_reason was not included in failed delivery preview! got: %', v_log.payload_preview;
      END IF;

      RAISE NOTICE 'Order failed delivery logged with reason: %', v_log.payload_preview;
    END;
    $$;
  `;
  try {
    runSql(test7Sql);
    console.log('  ✅ PASS: Failed delivery correctly recognized and logged with reason');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 7 failed:', err.message);
    failed++;
  }

  // TEST 8: Table Reservation Creation via submit_reservation RPC
  console.log('\n--- TEST 8: Reservation Creation via submit_reservation RPC ---');
  const test8Sql = `
    DO $$
    DECLARE
      v_res jsonb;
      v_res_id text;
      v_log public.telegram_logs%ROWTYPE;
    BEGIN
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

      v_res := public.submit_reservation(
        p_customer_name := 'عميل حجز تجريبي',
        p_customer_phone := '01055556666',
        p_reservation_date := CURRENT_DATE + 1,
        p_reservation_time := '20:00:00',
        p_guests_count := 4,
        p_location_type := 'restaurant',
        p_notes := 'طاولة مميزة بجوار النافذة'
      );

      v_res_id := v_res->>'reservation_id';

      SELECT * INTO v_log
      FROM public.telegram_logs
      WHERE entity_id = v_res_id AND event_type = 'reservation_created'
      ORDER BY created_at DESC LIMIT 1;

      IF v_log.id IS NULL THEN
        RAISE EXCEPTION 'No telegram log generated for reservation! res=%', v_res;
      END IF;

      RAISE NOTICE 'Reservation telegram event logged: status=%', v_log.status;
    END;
    $$;
  `;
  try {
    runSql(test8Sql);
    console.log('  ✅ PASS: Reservation created via submit_reservation and logged in telegram_logs');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 8 failed:', err.message);
    failed++;
  }

  // TEST 9: Feedback / Complaint Creation via submit_feedback RPC
  console.log('\n--- TEST 9: Feedback / Complaint Creation via submit_feedback RPC ---');
  const test9Sql = `
    DO $$
    DECLARE
      v_fb jsonb;
      v_fb_id text;
      v_log public.telegram_logs%ROWTYPE;
    BEGIN
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

      v_fb := public.submit_feedback(
        p_full_name := 'عميل يقدم مقترح',
        p_phone := '01077778888',
        p_type := 'اقتراح',
        p_message := 'نرجو إضافة المزيد من الحلويات والمشروبات'
      );

      v_fb_id := v_fb->>'feedback_id';

      SELECT * INTO v_log
      FROM public.telegram_logs
      WHERE entity_id = v_fb_id AND event_type = 'feedback_created'
      ORDER BY created_at DESC LIMIT 1;

      IF v_log.id IS NULL THEN
        RAISE EXCEPTION 'No telegram log generated for feedback! fb=%', v_fb;
      END IF;

      RAISE NOTICE 'Feedback telegram event logged: status=%', v_log.status;
    END;
    $$;
  `;
  try {
    runSql(test9Sql);
    console.log('  ✅ PASS: Feedback created via submit_feedback and logged in telegram_logs');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Test 9 failed:', err.message);
    failed++;
  }

  // Cleanup test data
  console.log('\n🧹 Cleaning up test records...');
  const cleanupSql = `
    DELETE FROM public.telegram_logs WHERE entity_id IN ('${testOrderId1}', '${testOrderId2}');
    DELETE FROM public.orders WHERE id IN ('${testOrderId1}', '${testOrderId2}');
    DELETE FROM public.reservations WHERE customer_name = 'عميل حجز تجريبي';
    DELETE FROM public.feedback WHERE full_name = 'عميل يقدم مقترح';
    DELETE FROM public.shifts WHERE id = '${testShiftId}';
  `;
  runSql(cleanupSql);
  console.log('  ✅ Cleanup complete.');

  console.log('\n================================================================');
  console.log(`🎉 Phase 14.1 Suite Complete: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');
}

runPhase14Tests().catch(console.error);
