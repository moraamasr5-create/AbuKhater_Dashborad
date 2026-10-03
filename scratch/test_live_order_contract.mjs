import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const url = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';
const supabase = createClient(url, anonKey);

async function testCreateAndReadOrder() {
  console.log('=== TEST CREATE & READ ORDER CONTRACT ===\n');

  const rpcParams = {
    p_order_type: 'delivery',
    p_customer_name: 'إختبار مزامنة الكونترات',
    p_customer_phone: '01011112233',
    p_customer_phone_2: null,
    p_delivery_address: 'شارع 15 - المطرية',
    p_payment_method: 'cash',
    p_payment_screenshot: null,
    p_location_method: 'gps',
    p_area_id: null,
    p_latitude: 30.126,
    p_longitude: 31.298,
    p_items: [
      {
        item_id: 'ade87b63-64f7-417e-93a6-5b92cd71a594', // Shawarma Chicken Canonical UUID
        name: 'شاورما فراخ (عيش سوري) + [تومية إضافية]',
        quantity: 2,
        notes: 'مستعجل'
      }
    ],
    p_idempotency_key: crypto.randomUUID(),
    p_source: 'online',
    p_turnstile_token: '1x00000000000000000000AA'
  };

  const { data: createRes, error: createErr } = await supabase.rpc('create_order', rpcParams);
  if (createErr) {
    console.error('Error creating order:', createErr);
    return;
  }
  console.log('✅ Order created in Supabase via RPC:', createRes);

  // Now fetch order using Dashboard fetch logic
  const { data: orderRow, error: fetchErr } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery:delivery_id(id, name, phone, state)')
    .eq('id', createRes.order_id)
    .single();

  if (fetchErr) {
    console.error('Error fetching created order:', fetchErr);
    return;
  }

  console.log('\n--- DASHBOARD PARSED CONTRACT VERIFICATION ---');
  console.log('Order ID:', orderRow.id);
  console.log('Customer:', orderRow.customer_name);
  console.log('Phone:', orderRow.customer_phone);
  console.log('Address:', orderRow.delivery_address);
  console.log('Total Amount:', orderRow.total_amount);
  console.log('Status:', orderRow.status);
  console.log('Order Items Count:', orderRow.order_items ? orderRow.order_items.length : 0);
  if (orderRow.order_items) {
    orderRow.order_items.forEach((i, idx) => {
      console.log(`  Item ${idx + 1}: Canonical UUID=${i.item_id} | name="${i.product_name}" | qty=${i.quantity} | unit_price=${i.unit_price} | total_price=${i.total_price}`);
    });
  }
}

testCreateAndReadOrder();
