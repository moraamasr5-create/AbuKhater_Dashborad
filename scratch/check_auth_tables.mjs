import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

function runSql(sql) {
  const tmpFile = 'scratch/tmp_auth_cols_' + Date.now() + '.sql';
  writeFileSync(tmpFile, sql);
  try {
    const out = execSync(`supabase db query --linked -f ${tmpFile}`, { encoding: 'utf-8' });
    return out;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function checkAllAuthTables() {
  console.log('--- 1. Tables in auth schema ---');
  const tablesSql = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'auth' 
    ORDER BY table_name;
  `;
  console.log(runSql(tablesSql));

  console.log('\n--- 2. Columns of auth.identities ---');
  const identitiesColsSql = `
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_schema = 'auth' AND table_name = 'identities' 
    ORDER BY ordinal_position;
  `;
  console.log(runSql(identitiesColsSql));

  console.log('\n--- 3. Row in auth.identities for admin ---');
  const identitiesRowSql = `
    SELECT * 
    FROM auth.identities;
  `;
  console.log(runSql(identitiesRowSql));

  console.log('\n--- 4. Check auth.sessions ---');
  const sessionsColsSql = `
    SELECT * 
    FROM auth.sessions 
    LIMIT 5;
  `;
  console.log(runSql(sessionsColsSql));

  console.log('\n--- 5. Check auth.refresh_tokens ---');
  const refreshColsSql = `
    SELECT * 
    FROM auth.refresh_tokens 
    LIMIT 5;
  `;
  console.log(runSql(refreshColsSql));
}

checkAllAuthTables().catch(console.error);
