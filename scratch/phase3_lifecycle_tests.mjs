import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const url = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';
const supabase = createClient(url, anonKey);

async function runPhase3Verification() {
  console.log('=== PHASE 3: OPERATIONAL LIFECYCLE & FLOW VERIFICATION ===\n');

  // ============================================================
  // TEST 1: DELIVERY LIFECYCLE FLOW
  // ============================================================
  console.log('--- TEST 1: DELIVERY LIFECYCLE FLOW ---');

  // Step 1: Create Delivery Order via create_order RPC
  const deliveryIdempotencyKey = crypto.randomUUID();
  const deliveryOrderPayload = {
    p_order_type: 'delivery',
    p_customer_name: 'إختبار تتبع التوصيل',
    p_customer_phone: '01099998877',
    p_customer_phone_2: null,
    p_delivery_address: 'شارع التحرير - المطرية',
    p_payment_method: 'cash',
    p_payment_screenshot: null,
    p_location_method: 'gps',
    p_area_id: null,
    p_latitude: 30.126,
    p_longitude: 31.298,
    p_items: [
      {
        item_id: 'ade87b63-64f7-417e-93a6-5b92cd71a594', // Shawarma Chicken Canonical UUID
        name: 'شاورما فراخ (كيزر)',
        quantity: 1,
        notes: null
      }
    ],
    p_idempotency_key: deliveryIdempotencyKey,
    p_source: 'online',
    p_turnstile_token: '1x00000000000000000000AA'
  };

  const { data: createDelivRes, error: errDelivCreate } = await supabase.rpc('create_order', deliveryOrderPayload);
  if (errDelivCreate) {
    console.error('❌ Delivery Order Creation Failed:', errDelivCreate);
    return;
  }
  const orderId = createDelivRes.order_id;
  console.log(`Step 1 [created]: Order ID=${orderId} (#${createDelivRes.order_number}) | Initial Status=${createDelivRes.status}`);

  // Step 2: Transition to 'preparing' via transition_order_status RPC
  const { data: prepRes, error: errPrep } = await supabase.rpc('transition_order_status', {
    p_order_id: orderId,
    p_target_status: 'preparing',
    p_reason: 'تأكيد وتحضير الطلب',
    p_mutation_id: crypto.randomUUID()
  });
  console.log(`Step 2 [preparing]: Transition Result=`, prepRes || errPrep);

  // Step 3: Transition to 'ready' via transition_order_status RPC
  const { data: readyRes, error: errReady } = await supabase.rpc('transition_order_status', {
    p_order_id: orderId,
    p_target_status: 'ready',
    p_reason: 'الطلب جاهز للمطبخ',
    p_mutation_id: crypto.randomUUID()
  });
  console.log(`Step 3 [ready]: Transition Result=`, readyRes || errReady);

  // Step 4: Driver Assignment via assign_order_to_pilot RPC
  // First fetch active delivery drivers
  const { data: drivers } = await supabase.from('delivery').select('id, name, state').limit(1);
  let testDriver = drivers && drivers.length > 0 ? drivers[0] : { id: 1, name: 'طيار تجريبي' };

  const { data: assignRes, error: errAssign } = await supabase.rpc('assign_order_to_pilot', {
    p_order_id: orderId,
    p_pilot_id: testDriver.id,
    p_pilot_name: testDriver.name,
    p_mutation_id: crypto.randomUUID()
  });
  console.log(`Step 4 [driver_assigned]: Driver Assigned [${testDriver.id}: ${testDriver.name}] Result=`, assignRes || errAssign);

  // Step 5: Start Pilot Trip via start_pilot_trip RPC
  const { data: tripRes, error: errTrip } = await supabase.rpc('start_pilot_trip', {
    p_order_id: orderId,
    p_mutation_id: crypto.randomUUID()
  });
  console.log(`Step 5 [out_for_delivery]: Trip Started Result=`, tripRes || errTrip);

  // Step 6: Complete Order Delivery via complete_order_delivery RPC
  const { data: completeRes, error: errComplete } = await supabase.rpc('complete_order_delivery', {
    p_order_id: orderId,
    p_mutation_id: crypto.randomUUID()
  });
  console.log(`Step 6 [delivered]: Delivery Completed Result=`, completeRes || errComplete);


  // ============================================================
  // TEST 2: PICKUP LIFECYCLE FLOW
  // ============================================================
  console.log('\n--- TEST 2: PICKUP LIFECYCLE FLOW ---');

  const pickupIdempotencyKey = crypto.randomUUID();
  const pickupOrderPayload = {
    p_order_type: 'pickup',
    p_customer_name: 'إختبار تتبع الاستلام',
    p_customer_phone: '01055554433',
    p_customer_phone_2: null,
    p_delivery_address: null,
    p_payment_method: 'cash',
    p_payment_screenshot: null,
    p_location_method: 'gps',
    p_area_id: null,
    p_latitude: null,
    p_longitude: null,
    p_items: [
      {
        item_id: 'bcfe5b69-143b-4954-8738-99692f941151', // Shawarma Beef Canonical UUID
        name: 'شاورما لحمة (كيزر)',
        quantity: 1,
        notes: null
      }
    ],
    p_idempotency_key: pickupIdempotencyKey,
    p_source: 'online',
    p_turnstile_token: '1x00000000000000000000AA'
  };

  const { data: createPickRes, error: errPickCreate } = await supabase.rpc('create_order', pickupOrderPayload);
  if (errPickCreate) {
    console.error('❌ Pickup Order Creation Failed:', errPickCreate);
    return;
  }
  const pickupOrderId = createPickRes.order_id;
  console.log(`Step 1 [created]: Pickup Order ID=${pickupOrderId} (#${createPickRes.order_number}) | Initial Status=${createPickRes.status}`);

  // Transition Pickup to preparing -> ready -> delivered
  await supabase.rpc('transition_order_status', { p_order_id: pickupOrderId, p_target_status: 'preparing', p_mutation_id: crypto.randomUUID() });
  console.log('Step 2 [preparing]: Pickup transitioning to preparing.');

  await supabase.rpc('transition_order_status', { p_order_id: pickupOrderId, p_target_status: 'ready', p_mutation_id: crypto.randomUUID() });
  console.log('Step 3 [ready]: Pickup ready for customer collection.');

  const { data: pickupDeliveredRes, error: errPickDeliv } = await supabase.rpc('transition_order_status', {
    p_order_id: pickupOrderId,
    p_target_status: 'delivered',
    p_reason: 'استلام العميل من الفرع',
    p_mutation_id: crypto.randomUUID()
  });
  console.log('Step 4 [delivered]: Pickup order marked delivered without pilot assignment Result=', pickupDeliveredRes || errPickDeliv);


  // ============================================================
  // TEST 3: FAILED DELIVERY FLOW
  // ============================================================
  console.log('\n--- TEST 3: FAILED DELIVERY FLOW ---');

  const failIdempotencyKey = crypto.randomUUID();
  const failOrderPayload = { ...deliveryOrderPayload, p_idempotency_key: failIdempotencyKey, p_customer_name: 'إختبار تعذر التوصيل' };
  const { data: createFailRes } = await supabase.rpc('create_order', failOrderPayload);
  const failOrderId = createFailRes.order_id;

  await supabase.rpc('transition_order_status', { p_order_id: failOrderId, p_target_status: 'preparing', p_mutation_id: crypto.randomUUID() });
  await supabase.rpc('transition_order_status', { p_order_id: failOrderId, p_target_status: 'ready', p_mutation_id: crypto.randomUUID() });
  await supabase.rpc('assign_order_to_pilot', { p_order_id: failOrderId, p_pilot_id: testDriver.id, p_pilot_name: testDriver.name, p_mutation_id: crypto.randomUUID() });
  await supabase.rpc('start_pilot_trip', { p_order_id: failOrderId, p_mutation_id: crypto.randomUUID() });

  const { data: failRes, error: errFail } = await supabase.rpc('fail_order_delivery', {
    p_order_id: failOrderId,
    p_reason: 'العميل لا يجيب على الهاتف',
    p_mutation_id: crypto.randomUUID()
  });
  console.log('Failed Delivery Result:', failRes || errFail);


  // ============================================================
  // TEST 4: INVALID TRANSITION SAFETY CHECK
  // ============================================================
  console.log('\n--- TEST 4: INVALID TRANSITION SAFETY CHECK ---');

  // Attempt invalid transition: pending -> delivered directly
  const { data: invalidRes, error: errInvalid } = await supabase.rpc('transition_order_status', {
    p_order_id: pickupOrderId, // Already delivered
    p_target_status: 'preparing',
    p_mutation_id: crypto.randomUUID()
  });
  console.log('Attempt invalid transition (delivered -> preparing):', { data: invalidRes, error: errInvalid });
}

runPhase3Verification();
