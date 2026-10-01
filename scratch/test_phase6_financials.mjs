import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_query_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting Phase 6 Authoritative Financials Verification Suite');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  const testAdminUid = 'a1111111-1111-1111-1111-111111111111';
  const testCasherUid = 'c2222222-2222-2222-2222-222222222222';
  const testShiftId = '99999999-9999-9999-9999-999999999999';
  const testDate = new Date().toISOString().split('T')[0];

  console.log('1. Setting up test shift and test orders in database...');
  const setupSql = `
    -- Setup test auth.users
    INSERT INTO auth.users (id, email)
    VALUES 
      ('${testAdminUid}', 'admin@abukhater.com'),
      ('${testCasherUid}', 'casher@abukhater.com')
    ON CONFLICT (id) DO NOTHING;

    -- Setup staff roles
    INSERT INTO public.staff_roles (user_id, email, role, display_name, is_active)
    VALUES ('${testAdminUid}', 'admin@abukhater.com', 'admin', 'Admin Tester', true)
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_active = true;

    INSERT INTO public.staff_roles (user_id, email, role, display_name, is_active)
    VALUES ('${testCasherUid}', 'casher@abukhater.com', 'casher', 'Cashier Tester', true)
    ON CONFLICT (user_id) DO UPDATE SET role = 'casher', is_active = true;

    -- Cleanup any existing shift with this ID
    DELETE FROM public.orders WHERE shift_id = '${testShiftId}';
    DELETE FROM public.shifts WHERE id = '${testShiftId}';

    -- Setup open shift
    INSERT INTO public.shifts (id, date, start_time, status, total_orders, stats)
    VALUES ('${testShiftId}', '${testDate}', now() - INTERVAL '4 hours', 'open', 0, '{}'::jsonb);

    -- Setup test pilot
    INSERT INTO public.delivery (id, name, phone, state, shift_started_at, total_minutes, orders_count, shift_used)
    VALUES (99901, 'طيار اختبار مالي', '01011112222', 'available', now() - INTERVAL '140 minutes', 140, 0, true)
    ON CONFLICT (id) DO UPDATE
    SET state = 'available', shift_started_at = now() - INTERVAL '140 minutes', total_minutes = 140, shift_used = true;

    -- 1. Completed Cash Delivery Order (total=200, delivery_fee=30) -> Pilot share = 15
    INSERT INTO public.orders (
      id, shift_id, delivery_id, customer_name, customer_phone, order_type, source,
      total_amount, delivery_fee, payment_method, status, created_at
    ) VALUES (
      gen_random_uuid(), '${testShiftId}', 99901, 'عميل كاش', '01000000001', 'delivery', 'manual',
      200.0, 30.0, 'Cash', 'delivered', now() - INTERVAL '3 hours'
    );

    -- 2. Completed Electronic (Vodafone Cash) Online Order (total=350, delivery_fee=40) -> Pilot share = 20
    INSERT INTO public.orders (
      id, shift_id, delivery_id, customer_name, customer_phone, order_type, source,
      total_amount, delivery_fee, payment_method, status, created_at
    ) VALUES (
      gen_random_uuid(), '${testShiftId}', 99901, 'عميل فودافون كاش', '01000000002', 'delivery', 'online',
      350.0, 40.0, 'Vodafone Cash', 'delivered', now() - INTERVAL '2 hours'
    );

    -- 3. Completed Private Trip (total=100, delivery_fee=50) -> Pilot share = 50 (100%)
    INSERT INTO public.orders (
      id, shift_id, delivery_id, customer_name, customer_phone, order_type, source,
      total_amount, delivery_fee, payment_method, status, created_at
    ) VALUES (
      gen_random_uuid(), '${testShiftId}', 99901, 'مشوار خاص', '01000000003', 'trip', 'external',
      100.0, 50.0, 'Cash', 'completed', now() - INTERVAL '1 hour'
    );

    -- 4. Failed Delivery Order (total=150, delivery_fee=30) -> Pilot share = 0
    INSERT INTO public.orders (
      id, shift_id, delivery_id, customer_name, customer_phone, order_type, source,
      total_amount, delivery_fee, payment_method, status, created_at
    ) VALUES (
      gen_random_uuid(), '${testShiftId}', 99901, 'عميل طلب فاشل', '01000000004', 'delivery', 'manual',
      150.0, 30.0, 'Cash', 'failed_delivery', now() - INTERVAL '30 minutes'
    );

    -- 5. Confirmed Reservation on this shift (deposit=100)
    INSERT INTO public.reservations (
      customer_name, customer_phone, reservation_date, reservation_time, guests_count,
      status, deposit_amount, created_at
    ) VALUES (
      'حجز اختبار مالي', '01055556666', '${testDate}', '20:00', 4,
      'confirmed', 100.0, now() - INTERVAL '2 hours'
    );
  `;

  runSql(setupSql);
  console.log('  ✅ Test data setup complete.');

  // TEST 1: Calculate Shift Stats authoritative execution
  console.log('\n--- TEST 1: Authoritative Server Calculation (calculate_shift_stats) ---');
  const calcSql = `
    DO $$
    DECLARE
      v_stats jsonb;
      v_gross numeric;
      v_cash numeric;
      v_elec numeric;
      v_pilot_fees numeric;
      v_pilot_att numeric;
      v_pilot_dues numeric;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      v_stats := public.calculate_shift_stats('${testShiftId}');

      v_gross := (v_stats->'financials'->>'grossSales')::numeric;
      v_cash := (v_stats->'financials'->>'cashTotal')::numeric;
      v_elec := (v_stats->'financials'->>'electronicTotal')::numeric;
      v_pilot_fees := (v_stats->>'totalDeliveryFees')::numeric;
      v_pilot_att := (v_stats->>'totalAttendancePay')::numeric;
      v_pilot_dues := (v_stats->>'totalPilotDues')::numeric;

      -- Assertions:
      -- Gross Sales = 200 + 350 + 100 = 650 (failed order 150 not counted in completed sales)
      IF v_gross <> 650.0 THEN
        RAISE EXCEPTION 'Gross Sales mismatch: got %, expected 650.0', v_gross;
      END IF;

      -- Cash Total = 200 (order 1) + 100 (order 3) = 300.0
      IF v_cash <> 300.0 THEN
        RAISE EXCEPTION 'Cash Total mismatch: got %, expected 300.0', v_cash;
      END IF;

      -- Electronic Total = 350.0 (order 2)
      IF v_elec <> 350.0 THEN
        RAISE EXCEPTION 'Electronic Total mismatch: got %, expected 350.0', v_elec;
      END IF;

      -- Pilot Share:
      -- Order 1: 30 / 2 = 15
      -- Order 2: 40 / 2 = 20
      -- Order 3 (trip): 50 (100%) = 50
      -- Order 4 (failed): 0
      -- Total Pilot Fee = 15 + 20 + 50 = 85.0
      IF v_pilot_fees <> 85.0 THEN
        RAISE EXCEPTION 'Pilot Fees mismatch: got %, expected 85.0', v_pilot_fees;
      END IF;

      -- Attendance Pay for 140 minutes: floor(140 / 35) * 15 = 4 * 15 = 60.0
      IF v_pilot_att <> 60.0 THEN
        RAISE EXCEPTION 'Attendance Pay mismatch: got %, expected 60.0', v_pilot_att;
      END IF;

      -- Total Pilot Dues = 85 + 60 = 145.0
      IF v_pilot_dues <> 145.0 THEN
        RAISE EXCEPTION 'Total Pilot Dues mismatch: got %, expected 145.0', v_pilot_dues;
      END IF;

      RAISE NOTICE 'Calculations Verified Successfully: Gross=%, Cash=%, Elec=%, PilotDues=%', v_gross, v_cash, v_elec, v_pilot_dues;
    END;
    $$;
  `;

  try {
    runSql(calcSql);
    console.log('  ✅ PASS: calculate_shift_stats correctly computed all cash, electronic, pilot fees, attendance, and dues');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: calculate_shift_stats assertion failed:', err.message);
    failed++;
  }

  // TEST 2: Active orders block close_shift
  console.log('\n--- TEST 2: Active orders block close_shift ---');
  const activeOrderSql = `
    INSERT INTO public.orders (
      id, shift_id, customer_name, customer_phone, order_type, source,
      total_amount, delivery_fee, payment_method, status, created_at
    ) VALUES (
      gen_random_uuid(), '${testShiftId}', 'طلب نشط معلق', '01099998888', 'delivery', 'manual',
      120.0, 20.0, 'Cash', 'active', now()
    );
  `;
  runSql(activeOrderSql);

  const activeCheckSql = `
    DO $$
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);
      
      BEGIN
        PERFORM public.close_shift('${testShiftId}', NULL, true);
        RAISE EXCEPTION 'SECURITY FAIL: close_shift should have failed due to active order';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Active orders exist%' THEN
          RAISE NOTICE 'Successfully blocked close_shift with active orders';
        ELSE
          RAISE;
        END IF;
      END;
    END;
    $$;
  `;

  try {
    runSql(activeCheckSql);
    console.log('  ✅ PASS: close_shift strictly blocked when active orders exist');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Active orders check failed:', err.message);
    failed++;
  }

  // Clean up the active order so we can test closing
  runSql(`DELETE FROM public.orders WHERE shift_id = '${testShiftId}' AND status = 'active';`);

  // TEST 3: Client tampering with p_stats is completely ignored by close_shift
  console.log('\n--- TEST 3: Client tampering with p_stats is ignored (Server Authority) ---');
  const fakeStatsSql = `
    DO $$
    DECLARE
      v_res jsonb;
      v_saved_stats jsonb;
      v_gross numeric;
      v_pilot_dues numeric;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      -- Client attempts to send fake stats (Gross: 10 EGP, Pilot dues: 0 EGP)
      v_res := public.close_shift(
        '${testShiftId}',
        '{"ordersCount": 999, "totalPilotDues": 0, "financials": {"grossSales": 10.0}}'::jsonb,
        true -- force close as admin
      );

      -- Read saved stats from shifts table
      SELECT stats INTO v_saved_stats FROM public.shifts WHERE id = '${testShiftId}';

      v_gross := (v_saved_stats->'financials'->>'grossSales')::numeric;
      v_pilot_dues := (v_saved_stats->>'totalPilotDues')::numeric;

      -- Verify server overwrote the fake values with genuine DB calculations
      IF v_gross <> 650.0 THEN
        RAISE EXCEPTION 'Server accepted fake grossSales! Got %, expected 650.0', v_gross;
      END IF;

      IF v_pilot_dues <> 145.0 THEN
        RAISE EXCEPTION 'Server accepted fake pilot dues! Got %, expected 145.0', v_pilot_dues;
      END IF;

      RAISE NOTICE 'Tamper Protection Verified: Fake client stats were replaced by genuine server calculation';
    END;
    $$;
  `;

  try {
    runSql(fakeStatsSql);
    console.log('  ✅ PASS: Server-side authority verified: Client-sent fake totals were ignored and replaced by authoritative DB calculations');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Tamper protection failed:', err.message);
    failed++;
  }

  // TEST 4: Idempotent duplicate close
  console.log('\n--- TEST 4: Idempotent duplicate close ---');
  const duplicateCloseSql = `
    DO $$
    DECLARE
      v_res jsonb;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      -- Second close on already closed shift
      v_res := public.close_shift('${testShiftId}', NULL, true);

      IF v_res IS NULL THEN
        RAISE EXCEPTION 'Duplicate close returned NULL';
      END IF;

      RAISE NOTICE 'Duplicate close handled gracefully and returned existing stats';
    END;
    $$;
  `;

  try {
    runSql(duplicateCloseSql);
    console.log('  ✅ PASS: Duplicate close on closed shift handled idempotently without error or corruption');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Duplicate close check failed:', err.message);
    failed++;
  }

  // TEST 5: Non-admin caller blocked from force close
  console.log('\n--- TEST 5: Non-admin caller blocked from force close ---');
  const nonAdminForceSql = `
    DO $$
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testCasherUid}","role":"authenticated"}', true);

      BEGIN
        PERFORM public.close_shift('${testShiftId}', NULL, true);
        RAISE EXCEPTION 'SECURITY FAIL: Cashier should not be allowed to force close';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Only Administrators can force close%' THEN
          RAISE NOTICE 'Cashier correctly denied force close permission';
        ELSE
          RAISE;
        END IF;
      END;
    END;
    $$;
  `;

  try {
    runSql(nonAdminForceSql);
    console.log('  ✅ PASS: Cashier correctly blocked from force close');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Non-admin force close test failed:', err.message);
    failed++;
  }

  // Cleanup test data
  console.log('\n🧹 Cleaning up test records...');
  const cleanupSql = `
    DELETE FROM public.orders WHERE shift_id = '${testShiftId}';
    DELETE FROM public.reservations WHERE customer_phone = '01055556666';
    DELETE FROM public.shifts WHERE id = '${testShiftId}';
    DELETE FROM public.delivery WHERE id = 99901;
  `;
  runSql(cleanupSql);
  console.log('  ✅ Cleanup complete.');

  console.log('\n================================================================');
  console.log(`🎉 Phase 6 Suite Complete: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');
}

runTests().catch(console.error);
