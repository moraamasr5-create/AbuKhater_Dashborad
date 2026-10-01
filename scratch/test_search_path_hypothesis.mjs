import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_test_sp_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function testSearchPath() {
  console.log('--- Test 1: Calling gen_random_uuid() with search_path = auth ---');
  const sql1 = `
    DO $$
    BEGIN
      SET LOCAL search_path = auth;
      BEGIN
        PERFORM gen_random_uuid();
        RAISE NOTICE 'gen_random_uuid() SUCCEEDED with search_path=auth';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'gen_random_uuid() FAILED with search_path=auth: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
      END;
    END;
    $$;
  `;
  console.log(runSql(sql1));

  console.log('\n--- Test 2: Check schema of gen_random_uuid() function ---');
  const sql2 = `
    SELECT p.proname, n.nspname AS schema 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE p.proname = 'gen_random_uuid';
  `;
  console.log(runSql(sql2));

  console.log('\n--- Test 3: Check search_path configuration for supabase_auth_admin in pg_roles / pg_db_role_setting ---');
  const sql3 = `
    SELECT rolname, rolconfig 
    FROM pg_roles 
    WHERE rolname IN ('supabase_auth_admin', 'supabase_admin', 'authenticator', 'postgres');
  `;
  console.log(runSql(sql3));

  console.log('\n--- Test 4: Check default column expressions in auth.sessions, auth.refresh_tokens, auth.identities ---');
  const sql4 = `
    SELECT table_name, column_name, column_default 
    FROM information_schema.columns 
    WHERE table_schema = 'auth' AND column_default IS NOT NULL
    ORDER BY table_name, ordinal_position;
  `;
  console.log(runSql(sql4));
}

testSearchPath().catch(console.error);
