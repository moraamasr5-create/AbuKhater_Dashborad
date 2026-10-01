import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

const anonClient = createClient(SUPABASE_URL, ANON_KEY);

function runSql(sql) {
  const tmpFile = 'scratch/tmp_audit_flow_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function runComprehensiveAudit() {
  console.log('================================================================');
  console.log('🔍 Comprehensive Multi-Flow Production Audit & Verification');
  console.log('================================================================\n');

  let results = {
    pass: 0,
    warn: 0,
    fail: 0
  };

  // -------------------------------------------------------------
  // 1. SECURITY & ACCESS CONTROL
  // -------------------------------------------------------------
  console.log('--- SECTION 1: SECURITY & ACCESS CONTROL ---');

  // Test 1.1: Anon calling staff-only RPC toggle_menu_item_availability
  const { data: d1, error: e1 } = await anonClient.rpc('toggle_menu_item_availability', {
    p_item_id: '00000000-0000-0000-0000-000000000000',
    p_is_available: false
  });
  if (e1 && (e1.message.includes('Authentication required') || e1.message.includes('Unauthorized') || e1.code === '42501')) {
    console.log('  🟢 PASS: Anon blocked from staff RPC toggle_menu_item_availability');
    results.pass++;
  } else {
    console.log('  🔴 FAIL: Anon allowed to toggle menu availability!', e1, d1);
    results.fail++;
  }

  // Test 1.2: Anon calling staff-only RPC create_manual_order
  const { data: d2, error: e2 } = await anonClient.rpc('create_manual_order', {
    p_order_type: 'dine_in',
    p_items: []
  });
  if (e2 && (e2.message.includes('permission denied') || e2.message.includes('Unauthorized') || e2.code === '42501')) {
    console.log('  🟢 PASS: Anon blocked from staff RPC create_manual_order');
    results.pass++;
  } else {
    console.log('  🔴 FAIL: Anon allowed to call create_manual_order!', e2, d2);
    results.fail++;
  }

  // Test 1.3: Anon calling staff-only RPC close_shift
  const { data: d3, error: e3 } = await anonClient.rpc('close_shift', {
    p_shift_id: 'test'
  });
  if (e3 && (e3.message.includes('Unauthorized') || e3.message.includes('permission denied') || e3.message.includes('Authentication required') || e3.code === '42501')) {
    console.log('  🟢 PASS: Anon blocked from staff RPC close_shift');
    results.pass++;
  } else {
    console.log('  🔴 FAIL: Anon allowed to call close_shift!', e3, d3);
    results.fail++;
  }

  // Test 1.4: Direct send_telegram_message RPC execution
  const { data: d4, error: e4 } = await anonClient.rpc('send_telegram_message', {
    p_text: 'hacked'
  });
  if (e4 && (e4.message.includes('permission denied') || e4.code === '42501' || e4.code === 'PGRST202')) {
    console.log('  🟢 PASS: Direct anon execute on send_telegram_message is revoked/blocked');
    results.pass++;
  } else {
    console.log('  🔴 FAIL: Anon can call send_telegram_message directly!', e4, d4);
    results.fail++;
  }

  // Test 1.5: Direct anonymous SELECT on private buckets
  const { data: d5, error: e5 } = await anonClient.storage.from('payment-screenshots').list('receipts');
  if (e5 || !d5 || d5.length === 0) {
    console.log('  🟢 PASS: Direct anonymous list on private bucket payment-screenshots is blocked/empty');
    results.pass++;
  } else {
    console.log('  🟡 WARN: Anonymous storage list returned items:', d5);
    results.warn++;
  }

  // -------------------------------------------------------------
  // 2. CUSTOMER FLOW & DATA INTEGRITY
  // -------------------------------------------------------------
  console.log('\n--- SECTION 2: CUSTOMER FLOW & DATA INTEGRITY ---');

  // Find a valid menu item
  const { data: menuItems, error: menuErr } = await anonClient
    .from('menu_items')
    .select('id, name, price, status')
    .eq('status', 'available')
    .limit(1);

  if (!menuItems || menuItems.length === 0) {
    console.log('  🟡 WARN: No available menu items found to test order flow');
    results.warn++;
  } else {
    const item = menuItems[0];
    const originalPrice = parseFloat(item.price);
    const fakePrice = 0.01;
    const testIdempotencyKey = '88888888-8888-8888-8888-888888888888';

    // Cleanup previous test idempotency
    runSql(`DELETE FROM public.applied_mutations WHERE client_mutation_id = '${testIdempotencyKey}';`);

    // Test 2.1: Fake price submission -> Server must calculate genuine total
    const { data: orderRes, error: orderErr } = await anonClient.rpc('create_order', {
      p_customer_name: 'Audit Customer',
      p_customer_phone: '01012345678',
      p_order_type: 'pickup',
      p_payment_method: 'Cash',
      p_items: [{
        item_id: item.id,
        quantity: 2,
        price: fakePrice // Tampered client price!
      }],
      p_idempotency_key: testIdempotencyKey
    });

    if (orderErr) {
      console.log('  🔴 FAIL: create_order failed:', orderErr.message);
      results.fail++;
    } else {
      const expectedSubtotal = originalPrice * 2;
      const actualSubtotal = parseFloat(orderRes.subtotal);
      if (Math.abs(actualSubtotal - expectedSubtotal) < 0.01) {
        console.log(`  🟢 PASS: Server ignored fake price (${fakePrice}) and enforced authentic price (${originalPrice} * 2 = ${expectedSubtotal})`);
        results.pass++;
      } else {
        console.log(`  🔴 FAIL: Server accepted tampered price! Subtotal = ${actualSubtotal}, expected = ${expectedSubtotal}`);
        results.fail++;
      }

      // Test 2.2: Idempotency protection with same key
      const { data: dupRes, error: dupErr } = await anonClient.rpc('create_order', {
        p_customer_name: 'Audit Customer',
        p_customer_phone: '01012345678',
        p_order_type: 'pickup',
        p_payment_method: 'Cash',
        p_items: [{
          item_id: item.id,
          quantity: 2,
          price: fakePrice
        }],
        p_idempotency_key: testIdempotencyKey
      });

      if (!dupErr && dupRes && dupRes.order_id === orderRes.order_id) {
        console.log('  🟢 PASS: Duplicate submission returned original order idempotently without duplicate insert');
        results.pass++;
      } else {
        console.log('  🔴 FAIL: Idempotency failed on duplicate submission:', dupErr, dupRes);
        results.fail++;
      }

      // Test 2.3: Order tracking with matching phone vs wrong phone
      const { data: trackOk, error: trackOkErr } = await anonClient.rpc('get_customer_order_tracking', {
        p_order_id: orderRes.order_id,
        p_customer_phone: '01012345678'
      });
      if (!trackOkErr && trackOk && trackOk.order_id === orderRes.order_id) {
        console.log('  🟢 PASS: Order tracking succeeded with matching phone number');
        results.pass++;
      } else {
        console.log('  🔴 FAIL: Order tracking failed for matching phone:', trackOkErr);
        results.fail++;
      }

      const { data: trackBad, error: trackBadErr } = await anonClient.rpc('get_customer_order_tracking', {
        p_order_id: orderRes.order_id,
        p_customer_phone: '01099999999' // Wrong phone
      });
      if (trackBadErr && trackBadErr.message.includes('Order not found')) {
        console.log('  🟢 PASS: Order tracking properly blocked for non-matching phone number');
        results.pass++;
      } else {
        console.log('  🔴 FAIL: Order tracking allowed unauthorized phone!', trackBad, trackBadErr);
        results.fail++;
      }

      // Clean up test order
      runSql(`
        DELETE FROM public.order_items WHERE order_id = '${orderRes.order_id}';
        DELETE FROM public.orders WHERE id = '${orderRes.order_id}';
        DELETE FROM public.applied_mutations WHERE client_mutation_id = '${testIdempotencyKey}';
      `);
    }

    // Test 2.4: Non-existent item rejection
    const { data: badItemRes, error: badItemErr } = await anonClient.rpc('create_order', {
      p_customer_name: 'Audit Customer',
      p_customer_phone: '01012345678',
      p_order_type: 'pickup',
      p_payment_method: 'Cash',
      p_items: [{
        item_id: '00000000-0000-0000-0000-000000000000',
        quantity: 1,
        price: 100
      }],
      p_idempotency_key: '77777777-7777-7777-7777-777777777777'
    });
    if (badItemErr && (badItemErr.message.includes('not found') || badItemErr.message.includes('unavailable') || badItemErr.message.includes('غير موجود'))) {
      console.log('  🟢 PASS: Non-existent menu item rejected by create_order');
      results.pass++;
    } else {
      console.log('  🔴 FAIL: Non-existent menu item accepted!', badItemRes, badItemErr);
      results.fail++;
    }
  }

  // -------------------------------------------------------------
  // 3. REALTIME REPLICATION AUDIT
  // -------------------------------------------------------------
  console.log('\n--- SECTION 3: REALTIME PUBLICATION AUDIT ---');
  const realtimeSql = `
    SELECT schemaname, tablename 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime'
    ORDER BY tablename;
  `;
  const realtimeTables = runSql(realtimeSql);
  if (realtimeTables.includes('orders') && realtimeTables.includes('menu_availability')) {
    console.log('  🟢 PASS: Core operational tables are included in supabase_realtime publication');
    results.pass++;
  } else {
    console.log('  🟡 WARN: Realtime tables missing expected items');
    results.warn++;
  }

  // -------------------------------------------------------------
  // 4. FINANCIAL INTEGRITY AUDIT
  // -------------------------------------------------------------
  console.log('\n--- SECTION 4: FINANCIAL ENGINE INTEGRITY ---');
  try {
    const finOut = execSync('node scratch/test_phase6_financials.mjs', { encoding: 'utf-8' });
    if (finOut.includes('5 PASSED, 0 FAILED')) {
      console.log('  🟢 PASS: Phase 6 Authoritative Financials Suite verified (5/5 tests passed)');
      results.pass++;
    } else {
      console.log('  🔴 FAIL: Financial suite reported errors:\n', finOut);
      results.fail++;
    }
  } catch (e) {
    console.log('  🔴 FAIL: Financial suite exception:', e.message);
    results.fail++;
  }

  console.log('\n================================================================');
  console.log(`📊 Audit Verification Complete: ${results.pass} PASSED, ${results.warn} WARNINGS, ${results.fail} FAILURES`);
  console.log('================================================================');
}

runComprehensiveAudit().catch(console.error);
