import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function testMultiplePasswords() {
  const passwords = ['8080', 'admin123456', 'admin123', 'admin', 'password', '12345678', 'wrong_pass'];
  
  for (const pwd of passwords) {
    console.log(`\nTesting password: "${pwd}"`);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'admin@abukhater.com',
      password: pwd
    });
    if (error) {
      console.log(`  ❌ Error (${error.status}): ${error.message} (code: ${error.code})`);
    } else {
      console.log(`  ✅ SUCCESS: Logged in! User ID: ${data?.user?.id}`);
    }
  }
}

testMultiplePasswords();
