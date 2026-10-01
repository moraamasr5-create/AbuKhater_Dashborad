import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

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

async function runPhase7Tests() {
  console.log('================================================================');
  console.log('🧪 Starting Phase 7 Menu Availability & Telegram Security Suite');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  const testAdminUid = 'a1111111-1111-1111-1111-111111111111';
  const testAnonUid = '00000000-0000-0000-0000-000000000000';
  const testItemId = '77777777-7777-7777-7777-777777777777';
  const testCategoryId = '66666666-6666-6666-6666-666666666666';

  console.log('1. Setting up test category and test menu item in database...');
  const setupSql = `
    -- Setup test category
    INSERT INTO public.categories (id, name, slug, display_order)
    VALUES ('${testCategoryId}', 'قسم اختبار الإتاحة', 'test-category', 1)
    ON CONFLICT (id) DO UPDATE SET name = 'قسم اختبار الإتاحة';

    -- Setup test menu item
    INSERT INTO public.menu_items (id, category_id, name, description, price, status, is_popular, display_order)
    VALUES ('${testItemId}', '${testCategoryId}', 'وجبة اختبار الإتاحة', 'وجبة تجريبية للتحقق من التوفر', 120.0, 'available', false, 1)
    ON CONFLICT (id) DO UPDATE SET status = 'available', price = 120.0;

    -- Setup staff role for admin tester
    INSERT INTO auth.users (id, email) VALUES ('${testAdminUid}', 'admin@abukhater.com') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.staff_roles (user_id, email, role, display_name, is_active)
    VALUES ('${testAdminUid}', 'admin@abukhater.com', 'admin', 'Admin Tester', true)
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_active = true;

    -- Ensure an open shift exists for order creation tests
    INSERT INTO public.shifts (id, date, start_time, status, total_orders, stats)
    VALUES ('88888888-8888-8888-8888-888888888888', CURRENT_DATE, now(), 'open', 0, '{}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET status = 'open';
  `;
  runSql(setupSql);
  console.log('  ✅ Test data setup complete.');

  // TEST 1: Admin disables item (sets status to out_of_stock)
  console.log('\n--- TEST 1: Admin changes menu item status to out_of_stock ---');
  const disableSql = `
    DO $$
    DECLARE
      v_res jsonb;
      v_status text;
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      v_res := public.update_menu_item_status('${testItemId}', 'out_of_stock');

      SELECT status INTO v_status FROM public.menu_items WHERE id = '${testItemId}';
      IF v_status <> 'out_of_stock' THEN
        RAISE EXCEPTION 'Expected status out_of_stock, got %', v_status;
      END IF;

      RAISE NOTICE 'Item status successfully set to out_of_stock: %', v_res;
    END;
    $$;
  `;

  try {
    runSql(disableSql);
    console.log('  ✅ PASS: Admin successfully updated item status to out_of_stock in menu_items');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Disable item test failed:', err.message);
    failed++;
  }

  // TEST 2: Customer order rejected when containing out_of_stock item
  console.log('\n--- TEST 2: Customer create_order strictly rejected for disabled item ---');
  const rejectOrderSql = `
    DO $$
    DECLARE
      v_items jsonb := jsonb_build_array(
        jsonb_build_object('item_id', '${testItemId}', 'quantity', 1)
      );
      v_res jsonb;
    BEGIN
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

      BEGIN
        v_res := public.create_order(
          p_customer_name := 'عميل تجريبي معطل',
          p_customer_phone := '01012345678',
          p_order_type := 'pickup',
          p_items := v_items,
          p_payment_method := 'Cash'
        );
        RAISE EXCEPTION 'SECURITY FAIL: create_order should have rejected out_of_stock item!';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%غير متوفر حالياً%' THEN
          RAISE NOTICE 'Successfully rejected order for unavailable item: %', SQLERRM;
        ELSE
          RAISE;
        END IF;
      END;
    END;
    $$;
  `;

  try {
    runSql(rejectOrderSql);
    console.log('  ✅ PASS: create_order strictly rejected order with out_of_stock item');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Reject order test failed:', err.message);
    failed++;
  }

  // TEST 3: Admin re-enables item -> Customer order accepted
  console.log('\n--- TEST 3: Admin re-enables item -> create_order succeeds ---');
  const enableAndOrderSql = `
    DO $$
    DECLARE
      v_res jsonb;
      v_status text;
      v_order jsonb;
      v_items jsonb := jsonb_build_array(
        jsonb_build_object('item_id', '${testItemId}', 'quantity', 1)
      );
    BEGIN
      -- Step 1: Admin enables item
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', '{"sub":"${testAdminUid}","role":"authenticated"}', true);

      v_res := public.toggle_menu_item_availability('${testItemId}', true);

      SELECT status INTO v_status FROM public.menu_items WHERE id = '${testItemId}';
      IF v_status <> 'available' THEN
        RAISE EXCEPTION 'Expected status available, got %', v_status;
      END IF;

      -- Step 2: Customer creates order
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

      v_order := public.create_order(
        p_customer_name := 'عميل تجريبي متاح',
        p_customer_phone := '01012345678',
        p_order_type := 'pickup',
        p_items := v_items,
        p_payment_method := 'Cash',
        p_idempotency_key := gen_random_uuid()
      );

      IF (v_order->>'total_amount')::numeric <> 120.0 THEN
        RAISE EXCEPTION 'Unexpected total_amount: %', v_order->>'total_amount';
      END IF;

      RAISE NOTICE 'Order created successfully with re-enabled item: %', v_order->>'id';
    END;
    $$;
  `;

  try {
    runSql(enableAndOrderSql);
    console.log('  ✅ PASS: Item re-enabled and order placed successfully via create_order');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Enable and order test failed:', err.message);
    failed++;
  }

  // TEST 4: Anonymous caller blocked from update_menu_item_status
  console.log('\n--- TEST 4: Anonymous caller blocked from update_menu_item_status ---');
  const anonUpdateSql = `
    DO $$
    BEGIN
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

      BEGIN
        PERFORM public.update_menu_item_status('${testItemId}', 'out_of_stock');
        RAISE EXCEPTION 'SECURITY FAIL: Anon should not be allowed to update menu item status!';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Unauthorized%' OR SQLERRM LIKE '%denied%' OR SQLSTATE = '42501' THEN
          RAISE NOTICE 'Anon correctly blocked from menu update: %', SQLERRM;
        ELSE
          RAISE;
        END IF;
      END;
    END;
    $$;
  `;

  try {
    runSql(anonUpdateSql);
    console.log('  ✅ PASS: Anonymous caller strictly forbidden from modifying menu items');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Anon menu update test failed:', err.message);
    failed++;
  }

  // TEST 5: Anonymous direct execution of send_telegram_message blocked
  console.log('\n--- TEST 5: Anonymous direct execution of send_telegram_message blocked ---');
  const anonTelegramSql = `
    DO $$
    BEGIN
      PERFORM set_config('role', 'anon', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

      BEGIN
        PERFORM public.send_telegram_message('Spam attempt by anonymous user', NULL);
        RAISE EXCEPTION 'SECURITY FAIL: Anon should not have execute permissions on send_telegram_message!';
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
    runSql(anonTelegramSql);
    console.log('  ✅ PASS: send_telegram_message execution strictly revoked and denied for anon/public');
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL: Telegram security test failed:', err.message);
    failed++;
  }

  // Cleanup test data
  console.log('\n🧹 Cleaning up test records...');
  const cleanupSql = `
    DELETE FROM public.orders WHERE customer_name IN ('عميل تجريبي معطل', 'عميل تجريبي متاح');
    DELETE FROM public.menu_items WHERE id = '${testItemId}';
    DELETE FROM public.categories WHERE id = '${testCategoryId}';
    DELETE FROM public.shifts WHERE id = '88888888-8888-8888-8888-888888888888';
  `;
  runSql(cleanupSql);
  console.log('  ✅ Cleanup complete.');

  console.log('\n================================================================');
  console.log(`🎉 Phase 7 Suite Complete: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');
}

runPhase7Tests().catch(console.error);
