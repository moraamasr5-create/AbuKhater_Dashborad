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

async function testFixNullStrings() {
  console.log('--- 1. Updating NULL string columns on auth.users for admin@abukhater.com ---');
  runSql(`
    UPDATE auth.users
    SET 
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
      is_anonymous = COALESCE(is_anonymous, false)
    WHERE email = 'admin@abukhater.com';
  `);

  console.log('--- 2. Testing signInWithPassword for admin@abukhater.com with WRONG password ---');
  const resWrong = await supabase.auth.signInWithPassword({
    email: 'admin@abukhater.com',
    password: 'definitely_wrong_password_test'
  });
  console.log('Wrong Password Response:', {
    status: resWrong.error?.status,
    message: resWrong.error?.message,
    code: resWrong.error?.code
  });
}

testFixNullStrings().catch(console.error);
