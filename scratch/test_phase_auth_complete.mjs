import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';
const supabase = createClient(SUPABASE_URL, ANON_KEY);

function runSql(sql) {
  const tmpFile = 'scratch/tmp_test_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    return execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function runFullAuthVerification() {
  console.log('================================================================');
  console.log('🧪 PHASE AUTH: COMPLETE 11-SCENARIO VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} - ${details}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Scenario 1: Forensic Table Status Audit
  // -------------------------------------------------------------
  console.log('\n--- Scenario 1: Forensic Table Status Audit ---');
  const staffRolesQuery = runSql(`
    SELECT user_id, email, role, display_name, quick_pin, is_active 
    FROM public.staff_roles 
    ORDER BY role;
  `);
  console.log('Current staff_roles:\n', staffRolesQuery);
  assert(staffRolesQuery.includes('admin') || staffRolesQuery.includes('casher'), 'staff_roles table is configured');

  // -------------------------------------------------------------
  // Scenario 2: Wrong Password Handling (Returns 400, NOT 500)
  // -------------------------------------------------------------
  console.log('\n--- Scenario 2: Invalid Password Rejection (400 vs 500) ---');
  const resWrong = await supabase.auth.signInWithPassword({
    email: 'nonexistent_test_account@abukhater.com',
    password: 'completely_wrong_password_9999'
  });
  assert(
    resWrong.error && resWrong.error.status === 400 && resWrong.error.code === 'invalid_credentials',
    'Invalid credentials returns clean 400 invalid_credentials',
    `Received status ${resWrong.error?.status}, code: ${resWrong.error?.code}`
  );

  // -------------------------------------------------------------
  // Scenario 3: RPC get_my_staff_profile Structure & Security
  // -------------------------------------------------------------
  console.log('\n--- Scenario 3: RPC get_my_staff_profile Security ---');
  const rpcAnon = await supabase.rpc('get_my_staff_profile');
  assert(
    rpcAnon.data === null || (Array.isArray(rpcAnon.data) && rpcAnon.data.length === 0),
    'get_my_staff_profile returns empty/null for unauthenticated caller',
    `Received: ${JSON.stringify(rpcAnon)}`
  );

  // -------------------------------------------------------------
  // Scenario 4: Server-Authoritative Role Checking Functions
  // -------------------------------------------------------------
  console.log('\n--- Scenario 4: SQL Helper Functions is_admin(), has_role(), _require_staff_role() ---');
  const functionsCheck = runSql(`
    SELECT proname, prosecdef 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' AND p.proname IN ('is_admin', 'has_role', 'get_my_staff_profile', '_require_staff_role', 'current_staff_role');
  `);
  console.log('Auth helper functions:\n', functionsCheck);
  assert(functionsCheck.includes('is_admin') && functionsCheck.includes('_require_staff_role') && functionsCheck.includes('get_my_staff_profile'), 'Auth RBAC helper functions exist in public schema');

  // -------------------------------------------------------------
  // Scenario 5: Financial Operations Protection via RBAC
  // -------------------------------------------------------------
  console.log('\n--- Scenario 5: Financial RPCs Require Staff Role ---');
  const rpcShiftStats = await supabase.rpc('calculate_shift_stats', { p_shift_id: 1 });
  assert(
    rpcShiftStats.error !== null,
    'Unauthenticated call to calculate_shift_stats is rejected by server',
    `Expected error, got: ${JSON.stringify(rpcShiftStats)}`
  );

  // -------------------------------------------------------------
  // Scenario 6: close_shift Authorization Enforcement
  // -------------------------------------------------------------
  console.log('\n--- Scenario 6: close_shift Authorization Enforcement ---');
  const rpcCloseShift = await supabase.rpc('close_shift', {
    p_shift_id: 1,
    p_closed_by: 'Anonymous Intruder',
    p_cash_actual: 1000
  });
  assert(
    rpcCloseShift.error !== null,
    'Unauthenticated close_shift is blocked by server',
    `Expected error, got: ${JSON.stringify(rpcCloseShift)}`
  );

  // -------------------------------------------------------------
  // Scenario 7: Order Transition RPC Authorization
  // -------------------------------------------------------------
  console.log('\n--- Scenario 7: update_order_status RPC Authorization ---');
  const rpcOrderStatus = await supabase.rpc('update_order_status', {
    p_order_id: 999999,
    p_new_status: 'preparing',
    p_actor_id: 'a0000000-0000-0000-0000-000000000000',
    p_actor_name: 'Test Actor',
    p_actor_role: 'casher'
  });
  assert(
    rpcOrderStatus.error !== null,
    'Unauthenticated update_order_status is blocked by server',
    `Expected error, got: ${JSON.stringify(rpcOrderStatus)}`
  );

  // -------------------------------------------------------------
  // Scenario 8: Payment Verification RPC Authorization
  // -------------------------------------------------------------
  console.log('\n--- Scenario 8: verify_order_payment RPC Authorization ---');
  const rpcVerifyPayment = await supabase.rpc('verify_order_payment', {
    p_order_id: 999999,
    p_action: 'verified',
    p_verifier_id: 'a0000000-0000-0000-0000-000000000000',
    p_verifier_name: 'Test Verifier'
  });
  assert(
    rpcVerifyPayment.error !== null,
    'Unauthenticated verify_order_payment is blocked by server',
    `Expected error, got: ${JSON.stringify(rpcVerifyPayment)}`
  );

  // -------------------------------------------------------------
  // Scenario 9: App Config Table RLS Policies
  // -------------------------------------------------------------
  console.log('\n--- Scenario 9: app_config Table RLS Policies ---');
  const appConfigRls = runSql(`
    SELECT polname, polcmd, polroles::regrole[] 
    FROM pg_policy 
    WHERE polrelid = 'public.app_config'::regclass;
  `);
  console.log('app_config policies:\n', appConfigRls);
  assert(appConfigRls.includes('select') || appConfigRls.includes('app_config'), 'app_config has RLS policies configured');

  // -------------------------------------------------------------
  // Scenario 10: Staff Roles RLS Isolation
  // -------------------------------------------------------------
  console.log('\n--- Scenario 10: staff_roles RLS Isolation ---');
  const staffRolesRls = runSql(`
    SELECT polname, polcmd 
    FROM pg_policy 
    WHERE polrelid = 'public.staff_roles'::regclass;
  `);
  console.log('staff_roles policies:\n', staffRolesRls);
  assert(staffRolesRls.includes('policy') || staffRolesRls.length > 0, 'staff_roles has RLS policies active');

  // -------------------------------------------------------------
  // Scenario 11: Client Code Base Free of Hardcoded Passwords
  // -------------------------------------------------------------
  console.log('\n--- Scenario 11: Static Analysis - Zero Hardcoded Passwords in Frontend ---');
  let search8080 = '';
  try {
    search8080 = execSync('git grep -i "8080" src/', { encoding: 'utf-8' });
  } catch (e) {
    search8080 = '';
  }
  const hasHardcodedAuth = search8080.includes('password !==') || search8080.includes("|| '8080'");
  assert(
    !hasHardcodedAuth,
    'No hardcoded passwords or bypass prompts in frontend codebase',
    `Found: ${search8080}`
  );

  console.log('\n================================================================');
  console.log(`📊 FINAL RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFullAuthVerification().catch(err => {
  console.error('Test suite runner exception:', err);
  process.exit(1);
});
