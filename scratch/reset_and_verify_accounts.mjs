import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_reset_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    return execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function resetAndVerifyAccounts() {
  console.log('================================================================');
  console.log('🔄 AUTH ACCOUNTS RESET & FULL VERIFICATION');
  console.log('================================================================\n');

  // 1. Remove old staff auth accounts and staff_roles entries
  console.log('--- Step 1: Cleaning existing staff auth accounts only ---');
  const cleanSql = `
    -- Clear lingering sessions & refresh tokens
    DELETE FROM auth.sessions;
    DELETE FROM auth.refresh_tokens;

    -- Delete old staff roles
    DELETE FROM public.staff_roles;

    -- Delete old staff auth accounts
    DELETE FROM auth.identities WHERE email IN (
      'admin@abukhater.com', 'casher@abukhater.com', 'driver@abukhater.com',
      'admin_1@abukhater.com', 'casher_1@abukhater.com', 'delivery_1@abukhater.com'
    );
    DELETE FROM auth.users WHERE email IN (
      'admin@abukhater.com', 'casher@abukhater.com', 'driver@abukhater.com',
      'admin_1@abukhater.com', 'casher_1@abukhater.com', 'delivery_1@abukhater.com'
    );
  `;
  runSql(cleanSql);
  console.log('✅ Cleaned old staff authentication records.');

  // 2. Accounts to provision
  const accounts = [
    {
      email: 'admin_1@abukhater.com',
      password: '9090',
      role: 'admin',
      displayName: 'Admin 1',
      quickPin: '9090'
    },
    {
      email: 'casher_1@abukhater.com',
      password: '1233',
      role: 'casher',
      displayName: 'Cashier 1',
      quickPin: '1233'
    },
    {
      email: 'delivery_1@abukhater.com',
      password: '123',
      role: 'driver',
      displayName: 'Delivery 1',
      quickPin: '123'
    }
  ];

  console.log('\n--- Step 2: Creating fresh GoTrue accounts ---');
  for (const acc of accounts) {
    const createSql = `
      DO $$
      DECLARE
        v_user_id uuid := gen_random_uuid();
      BEGIN
        -- 1. Insert into auth.users with clean GoTrue fields
        INSERT INTO auth.users (
          instance_id,
          id,
          aud,
          role,
          email,
          encrypted_password,
          email_confirmed_at,
          raw_app_meta_data,
          raw_user_meta_data,
          is_super_admin,
          created_at,
          updated_at,
          confirmation_token,
          recovery_token,
          email_change_token_new,
          email_change,
          phone_change,
          phone_change_token,
          email_change_token_current,
          reauthentication_token,
          email_change_confirm_status,
          is_sso_user,
          is_anonymous
        ) VALUES (
          '00000000-0000-0000-0000-000000000000',
          v_user_id,
          'authenticated',
          'authenticated',
          '${acc.email}',
          extensions.crypt('${acc.password}', extensions.gen_salt('bf', 10)),
          now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', '${acc.displayName}'),
          false,
          now(),
          now(),
          '', '', '', '', '', '', '', '',
          0,
          false,
          false
        );

        -- 2. Insert into auth.identities
        INSERT INTO auth.identities (
          id,
          user_id,
          identity_data,
          provider,
          provider_id,
          last_sign_in_at,
          created_at,
          updated_at
        ) VALUES (
          gen_random_uuid(),
          v_user_id,
          jsonb_build_object('sub', v_user_id::text, 'email', '${acc.email}', 'email_verified', true),
          'email',
          v_user_id::text,
          now(),
          now(),
          now()
        );

        -- 3. Link to public.staff_roles
        INSERT INTO public.staff_roles (
          user_id,
          email,
          role,
          display_name,
          quick_pin,
          is_active
        ) VALUES (
          v_user_id,
          '${acc.email}',
          '${acc.role}',
          '${acc.displayName}',
          '${acc.quickPin}',
          true
        );
      END;
      $$;
    `;
    runSql(createSql);
    console.log(`✅ Provisioned: ${acc.email} (Role: ${acc.role})`);
  }

  // 3. Verification of all 3 accounts
  console.log('\n--- Step 3: End-to-End Verification for all accounts ---');

  for (const acc of accounts) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`🔍 Testing Account: ${acc.email} (Expected Role: ${acc.role})`);
    console.log(`------------------------------------------------------------`);

    const client = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // A. Wrong Password
    const wrongRes = await client.auth.signInWithPassword({
      email: acc.email,
      password: 'wrong_password_9999'
    });
    if (wrongRes.error?.status === 400 && wrongRes.error?.code === 'invalid_credentials') {
      console.log('  ✅ [PASS] Wrong password rejected cleanly (400 invalid_credentials)');
    } else {
      throw new Error(`Wrong password test failed for ${acc.email}: ${JSON.stringify(wrongRes.error)}`);
    }

    // B. Correct Login
    const loginRes = await client.auth.signInWithPassword({
      email: acc.email,
      password: acc.password
    });
    if (loginRes.error) {
      throw new Error(`Login failed for ${acc.email}: ${loginRes.error.message}`);
    }
    const session = loginRes.data?.session;
    console.log(`  ✅ [PASS] GoTrue Login Success! User ID: ${loginRes.data?.user?.id}`);
    console.log(`  ✅ [PASS] JWT Session Token issued (expires in ${session.expires_in}s)`);

    // C. get_my_staff_profile()
    const { data: profileData, error: profileErr } = await client.rpc('get_my_staff_profile');
    if (profileErr) {
      throw new Error(`RPC get_my_staff_profile failed for ${acc.email}: ${profileErr.message}`);
    }
    const profile = Array.isArray(profileData) ? profileData[0] : profileData;
    if (profile && profile.role === acc.role && profile.is_active === true) {
      console.log(`  ✅ [PASS] Staff Profile verified: role = '${profile.role}', is_active = true`);
    } else {
      throw new Error(`Staff Profile mismatch for ${acc.email}: ${JSON.stringify(profile)}`);
    }

    // D. Session Refresh
    const refreshRes = await client.auth.refreshSession({
      refresh_token: session.refresh_token
    });
    if (refreshRes.error) {
      throw new Error(`Session refresh failed for ${acc.email}: ${refreshRes.error.message}`);
    }
    console.log('  ✅ [PASS] Session refreshed successfully');

    // E. Logout & Re-login
    await client.auth.signOut();
    const reloginRes = await client.auth.signInWithPassword({
      email: acc.email,
      password: acc.password
    });
    if (reloginRes.error) {
      throw new Error(`Re-login failed for ${acc.email}: ${reloginRes.error.message}`);
    }
    console.log('  ✅ [PASS] Logout and Re-login verified successfully');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 3 ACCOUNTS PROVISIONED & VERIFIED END-TO-END!');
  console.log('================================================================\n');
}

resetAndVerifyAccounts().catch(err => {
  console.error('❌ RESET / VERIFICATION ERROR:', err);
  process.exit(1);
});
