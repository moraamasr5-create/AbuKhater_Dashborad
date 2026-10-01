import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

const anonClient = createClient(SUPABASE_URL, ANON_KEY);

async function testAnonAccess() {
  console.log('================================================================');
  console.log('🧪 Testing Anonymous REST API Access & Table RLS Protections');
  console.log('================================================================\n');

  const tables = [
    'orders',
    'order_items',
    'shifts',
    'delivery',
    'staff_roles',
    'feedback',
    'reservations',
    'app_config',
    'restaurant_settings',
    'menu_items',
    'delivery_zones',
    'applied_mutations'
  ];

  for (const table of tables) {
    console.log(`\n--- Testing Table: ${table} ---`);
    
    // Test SELECT
    try {
      const { data, error } = await anonClient.from(table).select('*').limit(1);
      if (error) {
        console.log(`  🔒 SELECT blocked: ${error.message} (code: ${error.code})`);
      } else {
        console.log(`  ⚠️ SELECT allowed: Returned ${data.length} rows`);
      }
    } catch (e) {
      console.log(`  🔒 SELECT exception: ${e.message}`);
    }

    // Test INSERT
    try {
      const dummyRecord = { id: '00000000-0000-0000-0000-000000000000' };
      const { data, error } = await anonClient.from(table).insert([dummyRecord]);
      if (error) {
        console.log(`  🔒 INSERT blocked: ${error.message} (code: ${error.code})`);
      } else {
        console.log(`  ⚠️ INSERT allowed: Data inserted`);
      }
    } catch (e) {
      console.log(`  🔒 INSERT exception: ${e.message}`);
    }

    // Test UPDATE
    try {
      const { data, error } = await anonClient.from(table).update({ updated_at: new Date().toISOString() }).eq('id', 'non-existent-id');
      if (error) {
        console.log(`  🔒 UPDATE blocked: ${error.message} (code: ${error.code})`);
      } else {
        console.log(`  ⚠️ UPDATE allowed (or 0 rows affected without error)`);
      }
    } catch (e) {
      console.log(`  🔒 UPDATE exception: ${e.message}`);
    }

    // Test DELETE
    try {
      const { data, error } = await anonClient.from(table).delete().eq('id', 'non-existent-id');
      if (error) {
        console.log(`  🔒 DELETE blocked: ${error.message} (code: ${error.code})`);
      } else {
        console.log(`  ⚠️ DELETE allowed (or 0 rows affected without error)`);
      }
    } catch (e) {
      console.log(`  🔒 DELETE exception: ${e.message}`);
    }
  }
}

testAnonAccess().catch(console.error);
