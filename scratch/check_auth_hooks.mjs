import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_auth_hook_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkAuthHooks() {
  console.log('--- 1. Check all functions in auth schema ---');
  const authFuncsSql = `
    SELECT 
      p.proname, 
      pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'auth';
  `;
  console.log(runSql(authFuncsSql));

  console.log('\n--- 2. Check auth.users row for admin in full detail ---');
  const userAdminSql = `
    SELECT *
    FROM auth.users
    WHERE email = 'admin@abukhater.com';
  `;
  console.log(runSql(userAdminSql));

  console.log('\n--- 3. Check auth.audit_log_entries ---');
  const auditLogsSql = `
    SELECT *
    FROM auth.audit_log_entries
    ORDER BY created_at DESC
    LIMIT 10;
  `;
  console.log(runSql(auditLogsSql));
}

checkAuthHooks().catch(console.error);
