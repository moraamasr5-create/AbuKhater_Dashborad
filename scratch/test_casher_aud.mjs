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

async function testCasherAud() {
  console.log('--- Setting aud = authenticated on casher WITHOUT confirmed_at ---');
  runSql(`
    UPDATE auth.users
    SET aud = 'authenticated',
        role = 'authenticated',
        instance_id = '00000000-0000-0000-0000-000000000000',
        encrypted_password = '$2a$10$7u0/JkPL/LSXyobd3ey01.SGkAa5HLpZOtFxUTeUiF7MPzMZsvbEa',
        email_confirmed_at = now(),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
        raw_user_meta_data = '{"full_name":"Cashier"}'::jsonb
    WHERE email = 'casher@abukhater.com';
  `);

  console.log('--- Testing casher login ---');
  const res = await supabase.auth.signInWithPassword({
    email: 'casher@abukhater.com',
    password: 'wrong_password'
  });
  console.log('Casher login result:', {
    status: res.error?.status,
    message: res.error?.message,
    code: res.error?.code
  });
}

testCasherAud().catch(console.error);
