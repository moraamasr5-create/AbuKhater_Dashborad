import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function testSignIn() {
  console.log('Testing signInWithPassword for admin@abukhater.com ...');
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'admin@abukhater.com',
      password: 'test'
    });
    console.log('Result:', { data, error });
  } catch (e) {
    console.error('Exception:', e);
  }

  console.log('\nTesting signInWithPassword for casher@abukhater.com ...');
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'casher@abukhater.com',
      password: 'test'
    });
    console.log('Result:', { data, error });
  } catch (e) {
    console.error('Exception:', e);
  }
}

testSignIn();
