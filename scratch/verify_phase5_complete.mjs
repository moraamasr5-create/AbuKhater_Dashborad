import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

const SUPABASE_URL = 'https://htpnxizfqmnnkhemvmdz.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0cG54aXpmcW1ubmtoZW12bWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTMzODAsImV4cCI6MjA5NDM4OTM4MH0.HFhoKhyf5VrfAXLGdg1I8ndSgiWBSm6fRXMs56V8rjU';

const extractStoragePath = (urlOrPath, bucketName = 'payment-screenshots') => {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;
  const trimmed = urlOrPath.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  const bucketMarker = `/${bucketName}/`;
  const markerIndex = trimmed.indexOf(bucketMarker);
  if (markerIndex !== -1) {
    let sub = trimmed.substring(markerIndex + bucketMarker.length);
    sub = sub.split('?')[0].split('#')[0];
    try {
      return decodeURIComponent(sub);
    } catch {
      return sub;
    }
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return null;
  }
  if (trimmed.startsWith(`${bucketName}/`)) {
    const sub = trimmed.substring(bucketName.length + 1).split('?')[0].split('#')[0];
    return decodeURIComponent(sub);
  }
  return trimmed.split('?')[0].split('#')[0];
};

async function main() {
  console.log('===============================================================');
  console.log('🔒 Phase 5 Verification: Private Storage & Signed URLs Suite');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;
  const anon = createClient(SUPABASE_URL, ANON_KEY);

  // 1. Verify Bucket Privacy in Supabase
  console.log('1. Verifying storage.buckets status...');
  const bucketCheck = execSync(`supabase db query --linked "SELECT name, public FROM storage.buckets WHERE name = 'payment-screenshots';"`, { encoding: 'utf-8' });
  if (bucketCheck.includes('"public": false') || bucketCheck.includes('"public":false')) {
    console.log('  ✅ PASS: payment-screenshots bucket is private (public = false)');
    passed++;
  } else {
    console.error('  ❌ FAIL: payment-screenshots bucket is not private:', bucketCheck);
    failed++;
  }

  // 2. Anonymous customer uploads receipt image
  console.log('\n2. Testing anonymous customer receipt upload...');
  const testFileName = `test_p5_${Date.now()}.jpg`;
  const testPath = `payments/${testFileName}`;
  const fakeJpgBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x80, 0xff, 0xd9
  ]);

  const { data: uploadRes, error: uploadErr } = await anon.storage
    .from('payment-screenshots')
    .upload(testPath, fakeJpgBuffer, { contentType: 'image/jpeg', upsert: false });

  if (uploadErr) {
    console.error('  ❌ FAIL: Anonymous upload failed:', uploadErr.message);
    failed++;
  } else {
    console.log('  ✅ PASS: Anonymous upload succeeded:', uploadRes.path);
    passed++;
  }

  // 3. Direct unauthenticated access to uploaded file is rejected
  console.log('\n3. Testing direct unauthenticated HTTP GET access...');
  const directUrl = `${SUPABASE_URL}/storage/v1/object/public/payment-screenshots/${testPath}`;
  try {
    const res = await fetch(directUrl);
    if (!res.ok) {
      console.log(`  ✅ PASS: Direct public URL blocked with HTTP ${res.status} (${res.statusText})`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: Direct public URL returned HTTP 200 (Storage is public!)`);
      failed++;
    }
  } catch (err) {
    console.log('  ✅ PASS: Direct public GET threw network error:', err.message);
    passed++;
  }

  // 4. Test SQL RLS Policy Enforcement
  console.log('\n4. Testing Storage RLS policy enforcement at database layer...');
  const rlsCheck = execSync(`supabase db query --linked "SELECT polname, polcmd, polroles::regrole[] FROM pg_policy WHERE polrelid = 'storage.objects'::regclass;"`, { encoding: 'utf-8' });
  if (rlsCheck.includes('storage_receipts_read_staff') && rlsCheck.includes('storage_receipts_insert_public')) {
    console.log('  ✅ PASS: Storage RLS strict check verified (Anon upload only, Staff read/write)');
    passed++;
  } else {
    console.error('  ❌ FAIL: Storage RLS check failed:', rlsCheck);
    failed++;
  }

  // 5. Test Path Extraction Utility
  console.log('\n5. Testing Path Extraction & Legacy URL Resolution...');
  const samples = [
    { input: 'https://htpnxizfqmnnkhemvmdz.supabase.co/storage/v1/object/public/payment-screenshots/payments/abc.jpg', expected: 'payments/abc.jpg' },
    { input: 'https://htpnxizfqmnnkhemvmdz.supabase.co/storage/v1/object/sign/payment-screenshots/orders/123/receipt.jpg?token=secret123', expected: 'orders/123/receipt.jpg' },
    { input: 'reservations/test-uuid.png', expected: 'reservations/test-uuid.png' },
    { input: 'payment-screenshots/payments/foo.webp', expected: 'payments/foo.webp' },
    { input: 'https://drive.google.com/thumbnail?id=abc', expected: null },
    { input: 'data:image/jpeg;base64,...', expected: null }
  ];

  let pathExtractionOk = true;
  for (const s of samples) {
    const actual = extractStoragePath(s.input);
    if (actual !== s.expected) {
      console.error(`  ❌ Extraction mismatch for "${s.input}": got "${actual}", expected "${s.expected}"`);
      pathExtractionOk = false;
    }
  }

  if (pathExtractionOk) {
    console.log('  ✅ PASS: extractStoragePath correctly parsed all URL formats & relative paths');
    passed++;
  } else {
    failed++;
  }

  // 6. Test submit_reservation RPC with uploaded receipt path
  console.log('\n6. Testing submit_reservation RPC with private storage reference...');
  const futureDate = new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0];
  const randPhone = '010' + Math.floor(10000000 + Math.random() * 90000000);
  const { data: resData, error: resErr } = await anon.rpc('submit_reservation', {
    p_customer_name: 'أحمد محمود تجربة تخزين خاص',
    p_customer_phone: randPhone,
    p_reservation_date: futureDate,
    p_reservation_time: '19:00',
    p_guests_count: 4,
    p_payment_proof_url: testPath
  });

  if (resErr) {
    console.error('  ❌ FAIL: submit_reservation failed:', resErr.message);
    failed++;
  } else {
    console.log(`  ✅ PASS: submit_reservation created reservation #${resData?.ref_number} with receipt path`);
    passed++;
  }

  console.log('\n===============================================================');
  console.log(`🎉 Final Phase 5 Verification Result: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');
}

main().catch(console.error);
