import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_test_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    return execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkEagerTables() {
  const tables = ['identities', 'mfa_factors', 'sessions', 'one_time_tokens', 'webauthn_credentials', 'refresh_tokens'];
  for (const t of tables) {
    console.log(`\n================ Table: auth.${t} ================`);
    const sql = `
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_schema = 'auth' AND table_name = '${t}'
      ORDER BY ordinal_position;
    `;
    console.log(runSql(sql));
  }
}

checkEagerTables().catch(console.error);
