import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_auth_check_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkAuthSchema() {
  console.log('--- 1. Auth Schema Migrations ---');
  const migrationsSql = `
    SELECT * 
    FROM auth.schema_migrations 
    ORDER BY version DESC 
    LIMIT 10;
  `;
  console.log(runSql(migrationsSql));

  console.log('\n--- 2. Structure of auth.users ---');
  const usersColsSql = `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
    ORDER BY ordinal_position;
  `;
  console.log(runSql(usersColsSql));

  console.log('\n--- 3. Test Query as supabase_auth_admin ---');
  const authAdminTestSql = `
    DO $$
    DECLARE
      v_user record;
    BEGIN
      -- Simulate GoTrue connection as supabase_auth_admin
      PERFORM set_config('role', 'supabase_auth_admin', true);
      SELECT * INTO v_user FROM auth.users WHERE email = 'admin@abukhater.com' LIMIT 1;
      RAISE NOTICE 'supabase_auth_admin can read auth.users: %', v_user.email;
    END;
    $$;
  `;
  console.log(runSql(authAdminTestSql));

  console.log('\n--- 4. Check all custom functions/triggers in database referencing auth.users ---');
  const customTriggersSql = `
    SELECT 
      n.nspname,
      c.relname,
      t.tgname,
      p.proname,
      pg_get_triggerdef(t.oid)
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE p.proname NOT LIKE 'RI_FKey%'
      AND (n.nspname = 'auth' OR c.relname = 'users');
  `;
  console.log(runSql(customTriggersSql));

  console.log('\n--- 5. Check all users in auth.users ---');
  const allUsersSql = `
    SELECT id, instance_id, aud, role, email, is_super_admin, confirmed_at, created_at, updated_at
    FROM auth.users;
  `;
  console.log(runSql(allUsersSql));
}

checkAuthSchema().catch(console.error);
