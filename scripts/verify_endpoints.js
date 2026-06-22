import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env
const envPath = path.resolve('.env');
let supabaseUrl = '';
let supabaseKey = '';

try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const matchUrl = line.match(/^VITE_SUPABASE_URL\s*=\s*(.*)$/);
    const matchKey = line.match(/^VITE_SUPABASE_KEY\s*=\s*(.*)$/);
    if (matchUrl) supabaseUrl = matchUrl[1].trim();
    if (matchKey) supabaseKey = matchKey[1].trim();
  }
} catch (e) {
  console.error('Error reading .env:', e.message);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL or Key not found in .env!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const logPath = 'debug-1ee135.log';

function logToDebugFile(hypothesisId, location, message, data, success = true) {
  const logEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: Date.now(),
    location,
    message,
    data: { ...data, success },
    runId: 'verification_run_1',
    hypothesisId
  };
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf8');
}

async function runVerification() {
  console.log('🚀 Starting daily shift E2E endpoint verification...');
  
  // Test Shift Governance settings
  logToDebugFile('B', 'verify_endpoints.js:shift_settings', 'Reading working hours from restaurant_settings', {});
  const { data: settings, error: settingsErr } = await supabase
    .from('restaurant_settings')
    .select('key, value');
  
  if (settingsErr) {
    console.error('❌ Failed to read restaurant_settings:', settingsErr);
    logToDebugFile('B', 'verify_endpoints.js:shift_settings', 'Failed to read restaurant_settings', { error: settingsErr }, false);
  } else {
    console.log('✅ Read restaurant_settings successfully:', settings);
    logToDebugFile('B', 'verify_endpoints.js:shift_settings', 'Read restaurant_settings successfully', { settings });
  }

  // Generate a random UUID for testing the shift ID
  const testShiftId = '00000000-0000-4xxx-yxxx-000000000001'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  const testNonUuidShiftId = `SHIFT_TEST_${Date.now()}`;
  const todayStr = new Date().toISOString().split('T')[0];

  // Hypothesis A & B Test: Try to open shift with UUID
  console.log(`Trying to open shift with valid UUID: ${testShiftId} on date ${todayStr}`);
  logToDebugFile('A', 'verify_endpoints.js:open_shift', 'Calling open_shift RPC with UUID', { shiftId: testShiftId, date: todayStr });
  
  const { data: openShiftData, error: openShiftErr } = await supabase.rpc('open_shift', {
    p_id: testShiftId,
    p_date: todayStr,
    p_start_time: new Date().toISOString()
  });

  if (openShiftErr) {
    console.warn('⚠️ open_shift RPC with UUID failed or was blocked by governance time-window constraint:', openShiftErr.message);
    logToDebugFile('A', 'verify_endpoints.js:open_shift', 'open_shift RPC with UUID failed/blocked', { error: openShiftErr.message, code: openShiftErr.code }, false);
  } else {
    console.log('✅ open_shift RPC with UUID succeeded:', openShiftData);
    logToDebugFile('A', 'verify_endpoints.js:open_shift', 'open_shift RPC with UUID succeeded', { openShiftData });
  }

  // Hypothesis B Test: Try to open shift with non-UUID text
  console.log(`Trying to open shift with non-UUID: ${testNonUuidShiftId}`);
  logToDebugFile('B', 'verify_endpoints.js:open_shift_non_uuid', 'Calling open_shift RPC with non-UUID', { shiftId: testNonUuidShiftId, date: todayStr });
  
  const { data: openShiftNonUuidData, error: openShiftNonUuidErr } = await supabase.rpc('open_shift', {
    p_id: testNonUuidShiftId,
    p_date: todayStr,
    p_start_time: new Date().toISOString()
  });

  if (openShiftNonUuidErr) {
    console.log('✅ open_shift RPC with non-UUID correctly failed as expected (Hypothesis B CONFIRMED):', openShiftNonUuidErr.message);
    logToDebugFile('B', 'verify_endpoints.js:open_shift_non_uuid', 'open_shift RPC with non-UUID failed as expected', { error: openShiftNonUuidErr.message, code: openShiftNonUuidErr.code }, true);
  } else {
    console.warn('⚠️ open_shift RPC with non-UUID unexpectedly succeeded:', openShiftNonUuidData);
    logToDebugFile('B', 'verify_endpoints.js:open_shift_non_uuid', 'open_shift RPC with non-UUID succeeded unexpectedly', { openShiftNonUuidData }, false);
  }

  // Let's check menu_items endpoint
  console.log('Fetching menu_items and categories...');
  logToDebugFile('D', 'verify_endpoints.js:menu_items', 'Fetching menu_items', {});
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, price, status')
    .limit(5);

  if (menuErr) {
    console.error('❌ Failed to fetch menu_items:', menuErr);
    logToDebugFile('D', 'verify_endpoints.js:menu_items', 'Failed to fetch menu_items', { error: menuErr }, false);
  } else {
    console.log('✅ Fetched menu_items successfully:', menuItems);
    logToDebugFile('D', 'verify_endpoints.js:menu_items', 'Fetched menu_items successfully', { count: menuItems.length });
  }

  // Let's test create manual order
  const orderId = `test_order_${Date.now()}`;
  console.log(`Creating manual order: ${orderId}`);
  logToDebugFile('C', 'verify_endpoints.js:create_order', 'Creating manual test order', { orderId });

  // Use an existing shift ID in DB if the test shift open was blocked, or fallback
  const finalShiftIdForOrder = openShiftData ? openShiftData.id : null;
  console.log('Using shift ID for order:', finalShiftIdForOrder);

  const testOrderPayload = {
    customer_name: 'عميل تجريبي للتحقق',
    customer_phone: '01012345678',
    order_type: 'delivery',
    total_amount: 150,
    delivery_fee: 15,
    service_fee: 0,
    paid_now: 0,
    remaining_amount: 165,
    status: 'في التحضير', // Arabic active status
    delivery_address: 'شارع التسعين - التجمع الخامس',
    payment_method: 'Cash',
    source: 'online',
    shift_id: finalShiftIdForOrder // link to our shift
  };

  const { data: orderData, error: orderErr } = await supabase
    .from('orders')
    .insert(testOrderPayload)
    .select('*')
    .single();

  if (orderErr) {
    console.error('❌ Failed to create manual order:', orderErr.message);
    logToDebugFile('C', 'verify_endpoints.js:create_order', 'Failed to create manual order', { error: orderErr.message }, false);
  } else {
    console.log('✅ Created manual order successfully:', orderData);
    logToDebugFile('C', 'verify_endpoints.js:create_order', 'Created manual order successfully', { orderId: orderData.id });
  }

  // Test active order blocking shift close (Hypothesis C)
  if (finalShiftIdForOrder && orderData) {
    console.log(`Testing active order block on close_shift RPC with shift ID: ${finalShiftIdForOrder}`);
    logToDebugFile('C', 'verify_endpoints.js:close_shift_blocked', 'Calling close_shift with active orders', { shiftId: finalShiftIdForOrder });

    const { error: closeBlockedErr } = await supabase.rpc('close_shift', {
      p_shift_id: finalShiftIdForOrder,
      p_stats: { forceClose: false },
      p_force_close: false
    });

    if (closeBlockedErr) {
      console.log('✅ close_shift correctly failed with active orders (Hypothesis C CONFIRMED):', closeBlockedErr.message);
      logToDebugFile('C', 'verify_endpoints.js:close_shift_blocked', 'close_shift correctly failed with active orders', { error: closeBlockedErr.message }, true);
    } else {
      console.warn('⚠️ close_shift unexpectedly succeeded despite active orders!');
      logToDebugFile('C', 'verify_endpoints.js:close_shift_blocked', 'close_shift succeeded unexpectedly with active orders', {}, false);
    }

    // Now resolve/complete the order so we can close the shift safely!
    console.log(`Updating order ${orderData.id} to completed ('تم التوصيل')`);
    logToDebugFile('C', 'verify_endpoints.js:update_order_completed', 'Completing order to unblock shift close', { orderId: orderData.id });

    const { error: updateOrderErr } = await supabase
      .from('orders')
      .update({ status: 'تم التوصيل' })
      .eq('id', orderData.id);

    if (updateOrderErr) {
      console.error('❌ Failed to complete order:', updateOrderErr.message);
      logToDebugFile('C', 'verify_endpoints.js:update_order_completed', 'Failed to complete order', { error: updateOrderErr.message }, false);
    } else {
      console.log('✅ Updated order status to completed.');
      logToDebugFile('C', 'verify_endpoints.js:update_order_completed', 'Completed order successfully', {});
    }

    // Now try close_shift again!
    console.log(`Closing shift: ${finalShiftIdForOrder}`);
    logToDebugFile('A', 'verify_endpoints.js:close_shift_success', 'Calling close_shift on completed shift', { shiftId: finalShiftIdForOrder });

    const { error: closeSuccessErr } = await supabase.rpc('close_shift', {
      p_shift_id: finalShiftIdForOrder,
      p_stats: { total_orders: 1 },
      p_force_close: true // bypass any time window restrictions for this E2E test
    });

    if (closeSuccessErr) {
      console.error('❌ close_shift RPC failed:', closeSuccessErr.message);
      logToDebugFile('A', 'verify_endpoints.js:close_shift_success', 'close_shift RPC failed', { error: closeSuccessErr.message }, false);
    } else {
      console.log('✅ close_shift RPC succeeded!');
      logToDebugFile('A', 'verify_endpoints.js:close_shift_success', 'close_shift RPC succeeded', {});
    }

    // Clean up test order
    console.log('Cleaning up test order...');
    const { error: deleteOrderErr } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderData.id);
    if (deleteOrderErr) {
      console.error('Failed to delete test order:', deleteOrderErr.message);
    } else {
      console.log('Cleaned up test order successfully.');
    }
  }

  // Test Menu Availability update
  if (menuItems && menuItems.length > 0) {
    const itemToTest = menuItems[0];
    const initialStatus = itemToTest.status;
    const testNewStatus = initialStatus === 'available' ? 'unavailable' : 'available';

    console.log(`Testing Menu Availability update for item: ${itemToTest.name} (from ${initialStatus} to ${testNewStatus})`);
    logToDebugFile('D', 'verify_endpoints.js:update_menu', 'Updating menu item availability', { name: itemToTest.name, status: testNewStatus });

    const { error: menuUpdateErr } = await supabase
      .from('menu_items')
      .update({ status: testNewStatus })
      .eq('id', itemToTest.id);

    if (menuUpdateErr) {
      console.error('❌ Failed to update menu item status:', menuUpdateErr.message);
      logToDebugFile('D', 'verify_endpoints.js:update_menu', 'Failed to update menu item', { error: menuUpdateErr.message }, false);
    } else {
      console.log('✅ Menu item status updated successfully.');
      logToDebugFile('D', 'verify_endpoints.js:update_menu', 'Updated menu item successfully', {});

      // Revert status back
      await supabase
        .from('menu_items')
        .update({ status: initialStatus })
        .eq('id', itemToTest.id);
    }
  }

  // Verification finished
  console.log('🏁 Daily shift E2E verification complete. Check the debug-1ee135.log file for detailed results!');
}

runVerification().catch(e => {
  console.error('Unhandled verification error:', e);
});
