import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_audit_rpc_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function auditRPCs() {
  console.log('--- RPC Routine Privileges for anon and authenticated ---');
  const query = `
    SELECT 
      routine_name, 
      grantee, 
      privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND grantee IN ('anon', 'authenticated', 'public')
    ORDER BY routine_name, grantee;
  `;
  console.log(runSql(query));
}

auditRPCs().catch(console.error);
