import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_forensic_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function runForensic() {
  console.log('================================================================');
  console.log('🔬 AUTH FORENSIC VERIFICATION');
  console.log('================================================================\n');

  // 1. Detailed breakdown per account
  const accounts = ['admin@abukhater.com', 'casher@abukhater.com', 'driver@abukhater.com'];

  for (const email of accounts) {
    console.log(`========================================================`);
    console.log(`📧 Account: ${email}`);
    console.log(`========================================================`);

    // A. auth.users
    const userSql = `
      SELECT 
        id, instance_id, aud, role, email, 
        encrypted_password IS NOT NULL AS has_password,
        left(encrypted_password, 15) AS pwd_prefix,
        email_confirmed_at, confirmed_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data,
        is_super_admin, is_sso_user, is_anonymous,
        created_at, updated_at
      FROM auth.users
      WHERE email = '${email}';
    `;
    console.log('\n--- [auth.users] ---');
    console.log(runSql(userSql));

    // B. auth.identities
    const identitySql = `
      SELECT 
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at, email
      FROM auth.identities
      WHERE user_id IN (SELECT id FROM auth.users WHERE email = '${email}')
         OR email = '${email}';
    `;
    console.log('--- [auth.identities] ---');
    console.log(runSql(identitySql));

    // C. public.staff_roles
    const staffSql = `
      SELECT 
        id, user_id, email, role, display_name, quick_pin, is_active, created_at
      FROM public.staff_roles
      WHERE email = '${email}';
    `;
    console.log('--- [public.staff_roles] ---');
    console.log(runSql(staffSql));
  }
}

runForensic().catch(console.error);
