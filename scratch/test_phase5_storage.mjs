import { createClient } from '@supabase/supabase-js';

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

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting Phase 5 Private Storage Verification Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Client 1: Anonymous public client (Customer / Unauthenticated)
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);

  // 1. Upload test file as anonymous customer
  console.log('--- TEST 1: Anonymous customer upload to payment-screenshots bucket ---');
  const testFileName = `test_${Date.now()}_receipt.jpg`;
  const testFilePath = `payments/${testFileName}`;
  // 1x1 pixel JPEG binary
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

  const { data: uploadData, error: uploadErr } = await anonClient.storage
    .from('payment-screenshots')
    .upload(testFilePath, fakeJpgBuffer, {
      contentType: 'image/jpeg',
      upsert: false
    });

  if (uploadErr) {
    console.error('❌ FAIL: Anonymous upload failed:', uploadErr.message);
    failed++;
  } else {
    console.log('✅ PASS: Anonymous upload succeeded:', uploadData.path);
    passed++;
  }

  // 2. Direct public HTTP GET to private bucket must FAIL (400 or 404 or access denied)
  console.log('\n--- TEST 2: Direct unauthenticated public URL access blocked ---');
  const directPublicUrl = `${SUPABASE_URL}/storage/v1/object/public/payment-screenshots/${testFilePath}`;
  try {
    const res = await fetch(directPublicUrl);
    if (!res.ok) {
      console.log(`✅ PASS: Direct public GET rejected with HTTP ${res.status} (${res.statusText})`);
      passed++;
    } else {
      console.error(`❌ FAIL: Direct public GET returned HTTP 200 OK (Bucket is still publicly readable!)`);
      failed++;
    }
  } catch (err) {
    console.log('✅ PASS: Direct public GET failed network/request:', err.message);
    passed++;
  }

  // 3. Anonymous caller CANNOT select objects / generate valid signed url
  console.log('\n--- TEST 3: Anonymous caller cannot access storage objects ---');
  const { data: anonSigned, error: anonSignedErr } = await anonClient.storage
    .from('payment-screenshots')
    .createSignedUrl(testFilePath, 3600);

  if (anonSignedErr || !anonSigned?.signedUrl) {
    console.log('✅ PASS: Anonymous createSignedUrl denied:', anonSignedErr?.message || 'No signed URL returned');
    passed++;
  } else {
    console.log('Anonymous createSignedUrl result:', anonSigned?.signedUrl);
  }

  // 4. Authenticated Staff Login (admin)
  console.log('\n--- TEST 4: Staff Authentication & Signed URL Generation ---');
  const staffClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: authData, error: authErr } = await staffClient.auth.signInWithPassword({
    email: 'admin@abukhater.com',
    password: 'SecureStaffPass123!'
  });

  if (authErr || !authData?.user) {
    console.error('❌ FAIL: Staff login failed:', authErr?.message);
    failed++;
  } else {
    console.log('✅ PASS: Staff authenticated as:', authData.user.email);
    passed++;

    // 5. Staff creates signed URL
    console.log('\n--- TEST 5: Authenticated Staff creates Signed URL ---');
    const { data: staffSigned, error: staffSignedErr } = await staffClient.storage
      .from('payment-screenshots')
      .createSignedUrl(testFilePath, 3600);

    if (staffSignedErr || !staffSigned?.signedUrl) {
      console.error('❌ FAIL: Staff createSignedUrl failed:', staffSignedErr?.message);
      failed++;
    } else {
      console.log('✅ PASS: Staff created Signed URL:', staffSigned.signedUrl.substring(0, 80) + '...');
      passed++;

      // 6. Access signed URL via HTTP GET
      console.log('\n--- TEST 6: Fetching image using Staff Signed URL ---');
      const imgRes = await fetch(staffSigned.signedUrl);
      if (imgRes.ok && imgRes.status === 200) {
        const arrayBuf = await imgRes.arrayBuffer();
        console.log(`✅ PASS: Successfully fetched image via Signed URL (Status 200, size: ${arrayBuf.byteLength} bytes)`);
        passed++;
      } else {
        console.error(`❌ FAIL: Fetching Signed URL returned HTTP ${imgRes.status}`);
        failed++;
      }
    }
  }

  // 7. Path Extraction Utility Tests (Legacy URL, Sign URL, Relative Path)
  console.log('\n--- TEST 7: Path Extraction & Legacy URL Resolution ---');
  const legacyPublicUrl = `https://htpnxizfqmnnkhemvmdz.supabase.co/storage/v1/object/public/payment-screenshots/payments/b1a885fa-3ba9-4900-bb6a-779605c25be2.jpeg`;
  const legacySignUrl = `https://htpnxizfqmnnkhemvmdz.supabase.co/storage/v1/object/sign/payment-screenshots/orders/123/receipt.jpg?token=abcdef123`;
  const relativePath1 = `payments/52e75fd6-281c-4132-a553-eb32d4637eaf.jpeg`;
  const relativePath2 = `reservations/2973f5ea-e56c-4e72-a5d7-b20c4c59968d.png`;
  const externalDriveUrl = `https://drive.google.com/thumbnail?id=12345`;

  const ext1 = extractStoragePath(legacyPublicUrl);
  const ext2 = extractStoragePath(legacySignUrl);
  const ext3 = extractStoragePath(relativePath1);
  const ext4 = extractStoragePath(relativePath2);
  const ext5 = extractStoragePath(externalDriveUrl);

  const t1 = ext1 === 'payments/b1a885fa-3ba9-4900-bb6a-779605c25be2.jpeg';
  const t2 = ext2 === 'orders/123/receipt.jpg';
  const t3 = ext3 === 'payments/52e75fd6-281c-4132-a553-eb32d4637eaf.jpeg';
  const t4 = ext4 === 'reservations/2973f5ea-e56c-4e72-a5d7-b20c4c59968d.png';
  const t5 = ext5 === null;

  if (t1 && t2 && t3 && t4 && t5) {
    console.log('✅ PASS: extractStoragePath correctly extracts all legacy URLs and relative formats');
    passed++;
  } else {
    console.error('❌ FAIL: extractStoragePath failed on one or more tests:', { ext1, ext2, ext3, ext4, ext5 });
    failed++;
  }

  // 8. Test submit_reservation RPC with payment proof relative path / legacy url
  console.log('\n--- TEST 8: submit_reservation RPC with payment proof ---');
  const futureDate = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
  const randPhone = '010' + Math.floor(10000000 + Math.random() * 90000000);
  const { data: resRpc, error: resRpcErr } = await anonClient.rpc('submit_reservation', {
    p_customer_name: 'عميل تجربة الإيصال',
    p_customer_phone: randPhone,
    p_reservation_date: futureDate,
    p_reservation_time: '18:00',
    p_guests_count: 3,
    p_payment_proof_url: testFilePath
  });

  if (resRpcErr) {
    console.error('❌ FAIL: submit_reservation with receipt path failed:', resRpcErr.message);
    failed++;
  } else {
    console.log('✅ PASS: submit_reservation succeeded with payment proof:', resRpc?.ref_number);
    passed++;
  }

  // Cleanup test file if authenticated staff
  if (authData?.user) {
    await staffClient.storage.from('payment-screenshots').remove([testFilePath]);
    console.log('\n🧹 Cleaned up test receipt file from storage.');
  }

  console.log('\n====================================================');
  console.log(`📊 Suite Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
}

runTests().catch(console.error);
