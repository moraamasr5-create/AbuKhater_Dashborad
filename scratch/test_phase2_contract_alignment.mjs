import { createClient } from '@supabase/supabase-js';

const url = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';
const supabase = createClient(url, anonKey);

async function testContractAlignment() {
  console.log('=== PHASE 2 CONTRACT ALIGNMENT VERIFICATION ===\n');

  // Fetch recent orders
  const { data: rawOrders, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery:delivery_id(id, name, phone, state)')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching orders:', error);
    return;
  }

  console.log(`Fetched ${rawOrders.length} recent orders from Supabase.\n`);

  rawOrders.forEach((row, idx) => {
    const rawPayload = row.raw_payload || {};
    const rawItems = (row.order_items && row.order_items.length > 0)
      ? row.order_items.map((i, iIdx) => {
          const payloadItem = (rawPayload.items || [])[iIdx] || {};
          return {
            name: i.product_name || payloadItem.name || 'صنف غير معروف',
            count: Number(i.quantity || payloadItem.quantity || payloadItem.count || 1),
            price: Number(i.unit_price || payloadItem.price || payloadItem.unit_price || 0),
            menuItemId: i.item_id || i.menu_item_id || payloadItem.product_id || payloadItem.menuItemId || null,
            selected_variant: payloadItem.selected_variant || null,
            selected_options: payloadItem.selected_options || [],
            notes: i.notes || payloadItem.notes || null
          };
        })
      : (rawPayload.items || []).map(item => ({
          name: item.name || item.item_name || 'صنف غير معروف',
          count: Number(item.quantity || item.count || 1),
          price: Number(item.price || item.unit_price || 0),
          menuItemId: item.product_id || item.menuItemId || item.menu_item_id || item.id || null,
          selected_variant: item.selected_variant || null,
          selected_options: item.selected_options || [],
          notes: item.notes || null
        }));

    console.log(`Order #${idx + 1} [ID: ${row.id}] - Status: ${row.status} - Customer: ${row.customer_name}`);
    rawItems.forEach((item, itemIdx) => {
      console.log(`  Item ${itemIdx + 1}: ${item.count}x "${item.name}" (Price: ${item.price} EGP | ItemID: ${item.menuItemId})`);
      if (item.selected_variant) {
        console.log(`    -> Selected Variant:`, item.selected_variant);
      }
      if (item.selected_options && item.selected_options.length > 0) {
        console.log(`    -> Selected Options:`, item.selected_options);
      }
    });
    console.log('');
  });
}

testContractAlignment();
