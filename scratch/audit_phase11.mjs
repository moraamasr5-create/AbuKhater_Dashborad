import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

function runDbQuery(sql) {
  const tmpFile = 'scratch/tmp_audit_' + Date.now() + Math.random().toString(36).slice(2, 6) + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const jsonStr = execSync(`npx supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    const jsonStart = jsonStr.indexOf('{');
    const jsonEnd = jsonStr.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const parsed = JSON.parse(jsonStr.substring(jsonStart, jsonEnd + 1));
      return parsed.rows || [];
    }
    return [];
  } catch (e) {
    console.error('Query failed for sql:', sql, e.message);
    return [];
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function audit() {
  console.log('================================================================');
  console.log('🔍 FINAL POST-IMPLEMENTATION AUDIT FOR PHASE 11');
  console.log('================================================================\n');

  // --- ITEM 1: create_order RPC ---
  console.log('--- 1. AUDITING create_order RPC ---');
  const procs = runDbQuery("SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args FROM pg_proc p WHERE p.proname = 'create_order';");
  console.log('Signatures count:', procs.length);
  console.log('Signatures:', procs);

  const defQuery = runDbQuery("SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname = 'create_order';");
  const def = defQuery[0]?.def || '';
  console.log('Has _claim_mutation:', def.includes('_claim_mutation'));
  console.log('Has _verify_turnstile:', def.includes('_verify_turnstile'));
  console.log('Has _get_setting:', def.includes('_get_setting'));
  console.log('Has shifts check:', def.includes('public.shifts'));
  console.log('Has v_user_id := auth.uid():', def.includes('v_user_id := auth.uid()'));
  console.log('Does NOT take p_user_id parameter:', !def.includes('p_user_id'));
  console.log('Inserts user_id into orders:', def.includes('user_id,') && def.includes('v_user_id,'));

  // --- ITEM 2: orders.user_id FK & Index & Old Orders ---
  console.log('\n--- 2. AUDITING orders.user_id FK, Index, Old Orders ---');
  const fkQuery = runDbQuery(`
    SELECT
      tc.constraint_name, kcu.column_name, ccu.table_schema, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'orders' AND kcu.column_name = 'user_id';
  `);
  console.log('Foreign Key on user_id:', fkQuery);

  const idxQuery = runDbQuery("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_user_id';");
  console.log('Index idx_orders_user_id:', idxQuery);

  const ordersCount = runDbQuery("SELECT count(*) filter (where user_id is null) as null_user_orders, count(*) filter (where user_id is not null) as with_user_orders, count(*) as total_orders FROM public.orders;");
  console.log('Orders user_id distribution:', ordersCount);

  // --- ITEM 3: RLS Policies on orders & order_items ---
  console.log('\n--- 3. AUDITING RLS Policies ---');
  const policies = runDbQuery("SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE tablename IN ('orders', 'order_items') ORDER BY tablename, policyname;");
  console.log(`Active Policies count: ${policies.length}`);
  policies.forEach(p => console.log(` - [${p.tablename}] "${p.policyname}" (${p.cmd}) for ${p.roles}: qual=(${p.qual})`));

  // --- ITEM 4: get_customer_recent_orders RPC ---
  console.log('\n--- 4. AUDITING get_customer_recent_orders RPC ---');
  const recentProcs = runDbQuery("SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args FROM pg_proc p WHERE p.proname = 'get_customer_recent_orders';");
  console.log('get_customer_recent_orders overloads count:', recentProcs.length);
  console.log('Signatures:', recentProcs);

  const recentDefQuery = runDbQuery("SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p WHERE p.proname = 'get_customer_recent_orders';");
  const recentDef = recentDefQuery[0]?.def || '';
  console.log('Uses auth.uid() for authenticated customer:', recentDef.includes('v_caller_uid := auth.uid()'));
  console.log('Has LIMIT in query:', recentDef.includes('LIMIT v_limit'));

  // --- ITEM 5: Realtime Configuration & Publication ---
  console.log('\n--- 5. AUDITING Supabase Realtime Publication ---');
  const realtimePub = runDbQuery("SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'orders';");
  console.log('orders in supabase_realtime publication:', realtimePub);

  const replicaIdentity = runDbQuery("SELECT c.relname, c.relreplident FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'orders';");
  console.log('orders replica identity (d = default, f = full):', replicaIdentity);

  // --- ITEM 6: RLS Isolation Live Test ---
  console.log('\n--- 6. LIVE SECURITY & RLS TESTING ---');
  // Anon client
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: anonOrders, error: anonErr } = await anonClient.from('orders').select('id, customer_name').limit(5);
  console.log('Anon direct SELECT orders result:', { count: anonOrders?.length, error: anonErr?.message });

  const { data: anonItems, error: anonItemsErr } = await anonClient.from('order_items').select('id').limit(5);
  console.log('Anon direct SELECT order_items result:', { count: anonItems?.length, error: anonItemsErr?.message });
}

audit().catch(console.error);
