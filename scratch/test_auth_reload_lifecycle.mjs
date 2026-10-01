import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

const sharedStorage = new MockLocalStorage();

class SimulatedAuthLifecycle {
  constructor(storage = sharedStorage) {
    this.storage = storage;
    this.currentUser = null;
    this.currentStaff = null;
    this.userRole = '';
    this.isAuthLoading = true;

    this.client = createClient(SUPABASE_URL, ANON_KEY, {
      auth: {
        storage: this.storage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }

  async getCurrentStaffProfile(userId = null) {
    try {
      let targetUid = userId;
      if (!targetUid) {
        const { data } = await this.client.auth.getSession();
        targetUid = data?.session?.user?.id;
      }
      if (!targetUid) return null;

      // 1. RPC get_my_staff_profile
      const { data: rpcData, error: rpcError } = await this.client.rpc('get_my_staff_profile');
      if (!rpcError && rpcData && rpcData.length > 0) {
        return rpcData[0];
      }

      // 2. Direct query on staff_roles
      const { data, error } = await this.client
        .from('staff_roles')
        .select('*')
        .eq('user_id', targetUid)
        .maybeSingle();

      if (error) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  initAuthLifecycle() {
    return new Promise((resolve, reject) => {
      this.isAuthLoading = true;
      let isMounted = true;

      const handleSession = async (session) => {
        try {
          if (session?.user?.id) {
            const profile = await this.getCurrentStaffProfile(session.user.id);
            if (!isMounted) return;

            if (profile && profile.is_active) {
              this.currentUser = session.user;
              this.currentStaff = profile;
              this.userRole = profile.role;
            } else {
              this.currentUser = null;
              this.currentStaff = null;
              this.userRole = '';
            }
          } else {
            if (!isMounted) return;
            this.currentUser = null;
            this.currentStaff = null;
            this.userRole = '';
          }
        } catch (err) {
          if (!isMounted) return;
          this.currentUser = null;
          this.currentStaff = null;
          this.userRole = '';
        } finally {
          if (isMounted) {
            this.isAuthLoading = false;
            resolve({
              user: this.currentUser,
              staff: this.currentStaff,
              role: this.userRole,
              isLoading: this.isAuthLoading
            });
          }
        }
      };

      const { data: authListener } = this.client.auth.onAuthStateChange((event, session) => {
        if (!isMounted) return;

        if (event === 'SIGNED_OUT' || !session) {
          this.currentUser = null;
          this.currentStaff = null;
          this.userRole = '';
          this.isAuthLoading = false;
          resolve({
            user: null,
            staff: null,
            role: '',
            isLoading: false
          });
          return;
        }

        // Decouple async DB call from synchronous onAuthStateChange handler
        // to prevent GoTrue internal lock deadlock
        setTimeout(() => {
          handleSession(session);
        }, 0);
      });

      // Safety timeout
      setTimeout(() => {
        if (this.isAuthLoading) {
          reject(new Error('DEADLOCK_DETECTED: Auth lifecycle failed to resolve within 4000ms!'));
        }
      }, 4000);
    });
  }

  async signIn({ email, password }) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = await this.getCurrentStaffProfile(data.user.id);
    this.currentUser = data.user;
    this.currentStaff = profile;
    this.userRole = profile?.role || '';
    this.isAuthLoading = false;
    return { user: data.user, profile };
  }

  async signOut() {
    await this.client.auth.signOut();
    this.currentUser = null;
    this.currentStaff = null;
    this.userRole = '';
    this.isAuthLoading = false;
  }
}

async function runReloadTestSuite() {
  console.log('================================================================');
  console.log('🔄 AUTH RELOAD & LIFECYCLE COMPREHENSIVE TEST SUITE');
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
  // Test 1: Reload WITHOUT session (Fresh Visit)
  // -------------------------------------------------------------
  console.log('--- Test 1: Reload without Session (Fresh Browser Visit) ---');
  sharedStorage.clear();
  const app1 = new SimulatedAuthLifecycle(sharedStorage);
  const res1 = await app1.initAuthLifecycle();
  assert(
    res1.isLoading === false && res1.role === '' && res1.user === null,
    'Reload without session resolves to Login screen (isLoading = false, role = empty)',
    JSON.stringify(res1)
  );

  // -------------------------------------------------------------
  // Test 2: Admin Login -> Browser Reload -> Admin Dashboard
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Admin Login -> Browser Reload ---');
  const app2 = new SimulatedAuthLifecycle(sharedStorage);
  await app2.signIn({ email: 'admin_1@abukhater.com', password: '9090' });
  assert(app2.userRole === 'admin', 'Admin signed in successfully before reload');

  console.log('  👉 Simulating Browser Reload (F5)...');
  const app2Reloaded = new SimulatedAuthLifecycle(sharedStorage);
  const res2 = await app2Reloaded.initAuthLifecycle();
  assert(
    res2.isLoading === false && res2.role === 'admin' && res2.user?.email === 'admin_1@abukhater.com',
    'Browser Reload accurately restored Admin session, profile, and role (role = admin, isLoading = false)',
    JSON.stringify(res2)
  );

  // -------------------------------------------------------------
  // Test 3: Multiple Consecutive Rapid Reloads (5x Loop)
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Multiple Consecutive Rapid Reloads (5x Loop) ---');
  let consecutivePass = true;
  for (let i = 1; i <= 5; i++) {
    const loopApp = new SimulatedAuthLifecycle(sharedStorage);
    const loopRes = await loopApp.initAuthLifecycle();
    if (loopRes.isLoading !== false || loopRes.role !== 'admin') {
      consecutivePass = false;
      console.error(`  ❌ Rapid Reload #${i} failed:`, loopRes);
      break;
    }
  }
  assert(consecutivePass, '5x consecutive rapid browser reloads completed with 0 deadlocks and 100% role stability');

  // -------------------------------------------------------------
  // Test 4: Cashier Login -> Browser Reload
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Cashier Login -> Browser Reload ---');
  sharedStorage.clear();
  const appCashier = new SimulatedAuthLifecycle(sharedStorage);
  await appCashier.signIn({ email: 'casher_1@abukhater.com', password: '1233' });
  assert(appCashier.userRole === 'casher', 'Cashier signed in successfully');

  console.log('  👉 Simulating Browser Reload (Cashier)...');
  const appCashierReloaded = new SimulatedAuthLifecycle(sharedStorage);
  const resCashier = await appCashierReloaded.initAuthLifecycle();
  assert(
    resCashier.isLoading === false && resCashier.role === 'casher' && resCashier.user?.email === 'casher_1@abukhater.com',
    'Browser Reload restored Cashier session and role (role = casher, isLoading = false)',
    JSON.stringify(resCashier)
  );

  // -------------------------------------------------------------
  // Test 5: Delivery Driver Login -> Browser Reload
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Delivery Driver Login -> Browser Reload ---');
  sharedStorage.clear();
  const appDriver = new SimulatedAuthLifecycle(sharedStorage);
  await appDriver.signIn({ email: 'delivery_1@abukhater.com', password: '123' });
  assert(appDriver.userRole === 'driver', 'Delivery Driver signed in successfully');

  console.log('  👉 Simulating Browser Reload (Driver)...');
  const appDriverReloaded = new SimulatedAuthLifecycle(sharedStorage);
  const resDriver = await appDriverReloaded.initAuthLifecycle();
  assert(
    resDriver.isLoading === false && resDriver.role === 'driver' && resDriver.user?.email === 'delivery_1@abukhater.com',
    'Browser Reload restored Driver session and role (role = driver, isLoading = false)',
    JSON.stringify(resDriver)
  );

  // -------------------------------------------------------------
  // Test 6: Logout -> Browser Reload -> Resolves to Login Screen
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Logout -> Browser Reload ---');
  await appDriverReloaded.signOut();
  assert(appDriverReloaded.userRole === '' && appDriverReloaded.currentUser === null, 'Driver signed out successfully');

  console.log('  👉 Simulating Browser Reload after Logout...');
  const appAfterLogout = new SimulatedAuthLifecycle(sharedStorage);
  const resLogout = await appAfterLogout.initAuthLifecycle();
  assert(
    resLogout.isLoading === false && resLogout.role === '' && resLogout.user === null,
    'Browser Reload after Logout stays cleanly on Login screen',
    JSON.stringify(resLogout)
  );

  // -------------------------------------------------------------
  // Test 7: Expired / Corrupted Storage Token -> Browser Reload -> Login Screen
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Corrupted Storage Token -> Browser Reload ---');
  sharedStorage.clear();
  sharedStorage.setItem('sb-htpnxizfqmnnkhemvmdz-auth-token', JSON.stringify({
    access_token: 'invalid_corrupted_jwt_token',
    refresh_token: 'invalid_refresh_token',
    user: { id: '00000000-0000-0000-0000-000000000000', email: 'ghost@ghost.com' }
  }));

  const appCorrupted = new SimulatedAuthLifecycle(sharedStorage);
  const resCorrupted = await appCorrupted.initAuthLifecycle();
  assert(
    resCorrupted.isLoading === false && resCorrupted.role === '' && resCorrupted.user === null,
    'Corrupted token gracefully resets and falls back to Login screen (never hangs on loading)',
    JSON.stringify(resCorrupted)
  );

  console.log('\n================================================================');
  console.log(`📊 FINAL TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runReloadTestSuite().catch(err => {
  console.error('❌ Reload test suite runner exception:', err);
  process.exit(1);
});
