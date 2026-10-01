import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

class MockLocalStorage {
  constructor() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = String(value); }
  removeItem(key) { delete this.store[key]; }
  clear() { this.store = {}; }
}

const storage = new MockLocalStorage();

async function debug() {
  console.log('1. Signing in on Client 1...');
  const c1 = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: true }
  });
  const { data: signinData } = await c1.auth.signInWithPassword({
    email: 'admin_1@abukhater.com',
    password: '9090'
  });
  console.log('SignIn User ID:', signinData?.user?.id);

  console.log('\n2. Creating Client 2 with existing storage...');
  const c2 = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: true }
  });

  console.log('3. Registering onAuthStateChange with setTimeout decoupling...');
  c2.auth.onAuthStateChange((event, session) => {
    console.log('EVENT FIRED:', event, 'Has session?', !!session);
    // Decouple from gotrue lock tick using setTimeout
    setTimeout(async () => {
      if (session?.user) {
        console.log('Calling rpc get_my_staff_profile (decoupled)...');
        try {
          const start = Date.now();
          const rpcRes = await c2.rpc('get_my_staff_profile');
          console.log('rpc responded in', Date.now() - start, 'ms. Result:', rpcRes);
        } catch (e) {
          console.error('RPC Error:', e);
        }
      }
    }, 0);
  });
}

debug().catch(console.error);
