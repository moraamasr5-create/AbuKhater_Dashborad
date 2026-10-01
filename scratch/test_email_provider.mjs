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

async function test() {
  console.log('--- Updating raw_base_config ---');
  console.log(runSql(`
    UPDATE auth.instances 
    SET raw_base_config = '{"EXTERNAL_EMAIL_ENABLED": true, "DISABLE_SIGNUP": false}'::text 
    WHERE id = '00000000-0000-0000-0000-000000000000' 
    RETURNING *;
  `));

  console.log('--- Testing Gotrue SignIn after update ---');
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const res = await client.auth.signInWithPassword({
    email: 'admin_1@abukhater.com',
    password: '9090'
  });
  console.log('SignIn result:', res);
}

test();
