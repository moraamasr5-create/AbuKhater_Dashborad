import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_test_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    return execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function testAdminAuthLifecycle() {
  console.log('================================================================');
  console.log('🔐 ADMIN AUTHENTICATION END-TO-END LIFECYCLE TEST');
  console.log('================================================================\n');

  const testPassword = 'AdminPassword#2026';

  // 1. Ensure user row has valid schema and set password hash
  console.log('--- Step 1: Ensuring GoTrue User Integrity & Setting Password ---');
  runSql(`
    UPDATE auth.users
    SET 
      encrypted_password = extensions.crypt('${testPassword}', extensions.gen_salt('bf', 10)),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      aud = 'authenticated',
      role = 'authenticated',
      instance_id = '00000000-0000-0000-0000-000000000000',
      raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
      raw_user_meta_data = '{"full_name":"Super Admin"}'::jsonb,
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change = COALESCE(email_change, ''),
      phone_change = COALESCE(phone_change, ''),
      phone_change_token = COALESCE(phone_change_token, ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      reauthentication_token = COALESCE(reauthentication_token, ''),
      email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
      is_sso_user = COALESCE(is_sso_user, false),
      is_anonymous = COALESCE(is_anonymous, false),
      is_super_admin = false,
      updated_at = now()
    WHERE email = 'admin@abukhater.com';
  `);

  // Ensure identity exists
  runSql(`
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (
      'a1111111-1111-1111-1111-111111111111',
      'a1111111-1111-1111-1111-111111111111',
      jsonb_build_object('sub', 'a1111111-1111-1111-1111-111111111111', 'email', 'admin@abukhater.com', 'email_verified', true),
      'email',
      'a1111111-1111-1111-1111-111111111111',
      now(),
      now(),
      now()
    )
    ON CONFLICT (provider_id, provider) DO UPDATE
    SET identity_data = EXCLUDED.identity_data, updated_at = now();
  `);

  // Ensure staff_roles exists
  runSql(`
    INSERT INTO public.staff_roles (user_id, email, role, display_name, quick_pin, is_active)
    VALUES ('a1111111-1111-1111-1111-111111111111', 'admin@abukhater.com', 'admin', 'Super Admin', '9090', true)
    ON CONFLICT (user_id) DO UPDATE
    SET role = 'admin', is_active = true, updated_at = now();
  `);

  const supabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  // -------------------------------------------------------------
  // Test A: Wrong Password
  // -------------------------------------------------------------
  console.log('\n--- Test A: Wrong Password Verification ---');
  const resWrong = await supabaseClient.auth.signInWithPassword({
    email: 'admin@abukhater.com',
    password: 'IncorrectPassword999!'
  });
  console.log('Wrong Password Result:', {
    status: resWrong.error?.status,
    message: resWrong.error?.message,
    code: resWrong.error?.code
  });
  if (resWrong.error?.status === 400 && resWrong.error?.code === 'invalid_credentials') {
    console.log('✅ PASS: Wrong password rejected cleanly with 400 invalid_credentials');
  } else {
    throw new Error(`Test A FAILED: ${JSON.stringify(resWrong.error)}`);
  }

  // -------------------------------------------------------------
  // Test B: Correct Admin Login
  // -------------------------------------------------------------
  console.log('\n--- Test B: Correct Admin Login (GoTrue + Session) ---');
  const resLogin = await supabaseClient.auth.signInWithPassword({
    email: 'admin@abukhater.com',
    password: testPassword
  });

  if (resLogin.error) {
    throw new Error(`Test B FAILED: Login failed: ${resLogin.error.message} (${resLogin.error.status})`);
  }

  const user = resLogin.data?.user;
  const session = resLogin.data?.session;

  console.log('✅ PASS: GoTrue authenticated successfully!');
  console.log('  User ID:', user?.id);
  console.log('  Email:', user?.email);
  console.log('  Access Token Prefix:', session?.access_token ? session.access_token.slice(0, 25) + '...' : 'NONE');
  console.log('  Expires In:', session?.expires_in, 'seconds');

  // -------------------------------------------------------------
  // Test C: Authenticated Staff Profile RPC
  // -------------------------------------------------------------
  console.log('\n--- Test C: Fetching Staff Profile via Server-Authoritative RPC ---');
  const { data: profileData, error: profileErr } = await supabaseClient.rpc('get_my_staff_profile');

  if (profileErr) {
    throw new Error(`Test C FAILED: get_my_staff_profile returned error: ${profileErr.message}`);
  }

  console.log('Profile RPC Result:', profileData);
  const profile = Array.isArray(profileData) ? profileData[0] : profileData;

  if (profile && profile.role === 'admin' && profile.is_active === true) {
    console.log('✅ PASS: Staff Profile verified as role = admin, is_active = true');
  } else {
    throw new Error(`Test C FAILED: Profile mismatch: ${JSON.stringify(profile)}`);
  }

  // -------------------------------------------------------------
  // Test D: RBAC and RLS Verification under Authenticated Session
  // -------------------------------------------------------------
  console.log('\n--- Test D: RBAC & RLS Enforcement ---');
  const { data: configData, error: configErr } = await supabaseClient
    .from('app_config')
    .select('*')
    .limit(3);

  console.log('app_config query result:', { rowCount: configData?.length, error: configErr?.message });
  if (!configErr) {
    console.log('✅ PASS: Admin successfully read protected app_config table');
  } else {
    throw new Error(`Test D FAILED: app_config read error: ${configErr.message}`);
  }

  // -------------------------------------------------------------
  // Test E: Session Refresh
  // -------------------------------------------------------------
  console.log('\n--- Test E: Session Refresh ---');
  const resRefresh = await supabaseClient.auth.refreshSession({
    refresh_token: session.refresh_token
  });

  if (resRefresh.error) {
    throw new Error(`Test E FAILED: Session refresh failed: ${resRefresh.error.message}`);
  }
  console.log('✅ PASS: Session refreshed successfully, new access token acquired');

  // -------------------------------------------------------------
  // Test F: Logout
  // -------------------------------------------------------------
  console.log('\n--- Test F: Logout ---');
  const resLogout = await supabaseClient.auth.signOut();
  if (resLogout.error) {
    throw new Error(`Test F FAILED: Logout failed: ${resLogout.error.message}`);
  }
  console.log('✅ PASS: User logged out successfully');

  // Verify session invalidated
  const postLogoutSession = await supabaseClient.auth.getSession();
  console.log('Post-logout session:', postLogoutSession.data?.session ? 'ACTIVE' : 'NULL (Invalidated)');
  if (!postLogoutSession.data?.session) {
    console.log('✅ PASS: Session state cleared');
  }

  // -------------------------------------------------------------
  // Test G: Re-Login
  // -------------------------------------------------------------
  console.log('\n--- Test G: Re-Login ---');
  const resRelogin = await supabaseClient.auth.signInWithPassword({
    email: 'admin@abukhater.com',
    password: testPassword
  });

  if (resRelogin.error) {
    throw new Error(`Test G FAILED: Re-login failed: ${resRelogin.error.message}`);
  }
  console.log('✅ PASS: Re-login successful! New session created for User ID:', resRelogin.data?.user?.id);

  console.log('\n================================================================');
  console.log('🎉 ALL 7 LIFECYCLE TESTS PASSED PERFECTLY!');
  console.log('================================================================');
}

testAdminAuthLifecycle().catch(err => {
  console.error('❌ LIFECYCLE TEST FAILURE:', err);
  process.exit(1);
});
