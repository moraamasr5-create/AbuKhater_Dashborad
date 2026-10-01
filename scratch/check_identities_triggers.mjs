import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_ident_check_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkIdentitiesTriggers() {
  console.log('--- Triggers on auth.identities ---');
  const sql1 = `
    SELECT tgname, proname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'auth' AND c.relname = 'identities';
  `;
  console.log(runSql(sql1));

  console.log('\n--- Triggers on auth.sessions ---');
  const sql2 = `
    SELECT tgname, proname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'auth' AND c.relname = 'sessions';
  `;
  console.log(runSql(sql2));
}

checkIdentitiesTriggers().catch(console.error);
