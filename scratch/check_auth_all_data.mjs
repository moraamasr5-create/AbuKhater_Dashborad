import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_auth_all_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkAllAuthData() {
  const tables = [
    'auth.instances',
    'auth.mfa_factors',
    'auth.mfa_challenges',
    'auth.mfa_amr_claims',
    'auth.flow_state',
    'auth.one_time_tokens',
    'auth.oauth_clients',
    'auth.oauth_authorizations'
  ];

  for (const t of tables) {
    console.log(`--- Table: ${t} ---`);
    console.log(runSql(`SELECT * FROM ${t} LIMIT 5;`));
  }
}

checkAllAuthData().catch(console.error);
