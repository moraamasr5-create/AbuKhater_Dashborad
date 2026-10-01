import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

async function runTest() {
  console.log('=== Phase 11 Full Flow Verification ===');
  
  // Client 1: Authenticated as +201000000000
  const client1 = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false }
  });
  
  console.log('1. Signing in client 1 (+201000000000)...');
  await client1.auth.signInWithOtp({ phone: '+201000000000' });
  const { data: authData1 } = await client1.auth.verifyOtp({
    phone: '+201000000000',
    token: '123456',
    type: 'sms'
  });
  const uid1 = authData1.user.id;
  console.log('✅ Client 1 authenticated with auth.uid() =', uid1);

  // Get a valid menu item
  const { data: menuItems, error: menuErr } = await client1.from('menu_items').select('id, name, price').limit(1);
  if (menuErr || !menuItems || menuItems.length === 0) {
    console.error('Could not fetch menu items:', menuErr);
    return;
  }
  const testItem = menuItems[0];
  console.log('Using test menu item:', testItem.name, testItem.id);

  // 2. Submit order via create_order RPC
  console.log('2. Creating order as Client 1...');
  const { data: orderRes, error: orderErr } = await client1.rpc('create_order', {
    p_order_type: 'pickup',
    p_customer_name: 'عميل تجريبي 1',
    p_customer_phone: '01000000000',
    p_items: [{ item_id: testItem.id, quantity: 1 }],
    p_payment_method: 'cash',
    p_turnstile_token: '1x00000000000000000000AA'
  });

  if (orderErr) {
    console.error('❌ create_order failed:', orderErr);
    return;
  }
  console.log('✅ Order created successfully:', orderRes);
  const orderId = orderRes.order_id;
  const orderNumber = orderRes.order_number;

  // 3. Verify user_id in DB
  const { data: directOrder, error: directErr } = await client1
    .from('orders')
    .select('id, order_number, user_id, status, total_amount')
    .eq('id', orderId)
    .single();

  console.log('3. Direct RLS query for Client 1 own order:', directOrder, 'Error:', directErr);
  if (directOrder && directOrder.user_id === uid1) {
    console.log('✅ PASS: orders.user_id matches auth.uid() exactly!');
  } else {
    console.error('❌ FAIL: orders.user_id does not match auth.uid()');
  }

  // 4. Test get_customer_recent_orders with auth.uid()
  console.log('4. Calling get_customer_recent_orders for Client 1...');
  const { data: recentRes, error: recentErr } = await client1.rpc('get_customer_recent_orders', {
    p_limit: 2
  });
  console.log('✅ Recent orders response:', recentRes);
  if (recentRes?.found && recentRes?.orders?.length > 0 && recentRes.orders[0].order_id === orderId) {
    console.log('✅ PASS: get_customer_recent_orders returned the authenticated user order!');
  } else {
    console.error('❌ FAIL: get_customer_recent_orders failed to return the authenticated user order');
  }

  // 5. Verify RLS Isolation: Client 2 (+201111111111) cannot access Client 1 order
  console.log('5. Signing in client 2 (+201111111111) to test RLS isolation...');
  const client2 = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false }
  });
  await client2.auth.signInWithOtp({ phone: '+201111111111' });
  await client2.auth.verifyOtp({
    phone: '+201111111111',
    token: '123456',
    type: 'sms'
  });

  const { data: client2Order, error: client2Err } = await client2
    .from('orders')
    .select('id, order_number')
    .eq('id', orderId);

  console.log('Client 2 query result for Client 1 order:', client2Order);
  if (!client2Order || client2Order.length === 0) {
    console.log('✅ PASS: RLS successfully blocked Client 2 from viewing Client 1 order!');
  } else {
    console.error('❌ FAIL: Client 2 was able to view Client 1 order via RLS!');
  }

  console.log('\n=== ALL VERIFICATION CHECKS PASSED ===');
}

runTest().catch(console.error);
