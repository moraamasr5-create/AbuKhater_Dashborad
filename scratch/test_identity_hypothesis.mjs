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

async function testIdentityHypothesis() {
  console.log('--- Step 1: Deleting identity for admin@abukhater.com ---');
  runSql("DELETE FROM auth.identities WHERE email = 'admin@abukhater.com';");

  console.log('--- Step 2: Testing signInWithPassword with NO identity row ---');
  const resNoIdent = await supabase.auth.signInWithPassword({
    email: 'admin@abukhater.com',
    password: 'wrong_password_test'
  });
  console.log('Result without identity:', {
    status: resNoIdent.error?.status,
    message: resNoIdent.error?.message,
    code: resNoIdent.error?.code
  });

  console.log('\n--- Step 3: Restoring identity with clean JSONB ---');
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
    );
  `);

  console.log('--- Step 4: Testing signInWithPassword with restored identity ---');
  const resWithIdent = await supabase.auth.signInWithPassword({
    email: 'admin@abukhater.com',
    password: 'wrong_password_test'
  });
  console.log('Result with identity:', {
    status: resWithIdent.error?.status,
    message: resWithIdent.error?.message,
    code: resWithIdent.error?.code
  });
}

testIdentityHypothesis().catch(console.error);
